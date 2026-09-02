import { ElMessage } from "element-plus";
import { computed, onUnmounted, ref } from "vue";
import { useLipSyncRuntime } from "@/composables/lip-sync-runtime/useLipSyncRuntime";
import {
  useMoarkAccount,
  isMoarkAuthError,
} from "@/composables/useMoarkAccount";
import type {
  SubtitleRecognitionResult,
  SubtitleSegment,
} from "@/types/subtitle-recognition";

function isSubtitleSegment(value: unknown): value is SubtitleSegment {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "start" in value &&
    "end" in value &&
    "text" in value &&
    typeof value.id === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number" &&
    typeof value.text === "string"
  );
}

function isSubtitleRecognitionResult(
  value: unknown,
): value is SubtitleRecognitionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    "subtitles" in value &&
    Array.isArray(value.subtitles) &&
    value.subtitles.every(isSubtitleSegment)
  );
}

let sharedSubtitleRecognitionState: ReturnType<
  typeof useSubtitleRecognitionImpl
> | null = null;

function useSubtitleRecognitionImpl() {
  const lipSyncState = useLipSyncRuntime();
  const { ensureReady, handleAuthExpired } = useMoarkAccount();

  const isRecognizing = ref(false);
  const subtitleTaskStatus = ref("未开始");
  const subtitleElapsedMs = ref(0);
  const subtitleList = ref<SubtitleSegment[]>([]);
  const subtitleMergedText = ref("");
  const subtitleRequestId = ref("");
  const subtitleSrt = ref("");

  let subtitleStartedAt = 0;
  let subtitleTimer: number | undefined;
  let isCancelledByUser = false;

  const subtitleElapsedText = computed(
    () => `${(subtitleElapsedMs.value / 1000).toFixed(2)}秒`,
  );
  const audioSourceUrl = computed(() => {
    // 只从第四步取音频（本地缓存）
    const step4Audio = lipSyncState.uploadedAudioPreviewUrl.value;
    if (step4Audio && step4Audio.startsWith("local-audio://")) {
      return step4Audio;
    }
    return "";
  });
  const effectiveAudioSourceUrl = computed(() => {
    return audioSourceUrl.value;
  });

  /** 自动模式下从第四步对口型模块取得的远端视频地址 */
  const videoSourceUrl = computed(() => {
    // 视频对口型当前仅支持独享算力，直接取共享运行时的结果视频
    return lipSyncState.resultVideoUrl.value;
  });
  /**
   * 实际使用的视频地址：跟随第四步对口型生成的视频地址
   * 如果是本地绝对路径，转成 local-video://local-file/ 协议以便渲染端 <video> 能播放
   */
  const effectiveVideoSourceUrl = computed(() => {
    const url = videoSourceUrl.value;

    // 本地绝对路径（Windows 盘符或 Unix /）转为自定义协议
    if (
      url &&
      !url.startsWith("http") &&
      !url.startsWith("blob:") &&
      !url.startsWith("local-")
    ) {
      return `local-video://local-file/${encodeURIComponent(url)}`;
    }

    return url;
  });

  function formatSubtitlesText(subtitles: SubtitleSegment[]): string {
    return subtitles
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join("");
  }

  function startSubtitleTimer(): void {
    subtitleStartedAt = Date.now();
    subtitleElapsedMs.value = 0;

    if (subtitleTimer) {
      window.clearInterval(subtitleTimer);
    }

    subtitleTimer = window.setInterval(() => {
      subtitleElapsedMs.value = Date.now() - subtitleStartedAt;
    }, 100);
  }

  function stopSubtitleTimer(): void {
    if (subtitleStartedAt > 0) {
      subtitleElapsedMs.value = Date.now() - subtitleStartedAt;
    }

    if (subtitleTimer) {
      window.clearInterval(subtitleTimer);
      subtitleTimer = undefined;
    }
  }

  function updateSubtitleText(id: string, text: string): void {
    const targetItem = subtitleList.value.find((item) => item.id === id);
    if (!targetItem) {
      return;
    }

    targetItem.text = text;
    subtitleMergedText.value = formatSubtitlesText(subtitleList.value);
  }

  async function startSubtitleRecognition(): Promise<void> {
    if (isRecognizing.value) {
      return;
    }

    if (!effectiveAudioSourceUrl.value) {
      ElMessage.warning("请先完成第三步语音生成");
      return;
    }

    if (!ensureReady()) {
      return;
    }

    isRecognizing.value = true;
    isCancelledByUser = false;
    subtitleTaskStatus.value = "识别中";
    subtitleList.value = [];
    subtitleMergedText.value = "";
    subtitleRequestId.value = "";
    subtitleSrt.value = "";
    startSubtitleTimer();

    try {
      const audioUrlForRecognition = effectiveAudioSourceUrl.value;

      // 调主进程发起字幕识别（固定模力方舟 + whisper-large-v3-turbo）
      const rawResult = await window.desktopApi.recognizeSubtitles(
        audioUrlForRecognition,
      );

      if (!isSubtitleRecognitionResult(rawResult)) {
        throw new Error("字幕识别返回格式无效");
      }
      const result = rawResult;

      subtitleTaskStatus.value = result.status || "completed";
      subtitleList.value = result.subtitles.map((item, index) => ({
        id: item.id || `segment-${index + 1}`,
        start: item.start,
        end: item.end,
        text: item.text,
      }));
      subtitleMergedText.value = formatSubtitlesText(subtitleList.value);
      subtitleRequestId.value = result.requestId;
      subtitleSrt.value = result.srt;
      ElMessage.success("字幕识别完成");
    } catch (error) {
      if (isCancelledByUser) {
        return;
      }

      const isAbortError =
        error instanceof Error &&
        /abort|aborted|canceled|cancelled/i.test(error.message);
      if (isAbortError) {
        subtitleTaskStatus.value = "已中断";
        ElMessage.info("已停止字幕识别");
      } else {
        subtitleTaskStatus.value = "识别失败";
        const message = error instanceof Error ? error.message : "字幕识别失败";
        if (isMoarkAuthError(message)) {
          handleAuthExpired();
        } else {
          ElMessage.error(message);
        }
      }
    } finally {
      isRecognizing.value = false;
      stopSubtitleTimer();
    }
  }

  async function stopSubtitleRecognition(): Promise<void> {
    if (!isRecognizing.value) {
      return;
    }

    isCancelledByUser = true;
    await window.desktopApi.cancelSubtitleRecognition();
    isRecognizing.value = false;
    subtitleTaskStatus.value = "已中断";
    stopSubtitleTimer();
    ElMessage.info("已停止字幕识别");
  }

  // 清除旧版本手动模式残留的 localStorage 数据
  const audioInputStorageKey = "free-super-agent.subtitle-audio-input";
  try {
    window.localStorage.removeItem(audioInputStorageKey);
  } catch {
    // ignore
  }

  onUnmounted(() => {
    stopSubtitleTimer();
  });

  return {
    audioSourceUrl,
    effectiveAudioSourceUrl,
    effectiveVideoSourceUrl,
    isRecognizing,
    startSubtitleRecognition,
    stopSubtitleRecognition,
    subtitleElapsedText,
    subtitleList,
    subtitleMergedText,
    subtitleRequestId,
    subtitleSrt,
    subtitleTaskStatus,
    updateSubtitleText,
    videoSourceUrl,
  };
}

export function useSubtitleRecognition() {
  if (!sharedSubtitleRecognitionState) {
    sharedSubtitleRecognitionState = useSubtitleRecognitionImpl();
  }

  return sharedSubtitleRecognitionState;
}
