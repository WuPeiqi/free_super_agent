/**
 * 模力方舟文案创作（独立模块）
 *
 * 接口：POST https://api.moark.com/v1/chat/completions（流式 SSE）
 * 认证：Bearer API Key
 * 模型：按顺序尝试，前一个失败再用下一个，全部失败才报错
 *   1. DeepSeek-R1-Distill-Qwen-14B
 *   2. Qwen3-32B
 *
 * 两个都是推理模型，会先输出 reasoning_content（思考过程）再输出 content（正文），
 * 这里只取 content 作为文案。
 */
import { logInfo } from "./_shared/logger";

export interface MoarkCopyCreationConfig {
  apiKey: string;
}

/** 单个模型的调用参数 */
interface MoarkChatModelOption {
  model: string;
  max_tokens: number;
  temperature: number;
  top_p: number;
  top_k: number;
  frequency_penalty: number;
}

/** 文案创作候选模型，按优先级排列 */
const COPY_MODELS: MoarkChatModelOption[] = [
  {
    model: "DeepSeek-R1-Distill-Qwen-14B",
    max_tokens: 2048,
    temperature: 0.6,
    top_p: 0.7,
    top_k: 50,
    frequency_penalty: 0,
  },
  {
    model: "Qwen3-32B",
    max_tokens: 1024,
    temperature: 0.7,
    top_p: 0.7,
    top_k: 50,
    frequency_penalty: 1,
  },
];

/** 流式响应连续多久没有新数据就判定该模型卡住，切换下一个 */
const STREAM_IDLE_TIMEOUT_MS = 60_000;
/** 单个模型的最长等待时间 */
const MODEL_TOTAL_TIMEOUT_MS = 180_000;

export interface MoarkCopyCreationPayload {
  rewriteRequirements: string;
  sourceCopy: string;
}

export interface MoarkCopyCreationResult {
  text: string;
}

/** 流式响应中每个 data 块的结构 */
interface MoarkChatStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
    code?: string;
  };
}

/** 非 2xx 响应体的结构 */
interface MoarkErrorResponse {
  error?: { message?: string; code?: string } | string;
  message?: string;
}

const MOARK_CHAT_URL = "https://api.moark.com/v1/chat/completions";

/** 公共 prompt 模板（与阿里云保持一致） */
const copyPromptTemplate = `你是一名短视频IP口播文案专家，请基于用户提供的原始文案进行二次创作。

【改写要求（最高优先级，必须严格执行）】
{{rewriteRequirements}}

以上【改写要求】是本次创作最重要的指令，成品必须明显体现这些要求；当它与下方通用要求发生冲突时，一律以【改写要求】为准（"无"表示没有额外要求）。

输出要求非常重要：
1. 只输出一段完整口播文案正文。
2. 不要输出标题、开场钩子、完整口播文案、结尾引导等结构名。
3. 不要使用 Markdown 标题、编号、小标题、项目符号、分隔线。
4. 不要解释创作思路，不要给配图建议，不要给话题标签。
5. 文案会直接进入语音合成，所以输出内容必须能被直接朗读。
6. 可以自然分段，但每一段都必须是口播正文的一部分。

创作目标：
1. 严格落实上方【改写要求】，让成品明显体现这些要求（这是第一优先级）。
2. 保留原始文案的核心观点和事实，不编造不存在的信息。
3. 开头要更有钩子，表达要自然、有节奏，避免空泛鸡汤。
4. 结尾可以自然引导互动，但不要出现"结尾引导"这类标签。

原始文案：
{{sourceCopy}}

请直接输出最终口播文案正文，并确保明显体现上方【改写要求】。`;

function renderPrompt(payload: MoarkCopyCreationPayload): string {
  return copyPromptTemplate
    .replaceAll(
      "{{rewriteRequirements}}",
      payload.rewriteRequirements.trim() || "无",
    )
    .replaceAll("{{sourceCopy}}", payload.sourceCopy.trim());
}

function cleanText(text: string): string {
  return text
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,6}\s*/, "")
        .replace(/^[-*]\s+/, "")
        .replace(/^\d+[.、]\s*/, "")
        .replace(
          /^【?(标题|开场钩子|完整口播文案|口播文案|可选结尾引导|结尾引导)】?[：:]\s*/,
          "",
        )
        .trim(),
    )
    .filter((line) => line && !/^[-=]{3,}$/.test(line))
    .join("\n")
    .trim();
}

