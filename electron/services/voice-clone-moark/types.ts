/**
 * 模力方舟语音克隆类型定义（与其他 provider 完全独立）
 */

/** 模力方舟运行时配置 */
export interface MoarkVoiceCloneConfig {
  apiKey: string;
  cookies: string;
}

/** 本地存储的音色记录 */
export interface MoarkVoiceProfile {
  /** 唯一 ID */
  id: string;
  /** 音色名称 */
  name: string;
  /** 音频文件在 userData 中的绝对路径 */
  filePath: string;
  /** 音频文件内容的 MD5 值 */
  md5: string;
  /** 创建时间 */
  createdAt: string;
}

/** 暴露给前端的音色视图 */
export interface MoarkVoiceProfileView {
  id: string;
  name: string;
  filePath: string;
  md5: string;
  createdAt: string;
  /** 通过 local-audio 协议访问的 URL */
  audioUrl: string;
}

/** 创建音色入参（前端传来原始文件路径） */
export interface MoarkCreateVoicePayload {
  /** 音色名称 */
  name: string;
  /** 原始音频文件的绝对路径（前端通过 dialog 选择或录音保存） */
  sourceFilePath: string;
}

/** 更新音色入参 */
export interface MoarkUpdateVoicePayload {
  id: string;
  name: string;
}
