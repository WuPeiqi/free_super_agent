/**
 * 模力方舟中央账户（配置中心）—— 全局共享单例
 *
 * 抖音提取、文案创作、语音克隆、字幕识别四步共用同一个模力方舟账户。
 * 用户在配置中心一次性授权登录（获取 cookie + 自动获取 apiKey），之后各步骤直接可用。
 *
 * 凭证按能力拆分：
 *   - apiKey（hasApiKey）：抖音提取 / 文案创作 / 字幕识别 / 语音合成的模型调用都用它。
 *     这是"全部功能就绪"的唯一准入条件（isReady）。
 *   - cookie（loggedIn）：仅语音合成里"上传音色样本"需要。cookie 失效不影响其它功能，
 *     只需在语音合成时用 ensureLoggedIn 单独校验并引导重新授权。
 *
 * 之所以拆分：apiKey 是长期访问令牌、基本不过期；cookie 是登录态、会较快失效。
 * 若把 cookie 也算进通用准入，会导致 cookie 一失效就误伤所有功能。
 */
import { ElMessage } from "element-plus";
import { computed, ref } from "vue";

interface MoarkAccountInfo {
  name: string;
  username: string;
}

interface MoarkStatus {
  loggedIn: boolean;
  hasApiKey: boolean;
  account: MoarkAccountInfo | null;
}

/** 去掉 Electron IPC 抛错时自动包上的前缀，只保留真正的错误原因 */
function normalizeIpcErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^(Error|Error:)\s*/, "")
    .trim();
}

/** 判断错误信息是否为鉴权失效（cookie 过期 / apiKey 失效 / 401） */
export function isMoarkAuthError(message: string): boolean {
  return /401|登录已过期|登录过期|重新登录|API Key|访问令牌|令牌|未授权|unauthorized/i.test(
    message,
  );
}

interface MoarkCallQuota {
  remaining: number;
  total: number;
}

function isCallQuota(value: unknown): value is MoarkCallQuota {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MoarkCallQuota).remaining === "number" &&
    typeof (value as MoarkCallQuota).total === "number"
  );
}

function isMoarkStatus(value: unknown): value is MoarkStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "loggedIn" in value &&
    "hasApiKey" in value
  );
}

let sharedState: ReturnType<typeof useImpl> | null = null;

function useImpl() {
  const loggedIn = ref(false);
  const hasApiKey = ref(false);
  const account = ref<MoarkAccountInfo | null>(null);

  const isConfigCenterOpen = ref(false);
  const isAuthorizing = ref(false);
  const isChecking = ref(false);

  // 今日免费调用额度（null 表示未获取到）
  const quotaRemaining = ref<number | null>(null);
  const quotaTotal = ref<number | null>(null);
  const isLoadingQuota = ref(false);

  // 通用就绪只看 apiKey：cookie 失效不影响抖音提取 / 文案创作 / 字幕识别
  const isReady = computed(() => hasApiKey.value);

  function applyStatus(status: MoarkStatus): void {
    loggedIn.value = Boolean(status.loggedIn);
    hasApiKey.value = Boolean(status.hasApiKey);
    account.value = status.account ?? null;
  }

  async function refreshStatus(): Promise<void> {
    isChecking.value = true;
    try {
      const status = await window.desktopApi.moarkGetStatus();
      if (isMoarkStatus(status)) {
        applyStatus(status);
      }
    } catch {
      // 静默失败，保持当前状态
    } finally {
      isChecking.value = false;
    }
  }

  /**
   * 拉取今日免费调用额度；失败时置空由界面显示占位。
   * 该接口只认登录 cookie，所以 cookie 失效时直接跳过请求。
   */
  async function refreshQuota(): Promise<void> {
    if (!loggedIn.value) {
      quotaRemaining.value = null;
      quotaTotal.value = null;
      return;
    }

    isLoadingQuota.value = true;
    try {
      const quota = await window.desktopApi.moarkGetQuota();
      if (isCallQuota(quota)) {
        quotaRemaining.value = quota.remaining;
        quotaTotal.value = quota.total;
      } else {
        quotaRemaining.value = null;
        quotaTotal.value = null;
      }
    } catch {
      quotaRemaining.value = null;
      quotaTotal.value = null;
    } finally {
      isLoadingQuota.value = false;
    }
  }

  async function authorize(): Promise<void> {
    if (isAuthorizing.value) return;
    isAuthorizing.value = true;
    try {
      const status = await window.desktopApi.moarkAuthorize();
      if (isMoarkStatus(status) && status.loggedIn) {
        applyStatus(status);
        if (status.hasApiKey) {
          ElMessage.success("授权成功，已自动获取访问令牌，全部功能已就绪");
          void refreshQuota();
        }
      } else {
        ElMessage.info("已取消授权登录");
      }
    } catch (error) {
      ElMessage.error(
        error instanceof Error
          ? normalizeIpcErrorMessage(error.message)
          : "授权失败，请重试",
      );
      // 授权流程可能已写入 cookie 但取令牌失败，刷新一次真实状态
      await refreshStatus();
    } finally {
      isAuthorizing.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await window.desktopApi.moarkLogout();
    } finally {
      applyStatus({ loggedIn: false, hasApiKey: false, account: null });
      quotaRemaining.value = null;
      quotaTotal.value = null;
      ElMessage.info("已退出模力方舟登录");
    }
  }

  function openConfigCenter(): void {
    isConfigCenterOpen.value = true;
    // 先刷新授权状态，再按最新状态拉取今日剩余免费次数
    void refreshStatus().then(() => refreshQuota());
  }

  function closeConfigCenter(): void {
    isConfigCenterOpen.value = false;
  }

  /** 通用准入（模型调用）：只校验 apiKey；未就绪则打开配置中心并提示 */
  function ensureReady(): boolean {
    if (isReady.value) return true;
    openConfigCenter();
    ElMessage.warning("请先在【配置中心】完成授权登录");
    return false;
  }

  /**
   * 语音合成/音色上传专用：需要有效的登录 cookie。
   * apiKey 缺失或 cookie 失效都会引导去配置中心重新授权。
   */
  function ensureLoggedIn(): boolean {
    if (hasApiKey.value && loggedIn.value) return true;
    openConfigCenter();
    ElMessage.warning(
      loggedIn.value
        ? "请先在【配置中心】完成授权登录"
        : "登录态已过期，请在【配置中心】重新授权登录后再合成语音",
    );
    return false;
  }

  /**
   * 运行时捕获到鉴权失败（401 / 令牌失效 / 登录过期）时调用：
   * 刷新真实状态并引导重新授权，避免功能被"卡死"。
   */
  function handleAuthExpired(): void {
    void refreshStatus();
    openConfigCenter();
    ElMessage.error("授权已失效，请在【配置中心】重新授权登录");
  }

  void refreshStatus();

  return {
    loggedIn,
    hasApiKey,
    account,
    isReady,
    isConfigCenterOpen,
    isAuthorizing,
    isChecking,
    quotaRemaining,
    quotaTotal,
    isLoadingQuota,
    refreshQuota,
    refreshStatus,
    authorize,
    logout,
    openConfigCenter,
    closeConfigCenter,
    ensureReady,
    ensureLoggedIn,
    handleAuthExpired,
  };
}

export function useMoarkAccount() {
  if (!sharedState) {
    sharedState = useImpl();
  }
  return sharedState;
}
