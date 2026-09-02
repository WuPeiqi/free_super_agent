/**
 * 模力方舟中央账户（配置中心）
 *
 * 全局唯一的模力方舟账户信息，供抖音提取、文案创作、语音克隆、字幕识别四步共用：
 *   - cookies：登录后获取，用于音色管理（上传/登录态）与首次拉取访问令牌
 *   - apiKey：登录后凭 cookie 自动从访问令牌接口获取，用于全部模型调用
 *   - account：账户展示信息（昵称/用户名）
 *
 * 授权流程：
 *   1. openMoarkLoginWindow 打开 BrowserWindow 引导用户登录 → 提取 cookie
 *   2. verifyMoarkCookie 确认 cookie 有效
 *   3. fetchMoarkUserInfo 获取账户信息，其中 namespace_path 是后续接口的必要参数
 *   4. fetchMoarkAccessToken 用 cookie + 命名空间请求访问令牌接口，得到 apiKey
 *   5. 写入中央配置
 *
 * 注意：访问令牌与调用额度接口的 URL 里都含账户命名空间，必须用当前登录账户自己的
 * namespace_path，写死成某个账户的值会让其他账户拿到 401。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { BrowserWindow, session } from "electron";

import { logInfo } from "./_shared/logger";

const MOARK_LOGIN_URL = "https://moark.com/login";
const MOARK_ORIGIN = "https://moark.com";
const MOARK_VERIFY_URL = "https://moark.com/api/base/userinfo";

/**
 * 访问令牌与调用额度这两个接口的 URL 里都带账户命名空间，取值来自
 * /api/base/userinfo 响应里的 namespace_path，每个账户不同，不能写死。
 * 用别人的命名空间去请求会被服务端拒绝（401）。
 */
function buildTokensUrl(namespacePath: string): string {
  return `${MOARK_ORIGIN}/api/base/${encodeURIComponent(namespacePath)}/tokens?type=access`;
}

function buildQuotaUrl(namespacePath: string): string {
  return `${MOARK_ORIGIN}/api/base/hub/${encodeURIComponent(namespacePath)}/serverless/call-quota`;
}

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ===== 中央配置读写 =====

export interface MoarkAccountInfo {
  name: string;
  username: string;
  /** 账户命名空间路径，访问令牌与额度接口的 URL 里需要它 */
  namespacePath: string;
}

export interface MoarkAccountStore {
  apiKey: string;
  cookies: string;
  account: MoarkAccountInfo | null;
}

/** 语音合成/音色上传使用的运行时配置 */
export interface MoarkRuntimeConfig {
  apiKey: string;
  cookies: string;
}

export function getDefaultMoarkAccount(): MoarkAccountStore {
  return { apiKey: "", cookies: "", account: null };
}

function normalize(store: Partial<MoarkAccountStore>): MoarkAccountStore {
  const account =
    store.account &&
    typeof store.account === "object" &&
    typeof store.account.name === "string" &&
    typeof store.account.username === "string"
      ? {
          name: store.account.name,
          username: store.account.username,
          // 旧版本配置文件里没有这个字段，退回 username（多数账户两者相同）；
          // 若实际不同，下一次读取状态或重新授权时会被真实值覆盖。
          namespacePath:
            typeof store.account.namespacePath === "string" &&
            store.account.namespacePath.trim()
              ? store.account.namespacePath
              : store.account.username,
        }
      : null;
  return {
    apiKey: typeof store.apiKey === "string" ? store.apiKey : "",
    cookies: typeof store.cookies === "string" ? store.cookies : "",
    account,
  };
}

export async function readMoarkAccount(
  storePath: string,
): Promise<MoarkAccountStore> {
  try {
    return normalize(
      JSON.parse(
        await readFile(storePath, "utf-8"),
      ) as Partial<MoarkAccountStore>,
    );
  } catch {
    return getDefaultMoarkAccount();
  }
}

export async function writeMoarkAccount(
  storePath: string,
  store: MoarkAccountStore,
): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true });
  await writeFile(
    storePath,
    JSON.stringify(normalize(store), null, 2),
    "utf-8",
  );
}

export function toRuntimeConfig(store: MoarkAccountStore): MoarkRuntimeConfig {
  return { apiKey: store.apiKey, cookies: store.cookies };
}

// ===== Cookie 验证 / 账户信息 / 访问令牌 =====

/**
 * 验证 cookie 是否有效（GET /api/base/userinfo）。
 * 返回账户信息（有效）或 null（无效）。
 */
