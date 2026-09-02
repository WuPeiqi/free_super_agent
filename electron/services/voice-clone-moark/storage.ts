/**
 * 模力方舟音色本地存储
 *
 * 音色文件拷贝到 userData/moark-voices/ 目录
 * JSON 记录保存在 userData/moark-voices.json
 *
 * 特点：
 *   - 纯本地管理，不涉及任何网络操作
 *   - 不同 API Key 共享同一份本地音色（本质就是本地文件管理）
 *   - 上传的音频文件拷贝到用户目录，防止原文件删除导致丢失
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveFfmpegPath } from "../_shared/ffmpeg-path";
import type { MoarkVoiceProfile, MoarkVoiceProfileView } from "./types";

const execFileAsync = promisify(execFile);

/** 获取音色文件存储目录 */
export function getMoarkVoiceDir(userDataDir: string): string {
  return join(userDataDir, "moark-voices");
}

/** 获取音色 JSON 记录文件路径 */
export function getMoarkVoiceStorePath(userDataDir: string): string {
  return join(userDataDir, "moark-voices.json");
}

/** 读取音色列表 */
export async function readMoarkVoiceProfiles(
  userDataDir: string,
): Promise<MoarkVoiceProfile[]> {
  try {
    const storePath = getMoarkVoiceStorePath(userDataDir);
    return JSON.parse(
      await readFile(storePath, "utf-8"),
    ) as MoarkVoiceProfile[];
  } catch {
    return [];
  }
}

/** 写入音色列表 */
export async function writeMoarkVoiceProfiles(
  userDataDir: string,
  profiles: MoarkVoiceProfile[],
): Promise<void> {
  const storePath = getMoarkVoiceStorePath(userDataDir);
  await mkdir(userDataDir, { recursive: true });
  await writeFile(storePath, JSON.stringify(profiles, null, 2), "utf-8");
}

/** 计算文件 MD5 */
export async function computeFileMd5(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return createHash("md5").update(buffer).digest("hex");
}

/** 拷贝音频文件到 userData/moark-voices/ 目录，统一转码为标准 mp3，返回目标路径 */
export async function copyVoiceFile(
  userDataDir: string,
  sourceFilePath: string,
): Promise<string> {
  const voiceDir = getMoarkVoiceDir(userDataDir);
  await mkdir(voiceDir, { recursive: true });

  // 统一用 ffmpeg 转码为标准 mp3（避免假 mp3 等格式问题）
  const destFileName = `${randomUUID()}.mp3`;
  const destPath = join(voiceDir, destFileName);
  const ffmpegBin = resolveFfmpegPath();

  await execFileAsync(ffmpegBin, [
    "-i",
    sourceFilePath,
    "-y",
    "-ar",
    "44100",
    "-ac",
    "1",
    "-b:a",
    "128k",
    destPath,
  ]);

  return destPath;
}

/** 转换为前端视图（含 local-audio 协议 URL） */
export function toMoarkVoiceProfileView(
  profile: MoarkVoiceProfile,
): MoarkVoiceProfileView {
  const fileName = basename(profile.filePath);
  return {
    id: profile.id,
    name: profile.name,
    filePath: profile.filePath,
    md5: profile.md5,
    createdAt: profile.createdAt,
    audioUrl: `local-audio://moark-voices/${encodeURIComponent(fileName)}`,
  };
}

/** 删除音色文件 */
export async function removeVoiceFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}
