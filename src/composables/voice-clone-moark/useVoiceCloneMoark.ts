/**
 * 模力方舟语音克隆 composable
 *
 * 功能：
 *   - 配置管理（API Key + Cookie 持久化）
 *   - 登录状态管理（cookie 验证 + BrowserWindow 登录引导）
 *   - 音色管理（纯本地：录音/上传 → 拷贝到用户目录 → JSON 记录）
 *
 * 音色管理特点：
 *   - 不涉及任何网络操作
 *   - 不同 API Key 共享同一份本地音色
 *   - 文件拷贝到用户目录，防止原文件删除导致丢失
 *
 * 完全独立于其他 provider，删除时整个目录可直接移除。
 */
import { ElMessage } from "element-plus";
import { computed, ref, onMounted, onUnmounted } from "vue";
import { useWorkflowState } from "@/composables/useWorkflowState";
import { useVoiceCloneActive } from "@/composables/useVoiceClone";
import {
  useMoarkAccount,
  isMoarkAuthError,
} from "@/composables/useMoarkAccount";
import type { MoarkVoiceProfile } from "@/types/voice-clone-moark";

function isMoarkVoiceProfile(value: unknown): value is MoarkVoiceProfile {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    "filePath" in value &&
    "md5" in value &&
    "audioUrl" in value
  );
}

function isMoarkVoiceProfileList(value: unknown): value is MoarkVoiceProfile[] {
  return Array.isArray(value) && value.every(isMoarkVoiceProfile);
}

/**
 * 去掉 Electron IPC 抛错时自动包上的前缀，只保留真正的错误原因。
 * 例如：
 *   "Error invoking remote method 'voice-moark:synthesize': Error: 语音合成失败（400）：xxx"
 *   → "语音合成失败（400）：xxx"
 */
function normalizeIpcErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^(Error|Error:)\s*/, "")
    .trim();
}

let sharedMoarkState: ReturnType<typeof useVoiceCloneMoarkImpl> | null = null;

