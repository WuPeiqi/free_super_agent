import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

/**
 * 画中画历史素材的主进程读写服务
 *
 * 持久化目录结构：
 *   userData/
 *     pip-history/
 *       images/
 *         <id>.<ext>
 *       videos/
 *         <id>.<ext>
 *       history.json     # 元数据列表
 */

export type PipAssetKind = "image" | "video";

export type PipAssetOrigin = "upload" | "ai";

export interface PipHistoryEntry {
  id: string;
  kind: PipAssetKind;
  origin: PipAssetOrigin;
  url: string;
  mimeType: string;
  fileName: string;
  prompt?: string;
  modelId?: string;
  naturalSize?: {
    width: number;
    height: number;
  };
  createdAt: number;
}

export interface SavePipHistoryPayload {
  kind: PipAssetKind;
  origin: PipAssetOrigin;
  fileName: string;
  mimeType: string;
  arrayBuffer: ArrayBuffer;
  prompt?: string;
  modelId?: string;
}

const HISTORY_FILE_NAME = "history.json";
const IMAGE_DIR_NAME = "images";
const VIDEO_DIR_NAME = "videos";

/**
 * 根据 mimeType 推断文件后缀；找不到时回退到 .bin
 */
function inferExtension(mimeType: string, fileName: string): string {
  const fromName = extname(fileName).toLowerCase();
  if (fromName) {
    return fromName;
  }

  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
    case "image/jpg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    case "video/quicktime":
      return ".mov";
    default:
      return ".bin";
  }
}

function generateId(): string {
  return `pip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function ensureBaseDir(rootDir: string): string {
  return join(rootDir, "pip-history");
}

function ensureKindDir(rootDir: string, kind: PipAssetKind): string {
  return join(
    ensureBaseDir(rootDir),
    kind === "image" ? IMAGE_DIR_NAME : VIDEO_DIR_NAME,
  );
}

function getHistoryFilePath(rootDir: string): string {
  return join(ensureBaseDir(rootDir), HISTORY_FILE_NAME);
}

async function ensureDirectories(rootDir: string): Promise<void> {
  await mkdir(ensureBaseDir(rootDir), { recursive: true });
  await mkdir(ensureKindDir(rootDir, "image"), { recursive: true });
  await mkdir(ensureKindDir(rootDir, "video"), { recursive: true });
}

async function readHistoryFile(rootDir: string): Promise<PipHistoryEntry[]> {
  const filePath = getHistoryFilePath(rootDir);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content) as PipHistoryEntry[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

async function writeHistoryFile(
  rootDir: string,
  entries: PipHistoryEntry[],
): Promise<void> {
  await ensureDirectories(rootDir);
  await writeFile(
    getHistoryFilePath(rootDir),
    JSON.stringify(entries, null, 2),
    "utf-8",
  );
}

/**
 * 拼出渲染端可访问的资源 URL（自定义协议 local-pip://）
 */
function buildAssetUrl(kind: PipAssetKind, fileName: string): string {
  const dir = kind === "image" ? IMAGE_DIR_NAME : VIDEO_DIR_NAME;
  return `local-pip://${dir}/${encodeURIComponent(fileName)}`;
}

export async function listPipHistory(
  rootDir: string,
): Promise<PipHistoryEntry[]> {
  await ensureDirectories(rootDir);
  const entries = await readHistoryFile(rootDir);
  // 按时间倒序，最新的排前面
  return [...entries].sort((a, b) => b.createdAt - a.createdAt);
}

export async function savePipHistoryEntry(
  rootDir: string,
  payload: SavePipHistoryPayload,
): Promise<PipHistoryEntry> {
  await ensureDirectories(rootDir);

  const id = generateId();
  const ext = inferExtension(payload.mimeType, payload.fileName);
  const storedFileName = `${id}${ext}`;
  const targetDir = ensureKindDir(rootDir, payload.kind);
  const targetPath = join(targetDir, storedFileName);

  await writeFile(targetPath, Buffer.from(payload.arrayBuffer));

  const entry: PipHistoryEntry = {
    id,
    kind: payload.kind,
    origin: payload.origin,
    url: buildAssetUrl(payload.kind, storedFileName),
    mimeType: payload.mimeType,
    fileName: payload.fileName,
    prompt: payload.prompt,
    modelId: payload.modelId,
    createdAt: Date.now(),
  };

  const existing = await readHistoryFile(rootDir);
  existing.push(entry);
  await writeHistoryFile(rootDir, existing);
  return entry;
}

export async function deletePipHistoryEntry(
  rootDir: string,
  id: string,
): Promise<void> {
  const entries = await readHistoryFile(rootDir);
  const target = entries.find((entry) => entry.id === id);
  if (!target) {
    return;
  }

  const dir = ensureKindDir(rootDir, target.kind);
  const fileNameFromUrl = decodeURIComponent(target.url.split("/").pop() ?? "");
  const filePath = join(dir, fileNameFromUrl);

  if (fileNameFromUrl && existsSync(filePath)) {
    await rm(filePath, { force: true });
  }

  const next = entries.filter((entry) => entry.id !== id);
  await writeHistoryFile(rootDir, next);
}

/**
 * 通过 url（local-pip://kind/<fileName>）解析出真实磁盘路径
 */
export function resolvePipHistoryFilePath(
  rootDir: string,
  hostname: string,
  pathName: string,
): string | null {
  if (hostname !== IMAGE_DIR_NAME && hostname !== VIDEO_DIR_NAME) {
    return null;
  }
  const fileName = decodeURIComponent(pathName.replace(/^\/+/, ""));
  if (!fileName) {
    return null;
  }
  return join(ensureBaseDir(rootDir), hostname, fileName);
}
