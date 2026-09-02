/**
 * 语音克隆 dispatcher
 *
 * 管理：
 *   - activeProvider：当前使用的 provider（当前仅支持模力方舟 moark）
 *   - synthesizedAudioUrl：统一的语音合成结果 URL（由 provider 写入，下游步骤读取）
 *   - isConfigModalOpen：模型配置弹窗开关
 *
 * 说明：阿里云、自建模型已下线，语音克隆只保留模力方舟一个模型。
 * 历史用户即便曾选择过其它模型，这里也一律以 moark 为准。
 */
import { ref } from "vue";

export type VoiceCloneProviderKey = "moark";

let sharedActiveProvider: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const activeProvider = ref<VoiceCloneProviderKey>("moark");
  const isConfigModalOpen = ref(false);
  /** 统一的语音合成结果 URL（由当前活跃 provider 写入，下游步骤统一读取） */
  const synthesizedAudioUrl = ref("");

  function openConfigModal(): void {
    isConfigModalOpen.value = true;
  }

  function closeConfigModal(): void {
    isConfigModalOpen.value = false;
  }

  return {
    activeProvider,
    synthesizedAudioUrl,
    isConfigModalOpen,
    openConfigModal,
    closeConfigModal,
  };
}

export function useVoiceCloneActive() {
  if (!sharedActiveProvider) {
    sharedActiveProvider = useImpl();
  }
  return sharedActiveProvider;
}
