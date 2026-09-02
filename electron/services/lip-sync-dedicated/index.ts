/**
 * 独享算力视频对口型服务入口（对齐 TransDhServer 接口）
 *
 * 调用流程：
 *   1. POST {baseUrl}/upload 逐个上传视频/本地音频，拿到服务器本地路径
 *      （公网 http 音频 URL 可直接透传，无需上传）
 *   2. 客户端生成 code，POST {baseUrl}/submit 提交 { audio_url, video_url, code }
 *   3. 轮询 GET {baseUrl}/query?code=<code>：
 *        code:1 执行中（带 progress）；code:0 成功（data.result 为完整视频 URL）；code:-1 失败
 *   4. 下载 result 到本地缓存，返回 local-video:// 协议地址
 *
 * 取消：POST {baseUrl}/cancel（服务端重启容器，清空任务与显存）。
 * 支持通过 AbortSignal 在任意阶段中止本地轮询/下载。
 */
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { app } from "electron";
import { logInfo } from "../_shared/logger";
import { normalizeBaseUrl } from "./config";
import type {
  DedicatedLipSyncConfig,
  DedicatedSubmitPayload,
  DedicatedTaskResult,
} from "./types";

type StatusCallback = (status: string) => void;

const POLL_INTERVAL = 5000;

const LOG_TAG = "lipsync-dedicated";

interface UploadResponse {
  code?: number;
  msg?: string;
  data?: { path?: string };
}

interface SubmitResponse {
  code?: number;
  msg?: string;
}

interface QueryResponse {
  code?: number;
  msg?: string;
  data?: {
    status?: number;
    progress?: number;
    result?: string;
    video_duration?: number;
    msg?: string;
  };
}

/** 可中断的延时等待 */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * 校验并规范化服务器地址，非法时直接给出可操作的提示，
 * 避免把 "Failed to parse URL" 这种底层错误抛给用户
 */
function resolveBaseUrl(rawBaseUrl: string): string {
  const baseUrl = normalizeBaseUrl(rawBaseUrl);
  if (!baseUrl) {
    throw new Error("请先配置独享算力服务器地址");
  }

  try {
    new URL(baseUrl);
  } catch {
    throw new Error(
      `独享算力服务器地址无法识别：${rawBaseUrl}，请填写形如 http://127.0.0.1:8383 的地址`,
    );
  }

  return baseUrl;
}

/** 把底层网络错误码翻译成用户能照着排查的提示 */
function describeNetworkError(url: string, code: string): string {
  const target = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  switch (code) {
    case "ECONNREFUSED":
      return `无法连接 ${target}：对方端口未监听，请确认算力服务已启动、端口填写正确`;
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `无法连接 ${target}：网络不可达。若服务部署在局域网另一台机器，macOS 需在「系统设置 → 隐私与安全性 → 本地网络」中允许本程序访问`;
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return `连接 ${target} 超时：请确认服务所在机器的防火墙已放行该端口`;
    case "ENOTFOUND":
      return `无法解析地址 ${target}：请检查主机名或改用 IP`;
    default:
      return `连接 ${target} 失败${code ? `（${code}）` : ""}，请检查算力服务地址与网络`;
  }
}

/**
 * 统一发请求：失败时写日志并把网络错误翻译成可读提示。
 * Node 的 fetch 在连接失败时只抛 "fetch failed"，真正原因藏在 error.cause 里。
 * 用户主动取消（abort）时原样抛出，交由上层识别为取消而非错误。
 */
async function requestDedicated(
  action: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) {
      throw error;
    }

    const cause = (error as { cause?: { code?: string; message?: string } })
      .cause;
    const code = cause?.code ?? "";
    const detail = cause?.message ?? (error as Error).message;
    logInfo(LOG_TAG, `${action} 请求失败: ${url} code=${code} ${detail}`);

    throw new Error(describeNetworkError(url, code));
  }
}

/** 上传单个文件到 /upload，返回服务器本地路径 */
async function uploadFile(
  baseUrl: string,
  blob: Blob,
  fileName: string,
  signal?: AbortSignal,
): Promise<string> {
  const formData = new FormData();
  formData.append("file", blob, fileName);

  const response = await requestDedicated("上传文件", `${baseUrl}/upload`, {
    method: "POST",
    body: formData,
    signal,
  });

  const result = (await response.json()) as UploadResponse;
  if (result.code !== 0 || !result.data?.path) {
    logInfo(
      LOG_TAG,
      `上传文件失败: HTTP ${response.status} file=${fileName} msg=${result.msg ?? ""}`,
    );
    throw new Error(result.msg || `文件上传失败（${response.status}）`);
  }
  return result.data.path;
}

/**
 * 把音频解析为提交用的 audio_url：
 *   - 公网 http(s) URL：直接透传（服务端可自行拉取）
 *   - local-audio://synthesized 或二进制：读到本地字节后上传 /upload，返回服务器路径
 */
