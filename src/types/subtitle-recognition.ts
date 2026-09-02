export type SubtitleRecognitionProviderKey = "sourcecode";

export interface SubtitleRecognitionConfigStore {
  activeProvider: SubtitleRecognitionProviderKey;
  sourcecode: {
    apiKey: string;
  };
}

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