export async function fetchMoarkUserInfo(
  cookies: string,
): Promise<MoarkAccountInfo | null> {
  if (!cookies.trim()) return null;

  try {
    const response = await fetch(MOARK_VERIFY_URL, {
      method: "GET",
      headers: { Cookie: cookies, "User-Agent": DESKTOP_UA },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as {
      id?: number;
      username?: string;
      name?: string;
      namespace_path?: string;
      error?: number;
    };
    if (data.error || !data.id || !data.username) return null;
    return {
      name: data.name ?? data.username,
      username: data.username,
      namespacePath: data.namespace_path?.trim() || data.username,
    };
  } catch {
    return null;
  }
}

export async function verifyMoarkCookie(cookies: string): Promise<boolean> {
  return (await fetchMoarkUserInfo(cookies)) !== null;
}

interface MoarkTokenItem {
  token?: string;
  type?: string;
  status?: number;
}

/**
 * 用 cookie 请求访问令牌接口，返回 access 类型令牌作为 apiKey。
 * 优先取 type==="access" 且 status===1 的第一项，否则取第一项。
 *
 * namespacePath 必须是当前登录账户自己的命名空间（userinfo 的 namespace_path），
 * 传错会得到 401。
 */
export async function fetchMoarkAccessToken(
  cookies: string,
  namespacePath: string,
): Promise<string> {
  if (!namespacePath.trim()) {
    throw new Error("获取访问令牌失败：未能识别账户命名空间，请重新授权登录");
  }

  const response = await fetch(buildTokensUrl(namespacePath), {
    method: "GET",
    headers: { Cookie: cookies, "User-Agent": DESKTOP_UA },
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    logInfo(
      "moark-token",
      `获取访问令牌失败: HTTP ${response.status} namespace=${namespacePath} ${detail}`,
    );
    throw new Error(`获取访问令牌失败（${response.status}）`);
  }

  const data = (await response.json()) as
    | MoarkTokenItem[]
    | { error?: unknown };

  if (!Array.isArray(data)) {
    throw new Error("获取访问令牌失败：登录可能已过期");
  }

  const preferred = data.find(
    (item) => item.type === "access" && item.status === 1 && item.token,
  );
  const token = (preferred ?? data[0])?.token;

  if (!token) {
    throw new Error("未获取到访问令牌，请确认账户已开通模力方舟免费体验");
  }

  return token;
}

// ===== 每日免费调用额度 =====

export interface MoarkCallQuota {
  /** 今日剩余免费调用次数 */
  remaining: number;
  /** 每日免费调用总次数 */
  total: number;
}

/**
 * 查询今日免费调用额度（GET /api/base/hub/<namespace>/serverless/call-quota）
 *
 * 响应示例：{ "remaining_free_quota": 32, "free_quota": 100 }
 * 该接口只认登录 cookie（不接受 Bearer 令牌），所以仅在 cookie 有效时能取到额度。
 * URL 里的命名空间同样来自 userinfo 的 namespace_path。
 * 失败返回 null，并记录原因便于排查。
 */
export async function fetchMoarkCallQuota(
  cookies: string,
  namespacePath: string,
): Promise<MoarkCallQuota | null> {
  if (!cookies.trim() || !namespacePath.trim()) return null;

  try {
    const response = await fetch(buildQuotaUrl(namespacePath), {
      method: "GET",
      headers: {
        Cookie: cookies,
        "User-Agent": DESKTOP_UA,
        Accept: "application/json, text/plain, */*",
        Referer: `${MOARK_ORIGIN}/`,
      },
    });

    const bodyText = await response.text();

    if (!response.ok) {
      logInfo(
        "moark-quota",
        `请求失败: HTTP ${response.status} ${bodyText.slice(0, 300)}`,
      );
      return null;
    }

    const data = JSON.parse(bodyText) as {
      remaining_free_quota?: number;
      free_quota?: number;
    };

    if (
      typeof data.remaining_free_quota !== "number" ||
      typeof data.free_quota !== "number"
    ) {
      logInfo("moark-quota", `响应字段异常: ${bodyText.slice(0, 300)}`);
      return null;
    }

    return { remaining: data.remaining_free_quota, total: data.free_quota };
  } catch (error) {
    logInfo(
      "moark-quota",
      `请求异常: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

// ===== 登录窗口 =====

/** 登录窗口单例引用，防止重复打开 */
let loginWindow: BrowserWindow | null = null;

export interface MoarkLoginResult {
  success: boolean;
  cookies: string;
}

async function extractMoarkCookies(ses: Electron.Session): Promise<string> {
  const cookies = await ses.cookies.get({ url: MOARK_ORIGIN });
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * 打开 BrowserWindow 引导用户登录模力方舟。
 * 登录成功 resolve({ success: true, cookies })，否则 { success: false, cookies: "" }。
 */
export function openMoarkLoginWindow(): Promise<MoarkLoginResult> {
  if (loginWindow && !loginWindow.isDestroyed()) {
    loginWindow.focus();
    return Promise.resolve({ success: false, cookies: "" });
  }

  return new Promise((resolve) => {
    const ses = session.fromPartition("persist:moark-login");

    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      title: "模力方舟 - 登录",
      autoHideMenuBar: true,
      webPreferences: {
        session: ses,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    loginWindow = win;
    let resolved = false;

    function finish(result: MoarkLoginResult): void {
      if (resolved) return;
      resolved = true;
      loginWindow = null;
      if (!win.isDestroyed()) {
        win.close();
      }
      resolve(result);
    }

    async function checkLogin(url: string): Promise<void> {
      if (
        url.startsWith(MOARK_ORIGIN) &&
        !url.includes("/login") &&
        !url.includes("/register")
      ) {
        const cookies = await extractMoarkCookies(ses);
        if (cookies) {
          const valid = await verifyMoarkCookie(cookies);
          if (valid) {
            finish({ success: true, cookies });
          }
        }
      }
    }

    win.webContents.on("did-navigate", (_event, url) => {
      void checkLogin(url);
    });
    win.webContents.on("did-navigate-in-page", (_event, url) => {
      void checkLogin(url);
    });
    win.on("closed", () => {
      finish({ success: false, cookies: "" });
    });

    void win.loadURL(MOARK_LOGIN_URL);
  });
}

/** 清除登录窗口使用的持久化 session（登出用） */
export async function clearMoarkLoginSession(): Promise<void> {
  try {
    const ses = session.fromPartition("persist:moark-login");
    await ses.clearStorageData();
  } catch {
    // 忽略清理失败
  }
}
