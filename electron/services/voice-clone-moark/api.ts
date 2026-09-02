/**
 * 模力方舟语音克隆 API 调用
 *
 * 流程：
 *   1. 上传音色文件到临时存储（需要 cookie）
 *   2. 同步请求语音合成（IndexTTS-2），直接返回音频 URL
 *
 * 接口：POST https://api.moark.com/v1/audio/speech
 * 模型：IndexTTS-2
 * 返回：{ url, created, format }
 */
import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { logInfo } from "../_shared/logger";
import { resolveFfmpegPath } from "../_shared/ffmpeg-path";
import type { MoarkVoiceCloneConfig } from "./types";

const execFileAsync = promisify(execFile);

const UPLOAD_URL = "https://moark.com/api/base/hub/upload/temp";
const SYNTHESIS_URL = "https://api.moark.com/v1/audio/speech";

/** 上传给模力方舟的音色最大时长（秒），超过则截断 */
const MAX_VOICE_SECONDS = 20;

/** IndexTTS-2 情感强度（0~1），固定值 */
const EMO_ALPHA = 0.5;

interface UploadResponse {
  url?: string;
  error?: string;
  message?: string;
}

interface SynthesisResponse {
  url?: string;
  created?: number;
  format?: string;
  error?: {
    message?: string;
    code?: string;
  };
}

export interface MoarkSynthesisPayload {
  /** 要合成的文本 */
  text: string;
  /** 本地音色文件的绝对路径 */
  voiceFilePath: string;
}

export interface MoarkSynthesisResult {
  audioUrl: string;
}

/**
 * 用 ffmpeg 探测音频时长（秒）。ffmpeg 会把时长信息输出到 stderr，
 * 无法解析时返回 null（此时按不截断处理）。
 */
async function getAudioDurationSeconds(
  filePath: string,
): Promise<number | null> {
  try {
    const result = await execFileAsync(resolveFfmpegPath(), [
      "-i",
      filePath,
    ]).catch((e: { stderr?: string }) => ({ stderr: e?.stderr ?? "" }));
    const stderr = (result as { stderr?: string }).stderr ?? "";
    const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  } catch {
    return null;
  }
}

/**
 * 若音色时长超过 MAX_VOICE_SECONDS，则截断为前 N 秒生成临时文件；
 * 否则原样返回。返回 tempPath 时调用方需在使用后删除临时文件。
 */
async function truncateVoiceIfTooLong(
  voiceFilePath: string,
): Promise<{ uploadPath: string; tempPath: string | null }> {
  const duration = await getAudioDurationSeconds(voiceFilePath);
  if (duration === null || duration <= MAX_VOICE_SECONDS) {
    return { uploadPath: voiceFilePath, tempPath: null };
  }

  const tempPath = join(tmpdir(), `moark-voice-${randomUUID()}.mp3`);
  await execFileAsync(resolveFfmpegPath(), [
    "-y",
    "-t",
    String(MAX_VOICE_SECONDS),
    "-i",
    voiceFilePath,
    "-vn",
    "-acodec",
    "mp3",
    tempPath,
  ]);
  logInfo(
    "moark-upload",
    `音色时长 ${duration.toFixed(1)}s 超过 ${MAX_VOICE_SECONDS}s，已截断为前 ${MAX_VOICE_SECONDS}s 上传`,
  );
  return { uploadPath: tempPath, tempPath };
}

/**
 * 第 1 步：上传音色文件到模力方舟临时存储
 *
 * 上传前：若音色时长超过 15 秒，先截断为前 15 秒再上传。
 */
async function uploadVoiceFile(
  config: MoarkVoiceCloneConfig,
  voiceFilePath: string,
  signal: AbortSignal,
): Promise<string> {
  if (!config.cookies.trim()) {
    throw new Error("请先登录模力方舟");
  }

  const { uploadPath, tempPath } = await truncateVoiceIfTooLong(voiceFilePath);
  try {
    return await uploadVoiceBuffer(config, uploadPath, voiceFilePath, signal);
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => undefined);
  }
}

/**
 * 实际读取文件并上传（uploadPath 为待上传文件，nameSource 用于确定上传文件名/扩展名）
 */
