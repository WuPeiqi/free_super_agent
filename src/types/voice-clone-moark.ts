/**
 * 模力方舟语音克隆前端类型（独立于其他 provider）
 */

export interface MoarkVoiceProfile {
  id: string;
  name: string;
  filePath: string;
  md5: string;
  createdAt: string;
  audioUrl: string;
}

export interface MoarkVoiceSynthesisResult {
  audioUrl: string;
}
