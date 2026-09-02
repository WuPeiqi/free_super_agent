/**
 * 视频渲染服务（字幕 + 画中画烧制）
 *
 * 流程：
 * 1. 如果视频源是远端 URL，先下载到临时目录
 * 2. 用 ffmpeg drawtext 滤镜按时间段烧字幕
 * 3. 用 ffmpeg overlay 滤镜按时间段叠画中画（图片）
 * 4. 输出到用户指定路径
 */

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow } from "electron";

const execFileAsync = promisify(execFile);

/**
 * 获取 ffmpeg 可执行文件的实际路径
 * - 打包后：resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg(.exe)
 * - 开发时：通过 ffmpeg-static 包获取
 *
 * 支持的平台为 Windows x64 与 macOS arm64，二者的 ffmpeg-static 二进制均带
 * drawtext 滤镜（依赖 libfreetype），字幕烧制所需。
 */
function getFfmpegPath(): string | null {
  // 打包环境：ffmpeg-static 的 asar.unpacked 路径
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
    return null;
  }

  // 开发环境：ffmpeg-static
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const staticPath = require("ffmpeg-static") as string | null;
    return staticPath ?? null;
  } catch {
    return null;
  }
}

export interface SubtitleRenderItem {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleRenderStyle {
  fontFileName: string;
  fontSize: number;
  color: string;
  strokeSize: number;
  strokeColor: string;
}

export interface PipRenderItem {
  url: string;
  kind: "image" | "video";
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  startTime: number;
  endTime: number;
}

export interface VideoRenderPayload {
  videoUrl: string;
  subtitles: SubtitleRenderItem[];
  subtitleStyle: SubtitleRenderStyle;
  pipItems: PipRenderItem[];
  outputPath: string;
  /** 封面图 base64（data:image/...;base64,...），添加为视频首帧 */
  coverBase64?: string;
  /** 封面展示时长（秒），默认 1 秒 */
  coverDuration?: number;
}

export interface VideoRenderResult {
  success: boolean;
  outputPath?: string;
  error?: string;
}

function getTempDir(): string {
  return join(app.getPath("temp"), "free-super-agent", "video-render");
}

/**
 * 获取字体文件的实际磁盘路径
 * 打包后：从 resources/fonts/ 下读取（extraResources 配置）
 * 开发态：从项目 src/assets/fonts/ 下读取
 */
function getFontFilePath(fontFileName: string): string {
  // 打包环境：extraResources 把字体放到 process.resourcesPath/fonts/
  if (app.isPackaged) {
    const resourcePath = join(process.resourcesPath, "fonts", fontFileName);
    if (existsSync(resourcePath)) {
      return resourcePath;
    }
  }

  // 开发态：从项目根目录的 src/assets/fonts/ 读取
  // electron-vite 编译后 __dirname 在 out/main/，需要回退到项目根
  const projectRoot = app.isPackaged
    ? process.resourcesPath
    : join(__dirname, "../..");
  const devPath = join(projectRoot, "src/assets/fonts", fontFileName);
  if (existsSync(devPath)) {
    return devPath;
  }

  // 再试从 app.getAppPath() 出发
  const appPath = app.getAppPath();
  const appFontPath = join(appPath, "src/assets/fonts", fontFileName);
  if (existsSync(appFontPath)) {
    return appFontPath;
  }

  // 最终兜底：返回文件名，让 ffmpeg 尝试从系统字体查找
  return fontFileName;
}

/**
 * 下载远端文件到临时目录，返回本地路径
 */
async function downloadToTemp(url: string, prefix: string): Promise<string> {
  const tempDir = getTempDir();
  await mkdir(tempDir, { recursive: true });

  const ext = url.includes(".mp4")
    ? ".mp4"
    : url.includes(".mov")
      ? ".mov"
      : ".mp4";
  const fileName = `${prefix}-${Date.now()}${ext}`;
  const filePath = join(tempDir, fileName);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`下载视频失败：${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(filePath, buffer);
  return filePath;
}

/**
 * 下载画中画图片到临时目录
 */
async function downloadPipAsset(
  url: string,
  index: number,
): Promise<string | null> {
  try {
    const tempDir = getTempDir();
    await mkdir(tempDir, { recursive: true });

    // local-pip:// 协议的资源需要从 userData 目录读取
    if (url.startsWith("local-pip://")) {
      const parsed = new URL(url);
      const hostname = parsed.hostname; // images or videos
      const fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
      const localPath = join(
        app.getPath("userData"),
        "pip-history",
        hostname,
        fileName,
      );
      if (existsSync(localPath)) {
        return localPath;
      }
      return null;
    }

    // 远端 URL
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const ext = url.includes(".png")
        ? ".png"
        : url.includes(".webp")
          ? ".webp"
          : ".jpg";
      const fileName = `pip-${index}-${Date.now()}${ext}`;
      const filePath = join(tempDir, fileName);
      const buffer = Buffer.from(await response.arrayBuffer());
      await writeFile(filePath, buffer);
      return filePath;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * 将 HEX 颜色转为 ffmpeg drawtext 格式（去掉 # 号）
 * ffmpeg drawtext fontcolor 格式：0xRRGGBB 或直接 white/black 等
 */
function hexToFfmpegColor(hex: string): string {
  const cleaned = hex.replace("#", "").toLowerCase();
  return `0x${cleaned}`;
}

/**
 * 转义 drawtext 滤镜中的特殊字符
 * 注意：不处理 \n，换行由调用方拆行处理
 */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/;/g, "\\;")
    .replace(/%/g, "%%");
}

/**
 * 获取视频分辨率
 */
async function getVideoResolution(
  videoPath: string,
): Promise<{ width: number; height: number }> {
  const ffmpeg = getFfmpegPath() ?? "ffmpeg";

  try {
    const { stderr } = await execFileAsync(ffmpeg, [
      "-i",
      videoPath,
      "-hide_banner",
    ]).catch((err) => ({ stderr: err.stderr ?? "", stdout: "" }));

    const match = stderr.match(/(\d{2,5})x(\d{2,5})/);
    if (match) {
      return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
    }
  } catch {
    // fallback
  }

  // 默认 1080x1920（竖屏）
  return { width: 1080, height: 1920 };
}

/**
 * 获取视频总时长（秒）
 */
async function getVideoDuration(videoPath: string): Promise<number> {
  const ffmpeg = getFfmpegPath() ?? "ffmpeg";

  try {
    const { stderr } = await execFileAsync(ffmpeg, [
      "-i",
      videoPath,
      "-hide_banner",
    ]).catch((err: { stderr?: string }) => ({
      stderr: err.stderr ?? "",
      stdout: "",
    }));

    const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseInt(match[3], 10);
      const centiseconds = parseInt(match[4], 10);
      return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
    }
  } catch {
    // fallback
  }

  return 0;
}

/**
 * 从 ffmpeg stderr 输出中解析当前处理时间（秒）
 */
function parseTimeFromFfmpegOutput(line: string): number | null {
  const match = line.match(/time=(\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  if (!match) {
    return null;
  }
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const centiseconds = parseInt(match[4], 10);
  return hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
}

/**
 * 向所有窗口推送渲染进度
 */
function sendProgress(progress: number): void {
  const clamped = Math.min(100, Math.max(0, Math.round(progress)));
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("video-render:progress", clamped);
  }
}

export async function renderVideo(
  payload: VideoRenderPayload,
): Promise<VideoRenderResult> {
  const ffmpeg = getFfmpegPath();
  console.log("[video-render] 使用 ffmpeg 路径:", ffmpeg);
  if (!ffmpeg) {
    return {
      success: false,
      error: "未找到 ffmpeg，请确认 ffmpeg-static 已安装",
    };
  }

  try {
    sendProgress(0);

    // 1. 准备视频源文件（进度 0~30%）
    let videoPath: string;
    if (
      payload.videoUrl.startsWith("http://") ||
      payload.videoUrl.startsWith("https://")
    ) {
      sendProgress(5);
      videoPath = await downloadToTemp(payload.videoUrl, "source");
      sendProgress(30);
    } else if (payload.videoUrl.startsWith("local-video://local-file/")) {
      videoPath = decodeURIComponent(
        payload.videoUrl.replace("local-video://local-file/", ""),
      );
      sendProgress(30);
    } else if (payload.videoUrl.startsWith("local-video://lipsync-result/")) {
      const fileName = decodeURIComponent(
        payload.videoUrl.replace("local-video://lipsync-result/", ""),
      );
      videoPath = join(
        app.getPath("temp"),
        "free-super-agent",
        "lipsync-result",
        fileName,
      );
      sendProgress(30);
    } else if (payload.videoUrl.startsWith("local-video://douyin-videos/")) {
      const fileName = decodeURIComponent(
        payload.videoUrl.replace("local-video://douyin-videos/", ""),
      );
      videoPath = join(
        app.getPath("temp"),
        "free-super-agent",
        "douyin-videos",
        fileName,
      );
      sendProgress(30);
    } else {
      videoPath = payload.videoUrl;
      sendProgress(30);
    }

    if (!existsSync(videoPath)) {
      return { success: false, error: `视频源文件不存在：${videoPath}` };
    }

    // 2. 获取视频分辨率与时长（进度 30~40%）
    sendProgress(32);
    const resolution = await getVideoResolution(videoPath);
    const { width: videoWidth, height: videoHeight } = resolution;

    // 3. 构建滤镜链
    const filterParts: string[] = [];

    // 3-cover. 封面图作为全屏 overlay（覆盖视频开头 N 秒）
    let coverInputPath: string | null = null;
    const coverDuration = payload.coverDuration ?? 1;
    if (payload.coverBase64) {
      const tempDir = getTempDir();
      await mkdir(tempDir, { recursive: true });
      coverInputPath = join(tempDir, `cover-${Date.now()}.jpg`);
      const base64Data = payload.coverBase64.replace(
        /^data:image\/\w+;base64,/,
        "",
      );
      await writeFile(coverInputPath, Buffer.from(base64Data, "base64"));
    }

    // 3a. 字幕 drawtext 滤镜（支持多行：每行一个 drawtext，y 坐标逐行上移）
    const fontPath = getFontFilePath(payload.subtitleStyle.fontFileName);
    const fontColor = hexToFfmpegColor(payload.subtitleStyle.color);
    const borderColor = hexToFfmpegColor(payload.subtitleStyle.strokeColor);
    // ffmpeg drawtext 的 fontsize 需要按视频分辨率缩放
    // 原始字号是基于 270px 宽预览的，按视频实际宽度等比放大
    const fontScale = videoWidth / 270;
    const fontSize = Math.round(payload.subtitleStyle.fontSize * fontScale);
    const borderW = Math.max(
      1,
      Math.round(payload.subtitleStyle.strokeSize * fontScale),
    );
    // 行间距（像素）
    const lineSpacing = Math.round(fontSize * 1.4);

    for (const subtitle of payload.subtitles) {
      // 按换行符拆成多行
      const lines = subtitle.text.split("\n").filter((line) => line.length > 0);
      const totalLines = lines.length;

      for (let lineIdx = 0; lineIdx < totalLines; lineIdx++) {
        const escapedLine = escapeDrawtext(lines[lineIdx]);
        // 从底部 20% 位置开始，多行时往上偏移
        // 最后一行在 y=h*0.8-text_h，倒数第二行再上移 lineSpacing，以此类推
        const lineOffset = (totalLines - 1 - lineIdx) * lineSpacing;
        const yExpr = `h-h*0.2-text_h-${lineOffset}`;

        const drawtextFilter = [
          `drawtext=fontfile='${fontPath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''")}'`,
          `text='${escapedLine}'`,
          `fontsize=${fontSize}`,
          `fontcolor=${fontColor}`,
          `borderw=${borderW}`,
          `bordercolor=${borderColor}`,
          `x=(w-text_w)/2`,
          `y=${yExpr}`,
          `enable='between(t,${subtitle.start.toFixed(3)},${subtitle.end.toFixed(3)})'`,
        ].join(":");
        filterParts.push(drawtextFilter);
      }
    }

    // 3b. 画中画 overlay 滤镜
    const pipInputs: string[] = [];
    const pipOverlays: string[] = [];

    for (let i = 0; i < payload.pipItems.length; i++) {
      const pip = payload.pipItems[i];
      if (pip.kind !== "image") {
        continue; // 本期只支持图片画中画
      }

      const pipPath = await downloadPipAsset(pip.url, i);
      if (!pipPath) {
        continue;
      }

      // 计算像素位置和尺寸
      const pipW = Math.round((pip.region.width / 100) * videoWidth);
      const pipH = Math.round((pip.region.height / 100) * videoHeight);
      const pipX = Math.round((pip.region.x / 100) * videoWidth);
      const pipY = Math.round((pip.region.y / 100) * videoHeight);

      pipInputs.push(pipPath);

      const overlayFilter = [
        `[pip${i}]scale=${pipW}:${pipH}[pip${i}s]`,
        `[tmp${i}][pip${i}s]overlay=${pipX}:${pipY}:enable='between(t,${pip.startTime.toFixed(3)},${pip.endTime.toFixed(3)})'[tmp${i + 1}]`,
      ];
      pipOverlays.push(...overlayFilter);
    }

    // 4. 组装 ffmpeg 命令
    const args: string[] = ["-y"]; // 覆盖输出

    // 输入文件
    args.push("-i", videoPath);
    // 封面图片作为输入（如果有）
    if (coverInputPath) {
      args.push("-i", coverInputPath);
    }
    for (const pipPath of pipInputs) {
      args.push("-i", pipPath);
    }

    // 计算各输入的索引偏移
    const coverInputIndex = coverInputPath ? 1 : -1;
    const pipInputOffset = coverInputPath ? 2 : 1;

    if (pipInputs.length > 0 || coverInputPath) {
      // 复杂滤镜图：封面 overlay + 画中画 + 字幕
      let complexFilter = "";

      // 起点：主视频
      complexFilter += `[0:v]null[base];`;

      // 画中画部分
      let currentLabel = "base";
      if (pipInputs.length > 0) {
        complexFilter += `[${currentLabel}]null[tmp0];`;
        for (let i = 0; i < pipInputs.length; i++) {
          complexFilter += `[${i + pipInputOffset}:v]null[pip${i}];`;
        }
        complexFilter += pipOverlays.join(";") + ";";
        currentLabel = `tmp${pipInputs.length}`;
      }

      // 封面全屏 overlay（在画中画和字幕之后叠加，确保封面在最上层）
      if (coverInputPath) {
        complexFilter += `[${coverInputIndex}:v]scale=${videoWidth}:${videoHeight}[coverScaled];`;
        complexFilter += `[${currentLabel}][coverScaled]overlay=0:0:enable='between(t,0,${coverDuration.toFixed(3)})'[afterCover];`;
        currentLabel = "afterCover";
      }

      // 字幕部分
      if (filterParts.length > 0) {
        complexFilter += `[${currentLabel}]${filterParts.join(",")}[afterSub];`;
        currentLabel = "afterSub";
      }

      // 最终输出
      complexFilter += `[${currentLabel}]null[out]`;

      args.push("-filter_complex", complexFilter);
      args.push("-map", "[out]");
      args.push("-map", "0:a?");
    } else if (filterParts.length > 0) {
      // 只有字幕，用简单 -vf
      args.push("-vf", filterParts.join(","));
    }

    // 编码参数
    args.push("-c:v", "libx264");
    args.push("-preset", "fast");
    args.push("-crf", "23");
    args.push("-c:a", "copy");
    args.push(payload.outputPath);

    // 5. 执行 ffmpeg（使用 spawn 实时读取进度，编码阶段映射到 40~99%）
    const duration = await getVideoDuration(videoPath);
    sendProgress(40);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderrBuffer = "";

      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuffer += chunk.toString();
        const currentTime = parseTimeFromFfmpegOutput(stderrBuffer);
        if (currentTime !== null && duration > 0) {
          // 编码进度映射到 40~99
          const encodePercent = Math.min(1, currentTime / duration);
          const overallProgress = 40 + encodePercent * 59;
          sendProgress(overallProgress);
        }
        // 只保留最后 2000 字符，避免内存膨胀
        if (stderrBuffer.length > 2000) {
          stderrBuffer = stderrBuffer.slice(-1000);
        }
      });

      proc.on("close", (code) => {
        if (code === 0) {
          sendProgress(100);
          resolve();
        } else {
          reject(
            new Error(`ffmpeg 退出码 ${code}：${stderrBuffer.slice(-500)}`),
          );
        }
      });

      proc.on("error", (err) => {
        reject(err);
      });
    });

    // 6. 清理封面临时文件
    if (coverInputPath) {
      await unlink(coverInputPath).catch(() => undefined);
    }

    return { success: true, outputPath: payload.outputPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "视频渲染失败";
    return { success: false, error: message };
  }
}

/**
 * 截取视频指定时间点的帧，返回 JPEG 字节
 * @param videoUrl  视频地址（https URL 会先下载到临时目录；本地路径直接用）
 * @param timePercent 截取位置百分比（0~100）
 */
/**
 * 把渲染端传来的视频地址解析成主进程可读的本地文件路径
 * 支持 local-video:// 各类子域、远端 URL（先下载）与普通本地路径
 */
export async function resolveVideoLocalPath(videoUrl: string): Promise<string> {
  let resolvedPath = videoUrl;

  // 解析 local-video://local-file/ 协议为本地路径
  if (videoUrl.startsWith("local-video://local-file/")) {
    resolvedPath = decodeURIComponent(
      videoUrl.replace("local-video://local-file/", ""),
    );
  }

  // 解析 local-video://lipsync-result/ 协议为本地路径
  if (videoUrl.startsWith("local-video://lipsync-result/")) {
    const fileName = decodeURIComponent(
      videoUrl.replace("local-video://lipsync-result/", ""),
    );
    resolvedPath = join(
      app.getPath("temp"),
      "free-super-agent",
      "lipsync-result",
      fileName,
    );
  }

  // 解析 local-video://douyin-videos/ 协议为本地路径
  if (videoUrl.startsWith("local-video://douyin-videos/")) {
    const fileName = decodeURIComponent(
      videoUrl.replace("local-video://douyin-videos/", ""),
    );
    resolvedPath = join(
      app.getPath("temp"),
      "free-super-agent",
      "douyin-videos",
      fileName,
    );
  }

  // 远端 URL 先下载
  if (
    resolvedPath.startsWith("http://") ||
    resolvedPath.startsWith("https://")
  ) {
    resolvedPath = await downloadToTemp(resolvedPath, "frame-source");
  }

  if (!existsSync(resolvedPath)) {
    throw new Error(`视频文件不存在：${resolvedPath}`);
  }

  return resolvedPath;
}

/**
 * 生成时间轴缩略图条（filmstrip）
 *
 * 一次 ffmpeg 调用按均匀间隔抽取 count 张小图，供封面设计的时间轴平铺展示。
 * @param videoUrl 视频地址
 * @param count 期望抽取的帧数（实际数量可能相差 1 张，按 ffmpeg 输出为准）
 */
export async function captureVideoFilmstrip(
  videoUrl: string,
  count = 12,
): Promise<{
  frames: ArrayBuffer[];
  mimeType: string;
  duration: number;
}> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    throw new Error("未找到 ffmpeg，请确认 ffmpeg-static 已安装");
  }

  const resolvedPath = await resolveVideoLocalPath(videoUrl);
  const duration = await getVideoDuration(resolvedPath);
  const safeCount = Math.max(2, Math.min(40, Math.floor(count)));

  const tempDir = join(getTempDir(), `filmstrip-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  // fps = 帧数 / 时长 → 在整段视频上均匀取帧；高度固定 120px，宽度按比例（-2 保证偶数）
  const fps = duration > 0 ? safeCount / duration : 1;
  const outputPattern = join(tempDir, "thumb-%03d.jpg");

  try {
    await execFileAsync(
      ffmpeg,
      [
        "-y",
        "-i",
        resolvedPath,
        "-vf",
        `fps=${fps.toFixed(6)},scale=-2:120`,
        "-frames:v",
        String(safeCount),
        "-q:v",
        "4",
        outputPattern,
      ],
      {
        maxBuffer: 20 * 1024 * 1024,
        timeout: 120_000,
      },
    );

    const { readdir, readFile: readFileFs } = await import("node:fs/promises");
    const fileNames = (await readdir(tempDir))
      .filter((name) => name.endsWith(".jpg"))
      .sort();

    const frames: ArrayBuffer[] = [];
    for (const name of fileNames) {
      const buffer = await readFileFs(join(tempDir, name));
      frames.push(buffer.buffer as ArrayBuffer);
    }

    return { duration, frames, mimeType: "image/jpeg" };
  } finally {
    // 清理临时目录（失败不影响主流程）
    const { rm } = await import("node:fs/promises");
    void rm(tempDir, { force: true, recursive: true }).catch(() => undefined);
  }
}

export async function captureVideoFrame(
  videoUrl: string,
  timePercent: number,
): Promise<{ arrayBuffer: ArrayBuffer; mimeType: string }> {
  const ffmpeg = getFfmpegPath();
  if (!ffmpeg) {
    throw new Error("未找到 ffmpeg，请确认 ffmpeg-static 已安装");
  }

  const resolvedPath = await resolveVideoLocalPath(videoUrl);

  // 获取时长
  const duration = await getVideoDuration(resolvedPath);
  const seekTime =
    duration > 0 ? Math.max(0, (timePercent / 100) * duration) : 0;

  const tempDir = getTempDir();
  await mkdir(tempDir, { recursive: true });
  const outputPath = join(tempDir, `frame-${Date.now()}.jpg`);

  // ffmpeg -ss <time> -i <input> -frames:v 1 -q:v 2 <output>
  await execFileAsync(
    ffmpeg,
    [
      "-y",
      "-ss",
      String(seekTime.toFixed(3)),
      "-i",
      resolvedPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      outputPath,
    ],
    {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 30_000,
    },
  );

  const { readFile: readFileFs } = await import("node:fs/promises");
  const buffer = await readFileFs(outputPath);

  // 清理临时文件
  void unlink(outputPath).catch(() => undefined);

  return {
    arrayBuffer: buffer.buffer as ArrayBuffer,
    mimeType: "image/jpeg",
  };
}
