/**
 * 模力方舟文案创作（独立模块）
 *
 * 接口：POST https://api.moark.com/v1/chat/completions
 * 认证：Bearer API Key
 * 模型：Qwen3-32B（模型名在 main.ts 的文案创作分支里传入）
 */

export interface MoarkCopyCreationConfig {
  apiKey: string;
  modelName: string;
}

export interface MoarkCopyCreationPayload {
  rewriteRequirements: string;
  sourceCopy: string;
}

export interface MoarkCopyCreationResult {
  text: string;
}

interface MoarkChatResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    code?: string;
  };
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

export async function createCopyMoark(
  config: MoarkCopyCreationConfig,
  payload: MoarkCopyCreationPayload,
  signal: AbortSignal,
): Promise<MoarkCopyCreationResult> {
  if (!config.apiKey.trim()) {
    throw new Error("请先配置模力方舟文案创作的 API Key");
  }
  if (!config.modelName.trim()) {
    throw new Error("请先选择模型名称");
  }
  if (!payload.sourceCopy.trim()) {
    throw new Error("请先完成第一步提取文案");
  }

  const response = await fetch(MOARK_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.modelName,
      messages: [
        {
          role: "user",
          content: renderPrompt(payload),
        },
      ],
      stream: false,
      max_tokens: 1024,
      temperature: 0.7,
      top_p: 0.7,
      top_k: 50,
      frequency_penalty: 1,
    }),
    signal,
  });

  const data = (await response.json()) as MoarkChatResponse;

  if (!response.ok) {
    throw new Error(
      data.error?.message ?? data.error?.code ?? "模力方舟模型调用失败",
    );
  }

  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("模型返回内容为空");
  }

  return { text: cleanText(content) };
}