function useVoiceCloneMoarkImpl() {
  const { createdCopyText } = useWorkflowState();
  const { synthesizedAudioUrl: sharedSynthesizedAudioUrl } =
    useVoiceCloneActive();
  const { ensureLoggedIn, handleAuthExpired } = useMoarkAccount();

  // ── 音色管理 ──
  const voices = ref<MoarkVoiceProfile[]>([]);
  const selectedVoiceId = ref("");
  const isLoadingVoices = ref(false);
  const isSavingVoice = ref(false);
  const voiceName = ref("");
  const editingVoiceId = ref("");
  const editingVoiceName = ref("");

  // ── 语音合成 ──
  const isSynthesizingVoice = ref(false);
  const isVoiceSynthesisCancelled = ref(false);
  const synthesisElapsedMs = ref(0);
  const synthesizedAudioUrl = ref("");
  let synthesisStartedAt = 0;
  let synthesisTimer: number | undefined;

  const selectedVoice = computed(() =>
    voices.value.find((v) => v.id === selectedVoiceId.value),
  );

  // ── 音色管理（纯本地操作） ──

  async function refreshVoices(): Promise<void> {
    isLoadingVoices.value = true;
    try {
      const result = await window.desktopApi.listMoarkVoices();
      if (!isMoarkVoiceProfileList(result))
        throw new Error("Invalid voice list");
      voices.value = result;
      if (!selectedVoiceId.value && voices.value[0]) {
        selectedVoiceId.value = voices.value[0].id;
      }
      if (
        selectedVoiceId.value &&
        !voices.value.some((v) => v.id === selectedVoiceId.value)
      ) {
        selectedVoiceId.value = voices.value[0]?.id ?? "";
      }
    } catch (error) {
      ElMessage.error(
        error instanceof Error ? error.message : "音色列表获取失败",
      );
    } finally {
      isLoadingVoices.value = false;
    }
  }

  async function saveVoice(sourceFilePath: string): Promise<boolean> {
    if (!sourceFilePath) {
      ElMessage.warning("请先选择音频文件");
      return false;
    }
    if (!voiceName.value.trim()) {
      ElMessage.warning("请输入音色名称");
      return false;
    }

    isSavingVoice.value = true;
    try {
      const result = await window.desktopApi.createMoarkVoice({
        name: voiceName.value,
        sourceFilePath,
      });
      if (!isMoarkVoiceProfile(result)) throw new Error("保存失败");

      voices.value = [result, ...voices.value];
      selectedVoiceId.value = result.id;
      voiceName.value = "";
      ElMessage.success("音色保存成功");
      return true;
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : "音色保存失败");
      return false;
    } finally {
      isSavingVoice.value = false;
    }
  }

  function startEditVoice(voice: MoarkVoiceProfile): void {
    editingVoiceId.value = voice.id;
    editingVoiceName.value = voice.name;
  }

  async function saveEditVoice(): Promise<void> {
    const result = await window.desktopApi.updateMoarkVoice({
      id: editingVoiceId.value,
      name: editingVoiceName.value,
    });
    if (isMoarkVoiceProfileList(result)) voices.value = result;
    editingVoiceId.value = "";
    editingVoiceName.value = "";
  }

  async function deleteVoice(id: string): Promise<void> {
    const result = await window.desktopApi.deleteMoarkVoice(id);
    if (isMoarkVoiceProfileList(result)) voices.value = result;
    if (selectedVoiceId.value === id) {
      selectedVoiceId.value = voices.value[0]?.id ?? "";
    }
  }

  // ── 语音合成 ──

  const synthesisElapsedText = computed(
    () => `${(synthesisElapsedMs.value / 1000).toFixed(2)}秒`,
  );

  function startSynthesisTimer(): void {
    synthesisStartedAt = Date.now();
    synthesisElapsedMs.value = 0;
    if (synthesisTimer) window.clearInterval(synthesisTimer);
    synthesisTimer = window.setInterval(() => {
      synthesisElapsedMs.value = Date.now() - synthesisStartedAt;
    }, 100);
  }

  function stopSynthesisTimer(): void {
    if (synthesisStartedAt > 0)
      synthesisElapsedMs.value = Date.now() - synthesisStartedAt;
    if (synthesisTimer) {
      window.clearInterval(synthesisTimer);
      synthesisTimer = undefined;
    }
  }

  async function synthesizeSelectedVoice(): Promise<void> {
    if (isSynthesizingVoice.value) return;
    if (!selectedVoice.value) {
      ElMessage.warning("请先选择音色");
      return;
    }
    if (!createdCopyText.value.trim()) {
      ElMessage.warning("请先完成文案创作");
      return;
    }
    // 语音合成需要上传音色样本，依赖有效登录 cookie
    if (!ensureLoggedIn()) {
      return;
    }

    isVoiceSynthesisCancelled.value = false;
    isSynthesizingVoice.value = true;
    synthesizedAudioUrl.value = "";
    startSynthesisTimer();

    try {
      const result = (await window.desktopApi.synthesizeMoarkVoice({
        text: createdCopyText.value,
        voiceId: selectedVoice.value.id,
      })) as { audioUrl?: string };

      if (isVoiceSynthesisCancelled.value) return;

      if (!result?.audioUrl) throw new Error("语音合成返回格式异常");
      synthesizedAudioUrl.value = result.audioUrl;
      // 同步到统一入口，供下游步骤（字幕识别等）使用
      sharedSynthesizedAudioUrl.value = result.audioUrl;
      ElMessage.success("语音生成完成");
    } catch (error) {
      if (!isVoiceSynthesisCancelled.value) {
        const message =
          error instanceof Error
            ? normalizeIpcErrorMessage(error.message)
            : "语音生成失败";
        // 鉴权失效：刷新状态并引导去配置中心重新授权
        if (isMoarkAuthError(message)) {
          handleAuthExpired();
        } else {
          ElMessage.error(message);
        }
      }
    } finally {
      isSynthesizingVoice.value = false;
      stopSynthesisTimer();
    }
  }

  async function stopVoiceSynthesis(): Promise<void> {
    if (!isSynthesizingVoice.value) return;
    isVoiceSynthesisCancelled.value = true;
    await window.desktopApi.cancelMoarkVoiceSynthesis();
    isSynthesizingVoice.value = false;
    stopSynthesisTimer();
    ElMessage.info("已停止语音生成");
  }

  onMounted(() => {
    void refreshVoices();
  });

  onUnmounted(() => {
    if (synthesisTimer) window.clearInterval(synthesisTimer);
  });

  return {
    voices,
    selectedVoiceId,
    selectedVoice,
    isLoadingVoices,
    isSavingVoice,
    voiceName,
    editingVoiceId,
    editingVoiceName,
    isSynthesizingVoice,
    synthesisElapsedText,
    synthesizedAudioUrl,
    refreshVoices,
    saveVoice,
    startEditVoice,
    saveEditVoice,
    deleteVoice,
    synthesizeSelectedVoice,
    stopVoiceSynthesis,
  };
}

export function useVoiceCloneMoark() {
  if (!sharedMoarkState) {
    sharedMoarkState = useVoiceCloneMoarkImpl();
  }
  return sharedMoarkState;
}
