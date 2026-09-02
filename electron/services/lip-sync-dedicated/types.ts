/**
 * 独享算力视频对口型类型定义
 *
 * 对接自建/独享 GPU 服务器（TransDhServer）：
 * 上传音视频 → 提交任务 → 轮询 → 下载结果。
 * 只需配置服务器地址前缀，例如 http://127.0.0.1:8383
 */

export interface DedicatedLipSyncConfig {
  /** 独享算力服务器地址前缀，例如 http://127.0.0.1:8383 */
  baseUrl: string;
}

/** 单个媒体文件的原始二进制及元信息 */
export interface DedicatedMediaFile {
  arrayBuffer: ArrayBuffer;
  fileName: string;
  mimeType: string;
}

/** 音频源：有二进制直接传文件；没有则传 URL，由主进程下载 */
export type DedicatedAudioSource = DedicatedMediaFile | { url: string };

/** 提交任务时由渲染进程传入的负载 */
export interface DedicatedSubmitPayload {
  audio: DedicatedAudioSource;
  video: DedicatedMediaFile;
}

/** 任务执行结果 */
export interface DedicatedTaskResult {
  outputUrl: string;
}
