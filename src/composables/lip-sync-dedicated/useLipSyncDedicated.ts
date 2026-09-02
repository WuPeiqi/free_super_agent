/**
 * 独享算力视频对口型 composable
 *
 * 对接自建/独享 GPU 服务器（TransDhServer）。
 * 只需配置服务器地址前缀，例如 http://127.0.0.1:8383
 */
import { reactive, ref } from "vue";

interface DedicatedConfigStore {
  baseUrl: string;
}

let sharedState: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const config = reactive<DedicatedConfigStore>({
    baseUrl: "",
  });
  const isSavingConfig = ref(false);

  function applyStored(stored: unknown): void {
    if (typeof stored !== "object" || stored === null) return;
    const obj = stored as Partial<DedicatedConfigStore>;
    if (typeof obj.baseUrl === "string") config.baseUrl = obj.baseUrl;
  }

  async function refreshConfig(): Promise<void> {
    const stored = await window.desktopApi.loadLipSyncDedicatedConfig();
    applyStored(stored);
  }

  async function saveConfig(): Promise<void> {
    isSavingConfig.value = true;
    try {
      await window.desktopApi.saveLipSyncDedicatedConfig({
        baseUrl: config.baseUrl,
      });
    } finally {
      isSavingConfig.value = false;
    }
  }

  void refreshConfig();

  return {
    config,
    isSavingConfig,
    refreshConfig,
    saveConfig,
  };
}

export function useLipSyncDedicated() {
  if (!sharedState) {
    sharedState = useImpl();
  }
  return sharedState;
}
