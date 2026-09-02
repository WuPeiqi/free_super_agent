import {
  mkdir,
  readFile as fsReadFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  transcribeVideoWithMoark,
  type MoarkExtractionConfig,
} from "./douyin-extraction-moark";

export interface DouyinExtractionResult {
  videoUrl: string;
  text: string;
}

// ===== Aweme Detail API 的类型定义 =====

interface AwemePlayAddr {
  url_list?: string[];
  width?: number;
  height?: number;
  data_size?: number;
}

interface AwemeBitRate {
  play_addr?: AwemePlayAddr;
  bit_rate?: number;
  gear_name?: string;
  is_h265?: number;
}

interface AwemeVideo {
  play_addr?: AwemePlayAddr;
  play_addr_h264?: AwemePlayAddr;
  play_addr_265?: AwemePlayAddr;
  bit_rate?: AwemeBitRate[];
}

interface AwemeDetail {
  desc?: string;
  video?: AwemeVideo;
}

interface AwemeDetailResponse {
  status_code?: number;
  aweme_detail?: AwemeDetail;
}

/** 无水印视频候选项 */
interface VideoCandidate {
  label: string;
  url: string;
  width?: number;
  height?: number;
  dataSize?: number;
  bitRate?: number;
  gearName?: string;
}

const mobileUserAgent =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1";

const desktopUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function getFirstUrl(textOrUrl: string): string {
  const matchList = textOrUrl.match(/https:\/\/[^\s]+/g);

  if (!matchList?.length) {
    throw new Error("短视频地址格式错误");
  }

  return matchList[0].replace(/[，。；;、]+$/g, "");
}

async function resolveShortUrl(
  videoUrl: string,
  signal: AbortSignal,
): Promise<string> {
  if (!videoUrl.startsWith("https://v.douyin.com")) {
    return videoUrl;
  }

  const response = await fetch(videoUrl, {
    headers: {
      "user-agent": mobileUserAgent,
    },
    redirect: "manual",
    signal,
  });

  const location = response.headers.get("location");

  if (!location) {
    throw new Error("抖音短链接解析失败");
  }

  return new URL(location, videoUrl).href;
}

export async function getVideoId(
  textOrUrl: string,
  signal: AbortSignal,
): Promise<string> {
  try {
    const videoUrl = await resolveShortUrl(getFirstUrl(textOrUrl), signal);
    const parsedUrl = new URL(videoUrl);
    const modalId = parsedUrl.searchParams.get("modal_id");

    if (modalId) {
      return modalId;
    }

    const pathList = parsedUrl.pathname.replace(/^\/|\/$/g, "").split("/");
    const videoId = pathList[pathList.length - 1];

    if (!videoId) {
      throw new Error("短视频地址格式错误");
    }

    return videoId;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    throw new Error("抖音视频ID提取失败");
  }
}

// ===== 反爬 Cookie 引导 =====
//
// 抖音 Web 详情接口（aweme/v1/web/aweme/detail）需要合法的反爬 Cookie
// （主要是 ttwid）才会返回数据，否则会以 403 / 空响应拦截。
// 这里在请求详情接口前先获取这些 Cookie：
//   1. 访问抖音首页拿到基础 Cookie（如 __ac_nonce）
//   2. 调用 ttwid 注册接口拿到 ttwid
// Node 的 fetch 没有自动 Cookie 管理，所以用一个模块级 Map 手动维护。

const cookieJar = new Map<string, string>();

/** 从响应的 Set-Cookie 头解析并写入 Cookie 池 */
function storeSetCookies(response: Response): void {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = headers.getSetCookie?.() ?? [];

  for (const raw of setCookies) {
    const pair = raw.split(";")[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;

    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) {
      cookieJar.set(name, value);
    }
  }
}

