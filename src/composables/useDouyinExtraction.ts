import { ElMessage } from "element-plus";
import { computed, onUnmounted, ref } from "vue";
import {
  useMoarkAccount,
  isMoarkAuthError,
} from "@/composables/useMoarkAccount";
import type { DouyinExtractionResult } from "@/types/douyin";

function isDouyinExtractionResult(
  value: unknown,
): value is DouyinExtractionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "videoUrl" in value &&
    "text" in value &&
    typeof value.videoUrl === "string" &&
    typeof value.text === "string"
  );
}

let sharedDouyinExtractionState: ReturnType<
  typeof useDouyinExtractionImpl
> | null = null;

function useDouyinExtractionImpl() {
  const { ensureReady, handleAuthExpired } = useMoarkAccount();
  // 默认填一条抖音分享原文，主进程会从里面解析出短链，用户也可直接粘贴自己的分享文本
  const douyinUrl = ref(
    "9.99 dAg:/ 01/20 :5pm h@o.da 免费，开源，超级IP智能体 超级IP智能体，不用花钱，直接用 # 自媒体创业 # 超级ip # ai编程 # 运营 # vibecoding大赏  https://v.douyin.com/_bqmQg2aY94/ 复制此链接，打开Dou音搜索，直接观看视频！",
  );
  const isExtractingDouyin = ref(false);
  const isDouyinCancelled = ref(false);
  const extractedVideoUrl = ref("");
  const extractedCopy = ref("");
  const extractionElapsedMs = ref(0);
  let extractionStartedAt = 0;
  let extractionTimer: number | undefined;

  const extractionElapsedText = computed(
    () => `${(extractionElapsedMs.value / 1000).toFixed(2)}秒`,
  );

  function startExtractionTimer(): void {
    extractionStartedAt = Date.now();
    extractionElapsedMs.value = 0;

    if (extractionTimer) {
      window.clearInterval(extractionTimer);
    }

    extractionTimer = window.setInterval(() => {
      extractionElapsedMs.value = Date.now() - extractionStartedAt;
    }, 100);
  }

  function stopExtractionTimer(): void {
    if (extractionStartedAt > 0) {
      extractionElapsedMs.value = Date.now() - extractionStartedAt;
    }

    if (extractionTimer) {
      window.clearInterval(extractionTimer);
      extractionTimer = undefined;
    }
  }

  async function extractDouyinCopy(): Promise<void> {
    if (isExtractingDouyin.value) {
      return;
    }

    if (!ensureReady()) {
      return;
    }

    const url = douyinUrl.value.trim();

    if (!url) {
      ElMessage.warning("请输入抖音地址");
      return;
    }

    isDouyinCancelled.value = false;
    isExtractingDouyin.value = true;
    extractedVideoUrl.value = "";
    extractedCopy.value = "";
    startExtractionTimer();

    try {
      const result = await window.desktopApi.extractDouyinCopy(url);

      if (isDouyinCancelled.value) {
        return;
      }

      if (!isDouyinExtractionResult(result)) {
        throw new Error("Invalid extraction result");
      }

      extractedVideoUrl.value = result.videoUrl;
      extractedCopy.value = result.text;
      ElMessage.success("文案提取完成");
    } catch (error) {
      if (!isDouyinCancelled.value) {
        const message = error instanceof Error ? error.message : "文案提取失败";
        if (isMoarkAuthError(message)) {
          handleAuthExpired();
        } else {
          ElMessage.error(message);
        }
      }
    } finally {
      isExtractingDouyin.value = false;
      stopExtractionTimer();
    }
  }

  async function stopDouyinExtraction(): Promise<void> {
    if (!isExtractingDouyin.value) {
      return;
    }

    isDouyinCancelled.value = true;
    await window.desktopApi.cancelDouyinExtraction();
    isExtractingDouyin.value = false;
    stopExtractionTimer();
    ElMessage.info("已停止提取");
  }

  onUnmounted(() => {
    if (extractionTimer) {
      window.clearInterval(extractionTimer);
    }
  });

  return {
    douyinUrl,
    extractionElapsedText,
    extractedCopy,
    extractedVideoUrl,
    extractDouyinCopy,
    isExtractingDouyin,
    stopDouyinExtraction,
  };
}

/**
 * 抖音文案提取 composable（共享单例模式）
 */
export function useDouyinExtraction() {
  if (!sharedDouyinExtractionState) {
    sharedDouyinExtractionState = useDouyinExtractionImpl();
  }
  return sharedDouyinExtractionState;
}
