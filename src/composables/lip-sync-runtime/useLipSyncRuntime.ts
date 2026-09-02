/**
 * 视频对口型运行时（独享算力）
 *
 * 负责音频/视频上传、任务提交与状态跟踪：
 *   - 音频：来自第三步语音克隆结果，或用户手动上传
 *   - 视频：用户本地选择的文件
 * 通过独享算力服务提交任务，主进程分阶段回传状态，完成后取回结果视频地址。
 *
 * 说明：早期这里同时承载「模力方舟」provider，模力方舟下线后其相关逻辑已移除，
 * 现仅保留独享算力流程。
 */
import { ElMessage } from "element-plus";
import { computed, onUnmounted, ref } from "vue";

import { useLipSyncActive } from "@/composables/useLipSyncActive";
import { useLipSyncDedicated } from "@/composables/lip-sync-dedicated/useLipSyncDedicated";

let sharedRuntimeState: ReturnType<typeof useImpl> | null = null;

/**
 * 清洗 Electron IPC 抛出的错误文案
 *
 * 主进程抛错经 IPC 透传后会带上
 * `Error invoking remote method 'xxx': Error: 真正的提示`
 * 这样的包装前缀，直接展示给用户很难理解，这里只保留最后一段真正的提示。
 */
function cleanIpcErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/i, "")
    .replace(/^(?:Uncaught\s+)?Error:\s*/i, "")
    .trim();
}

