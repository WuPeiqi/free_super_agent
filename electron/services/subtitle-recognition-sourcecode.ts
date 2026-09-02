/**
 * 模力方舟平台字幕识别服务（OpenAI 兼容 API）
 *
 * 调用端点：https://api.moark.com/v1/audio/transcriptions
 * 模型：whisper-large-v3
 *
 * 采用「句子级别（segment）」时间戳：直接使用接口返回的 segments，
 * 每个 segment 即一条字幕，start/end 为接口给出的真实时间，不做二次切分/插值。
 *
 * 音频来源可能是远程 URL 或本地文件路径：
 *   - 远程 URL：主进程先下载为 Buffer，再以 multipart/form-data 形式提交
 *   - 本地路径：主进程直接读取文件后提交
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type {
  SubtitleRecognitionResult,
  SubtitleSegment,
} from "./subtitle-recognition";

const MOARK_BASE_URL = "https://api.moark.com/v1";
const DEFAULT_MODEL = "whisper-large-v3";

interface MoarkTranscriptionSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  [key: string]: unknown;
}

interface MoarkTranscriptionResponse {
  duration?: string | number;
  language?: string;
  text?: string;
  segments?: MoarkTranscriptionSegment[];
  [key: string]: unknown;
}

/**
 * 下载远端音频文件为 Buffer
 */
async function downloadAudioBuffer(
  url: string,
  signal: AbortSignal,
): Promise<{ buffer: Buffer; fileName: string }> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`下载音频失败: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  // 从 URL 中提取文件名
  const urlPath = new URL(url).pathname;
  const fileName = basename(urlPath) || "audio.mp3";
  return { buffer: Buffer.from(arrayBuffer), fileName };
}

/**
 * 读取本地音频文件为 Buffer
 */
async function readLocalAudioBuffer(
  filePath: string,
): Promise<{ buffer: Buffer; fileName: string }> {
  const buffer = await readFile(filePath);
  const fileName = basename(filePath);
  return { buffer, fileName };
}

/**
 * 构建 multipart/form-data 的 Boundary 和 Body
 */
function buildMultipartFormData(
  audioBuffer: Buffer,
  fileName: string,
  model: string,
): { boundary: string; body: Buffer } {
  const boundary = `----FormBoundary${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const crlf = "\r\n";

  // 根据文件扩展名确定 MIME 类型
  const ext = fileName.split(".").pop()?.toLowerCase() || "mp3";
  const mimeMap: Record<string, string> = {
    mp3: "audio/mpeg",
    wav: "audio/wav",
    m4a: "audio/mp4",
    ogg: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
  };
  const mimeType = mimeMap[ext] || "audio/mpeg";

  const fields: Array<{ name: string; value: string }> = [
    { name: "model", value: model },
    { name: "language", value: "zh" },
    { name: "response_format", value: "verbose_json" },
    // 句子级别时间戳（字段名不带 []，模力方舟只认 timestamp_granularities）
    { name: "timestamp_granularities", value: "segment" },
    { name: "temperature", value: "0.7" },
  ];

  const parts: Buffer[] = [];

  // 文本字段
  for (const field of fields) {
    parts.push(
      Buffer.from(
        `--${boundary}${crlf}Content-Disposition: form-data; name="${field.name}"${crlf}${crlf}${field.value}${crlf}`,
      ),
    );
  }

  // 文件字段
  parts.push(
    Buffer.from(
      `--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${fileName}"${crlf}Content-Type: ${mimeType}${crlf}${crlf}`,
    ),
  );
  parts.push(audioBuffer);
  parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

  return { boundary, body: Buffer.concat(parts) };
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}

/**
 * 模力方舟字幕识别入口
 *
 * @param apiKey 模力方舟 API KEY
 * @param audioSource 音频来源（远程 URL 或本地文件绝对路径）
 * @param signal 取消信号
 */
export async function recognizeMoarkSubtitles(
  apiKey: string,
  audioSource: string,
  signal: AbortSignal,
  modelName?: string,
): Promise<SubtitleRecognitionResult> {
  // 获取音频 Buffer
  let audioBuffer: Buffer;
  let fileName: string;

  if (audioSource.startsWith("local-audio://synthesized/")) {
    // 本地缓存的合成音频
    const { join, basename } = await import("node:path");
    const { app } = await import("electron");
    const decodedName = basename(
      decodeURIComponent(new URL(audioSource).pathname.replace(/^\/+/, "")),
    );
    const filePath = join(
      app.getPath("temp"),
      "free-super-agent",
      "synthesized-audio",
      decodedName,
    );
    audioBuffer = await readFile(filePath);
    fileName = decodedName;
  } else if (/^https?:\/\//i.test(audioSource)) {
    const downloaded = await downloadAudioBuffer(audioSource, signal);
    audioBuffer = downloaded.buffer;
    fileName = downloaded.fileName;
  } else {
    const local = await readLocalAudioBuffer(audioSource);
    audioBuffer = local.buffer;
    fileName = local.fileName;
  }

  // 构建 multipart body
  const { boundary, body } = buildMultipartFormData(
    audioBuffer,
    fileName,
    modelName?.trim() || DEFAULT_MODEL,
  );

  // 发送请求
  const response = await fetch(`${MOARK_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: bufferToArrayBuffer(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `模力方舟字幕识别失败: ${response.status} ${errorText || response.statusText}`,
    );
  }

  const data = (await response.json()) as MoarkTranscriptionResponse;

  // 句子级别：直接使用接口返回的 segments，每段即一条字幕
  const segments = Array.isArray(data.segments) ? data.segments : [];
  const subtitles: SubtitleSegment[] = segments
    .map((seg, index) => ({
      id: `segment-${index + 1}`,
      start: typeof seg.start === "number" ? seg.start : 0,
      end: typeof seg.end === "number" ? seg.end : 0,
      text: typeof seg.text === "string" ? seg.text.trim() : "",
    }))
    .filter((item) => item.text);

  // 生成 SRT 格式
  const srt = subtitles
    .map((item, index) => {
      const startTime = formatSrtTime(item.start);
      const endTime = formatSrtTime(item.end);
      return `${index + 1}\n${startTime} --> ${endTime}\n${item.text}\n`;
    })
    .join("\n");

  const fullText =
    typeof data.text === "string"
      ? data.text
      : subtitles.map((s) => s.text).join("");

  return {
    executionTimeMs: 0,
    requestId: "",
    srt,
    status: "completed",
    subtitles,
    text: fullText,
  };
}

/**
 * 将秒数转为 SRT 时间格式 (HH:MM:SS,mmm)
 */
function formatSrtTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}
