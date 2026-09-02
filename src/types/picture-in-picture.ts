/**
 * 画中画（Picture-in-Picture）功能相关的数据类型
 *
 * 设计要点：
 * - 资源大小、位置统一以画布百分比表示（0~100），与具体像素解耦，
 *   方便后续在不同分辨率视频上使用 ffmpeg 烧制时按比例换算
 * - 资源按字幕段（subtitleId）分桶存储，每个字幕可以挂多张图/多段视频
 */

export type PipAssetKind = "image" | "video";

export type PipAssetOrigin = "upload" | "ai";

/**
 * 单个画中画资源
 */
export interface PipAsset {
  id: string;
  kind: PipAssetKind;
  origin: PipAssetOrigin;
  /**
   * 浏览器可访问的资源 URL：
   * - 上传：`blob:` 协议，仅当前会话有效
   * - AI 生成：远端 https URL（接入后回填）
   */
  url: string;
  /** 原始素材尺寸，用于裁剪/烧制时按比例计算 */
  naturalSize?: {
    width: number;
    height: number;
  };
  /** 画布百分比定位与尺寸（0~100） */
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /**
   * 资源生效的字幕段 ID 列表；多个字幕段可共用同一份资源
   * - 长度为 0 时表示作用于整个视频时间范围（预留全局资源能力）
   */
  subtitleIds: string[];
  /** 资源标题 / 标签，用于列表展示 */
  label?: string;
}

/**
 * 历史素材记录（落地到 userData/pip-history/ 下）
 *
 * - id: 唯一标识，同时也作为文件名
 * - kind: image / video，决定存到 images/ 还是 videos/
 * - origin: 区分用户上传与 AI 生成
 * - url: 渲染端可访问的资源地址（local-pip://...）
 * - mimeType: 复制 / 重新落盘时使用
 * - fileName: 原始文件名（仅展示用）
 * - prompt: AI 生成时的提示词，可用于后续重新生成
 * - modelId: AI 生成时所使用的模型 id
 * - naturalSize: 原始宽高
 * - createdAt: 时间戳，用于排序
 */
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
  /** 资源数据，由渲染端通过 ArrayBuffer 经 IPC 透传 */
  arrayBuffer: ArrayBuffer;
  prompt?: string;
  modelId?: string;
}
