/**
 * 模力方舟抖音文案提取（独立模块）
 *
 * 流程：
 *   1. 获取抖音视频真实 URL
 *   2. 下载视频到临时目录
 *   3. 用 ffmpeg 提取音频（mp3）
 *   4. 上传音频文件到模力方舟 ASR 接口提取文案
 *
 * 接口：POST https://api.moark.com/v1/audio/transcriptions
 * 认证：Bearer API Key
 * 模型：SenseVoiceSmall
 *
 * 与阿里云实现完全独立，删除时只需移除此文件 + douyin.ts 中对应分支。
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "./_shared/ffmpeg-path";

const execFileAsync = promisify(execFile);

const MOARK_ASR_URL = "https://api.moark.com/v1/audio/transcriptions";

export interface MoarkExtractionConfig {
  apiKey: string;
}

interface MoarkTranscriptionResponse {
  text?: string;
  error?: {
    message?: string;
    code?: string;
  };
}

/**
 * 用 ffmpeg 从视频文件中提取音频为 mp3
 */
async function extractAudioFromVideo(
  videoPath: string,
  tempDir: string,
): Promise<string> {
  await mkdir(tempDir, { recursive: true });
  const audioPath = join(tempDir, `${randomUUID()}.mp3`);

  await execFileAsync(resolveFfmpegPath(), [
    "-y",
    "-i",
    videoPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-b:a",
    "64k",
    audioPath,
  ]);

  return audioPath;
}

/**
 * 上传音频文件到模力方舟 ASR 接口进行转写
 */
async function transcribeAudioWithMoark(
  config: MoarkExtractionConfig,
  audioPath: string,
  signal: AbortSignal,
): Promise<string> {
  const audioBuffer = await readFile(audioPath);
  const fileName = `audio_${randomUUID()}.mp3`;

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
  formData.append("file", blob, fileName);
  formData.append("model", "SenseVoiceSmall");
  formData.append("language", "auto");

  const response = await fetch(MOARK_ASR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: formData,
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("模力方舟 API Key 无效或已过期，请检查配置");
    }
    // 尝试解析错误信息
    try {
      const errData = (await response.json()) as MoarkTranscriptionResponse;
      throw new Error(
        errData.error?.message ??
          errData.error?.code ??
          `模力方舟文案提取失败（${response.status}）`,
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("模力方舟")) throw e;
      throw new Error(`模力方舟文案提取失败（${response.status}）`);
    }
  }

  const data = (await response.json()) as MoarkTranscriptionResponse;

  if (!data.text?.trim()) {
    throw new Error("模力方舟转写结果为空");
  }

  return data.text.trim();
}

/**
 * 完整的模力方舟抖音文案提取流程
 *
 * @param config 模力方舟配置（API Key）
 * @param videoPath 已下载的本地视频文件路径
 * @param tempDir 临时目录（用于存放提取的音频）
 * @param signal 取消信号
 * @returns 提取的文案文本
 */
export async function transcribeVideoWithMoark(
  config: MoarkExtractionConfig,
  videoPath: string,
  tempDir: string,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey.trim()) {
    throw new Error("请先配置提取文案的模力方舟 API Key");
  }

  // 1. 用 ffmpeg 提取音频
  const audioPath = await extractAudioFromVideo(videoPath, tempDir);

  try {
    // 2. 上传音频进行转写
    return await transcribeAudioWithMoark(config, audioPath, signal);
  } finally {
    // 清理临时音频文件
    await unlink(audioPath).catch(() => undefined);
  }
}