/** 把 Cookie 池拼成请求头需要的 Cookie 字符串 */
function buildCookieHeader(): string {
  return [...cookieJar.entries()]
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

/** 刷新抖音反爬 Cookie（首页基础 Cookie + ttwid） */
async function refreshDouyinCookies(signal: AbortSignal): Promise<void> {
  // 1. 访问首页获取基础 Cookie
  try {
    const home = await fetch("https://www.douyin.com/", {
      headers: {
        "user-agent": desktopUserAgent,
        referer: "https://www.douyin.com/",
      },
      redirect: "follow",
      signal,
    });
    storeSetCookies(home);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    // 首页失败不致命，继续尝试 ttwid 注册
  }

  // 2. 注册 ttwid
  const body = JSON.stringify({
    region: "cn",
    aid: 1768,
    needFid: false,
    union: true,
    service: "www.ixigua.com",
    cbUrlProtocol: "https",
    migrate_info: { ticket: "", source: "node" },
  });

  const ttwidResponse = await fetch(
    "https://ttwid.bytedance.com/ttwid/union/register/",
    {
      method: "POST",
      headers: {
        "user-agent": desktopUserAgent,
        referer: "https://www.douyin.com/",
        "content-type": "application/json",
      },
      body,
      signal,
    },
  );

  storeSetCookies(ttwidResponse);
}

// ===== Aweme Detail API 获取视频详细信息 =====

/**
 * 通过抖音 Web 详情接口获取视频信息（包含多个无水印下载候选地址）。
 * 依赖 refreshDouyinCookies 预先获取的反爬 Cookie。
 */
async function getAwemeDetail(
  videoId: string,
  signal: AbortSignal,
): Promise<AwemeDetail> {
  const detailUrl = new URL(
    "https://www.douyin.com/aweme/v1/web/aweme/detail/",
  );
  detailUrl.searchParams.set("aweme_id", videoId);

  const response = await fetch(detailUrl.toString(), {
    headers: {
      "user-agent": desktopUserAgent,
      referer: "https://www.douyin.com/",
      cookie: buildCookieHeader(),
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Aweme Detail API 请求失败：${response.status}`);
  }

  const text = await response.text();

  if (!text.trim()) {
    throw new Error("Aweme Detail API 返回空响应（可能被反爬拦截）");
  }

  const data = JSON.parse(text) as AwemeDetailResponse;

  if (!data.aweme_detail) {
    throw new Error("未获取到作品详情，可能已删除、私密或接口有变动");
  }

  return data.aweme_detail;
}

/**
 * 从 AwemePlayAddr 中提取候选 URL 列表
 */
function addAddrCandidates(
  candidates: VideoCandidate[],
  label: string,
  addr?: AwemePlayAddr,
  source?: AwemeBitRate,
): void {
  if (!addr?.url_list) return;

  for (const url of addr.url_list) {
    if (!url) continue;
    candidates.push({
      label,
      url,
      width: addr.width,
      height: addr.height,
      dataSize: addr.data_size,
      bitRate: source?.bit_rate,
      gearName: source?.gear_name,
    });
  }
}

/**
 * 生成所有无水印视频候选 URL（按优先级排序：高码率优先）
 */
function getNoWatermarkCandidates(detail: AwemeDetail): VideoCandidate[] {
  const video = detail.video;
  if (!video) return [];

  const candidates: VideoCandidate[] = [];

  // 1. 按码率排序的 bit_rate 列表（最高质量优先）
  const bitRates = [...(video.bit_rate || [])].sort((a, b) => {
    const aHeight = a.play_addr?.height || 0;
    const bHeight = b.play_addr?.height || 0;
    if (aHeight !== bHeight) return bHeight - aHeight;

    const aBitRate = a.bit_rate || 0;
    const bBitRate = b.bit_rate || 0;
    if (aBitRate !== bBitRate) return bBitRate - aBitRate;

    const aSize = a.play_addr?.data_size || 0;
    const bSize = b.play_addr?.data_size || 0;
    return bSize - aSize;
  });

  for (const bitRate of bitRates) {
    addAddrCandidates(
      candidates,
      `bit_rate:${bitRate.gear_name || "unknown"}`,
      bitRate.play_addr,
      bitRate,
    );
  }

  // 2. H265 地址
  addAddrCandidates(candidates, "play_addr_265", video.play_addr_265);

  // 3. H264 地址
  addAddrCandidates(candidates, "play_addr_h264", video.play_addr_h264);

  // 4. 通用 play_addr
  addAddrCandidates(candidates, "play_addr", video.play_addr);

  // 去重
  const seen = new Set<string>();
  return candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });
}

/**
 * 检查文件是否为有效的 MP4（通过检测 ftyp 签名）
 */
async function looksLikeMp4(filePath: string): Promise<boolean> {
  try {
    const fd = await fsReadFile(filePath);
    const head = fd.subarray(0, 64);
    return head.includes(Buffer.from("ftyp"));
  } catch {
    return false;
  }
}

/**
 * 从多个候选 URL 中尝试下载第一个可用的无水印视频
 */
async function downloadFirstAvailable(
  candidates: VideoCandidate[],
  videoId: string,
  tempDir: string,
  signal: AbortSignal,
): Promise<{ mp4Path: string; candidate: VideoCandidate }> {
  await mkdir(tempDir, { recursive: true });

  let lastError: Error | undefined;

  for (const candidate of candidates) {
    let tempPath: string | undefined;

    try {
      const response = await fetch(candidate.url, {
        headers: {
          "user-agent": desktopUserAgent,
          referer: `https://www.douyin.com/video/${videoId}`,
          cookie: buildCookieHeader(),
          accept: "*/*",
        },
        redirect: "follow",
        signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      tempPath = join(tempDir, `${randomUUID()}.mp4`);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(tempPath, buffer);

      // 检查文件大小
      if (buffer.length < 1024) {
        throw new Error("下载文件过小");
      }

      // 检查 MP4 签名
      if (!(await looksLikeMp4(tempPath))) {
        throw new Error("下载内容不是有效的 MP4 文件");
      }

      return { mp4Path: tempPath, candidate };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // AbortError 直接抛出
      if (lastError.name === "AbortError") {
        throw lastError;
      }

      // 清理失败的临时文件
      if (tempPath) {
        try {
          await unlink(tempPath);
        } catch {
          // 忽略清理失败
        }
      }
    }
  }

  throw new Error(
    `所有无水印视频候选地址均失败：${lastError?.message || "未知错误"}`,
  );
}

// ===== 核心提取函数 =====

export async function extractDouyinVideo(
  textOrUrl: string,
  tempDir: string,
  signal: AbortSignal,
  moarkConfig: MoarkExtractionConfig,
): Promise<DouyinExtractionResult> {
  const videoId = await getVideoId(textOrUrl, signal);

  // 先获取反爬 Cookie，再请求详情接口拿无水印地址
  await refreshDouyinCookies(signal);

  const awemeDetail = await getAwemeDetail(videoId, signal);

  const candidates = getNoWatermarkCandidates(awemeDetail);

  if (candidates.length === 0) {
    throw new Error("抖音视频地址解析失败");
  }

  const { mp4Path } = await downloadFirstAvailable(
    candidates,
    videoId,
    tempDir,
    signal,
  );

  // 文案提取：模力方舟——从已下载的本地视频提取音频 → 上传转写
  const transcriptionText = await transcribeVideoWithMoark(
    moarkConfig,
    mp4Path,
    tempDir,
    signal,
  );

  return {
    text: transcriptionText,
    videoUrl: `local-video://douyin-videos/${encodeURIComponent(basename(mp4Path))}`,
  };
}
