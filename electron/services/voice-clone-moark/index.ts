/**
 * 模力方舟语音克隆对外入口（main.ts 仅依赖此文件）
 *
 * 音色管理：纯本地操作（拷贝文件 + JSON 记录），不涉及网络。
 * 语音合成：上传音色 → 提交任务 → 轮询结果。
 *
 * 完全独立于其他 provider，删除时只需移除整个文件夹 + main.ts 中的 moark IPC handlers。
 */
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  computeFileMd5,
  copyVoiceFile,
  readMoarkVoiceProfiles,
  removeVoiceFile,
  toMoarkVoiceProfileView,
  writeMoarkVoiceProfiles,
} from "./storage";
import type {
  MoarkCreateVoicePayload,
  MoarkUpdateVoicePayload,
  MoarkVoiceProfile,
  MoarkVoiceProfileView,
} from "./types";

/** 获取音色列表 */
export async function listVoices(
  userDataDir: string,
): Promise<MoarkVoiceProfileView[]> {
  const profiles = await readMoarkVoiceProfiles(userDataDir);
  return profiles.map(toMoarkVoiceProfileView);
}

/**
 * 保存音色（仅本地操作，不发网络请求）
 */
export async function createVoiceProfile(
  userDataDir: string,
  payload: MoarkCreateVoicePayload,
): Promise<MoarkVoiceProfileView> {
  if (!payload.name.trim()) {
    throw new Error("请输入音色名称");
  }
  if (!payload.sourceFilePath || !existsSync(payload.sourceFilePath)) {
    throw new Error("音频文件不存在，请重新选择");
  }

  const destPath = await copyVoiceFile(userDataDir, payload.sourceFilePath);
  const md5 = await computeFileMd5(destPath);

  const profile: MoarkVoiceProfile = {
    id: randomUUID(),
    name: payload.name.trim(),
    filePath: destPath,
    md5,
    createdAt: new Date().toISOString(),
  };

  const profiles = await readMoarkVoiceProfiles(userDataDir);
  profiles.unshift(profile);
  await writeMoarkVoiceProfiles(userDataDir, profiles);

  return toMoarkVoiceProfileView(profile);
}

/** 更新音色名称 */
export async function updateVoiceProfile(
  userDataDir: string,
  payload: MoarkUpdateVoicePayload,
): Promise<MoarkVoiceProfileView[]> {
  const profiles = await readMoarkVoiceProfiles(userDataDir);
  const target = profiles.find((p) => p.id === payload.id);
  if (!target) throw new Error("音色不存在");

  target.name = payload.name.trim() || target.name;
  await writeMoarkVoiceProfiles(userDataDir, profiles);
  return profiles.map(toMoarkVoiceProfileView);
}

/** 删除音色 */
export async function deleteVoiceProfile(
  userDataDir: string,
  id: string,
): Promise<MoarkVoiceProfileView[]> {
  const profiles = await readMoarkVoiceProfiles(userDataDir);
  const target = profiles.find((p) => p.id === id);
  const next = profiles.filter((p) => p.id !== id);

  if (target) {
    await removeVoiceFile(target.filePath);
  }

  await writeMoarkVoiceProfiles(userDataDir, next);
  return next.map(toMoarkVoiceProfileView);
}

/**
 * 根据音色 ID 获取本地文件路径（用于合成时上传）
 */
export async function getVoiceFilePath(
  userDataDir: string,
  voiceId: string,
): Promise<string> {
  const profiles = await readMoarkVoiceProfiles(userDataDir);
  const target = profiles.find((p) => p.id === voiceId);
  if (!target) throw new Error("音色不存在，请重新选择");
  if (!existsSync(target.filePath))
    throw new Error("音色文件已丢失，请重新上传");
  return target.filePath;
}

// 语音合成（apiKey / cookies 由中央账户 moark-account 提供）
export { synthesizeVoice } from "./api";
export type {
  MoarkCreateVoicePayload,
  MoarkUpdateVoicePayload,
  MoarkVoiceCloneConfig,
  MoarkVoiceProfileView,
} from "./types";
export type { MoarkSynthesisPayload, MoarkSynthesisResult } from "./api";
