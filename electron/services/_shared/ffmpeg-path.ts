/**
 * 共享基础设施：解析 ffmpeg 可执行文件路径
 *
 * - 打包后：resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg.exe
 * - 开发时：通过 ffmpeg-static 包获取
 * - 兜底：使用系统 PATH 中的 ffmpeg
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export function resolveFfmpegPath(): string {
  if (process.env.FFMPEG_PATH) {
    return process.env.FFMPEG_PATH;
  }

  // 打包环境
  if (app.isPackaged) {
    const packedPath = join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "ffmpeg-static",
      process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
    );
    if (existsSync(packedPath)) {
      return packedPath;
    }
  }

  // 开发环境
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string | null;
    if (staticPath && existsSync(staticPath)) return staticPath;
  } catch {
    // ignore
  }

  // 兜底：检查系统 PATH 中常见位置
  if (process.platform === "win32") {
    throw new Error(
      "未找到 ffmpeg.exe，请关闭程序后重新打开重试。\n原因：杀毒软件可能拦截了该文件，若多次重试仍失败，请关闭杀毒软件或将本程序所在文件夹加入杀毒软件白名单/排除项。",
    );
  }

  return "ffmpeg";
}
