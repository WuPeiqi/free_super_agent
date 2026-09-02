import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("app:get-version"),
  requestMicrophoneAccess: (): Promise<string> =>
    ipcRenderer.invoke("app:request-microphone-access"),
  // ===== 模力方舟中央账户（配置中心） =====
  moarkGetStatus: (): Promise<unknown> =>
    ipcRenderer.invoke("moark:get-status"),
  moarkGetQuota: (): Promise<unknown> => ipcRenderer.invoke("moark:get-quota"),
  moarkAuthorize: (): Promise<unknown> => ipcRenderer.invoke("moark:authorize"),
  moarkLogout: (): Promise<boolean> => ipcRenderer.invoke("moark:logout"),
  extractDouyinCopy: (douyinUrl: string): Promise<unknown> =>
    ipcRenderer.invoke("douyin:extract-copy", douyinUrl),
  cancelDouyinExtraction: (): Promise<boolean> =>
    ipcRenderer.invoke("douyin:cancel-extraction"),
  // ===== 音频缓存 =====
  cacheSynthesizedAudio: (
    arrayBuffer: ArrayBuffer,
    fileName: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke("audio:cache-synthesized", arrayBuffer, fileName),
  copyLocalAudio: (sourceUrl: string): Promise<unknown> =>
    ipcRenderer.invoke("audio:copy-local", sourceUrl),
  readAudioFile: (filePath: string): Promise<unknown> =>
    ipcRenderer.invoke("audio:read-file", filePath),
  createRewriteCopy: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("copy:create", payload),
  cancelCopyCreation: (): Promise<boolean> => ipcRenderer.invoke("copy:cancel"),

  // ===== 语音克隆：模力方舟（音色管理，登录/apiKey 走配置中心） =====
  listMoarkVoices: (): Promise<unknown> =>
    ipcRenderer.invoke("voice-moark:list"),
  createMoarkVoice: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("voice-moark:create", payload),
  updateMoarkVoice: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("voice-moark:update", payload),
  deleteMoarkVoice: (id: string): Promise<unknown> =>
    ipcRenderer.invoke("voice-moark:delete", id),
  saveMoarkRecording: (
    arrayBuffer: ArrayBuffer,
    mimeType: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke("voice-moark:save-recording", arrayBuffer, mimeType),
  synthesizeMoarkVoice: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("voice-moark:synthesize", payload),
  cancelMoarkVoiceSynthesis: (): Promise<boolean> =>
    ipcRenderer.invoke("voice-moark:cancel-synthesis"),

  // ===== 视频对口型：独享算力 =====
  loadLipSyncDedicatedConfig: (): Promise<unknown> =>
    ipcRenderer.invoke("lipsync-dedicated:load-config"),
  saveLipSyncDedicatedConfig: (config: unknown): Promise<void> =>
    ipcRenderer.invoke("lipsync-dedicated:save-config", config),
  submitLipSyncDedicatedTask: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("lipsync-dedicated:submit", payload),
  cancelLipSyncDedicatedTask: (): Promise<boolean> =>
    ipcRenderer.invoke("lipsync-dedicated:cancel"),
  onLipSyncDedicatedStatus: (
    callback: (status: string) => void,
  ): (() => void) => {
    const handler = (_event: unknown, status: string) => callback(status);
    ipcRenderer.on("lipsync-dedicated:status", handler);
    return () => {
      ipcRenderer.removeListener("lipsync-dedicated:status", handler);
    };
  },
  recognizeSubtitles: (audioUrl: string): Promise<unknown> =>
    ipcRenderer.invoke("subtitle:recognize", audioUrl),
  cancelSubtitleRecognition: (): Promise<boolean> =>
    ipcRenderer.invoke("subtitle:cancel"),
  // ===== 画中画历史素材 =====
  listPipHistory: (): Promise<unknown> =>
    ipcRenderer.invoke("pip-history:list"),
  savePipHistory: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("pip-history:save", payload),
  deletePipHistory: (id: string): Promise<unknown> =>
    ipcRenderer.invoke("pip-history:delete", id),
  // ===== 封面图片保存 =====
  saveImageFile: (dataUrl: string, defaultName: string): Promise<unknown> =>
    ipcRenderer.invoke("dialog:save-image", dataUrl, defaultName),
  // ===== 渲染导出（视频 + 封面统一输出到子目录） =====
  exportAll: (options: unknown): Promise<unknown> =>
    ipcRenderer.invoke("video-render:export-all", options),
  // ===== 视频渲染（字幕 + 画中画烧制） =====
  selectAudioFile: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-audio-file"),
  selectVideoFile: (): Promise<string | null> =>
    ipcRenderer.invoke("dialog:select-video-file"),
  selectVideoRenderOutput: (): Promise<string | null> =>
    ipcRenderer.invoke("video-render:select-output"),
  renderVideo: (payload: unknown): Promise<unknown> =>
    ipcRenderer.invoke("video-render:render", payload),
  captureVideoFrame: (
    videoUrl: string,
    timePercent: number,
  ): Promise<unknown> =>
    ipcRenderer.invoke("video-render:capture-frame", videoUrl, timePercent),
  captureVideoFilmstrip: (videoUrl: string, count: number): Promise<unknown> =>
    ipcRenderer.invoke("video-render:capture-filmstrip", videoUrl, count),
  onVideoRenderProgress: (
    callback: (progress: number) => void,
  ): (() => void) => {
    const handler = (_event: unknown, progress: number) => callback(progress);
    ipcRenderer.on("video-render:progress", handler);
    return () => {
      ipcRenderer.removeListener("video-render:progress", handler);
    };
  },
  showVideoInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("video-render:show-in-folder", filePath),
};

contextBridge.exposeInMainWorld("desktopApi", desktopApi);

export type DesktopApi = typeof desktopApi;