function useImpl() {
  const { config: dedicatedConfig, refreshConfig: refreshDedicatedConfig } =
    useLipSyncDedicated();
  const { openConfigModal } = useLipSyncActive();

  // 任务相关状态
  const taskStatus = ref("未开始");
  const elapsedMs = ref(0);
  const isSubmitting = ref(false);
  const isPolling = ref(false);
  const resultVideoUrl = ref("");

  // 视频上传相关状态
  const videoPreviewUrl = ref("");
  const videoStatus = ref("未上传");
  // 本地选择的视频文件（提交时需要其二进制内容）
  let selectedVideoFile: File | null = null;
  let ownsVideoPreviewUrl = false;

  // 音频上传相关状态（用户手动上传，可跳过第三步）
  const uploadedAudioPreviewUrl = ref("");
  const uploadedAudioFileName = ref("");
  let selectedAudioFile: File | null = null;
  let ownsAudioPreviewUrl = false;

  // 计时
  let elapsedTimer: number | undefined;
  let startedAt = 0;

  const hasResult = computed(() => Boolean(resultVideoUrl.value));
  const elapsedText = computed(
    () => `${(elapsedMs.value / 1000).toFixed(2)}秒`,
  );

  function revokeVideoPreviewUrl(): void {
    if (ownsVideoPreviewUrl && videoPreviewUrl.value.startsWith("blob:")) {
      URL.revokeObjectURL(videoPreviewUrl.value);
    }
    ownsVideoPreviewUrl = false;
    videoPreviewUrl.value = "";
  }

  // 仅做本地预览，不向后端发送任何请求
  async function uploadVideoFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    videoStatus.value = "上传中...";
    try {
      revokeVideoPreviewUrl();
      selectedVideoFile = file;
      videoPreviewUrl.value = URL.createObjectURL(file);
      ownsVideoPreviewUrl = true;
      videoStatus.value = "已上传";
      ElMessage.success("视频已就绪");
    } catch (error) {
      selectedVideoFile = null;
      videoStatus.value = "上传失败";
      ElMessage.error("视频读取失败");
      console.error("视频读取失败:", error);
    }
  }

  function revokeAudioPreviewUrl(): void {
    if (
      ownsAudioPreviewUrl &&
      uploadedAudioPreviewUrl.value.startsWith("blob:")
    ) {
      URL.revokeObjectURL(uploadedAudioPreviewUrl.value);
    }
    ownsAudioPreviewUrl = false;
    uploadedAudioPreviewUrl.value = "";
  }

  async function uploadAudioFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (
      !file.type.startsWith("audio/") &&
      !file.name.match(/\.(mp3|wav|m4a|ogg|flac|aac)$/i)
    ) {
      ElMessage.warning("请上传音频文件");
      return;
    }

    try {
      revokeAudioPreviewUrl();
      selectedAudioFile = file;
      uploadedAudioFileName.value = file.name;

      // 缓存到本地临时目录，供第五步字幕识别使用
      const arrayBuffer = await file.arrayBuffer();
      const result = await window.desktopApi.cacheSynthesizedAudio(
        arrayBuffer,
        file.name,
      );
      const cachedUrl = result as string;
      uploadedAudioPreviewUrl.value = cachedUrl;
      ownsAudioPreviewUrl = false;
      ElMessage.success("音频已就绪");
    } catch (error) {
      selectedAudioFile = null;
      uploadedAudioFileName.value = "";
      ElMessage.error("音频读取失败");
      console.error("音频读取失败:", error);
    }
  }

  function startElapsedTimer(): void {
    startedAt = Date.now();
    elapsedMs.value = 0;
    if (elapsedTimer) window.clearInterval(elapsedTimer);
    elapsedTimer = window.setInterval(() => {
      elapsedMs.value = Date.now() - startedAt;
    }, 100);
  }

  function stopElapsedTimer(): void {
    if (startedAt > 0) elapsedMs.value = Date.now() - startedAt;
    if (elapsedTimer) {
      window.clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
  }

  /** 把音频准备成提交负载：有 Blob 直接传二进制，否则只传 URL，由主进程下载 */
  async function buildAudioSource(
    audioUrl: string,
    audioBlob?: Blob | null,
  ): Promise<
    | { arrayBuffer: ArrayBuffer; fileName: string; mimeType: string }
    | { url: string }
  > {
    if (audioBlob) {
      const mimeType = audioBlob.type || "audio/mpeg";
      const fileName = mimeType.includes("wav")
        ? "voice-clone-audio.wav"
        : "voice-clone-audio.mp3";
      return {
        arrayBuffer: await audioBlob.arrayBuffer(),
        fileName,
        mimeType,
      };
    }

    if (!audioUrl) {
      throw new Error("请先完成第三步语音生成");
    }

    // 远程 URL 或 local-audio:// 协议由主进程下载，避免渲染端 CORS
    if (
      /^https?:\/\//i.test(audioUrl) ||
      audioUrl.startsWith("local-audio://")
    ) {
      return { url: audioUrl };
    }

    // blob: 等本地引用，渲染端 fetch 是允许的
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error("获取第三步音频失败");
    const blob = await response.blob();
    const mimeType = blob.type || "audio/mpeg";
    const fileName = mimeType.includes("wav")
      ? "voice-clone-audio.wav"
      : "voice-clone-audio.mp3";
    return { arrayBuffer: await blob.arrayBuffer(), fileName, mimeType };
  }

  /**
   * 提交对口型任务（独享算力）：音频取自第三步或用户手动上传，视频取自本地选择的文件。
   * 主进程分阶段执行，通过 IPC 事件回传状态更新。
   */
  async function submitTask(
    audioUrl: string,
    audioBlob?: Blob | null,
  ): Promise<void> {
    if (isSubmitting.value || isPolling.value) return;

    // 未填写服务器地址时提前拦下，避免把主进程抛的原始 IPC 错误抛给用户。
    // 配置是异步加载的，为空时先补读一次，避免刚启动就点击造成误判。
    if (!dedicatedConfig.baseUrl.trim()) {
      await refreshDedicatedConfig();
    }
    if (!dedicatedConfig.baseUrl.trim()) {
      ElMessage.warning("请先点击右上角【模型配置】，填写独享算力服务器地址");
      openConfigModal();
      return;
    }

    if (!selectedVideoFile) {
      ElMessage.warning("请先上传视频文件");
      return;
    }

    // 优先使用用户手动上传的音频，其次使用第四步缓存的音频地址，最后用第三步传来的 Blob
    const hasManualAudio = Boolean(selectedAudioFile);
    const step4AudioUrl = uploadedAudioPreviewUrl.value;
    if (!hasManualAudio && !step4AudioUrl && !audioUrl && !audioBlob) {
      ElMessage.warning("请先上传音频或完成第三步语音生成");
      return;
    }

    isSubmitting.value = true;
    resultVideoUrl.value = "";
    taskStatus.value = "准备中...";
    startElapsedTimer();

    try {
      let audio: Awaited<ReturnType<typeof buildAudioSource>>;
      if (hasManualAudio && selectedAudioFile) {
        const mimeType = selectedAudioFile.type || "audio/mpeg";
        const fileName = selectedAudioFile.name;
        audio = {
          arrayBuffer: await selectedAudioFile.arrayBuffer(),
          fileName,
          mimeType,
        };
      } else if (step4AudioUrl) {
        audio = await buildAudioSource(step4AudioUrl, null);
      } else {
        audio = await buildAudioSource(audioUrl, audioBlob);
      }

      taskStatus.value = "提交中...";
      isPolling.value = true;

      const removeStatusListener = window.desktopApi.onLipSyncDedicatedStatus(
        (status: string) => {
          taskStatus.value = status;
        },
      );

      try {
        const dedicatedResult =
          await window.desktopApi.submitLipSyncDedicatedTask({
            audio,
            video: {
              arrayBuffer: await selectedVideoFile.arrayBuffer(),
              fileName: selectedVideoFile.name,
              mimeType: selectedVideoFile.type || "video/mp4",
            },
          });

        const result = dedicatedResult as {
          outputUrl?: string;
          canceled?: boolean;
        };
        // 用户主动「停止重启」：状态与提示已由 stopTask 处理，这里静默结束
        if (result?.canceled) {
          return;
        }
        if (result?.outputUrl) {
          resultVideoUrl.value = result.outputUrl;
          taskStatus.value = "completed";
          isPolling.value = false;
          stopElapsedTimer();
          ElMessage.success("视频对口型完成");
        } else {
          throw new Error("独享算力返回结果中未包含视频地址");
        }
      } finally {
        removeStatusListener();
      }
    } catch (error) {
      const message = cleanIpcErrorMessage(
        error instanceof Error ? error.message : "",
      );
      // 用户主动取消时不显示错误（正常情况下主进程已返回取消标记，这里是兜底）
      const isAbortError = /abort|aborted|canceled|cancelled/i.test(message);
      if (isAbortError) {
        return;
      }

      stopElapsedTimer();
      isPolling.value = false;

      // 连接失败：多为服务端正在重启或未启动，给出可操作的友好提示
      const isConnError =
        /fetch failed|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|network|Failed to fetch/i.test(
          message,
        );
      if (isConnError) {
        taskStatus.value = "连接失败";
        ElMessage.error(
          "无法连接到独享算力服务器，服务可能正在重启，请稍候重试",
        );
      } else {
        // 根据当前阶段显示对应的失败状态
        const currentStatus = taskStatus.value;
        if (currentStatus.startsWith("下载")) {
          taskStatus.value = "下载失败";
        } else if (currentStatus.startsWith("执行")) {
          taskStatus.value = "执行失败";
        } else {
          taskStatus.value = "提交失败";
        }
        ElMessage.error(message || "视频对口型失败");
      }
    } finally {
      isSubmitting.value = false;
    }
  }

  async function stopTask(): Promise<void> {
    if (!isPolling.value && !isSubmitting.value) return;
    stopElapsedTimer();
    isPolling.value = false;
    isSubmitting.value = false;
    taskStatus.value = "已停止";

    // 通知主进程取消独享算力任务：服务端会重启容器以清空任务与显存
    await window.desktopApi.cancelLipSyncDedicatedTask().catch(() => {});

    ElMessage.info("已停止，服务器正在重启，请稍候再重试");
  }

  function clearSelectedAudioFile(): void {
    selectedAudioFile = null;
  }

  onUnmounted(() => {
    if (elapsedTimer) {
      window.clearInterval(elapsedTimer);
      elapsedTimer = undefined;
    }
    revokeVideoPreviewUrl();
    revokeAudioPreviewUrl();
  });

  return {
    clearSelectedAudioFile,
    hasResult,
    taskStatus,
    elapsedText,
    isSubmitting,
    isPolling,
    resultVideoUrl,
    uploadedAudioFileName,
    uploadedAudioPreviewUrl,
    videoPreviewUrl,
    videoStatus,
    submitTask,
    stopTask,
    uploadAudioFile,
    uploadVideoFile,
  };
}

export function useLipSyncRuntime() {
  if (!sharedRuntimeState) {
    sharedRuntimeState = useImpl();
  }
  return sharedRuntimeState;
}