/** 去掉正文里可能残留的 <think>…</think> 思考块 */
function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^[\s\S]*?<\/think>/, "")
    .trim();
}

/** 从非 2xx 响应里提取可读的错误信息 */
async function readErrorMessage(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  try {
    const data = JSON.parse(raw) as MoarkErrorResponse;
    const err = data.error;
    if (typeof err === "string") return err;
    return (
      err?.message ?? err?.code ?? data.message ?? `HTTP ${response.status}`
    );
  } catch {
    // 网关报错时返回的是 HTML 页面（如 502 Bad Gateway），只保留状态码
    if (!raw.trim() || raw.trimStart().startsWith("<")) {
      return `服务暂时不可用（HTTP ${response.status}）`;
    }
    return raw.slice(0, 200);
  }
}

/**
 * 用指定模型调用一次流式对话，返回拼接好的正文。
 * 超时（空闲或总时长）、HTTP 错误、正文为空都会抛错，交给上层切换下一个模型。
 */
async function requestCopyWithModel(
  apiKey: string,
  option: MoarkChatModelOption,
  prompt: string,
  userSignal: AbortSignal,
): Promise<string> {
  // 空闲计时器：每收到一块数据就重置
  const idleController = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => idleController.abort(new Error("模型响应超时")),
      STREAM_IDLE_TIMEOUT_MS,
    );
  };

  const signal = AbortSignal.any([
    userSignal,
    idleController.signal,
    AbortSignal.timeout(MODEL_TOTAL_TIMEOUT_MS),
  ]);

  resetIdle();
  try {
    const response = await fetch(MOARK_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        ...option,
        messages: [{ role: "user", content: prompt }],
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    if (!response.body) {
      throw new Error("模型没有返回数据");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let finishReason = "";

    // 逐行解析 SSE：每行形如 "data: {...}"，结束标记是 "data: [DONE]"
    const handleLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return false;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return true;
      let chunk: MoarkChatStreamChunk;
      try {
        chunk = JSON.parse(data) as MoarkChatStreamChunk;
      } catch {
        return false;
      }
      if (chunk.error) {
        throw new Error(
          chunk.error.message ?? chunk.error.code ?? "模型返回错误",
        );
      }
      const choice = chunk.choices?.[0];
      content += choice?.delta?.content ?? "";
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      return false;
    };

    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      resetIdle();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (handleLine(line)) {
          done = true;
          break;
        }
      }
    }
    if (!done && buffer) handleLine(buffer);
    await reader.cancel().catch(() => undefined);

    const text = cleanText(stripThinking(content));
    if (!text) {
      // finish_reason=length 说明思考过程把 max_tokens 用完了，正文没来得及输出
      throw new Error(
        finishReason === "length"
          ? "模型输出被截断，没有生成正文"
          : "模型返回内容为空",
      );
    }
    return text;
  } catch (error) {
    // 区分超时与其他错误，便于日志排查
    if (signal.aborted && !userSignal.aborted) {
      const reason = signal.reason;
      throw new Error(
        reason instanceof Error && reason.name !== "TimeoutError"
          ? reason.message
          : "模型响应超时",
      );
    }
    throw error;
  } finally {
    clearTimeout(idleTimer);
  }
}

export async function createCopyMoark(
  config: MoarkCopyCreationConfig,
  payload: MoarkCopyCreationPayload,
  signal: AbortSignal,
): Promise<MoarkCopyCreationResult> {
  if (!config.apiKey.trim()) {
    throw new Error("请先配置模力方舟文案创作的 API Key");
  }
  if (!payload.sourceCopy.trim()) {
    throw new Error("请先完成第一步提取文案");
  }

  const prompt = renderPrompt(payload);
  const failures: string[] = [];

  // 按优先级依次尝试，成功即返回
  for (const option of COPY_MODELS) {
    try {
      const text = await requestCopyWithModel(
        config.apiKey,
        option,
        prompt,
        signal,
      );
      if (failures.length) {
        logInfo("copy-creation", `已切换到备用模型 ${option.model} 并生成成功`);
      }
      return { text };
    } catch (error) {
      // 用户主动取消时直接终止，不再尝试下一个模型
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      logInfo("copy-creation", `模型 ${option.model} 调用失败：${message}`);
      failures.push(`${option.model}：${message}`);
    }
  }

  throw new Error(`文案改写失败，所有模型均无法调用。${failures.join("；")}`);
}
