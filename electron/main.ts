import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
  systemPreferences,
} from "electron";
import { basename, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveFfmpegPath } from "./services/_shared/ffmpeg-path";
import {
  createCopyMoark,
  type MoarkCopyCreationPayload as CopyCreationPayload,
} from "./services/copy-creation-moark";
import { extractDouyinVideo } from "./services/douyin";
import type { SubtitleRecognitionResult } from "./services/subtitle-recognition";
import { recognizeMoarkSubtitles } from "./services/subtitle-recognition-sourcecode";
import {
  deletePipHistoryEntry,
  listPipHistory,
  resolvePipHistoryFilePath,
  savePipHistoryEntry,
  type SavePipHistoryPayload as MainSavePipHistoryPayload,
} from "./services/picture-in-picture-history";
import {
  captureVideoFilmstrip,
  captureVideoFrame,
  renderVideo,
  resolveVideoLocalPath,
  type VideoRenderPayload,
} from "./services/video-render";
import {
  listVoices as moarkListVoices,
  createVoiceProfile as moarkCreateVoiceProfile,
  updateVoiceProfile as moarkUpdateVoiceProfile,
  deleteVoiceProfile as moarkDeleteVoiceProfile,
  getVoiceFilePath as moarkGetVoiceFilePath,
  synthesizeVoice as moarkSynthesizeVoice,
  type MoarkCreateVoicePayload,
  type MoarkUpdateVoicePayload,
} from "./services/voice-clone-moark";
import {
  readMoarkAccount,
  writeMoarkAccount,
  getDefaultMoarkAccount,
  toRuntimeConfig as moarkToRuntimeConfig,
  openMoarkLoginWindow,
  fetchMoarkUserInfo,
  fetchMoarkAccessToken,
  clearMoarkLoginSession,
  fetchMoarkCallQuota,
  type MoarkAccountStore,
} from "./services/moark-account";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const moarkAccountConfigFileName = "moark-account-config.json";
const copyCreationControllers = new Map<number, AbortController>();
const douyinExtractionControllers = new Map<number, AbortController>();
const moarkSynthesisControllers = new Map<number, AbortController>();
const subtitleRecognitionControllers = new Map<number, AbortController>();
const dedicatedLipSyncControllers = new Map<number, AbortController>();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-video",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: "local-audio",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
  {
    scheme: "local-pip",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

function getDouyinVideoTempDir(): string {
  return join(app.getPath("temp"), "free-super-agent", "douyin-videos");
}

function getMoarkAccountPath(): string {
  return join(app.getPath("userData"), moarkAccountConfigFileName);
}

async function loadMoarkAccount(): Promise<MoarkAccountStore> {
  return readMoarkAccount(getMoarkAccountPath());
}

async function saveMoarkAccount(store: MoarkAccountStore): Promise<void> {
  await writeMoarkAccount(getMoarkAccountPath(), store);
}

// ===== 独享算力对口型配置 =====
import {
  readConfig as readDedicatedConfig,
  writeConfig as writeDedicatedConfig,
  submitTask as submitDedicatedTask,
  cancelTask as cancelDedicatedRemoteTask,
  type DedicatedLipSyncConfig,
} from "./services/lip-sync-dedicated";

function getLipSyncDedicatedConfigPath(): string {
  return join(app.getPath("userData"), "lip-sync-dedicated-config.json");
}

async function loadDedicatedLipSyncConfig(): Promise<DedicatedLipSyncConfig> {
  return readDedicatedConfig(getLipSyncDedicatedConfigPath());
}

async function saveDedicatedLipSyncConfig(
  config: DedicatedLipSyncConfig,
): Promise<void> {
  await writeDedicatedConfig(getLipSyncDedicatedConfigPath(), config);
}

async function submitDedicatedLipSyncTask(
  payload: {
    audio:
      | { arrayBuffer: ArrayBuffer; fileName: string; mimeType: string }
      | { url: string };
    video: { arrayBuffer: ArrayBuffer; fileName: string; mimeType: string };
  },
  sender?: Electron.WebContents,
  signal?: AbortSignal,
): Promise<{ outputUrl: string }> {
  const config = await loadDedicatedLipSyncConfig();
  return submitDedicatedTask(
    config,
    payload,
    (status) => {
      try {
        sender?.send("lipsync-dedicated:status", status);
      } catch {
        /* ignore */
      }
    },
    signal,
  );
}

/**
 * 读取中央账户并确保已授权（有 apiKey）。四步共用。
 */
async function requireMoarkAccount(): Promise<MoarkAccountStore> {
  const account = await loadMoarkAccount();
  if (!account.apiKey.trim()) {
    throw new Error("请先在右上角【配置中心】完成模力方舟授权登录");
  }
  return account;
}

async function extractDouyinCopy(
  webContentsId: number,
  douyinUrl: string,
): Promise<unknown> {
  const existingController = douyinExtractionControllers.get(webContentsId);

  if (existingController) {
    existingController.abort();
  }

  const controller = new AbortController();
  douyinExtractionControllers.set(webContentsId, controller);

  try {
    const account = await requireMoarkAccount();

    // 抖音文案提取仅支持模力方舟
    return await extractDouyinVideo(
      douyinUrl,
      getDouyinVideoTempDir(),
      controller.signal,
      { apiKey: account.apiKey },
    );
  } finally {
    if (douyinExtractionControllers.get(webContentsId) === controller) {
      douyinExtractionControllers.delete(webContentsId);
    }
  }
}

async function createRewriteCopy(
  webContentsId: number,
  payload: CopyCreationPayload,
): Promise<unknown> {
  const existingController = copyCreationControllers.get(webContentsId);

  if (existingController) {
    existingController.abort();
  }

  const controller = new AbortController();
  copyCreationControllers.set(webContentsId, controller);

  try {
    const account = await requireMoarkAccount();

    // 文案创作仅支持模力方舟，模型固定为 Qwen3-32B
    return await createCopyMoark(
      { apiKey: account.apiKey, modelName: "Qwen3-32B" },
      payload,
      controller.signal,
    );
  } finally {
    if (copyCreationControllers.get(webContentsId) === controller) {
      copyCreationControllers.delete(webContentsId);
    }
  }
}

function registerLocalVideoProtocol(): void {
  protocol.handle("local-video", (request) => {
    const requestUrl = new URL(request.url);

    if (requestUrl.hostname === "douyin-videos") {
      const fileName = basename(
        decodeURIComponent(requestUrl.pathname.replace(/^\/+/, "")),
      );

      if (!fileName.endsWith(".mp4")) {
        return new Response("Not found", { status: 404 });
      }

      return net.fetch(
        pathToFileURL(join(getDouyinVideoTempDir(), fileName)).href,
        { headers: request.headers },
      );
    }

    // 通用本地文件访问：local-video://local-file/<编码后的绝对路径>
    // 用于手动选择的本地视频在渲染端预览
    if (requestUrl.hostname === "local-file") {
      const filePath = decodeURIComponent(
        requestUrl.pathname.replace(/^\/+/, ""),
      );
      if (!filePath) {
        return new Response("Not found", { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).href, {
        headers: request.headers,
      });
    }

    // 对口型结果视频缓存：local-video://lipsync-result/<fileName>
    if (requestUrl.hostname === "lipsync-result") {
      const fileName = basename(
        decodeURIComponent(requestUrl.pathname.replace(/^\/+/, "")),
      );
      if (!fileName) {
        return new Response("Not found", { status: 404 });
      }
      const resultDir = join(
        app.getPath("temp"),
        "free-super-agent",
        "lipsync-result",
      );
      return net.fetch(pathToFileURL(join(resultDir, fileName)).href, {
        headers: request.headers,
      });
    }

    return new Response("Not found", { status: 404 });
  });
}

function registerLocalAudioProtocol(): void {
  protocol.handle("local-audio", async (request) => {
    const requestUrl = new URL(request.url);

    const fileName = basename(
      decodeURIComponent(requestUrl.pathname.replace(/^\/+/, "")),
    );

    if (!fileName) {
      return new Response("Not found", { status: 404 });
    }

    let filePath = "";

    // 模力方舟音色：local-audio://moark-voices/<fileName>
    if (requestUrl.hostname === "moark-voices") {
      filePath = join(app.getPath("userData"), "moark-voices", fileName);
    }

    // 合成音频缓存：local-audio://synthesized/<fileName>
    if (requestUrl.hostname === "synthesized") {
      filePath = join(
        app.getPath("temp"),
        "free-super-agent",
        "synthesized-audio",
        fileName,
      );
    }

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    // 确定 Content-Type
    const ext = fileName.split(".").pop()?.toLowerCase() || "mp3";
    const mimeMap: Record<string, string> = {
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      ogg: "audio/ogg",
      flac: "audio/flac",
      aac: "audio/aac",
    };
    const contentType = mimeMap[ext] || "audio/mpeg";

    try {
      const { stat, open } = await import("node:fs/promises");
      const fileStat = await stat(filePath);
      const fileSize = fileStat.size;
      const rangeHeader = request.headers.get("range");

      if (rangeHeader) {
        // 支持 Range 请求（快进/seek）
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        const start = match ? parseInt(match[1], 10) : 0;
        const end = match && match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const fileHandle = await open(filePath, "r");
        const buffer = Buffer.alloc(chunkSize);
        await fileHandle.read(buffer, 0, chunkSize, start);
        await fileHandle.close();

        return new Response(buffer, {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(chunkSize),
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
          },
        });
      }

      // 普通请求：返回完整文件
      const { readFile } = await import("node:fs/promises");
      const fileBuffer = await readFile(filePath);
      return new Response(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

/**
 * 注册画中画历史素材的 local-pip:// 协议
 *
 * URL 形态：local-pip://images/<fileName> 或 local-pip://videos/<fileName>
 * 实际指向 userData/pip-history/(images|videos)/<fileName>
 */
function registerLocalPipProtocol(): void {
  protocol.handle("local-pip", (request) => {
    const requestUrl = new URL(request.url);
    const filePath = resolvePipHistoryFilePath(
      app.getPath("userData"),
      requestUrl.hostname,
      requestUrl.pathname,
    );

    if (!filePath) {
      return new Response("Not found", { status: 404 });
    }

    return net.fetch(pathToFileURL(filePath).href);
  });
}

/**
 * 将远程合成音频下载到本地临时目录，返回 local-audio:// 协议 URL
 */
async function cacheSynthesizedAudio(
  remoteUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const synthesizedDir = join(
    app.getPath("temp"),
    "free-super-agent",
    "synthesized-audio",
  );
  await mkdir(synthesizedDir, { recursive: true });

  const response = await fetch(remoteUrl, { signal });
  if (!response.ok) {
    throw new Error(`音频下载失败：${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = remoteUrl.includes(".wav") ? ".wav" : ".mp3";
  const fileName = `${randomUUID()}${ext}`;
  const filePath = join(synthesizedDir, fileName);
  await writeFile(filePath, buffer);

  return `local-audio://synthesized/${encodeURIComponent(fileName)}`;
}

async function recognizeSubtitles(
  webContentsId: number,
  audioUrl: string,
): Promise<SubtitleRecognitionResult> {
  const existingController = subtitleRecognitionControllers.get(webContentsId);

  if (existingController) {
    existingController.abort();
  }

  const controller = new AbortController();
  subtitleRecognitionControllers.set(webContentsId, controller);

  try {
    // 字幕识别仅支持模力方舟，模型固定为 whisper-large-v3（句子级别时间戳）
    const account = await requireMoarkAccount();
    return await recognizeMoarkSubtitles(
      account.apiKey,
      audioUrl,
      controller.signal,
    );
  } finally {
    if (subtitleRecognitionControllers.get(webContentsId) === controller) {
      subtitleRecognitionControllers.delete(webContentsId);
    }
  }
}

function cancelDouyinExtraction(webContentsId: number): boolean {
  const controller = douyinExtractionControllers.get(webContentsId);

  if (!controller) {
    return false;
  }

  controller.abort();
  douyinExtractionControllers.delete(webContentsId);
  return true;
}

function cancelCopyCreation(webContentsId: number): boolean {
  const controller = copyCreationControllers.get(webContentsId);

  if (!controller) {
    return false;
  }

  controller.abort();
  copyCreationControllers.delete(webContentsId);
  return true;
}

function cancelSubtitleRecognition(webContentsId: number): boolean {
  const controller = subtitleRecognitionControllers.get(webContentsId);

  if (!controller) {
    return false;
  }

  controller.abort();
  subtitleRecognitionControllers.delete(webContentsId);
  return true;
}

function createMainWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Free Super Agent",
    backgroundColor: "#f6f7fb",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(currentDir, "../preload/index.cjs"),
      sandbox: false,
    },
  });

  // 隐藏菜单栏（File、Edit、View、Window 等）
  Menu.setApplicationMenu(null);

  // 页面加载完成后最大化再显示，避免出现先小窗再放大的闪烁
  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
    return;
  }

  void mainWindow.loadFile(join(currentDir, "../renderer/index.html"));
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.free-super-agent.desktop");
  registerLocalVideoProtocol();
  registerLocalAudioProtocol();
  registerLocalPipProtocol();

  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("app:request-microphone-access", async () => {
    // macOS 需要通过系统权限请求麦克风访问
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      if (status === "granted") return "granted";
      if (status === "denied") return "denied";
      // status 为 'not-determined' 时请求权限
      const granted = await systemPreferences.askForMediaAccess("microphone");
      return granted ? "granted" : "denied";
    }
    // Windows / Linux 不需要系统级权限请求
    return "granted";
  });
  // ===== 模力方舟中央账户（配置中心） =====
  ipcMain.handle("moark:get-status", async () => {
    const account = await loadMoarkAccount();
    // 用 userinfo 校验 cookie，同时把最新账户信息写回本地：
    // 旧版本配置文件里没有 namespacePath，这里顺带补齐，避免额度接口取不到命名空间。
    const info = await fetchMoarkUserInfo(account.cookies);
    if (info && JSON.stringify(info) !== JSON.stringify(account.account)) {
      await saveMoarkAccount({ ...account, account: info });
    }
    return {
      loggedIn: info !== null,
      hasApiKey: Boolean(account.apiKey.trim()),
      account: info ?? account.account,
    };
  });
  ipcMain.handle("moark:authorize", async () => {
    const result = await openMoarkLoginWindow();
    if (!result.success) {
      return {
        success: false,
        loggedIn: false,
        hasApiKey: false,
        account: null,
      };
    }
    const info = await fetchMoarkUserInfo(result.cookies);
    if (!info) {
      // cookie 拿到了但校验不通过，没有命名空间也就无法取令牌
      await saveMoarkAccount({
        apiKey: "",
        cookies: result.cookies,
        account: null,
      });
      throw new Error("登录状态校验失败，请重新授权登录");
    }
    let apiKey = "";
    try {
      apiKey = await fetchMoarkAccessToken(result.cookies, info.namespacePath);
    } catch (error) {
      // 登录成功但取访问令牌失败：先保存 cookie 与账户，令牌置空，向前端透传错误
      await saveMoarkAccount({
        apiKey: "",
        cookies: result.cookies,
        account: info,
      });
      throw error;
    }
    await saveMoarkAccount({ apiKey, cookies: result.cookies, account: info });
    return { success: true, loggedIn: true, hasApiKey: true, account: info };
  });
  ipcMain.handle("moark:get-quota", async () => {
    const account = await loadMoarkAccount();
    let namespacePath = account.account?.namespacePath ?? "";
    if (!namespacePath) {
      // 本地还没有命名空间（旧配置），用 cookie 现拉一次并补写回去
      const info = await fetchMoarkUserInfo(account.cookies);
      if (!info) return null;
      namespacePath = info.namespacePath;
      await saveMoarkAccount({ ...account, account: info });
    }
    return fetchMoarkCallQuota(account.cookies, namespacePath);
  });
  ipcMain.handle("moark:logout", async () => {
    await saveMoarkAccount(getDefaultMoarkAccount());
    await clearMoarkLoginSession();
    return true;
  });
  ipcMain.handle("douyin:extract-copy", (event, douyinUrl: string) =>
    extractDouyinCopy(event.sender.id, douyinUrl),
  );
  ipcMain.handle("douyin:cancel-extraction", (event) =>
    cancelDouyinExtraction(event.sender.id),
  );
  ipcMain.handle(
    "audio:cache-synthesized",
    async (_event, arrayBuffer: ArrayBuffer, fileName: string) => {
      const { mkdir, writeFile } = await import("node:fs/promises");
      const { randomUUID } = await import("node:crypto");
      const synthesizedDir = join(
        app.getPath("temp"),
        "free-super-agent",
        "synthesized-audio",
      );
      await mkdir(synthesizedDir, { recursive: true });
      const ext = fileName.match(/\.[^.]+$/)?.[0] || ".mp3";
      const cachedName = `${randomUUID()}${ext}`;
      const filePath = join(synthesizedDir, cachedName);
      await writeFile(filePath, Buffer.from(arrayBuffer));
      return `local-audio://synthesized/${encodeURIComponent(cachedName)}`;
    },
  );
  ipcMain.handle("audio:copy-local", async (_event, sourceUrl: string) => {
    const { mkdir, copyFile } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");

    // 从 local-audio://synthesized/xxx.mp3 解析出源文件路径
    if (!sourceUrl.startsWith("local-audio://synthesized/")) {
      throw new Error("不支持的音频地址格式");
    }
    const sourceFileName = decodeURIComponent(
      new URL(sourceUrl).pathname.replace(/^\/+/, ""),
    );
    const synthesizedDir = join(
      app.getPath("temp"),
      "free-super-agent",
      "synthesized-audio",
    );
    const sourcePath = join(synthesizedDir, basename(sourceFileName));

    await mkdir(synthesizedDir, { recursive: true });
    const ext = sourcePath.match(/\.[^.]+$/)?.[0] || ".mp3";
    const newName = `${randomUUID()}${ext}`;
    const destPath = join(synthesizedDir, newName);
    await copyFile(sourcePath, destPath);

    return `local-audio://synthesized/${encodeURIComponent(newName)}`;
  });
  // 通用音频文件读取（供上传音色样本使用）
  ipcMain.handle("audio:read-file", async (_event, filePath: string) => {
    const { readFile: readFileFs } = await import("node:fs/promises");
    const buffer = await readFileFs(filePath);
    const lower = filePath.toLowerCase();
    const mimeType = lower.endsWith(".wav")
      ? "audio/wav"
      : lower.endsWith(".ogg")
        ? "audio/ogg"
        : lower.endsWith(".m4a") || lower.endsWith(".aac")
          ? "audio/aac"
          : lower.endsWith(".flac")
            ? "audio/flac"
            : "audio/mpeg";
    return {
      arrayBuffer: buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      mimeType,
    };
  });
  ipcMain.handle("copy:create", (event, payload: CopyCreationPayload) =>
    createRewriteCopy(event.sender.id, payload),
  );

  ipcMain.handle("copy:cancel", (event) => cancelCopyCreation(event.sender.id));

  // ===== 语音克隆：模力方舟（登录/apiKey 统一走配置中心的中央账户） =====
  ipcMain.handle("voice-moark:list", () =>
    moarkListVoices(app.getPath("userData")),
  );
  ipcMain.handle(
    "voice-moark:create",
    (_event, payload: MoarkCreateVoicePayload) =>
      moarkCreateVoiceProfile(app.getPath("userData"), payload),
  );
  ipcMain.handle(
    "voice-moark:update",
    (_event, payload: MoarkUpdateVoicePayload) =>
      moarkUpdateVoiceProfile(app.getPath("userData"), payload),
  );
  ipcMain.handle("voice-moark:delete", (_event, id: string) =>
    moarkDeleteVoiceProfile(app.getPath("userData"), id),
  );
  ipcMain.handle(
    "voice-moark:save-recording",
    async (_event, arrayBuffer: ArrayBuffer, mimeType: string) => {
      const { mkdir: mkdirFs, writeFile: wf } =
        await import("node:fs/promises");
      const { randomUUID } = await import("node:crypto");
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const tempDir = join(
        app.getPath("temp"),
        "free-super-agent",
        "moark-recordings",
      );
      await mkdirFs(tempDir, { recursive: true });

      // 先保存原始文件
      const srcExt = mimeType.includes("wav")
        ? ".wav"
        : mimeType.includes("mp3") || mimeType.includes("mpeg")
          ? ".mp3"
          : ".webm";
      const srcPath = join(tempDir, `${randomUUID()}${srcExt}`);
      await wf(srcPath, Buffer.from(arrayBuffer));

      // 统一用 ffmpeg 转码为标准 mp3（确保编码正确，避免手机录音假 mp3）
      const mp3Path = join(tempDir, `${randomUUID()}.mp3`);
      const ffmpegBin = resolveFfmpegPath();
      await execFileAsync(ffmpegBin, [
        "-i",
        srcPath,
        "-y",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-b:a",
        "128k",
        mp3Path,
      ]);

      // 删除原始文件
      const { unlink } = await import("node:fs/promises");
      await unlink(srcPath).catch(() => undefined);

      return mp3Path;
    },
  );
  ipcMain.handle(
    "voice-moark:synthesize",
    async (event, payload: { text: string; voiceId: string }) => {
      const existingController = moarkSynthesisControllers.get(event.sender.id);
      if (existingController) {
        existingController.abort();
      }

      const controller = new AbortController();
      moarkSynthesisControllers.set(event.sender.id, controller);

      try {
        const account = await requireMoarkAccount();
        const config = moarkToRuntimeConfig(account);
        const voiceFilePath = await moarkGetVoiceFilePath(
          app.getPath("userData"),
          payload.voiceId,
        );
        const result = await moarkSynthesizeVoice(
          config,
          { text: payload.text, voiceFilePath },
          controller.signal,
        );
        // 下载音频到本地缓存，避免远程 URL 过期
        const localUrl = await cacheSynthesizedAudio(
          result.audioUrl,
          controller.signal,
        );
        return { audioUrl: localUrl };
      } finally {
        if (moarkSynthesisControllers.get(event.sender.id) === controller) {
          moarkSynthesisControllers.delete(event.sender.id);
        }
      }
    },
  );
  ipcMain.handle("voice-moark:cancel-synthesis", (event) => {
    const controller = moarkSynthesisControllers.get(event.sender.id);
    if (!controller) return false;
    controller.abort();
    moarkSynthesisControllers.delete(event.sender.id);
    return true;
  });

  // ===== 视频对口型：独享算力 =====
  ipcMain.handle("lipsync-dedicated:load-config", () =>
    loadDedicatedLipSyncConfig(),
  );
  ipcMain.handle(
    "lipsync-dedicated:save-config",
    (_event, config: DedicatedLipSyncConfig) =>
      saveDedicatedLipSyncConfig(config),
  );
  ipcMain.handle(
    "lipsync-dedicated:submit",
    async (
      event,
      payload: Parameters<typeof submitDedicatedLipSyncTask>[0],
    ) => {
      const webContentsId = event.sender.id;
      const existingController = dedicatedLipSyncControllers.get(webContentsId);
      if (existingController) {
        existingController.abort();
      }
      const controller = new AbortController();
      dedicatedLipSyncControllers.set(webContentsId, controller);
      try {
        return await submitDedicatedLipSyncTask(
          payload,
          event.sender,
          controller.signal,
        );
      } catch (error) {
        // 用户点击「停止重启」会 abort 本次请求，服务端重启也会导致连接中断，
        // 这些都属预期，返回取消标记而非抛错，避免主进程打印错误日志、前端弹报错。
        if (controller.signal.aborted) {
          return { outputUrl: "", canceled: true };
        }
        throw error;
      } finally {
        if (dedicatedLipSyncControllers.get(webContentsId) === controller) {
          dedicatedLipSyncControllers.delete(webContentsId);
        }
      }
    },
  );
  ipcMain.handle("lipsync-dedicated:cancel", async (event) => {
    const controller = dedicatedLipSyncControllers.get(event.sender.id);
    if (!controller) return false;
    controller.abort();
    dedicatedLipSyncControllers.delete(event.sender.id);
    // 通知独享算力后端取消任务
    try {
      const config = await loadDedicatedLipSyncConfig();
      if (config.baseUrl.trim()) {
        await cancelDedicatedRemoteTask(config.baseUrl);
      }
    } catch {
      // 后端取消失败不影响前端流程
    }
    return true;
  });
  ipcMain.handle("subtitle:recognize", (event, audioUrl: string) =>
    recognizeSubtitles(event.sender.id, audioUrl),
  );
  ipcMain.handle("subtitle:cancel", (event) =>
    cancelSubtitleRecognition(event.sender.id),
  );

  // ===== 画中画历史素材 =====
  ipcMain.handle("pip-history:list", () =>
    listPipHistory(app.getPath("userData")),
  );
  ipcMain.handle(
    "pip-history:save",
    (_event, payload: MainSavePipHistoryPayload) =>
      savePipHistoryEntry(app.getPath("userData"), payload),
  );
  ipcMain.handle("pip-history:delete", (_event, id: string) =>
    deletePipHistoryEntry(app.getPath("userData"), id),
  );
  // ===== 视频渲染（字幕 + 画中画烧制） =====
  ipcMain.handle(
    "dialog:save-image",
    async (_event, dataUrl: string, defaultName: string) => {
      const result = await dialog.showSaveDialog({
        title: "保存封面图片",
        defaultPath: defaultName,
        filters: [{ name: "JPEG 图片", extensions: ["jpg", "jpeg"] }],
      });
      if (result.canceled || !result.filePath) {
        return { success: false };
      }
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, "");
      const { writeFile } = await import("node:fs/promises");
      await writeFile(result.filePath, Buffer.from(base64, "base64"));
      return { success: true, filePath: result.filePath };
    },
  );
  /**
   * 选择输出目录，在里面新建子目录 渲染导出_<时间戳>，最多写入 3 个文件：
   *   1. 对口型原视频（sourceVideoUrl，始终导出）
   *   2. 成品视频（videoPayload，配置了字幕或画中画时才渲染导出）
   *   3. 封面图（coverBase64，填写了封面标题时才导出）
   */
  ipcMain.handle(
    "video-render:export-all",
    async (
      _event,
      options: {
        sourceVideoUrl?: string;
        videoPayload?: VideoRenderPayload;
        coverBase64?: string;
        coverFileName?: string;
      },
    ) => {
      const folderResult = await dialog.showOpenDialog({
        title: "选择导出目录",
        properties: ["openDirectory", "createDirectory"],
      });
      if (folderResult.canceled || !folderResult.filePaths.length) {
        return { success: false, canceled: true };
      }

      const {
        copyFile: copyFileFs,
        writeFile: wf,
        mkdir: mkdirFs,
      } = await import("node:fs/promises");
      const ts = Date.now();
      const subDir = join(folderResult.filePaths[0], `渲染导出_${ts}`);
      await mkdirFs(subDir, { recursive: true });

      const results: {
        sourceVideo?: string;
        video?: string;
        cover?: string;
      } = {};

      // 1. 对口型原视频：直接复制，不重编码（始终导出）
      if (options.sourceVideoUrl) {
        try {
          const localPath = await resolveVideoLocalPath(options.sourceVideoUrl);
          const ext = extname(localPath) || ".mp4";
          const sourcePath = join(subDir, `对口型原视频_${ts}${ext}`);
          await copyFileFs(localPath, sourcePath);
          results.sourceVideo = sourcePath;
        } catch (error) {
          return {
            success: false,
            error:
              error instanceof Error ? error.message : "导出对口型原视频失败",
          };
        }
      }

      // 2. 成品视频：烧制字幕 / 画中画
      if (options.videoPayload) {
        const videoPath = join(subDir, `成品视频_${ts}.mp4`);
        const videoResult = await renderVideo({
          ...options.videoPayload,
          outputPath: videoPath,
        });
        if (videoResult.success) {
          results.video = videoPath;
        } else {
          return { success: false, error: videoResult.error };
        }
      }

      // 3. 写入封面
      if (options.coverBase64 && options.coverFileName) {
        const coverPath = join(subDir, options.coverFileName);
        const base64 = options.coverBase64.replace(
          /^data:image\/\w+;base64,/,
          "",
        );
        await wf(coverPath, Buffer.from(base64, "base64"));
        results.cover = coverPath;
      }

      return { success: true, outputDir: subDir, ...results };
    },
  );
  ipcMain.handle("dialog:select-audio-file", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择音频文件",
      filters: [
        {
          name: "音频文件",
          extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
        },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("dialog:select-video-file", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择视频文件",
      filters: [
        { name: "视频文件", extensions: ["mp4", "mov", "mkv", "avi", "webm"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    return result.filePaths[0];
  });
  ipcMain.handle("video-render:select-output", async () => {
    const result = await dialog.showSaveDialog({
      title: "选择视频保存位置",
      defaultPath: `渲染视频_${Date.now()}.mp4`,
      filters: [{ name: "MP4 视频", extensions: ["mp4"] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    return result.filePath;
  });
  ipcMain.handle("video-render:render", (_event, payload: VideoRenderPayload) =>
    renderVideo(payload),
  );
  ipcMain.handle(
    "video-render:capture-frame",
    (_event, videoUrl: string, timePercent: number) =>
      captureVideoFrame(videoUrl, timePercent),
  );
  ipcMain.handle(
    "video-render:capture-filmstrip",
    (_event, videoUrl: string, count: number) =>
      captureVideoFilmstrip(videoUrl, count),
  );
  ipcMain.handle("video-render:show-in-folder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
