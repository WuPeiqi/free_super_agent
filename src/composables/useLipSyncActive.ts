/**
 * 视频对口型配置弹窗开关
 *
 * 对口型仅保留独享算力一个模型（WaveSpeed、模力方舟均已下线），
 * 不再需要 provider 切换，这里只负责「模型配置弹窗」的开关状态。
 *
 * 不要在这里写任何业务逻辑。
 */
import { ref } from "vue";

let sharedActiveProvider: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const isConfigModalOpen = ref(false);

  function openConfigModal(): void {
    isConfigModalOpen.value = true;
  }

  function closeConfigModal(): void {
    isConfigModalOpen.value = false;
  }

  return {
    isConfigModalOpen,
    openConfigModal,
    closeConfigModal,
  };
}

export function useLipSyncActive() {
  if (!sharedActiveProvider) {
    sharedActiveProvider = useImpl();
  }
  return sharedActiveProvider;
}