async function uploadVoiceBuffer(
  config: MoarkVoiceCloneConfig,
  uploadPath: string,
  nameSource: string,
  signal: AbortSignal,
): Promise<string> {
  const fileBuffer = await readFile(uploadPath);
  const fileName = basename(nameSource);

  // 根据文件扩展名确定 MIME 类型
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
    aac: "audio/aac",
  };
  const mimeType = mimeMap[ext] || "audio/mpeg";

  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: mimeType });
  formData.append("file", blob, fileName);

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Cookie: config.cookies,
    },
    body: formData,
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("登录已过期，请重新登录模力方舟");
    }
    try {
      const data = (await response.json()) as UploadResponse;
      throw new Error(
        data.message ?? data.error ?? "音色文件上传失败，请重新登录后重试",
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("模力方舟")) throw e;
      if (e instanceof Error && e.message.includes("登录")) throw e;
      if (e instanceof Error && e.message.includes("上传")) throw e;
      throw new Error(`音色文件上传失败（${response.status}）`);
    }
  }

  const data = (await response.json()) as UploadResponse;

  if (!data.url) {
    throw new Error("音色文件上传成功但未返回 URL");
  }

  return data.url;
}

/**
 * 第 2 步：同步请求语音合成（IndexTTS-2）
 *
 * 直接返回音频下载 URL，无需轮询。
 */
async function synthesizeSpeech(
  config: MoarkVoiceCloneConfig,
  text: string,
  promptAudioUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(SYNTHESIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      model: "IndexTTS-2",
      voice: "alloy",
      prompt_audio_url: promptAudioUrl,
      emo_alpha: EMO_ALPHA,
      response_data_format: "url",
    }),
    signal,
  });

  if (!response.ok) {
    // 读取原始响应体（可能不是 JSON），记录并透传真实错误
    const rawBody = await response.text().catch(() => "");
    logInfo(
      "moark-synthesize",
      `合成接口返回 ${response.status}，原始响应：${rawBody || "(空)"}`,
    );

    if (response.status === 401) {
      throw new Error("模力方舟 API Key 无效或已过期，请检查配置");
    }

    let detail = "";
    try {
      const parsed: unknown = JSON.parse(rawBody);
      // 模力方舟错误返回可能是对象或数组，error 可能是字符串或 { message, code }
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      const err = (first as { error?: unknown; message?: string })?.error;
      if (typeof err === "string") {
        detail = err;
      } else if (err && typeof err === "object") {
        const errObj = err as { message?: string; code?: string };
        detail = errObj.message ?? errObj.code ?? "";
      }
      if (!detail) {
        detail = (first as { message?: string })?.message ?? "";
      }
    } catch {
      detail = rawBody.slice(0, 300);
    }
    if (!detail) detail = rawBody.slice(0, 300);

    throw new Error(
      detail
        ? `语音合成失败（${response.status}）：${detail}`
        : `语音合成失败（${response.status}）`,
    );
  }

  const data = (await response.json()) as SynthesisResponse;

  if (!data.url) {
    throw new Error("语音合成成功但未返回音频地址");
  }

  return data.url;
}

/**
 * 完整的语音合成流程：上传音色 → 同步合成
 */
export async function synthesizeVoice(
  config: MoarkVoiceCloneConfig,
  payload: MoarkSynthesisPayload,
  signal: AbortSignal,
): Promise<MoarkSynthesisResult> {
  if (!config.apiKey.trim()) {
    throw new Error("请先配置模力方舟 API Key");
  }
  if (!config.cookies.trim()) {
    throw new Error("请先登录模力方舟");
  }
  if (!payload.text.trim()) {
    throw new Error("请先完成文案创作");
  }
  if (!payload.voiceFilePath) {
    throw new Error("请先选择音色");
  }

  // 检查音色文件格式，非 mp3 提示用户重新上传
  const voiceExt = payload.voiceFilePath.split(".").pop()?.toLowerCase() || "";
  if (voiceExt !== "mp3") {
    throw new Error(
      "当前音色文件格式不是 mp3，请删除该音色后重新上传或录制，系统会自动转换为 mp3 格式。",
    );
  }

  // 第 1 步：上传音色文件获取在线 URL
  const promptAudioUrl = await uploadVoiceFile(
    config,
    payload.voiceFilePath,
    signal,
  );

  // 第 2 步：同步请求语音合成，直接返回结果 URL
  const audioUrl = await synthesizeSpeech(
    config,
    payload.text.trim(),
    promptAudioUrl,
    signal,
  );

  return { audioUrl };
}
