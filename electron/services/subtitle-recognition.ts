/**
 * 字幕识别共享类型定义
 *
 * 字幕识别当前仅支持模力方舟（见 subtitle-recognition-sourcecode.ts）。
 * 这里只保留各实现共用的结果类型。
 */

export interface SubtitleSegment {
  end: number;
  id: string;
  start: number;
  text: string;
}

export interface SubtitleRecognitionResult {
  executionTimeMs: number;
  requestId: string;
  srt: string;
  status: string;
  subtitles: SubtitleSegment[];
  text: string;
}