async function resolveAudioUrlForSubmit(
  baseUrl: string,
  audio: DedicatedSubmitPayload["audio"],
  signal?: AbortSignal,
): Promise<string> {
  if ("arrayBuffer" in audio) {
    return uploadFile(
      baseUrl,
      new Blob([audio.arrayBuffer], { type: audio.mimeType }),
      audio.fileName,
      signal,
    );
  }

  const audioUrl = audio.url;

  // 公网地址直接透传
  if (/^https?:\/\//i.test(audioUrl)) {
    return audioUrl;
  }

  // 本地缓存的合成音频：读文件再上传
  if (audioUrl.startsWith("local-audio://synthesized/")) {
    const { readFile } = await import("node:fs/promises");
    const fileName = basename(
      decodeURIComponent(new URL(audioUrl).pathname.replace(/^\/+/, "")),
    );
    const filePath = join(
      app.getPath("temp"),
      "free-super-agent",
      "synthesized-audio",
      fileName,
    );
    const fileBuffer = await readFile(filePath);
    return uploadFile(
      baseUrl,
      new Blob([fileBuffer], { type: "audio/mpeg" }),
      fileName,
      signal,
    );
  }

  // 其它引用：先下载再上传
  const response = await requestDedicated("下载音频", audioUrl, { signal });
  if (!response.ok) {
    logInfo(LOG_TAG, `下载音频失败: HTTP ${response.status} ${audioUrl}`);
    throw new Error("获取音频失败");
  }
  const arrayBuffer = await response.arrayBuffer();
  return uploadFile(
    baseUrl,
    new Blob([arrayBuffer], { type: "audio/mpeg" }),
    "audio.mp3",
    signal,
  );
}

/** 下载结果视频到本地临时目录，返回 local-video:// 协议地址 */
async function cacheResultVideo(
  remoteUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");

  const resultDir = join(
    app.getPath("temp"),
    "free-super-agent",
    "lipsync-result",
  );
  await mkdir(resultDir, { recursive: true });

  const response = await requestDedicated("下载结果视频", remoteUrl, {
    signal,
  });
  if (!response.ok) {
    logInfo(LOG_TAG, `下载结果视频失败: HTTP ${response.status} ${remoteUrl}`);
    throw new Error(`对口型结果视频下载失败：${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const fileName = `${randomUUID()}.mp4`;
  const filePath = join(resultDir, fileName);
  await writeFile(filePath, buffer);

  return `local-video://lipsync-result/${encodeURIComponent(fileName)}`;
}

/**
 * 提交独享算力对口型任务并轮询至完成
 */
export async function submitTask(
  config: DedicatedLipSyncConfig,
  payload: DedicatedSubmitPayload,
  onStatus?: StatusCallback,
  signal?: AbortSignal,
): Promise<DedicatedTaskResult> {
  const baseUrl = resolveBaseUrl(config.baseUrl);
  logInfo(LOG_TAG, `提交对口型任务: baseUrl=${baseUrl}`);

  // 第一步：上传视频 + 音频，拿到服务器可用的地址
  onStatus?.("上传中...");
  const videoUrl = await uploadFile(
    baseUrl,
    new Blob([payload.video.arrayBuffer], { type: payload.video.mimeType }),
    payload.video.fileName,
    signal,
  );
  const audioUrl = await resolveAudioUrlForSubmit(
    baseUrl,
    payload.audio,
    signal,
  );

  // 第二步：提交任务（code 由客户端生成，作为查询凭据）
  const code = randomUUID().replace(/-/g, "");
  onStatus?.("提交中...");

  const submitResponse = await requestDedicated(
    "提交任务",
    `${baseUrl}/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, video_url: videoUrl, code }),
      signal,
    },
  );

  const submitResult = (await submitResponse.json()) as SubmitResponse;
  if (submitResult.code !== 0) {
    const msg = submitResult.msg ?? "";
    logInfo(
      LOG_TAG,
      `提交任务被拒: HTTP ${submitResponse.status} code=${submitResult.code} msg=${msg}`,
    );
    if (msg.includes("忙碌")) {
      throw new Error(
        "服务器忙碌中（一次只能处理一个任务），请等当前任务完成后再试",
      );
    }
    throw new Error(msg || `对口型任务提交失败（${submitResponse.status}）`);
  }

  // 第三步：轮询任务状态
  onStatus?.("执行中...");
  while (true) {
    await abortableDelay(POLL_INTERVAL, signal);

    const queryResponse = await requestDedicated(
      "查询任务",
      `${baseUrl}/query?code=${encodeURIComponent(code)}`,
      { method: "GET", signal },
    );
    const queryResult = (await queryResponse.json()) as QueryResponse;

    // 执行中
    if (queryResult.code === 1) {
      const progress = queryResult.data?.progress;
      onStatus?.(
        typeof progress === "number" ? `执行中 ${progress}%` : "执行中...",
      );
      continue;
    }

    // 成功：data.result 是完整可访问的视频 URL
    if (queryResult.code === 0) {
      const resultUrl = queryResult.data?.result;
      if (!resultUrl) {
        throw new Error("对口型任务完成但未返回视频地址");
      }
      onStatus?.("下载中...");
      const localUrl = await cacheResultVideo(resultUrl, signal);
      return { outputUrl: localUrl };
    }

    // 其它（code:-1）：任务不存在 / 执行异常 / 忙碌
    logInfo(
      LOG_TAG,
      `任务执行失败: code=${queryResult.code} msg=${queryResult.data?.msg ?? queryResult.msg ?? ""}`,
    );
    throw new Error(
      queryResult.data?.msg || queryResult.msg || "对口型任务执行失败",
    );
  }
}

/**
 * 取消当前任务：调用 /cancel 触发服务端重启容器（清空任务与 GPU 显存）。
 * 服务端会 kill 自身导致连接中断，属预期，静默忽略。
 */
export async function cancelTask(baseUrl: string): Promise<void> {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return;

  try {
    await fetch(`${normalized}/cancel`, { method: "POST" });
  } catch (error) {
    // 服务端重启导致连接中断属预期，只记录不抛出
    const cause = (error as { cause?: { code?: string } }).cause;
    logInfo(
      LOG_TAG,
      `取消任务请求中断（通常属正常）: code=${cause?.code ?? ""}`,
    );
  }
}

export { readConfig, writeConfig, getDefaultConfig } from "./config";
export type {
  DedicatedLipSyncConfig,
  DedicatedMediaFile,
  DedicatedAudioSource,
  DedicatedSubmitPayload,
  DedicatedTaskResult,
} from "./types";
