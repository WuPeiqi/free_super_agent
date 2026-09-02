import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

function getLogPath(): string {
  return join(app.getPath("logs"), "zhinengti.txt");
}

function formatTime(): string {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

export function logInfo(tag: string, message: string): void {
  try {
    appendFileSync(getLogPath(), `[${formatTime()}] [INFO] [${tag}] ${message}\n`, "utf-8");
  } catch { /* ignore */ }
}
