/**
 * 独享算力视频对口型配置读写
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { DedicatedLipSyncConfig } from "./types";

export function getDefaultConfig(): DedicatedLipSyncConfig {
  return { baseUrl: "" };
}

/**
 * 规范化服务器地址：
 *   - 去掉首尾空白与末尾斜杠，避免拼接出 //upload 之类的双斜杠
 *   - 补全协议头：用户常只填 192.168.1.100:8383，缺 http:// 会让 fetch 直接抛
 *     URL 解析错误，且报错信息对用户毫无指导性
 */
export function normalizeBaseUrl(rawBaseUrl: unknown): string {
  if (typeof rawBaseUrl !== "string") return "";

  const trimmed = rawBaseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) return "";

  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function normalize(
  config: Partial<DedicatedLipSyncConfig>,
): DedicatedLipSyncConfig {
  return { baseUrl: normalizeBaseUrl(config.baseUrl) };
}

export async function readConfig(
  storePath: string,
): Promise<DedicatedLipSyncConfig> {
  try {
    return normalize(
      JSON.parse(
        await readFile(storePath, "utf-8"),
      ) as Partial<DedicatedLipSyncConfig>,
    );
  } catch {
    return getDefaultConfig();
  }
}

export async function writeConfig(
  storePath: string,
  config: DedicatedLipSyncConfig,
): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify(normalize(config), null, 2),
    "utf-8",
  );
}
