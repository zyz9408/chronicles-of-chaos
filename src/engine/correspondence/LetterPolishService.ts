import {
  BrowserLlmClient,
  LlmEmptyContentError,
  type LlmClient,
  type LlmGenerateResult,
  type LlmMessage,
  type LlmTokenUsage,
} from '../llm/LlmClient';
import {
  resolveExplicitApiConfigForTaskAsync,
  type ApiConfigArchive,
  type ApiTaskId,
} from '../settings/ApiConfigManager';

const MAX_LETTER_INPUT_LENGTH = 4_000;
const LETTER_POLISH_MAX_OUTPUT_TOKENS = 1_200;
const LETTER_POLISH_TIMEOUT_MS = 60_000;

export interface LetterPolishInput {
  body: string;
  senderName: string;
  recipientName: string;
  currentDate?: string;
  eraSummary?: string;
  context?: LetterPolishContext;
}

export interface LetterPolishContext {
  worldSummary?: string;
  senderProfile?: string;
  recipientProfile?: string;
  relationshipSummary?: string;
}

export interface LetterPolishResult {
  body: string;
  provider: string;
  model: string;
  configName: string;
  routeLabel: string;
  retriedAfterEmptyContent: boolean;
  usage?: LlmTokenUsage;
}

export interface ResolvedLetterPolishConfig {
  config: ApiConfigArchive;
  taskId: 'letterPolish' | 'npcCompletion';
  routeLabel: string;
}

export interface LetterPolishServiceDependencies {
  resolveConfig?: () => Promise<ApiConfigArchive | null>;
  llmClient?: LlmClient;
}

/**
 * 玩家主动点击后的一次性轻量润色。优先使用独立 letterPolish 路由；未配置时
 * 复用低频的 NPC 建档主要 API。绝不回退到主剧情 API，也不自动重试或寄出书信。
 */
export async function polishLetterDraft(
  input: LetterPolishInput,
  dependencies: LetterPolishServiceDependencies = {},
): Promise<LetterPolishResult> {
  const body = input.body.trim();
  if (!body) throw new Error('请先填写书信正文。');
  if (body.length > MAX_LETTER_INPUT_LENGTH) {
    throw new Error(`书信正文过长，请控制在 ${MAX_LETTER_INPUT_LENGTH} 字以内。`);
  }

  const resolved = dependencies.resolveConfig
    ? await dependencies.resolveConfig().then((config) => config ? ({
      config,
      taskId: 'letterPolish' as const,
      routeLabel: '书信润色 API',
    }) : null)
    : await resolveLetterPolishConfig();
  if (!resolved) {
    throw new Error('尚未配置“书信润色”或“NPC建档主要 API”；请先在 API 设置中选择一个轻量模型。');
  }
  const { config } = resolved;

  const llmClient = dependencies.llmClient ?? new BrowserLlmClient();
  const request = {
    config,
    messages: buildLetterPolishMessages(input, body),
    temperature: 0.35,
    maxOutputTokens: Math.min(
      LETTER_POLISH_MAX_OUTPUT_TOKENS,
      config.maxOutputTokens ?? LETTER_POLISH_MAX_OUTPUT_TOKENS,
    ),
    responseFormat: 'text',
    timeoutMs: LETTER_POLISH_TIMEOUT_MS,
    retryCount: 0,
  } as const;
  let result: LlmGenerateResult;
  let retriedAfterEmptyContent = false;
  try {
    result = await llmClient.generate(request);
  } catch (error) {
    if (!(error instanceof LlmEmptyContentError)) throw error;
    retriedAfterEmptyContent = true;
    try {
      // 草稿和上下文完全冻结，且前一次没有正文、没有状态变更；只对这一种失败安全重试一次。
      result = await llmClient.generate(request);
    } catch (retryError) {
      if (retryError instanceof LlmEmptyContentError) {
        throw new Error('书信润色 API 连续两次未返回正文，原稿已保留。');
      }
      throw retryError;
    }
  }
  const polished = extractPolishedLetterBody(result.content);
  validatePolishedLetter(body, polished, input);
  return {
    body: polished,
    provider: result.provider,
    model: result.model,
    configName: config.name,
    routeLabel: resolved.routeLabel,
    retriedAfterEmptyContent,
    usage: result.usage,
  };
}

export async function getLetterPolishApiDisplay(): Promise<string> {
  const resolved = await resolveLetterPolishConfig();
  return resolved
    ? `${resolved.routeLabel}：${resolved.config.name} · ${resolved.config.model}`
    : '未配置书信润色或 NPC 建档主要 API';
}

export async function resolveLetterPolishConfig(
  resolver: (taskId: ApiTaskId) => Promise<ApiConfigArchive | null> = resolveExplicitApiConfigForTaskAsync,
): Promise<ResolvedLetterPolishConfig | null> {
  const dedicated = await resolver('letterPolish');
  if (dedicated) {
    return { config: dedicated, taskId: 'letterPolish', routeLabel: '书信润色 API' };
  }
  const npcCompletion = await resolver('npcCompletion');
  if (npcCompletion) {
    return { config: npcCompletion, taskId: 'npcCompletion', routeLabel: 'NPC建档主要 API' };
  }
  return null;
}

export function buildLetterPolishMessages(input: LetterPolishInput, body = input.body.trim()): LlmMessage[] {
  const protectedNumbers = extractProtectedNumberValues(body);
  const contextLines = buildCompactContextLines(input.context);
  return [
    {
      role: 'system',
      content: [
        '把原文润色成易读、自然的半文半白书信；不续写剧情，不得新增承诺。',
        '保留人物、地点、数量、日期、条件、请求和立场；数字形式可变，但数值不得省略或改动。',
        '轻量背景只用于选择合适的称谓与语气，不得把背景资料扩写成原文没有的事实、要求或承诺。',
        '只输出润色后的书信正文，不要标题、解释、引号、Markdown 或落款。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `收发：${input.senderName.trim() || '玩家'} → ${input.recipientName.trim() || '未署名'}`,
        input.currentDate?.trim() ? `当前时间：${input.currentDate.trim()}` : '',
        input.eraSummary?.trim() ? `时代环境：${input.eraSummary.trim()}` : '',
        contextLines.length > 0 ? ['轻量背景：', ...contextLines].join('\n') : '',
        protectedNumbers.length > 0
          ? `原文中的数量/日期数值（必须逐项出现在正文中）：${protectedNumbers.join('、')}`
          : '',
        '原文：',
        body,
      ].filter(Boolean).join('\n'),
    },
  ];
}

function buildCompactContextLines(context?: LetterPolishContext): string[] {
  if (!context) return [];
  return [
    compactContextField('世界', context.worldSummary, 360),
    compactContextField('写信人', context.senderProfile, 180),
    compactContextField('收信人', context.recipientProfile, 180),
    compactContextField('双方关系', context.relationshipSummary, 260),
  ].filter((line): line is string => Boolean(line));
}

function compactContextField(label: string, value: string | undefined, maxLength: number): string | null {
  const compact = value?.replace(/\s+/gu, ' ').trim();
  if (!compact) return null;
  const clipped = compact.length > maxLength ? `${compact.slice(0, maxLength - 1)}…` : compact;
  return `${label}：${clipped}`;
}

export function extractPolishedLetterBody(content: string): string {
  let value = content.trim();
  if (value.startsWith('```') && value.endsWith('```')) {
    value = value.replace(/^```(?:json|text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  const structured = tryExtractStructuredLetterBody(value);
  if (structured !== null) {
    value = structured.trim();
  }
  return value
    .replace(/^(?:以下是)?(?:润色(?:后的)?(?:书信)?(?:正文)?|书信正文|正文)\s*[:：]\s*/u, '')
    .trim();
}

function tryExtractStructuredLetterBody(value: string): string | null {
  if (!value.startsWith('{') && !value.startsWith('"')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed === 'string') return parsed;
  if (!isRecord(parsed)) return null;
  const direct = findLetterBodyField(parsed);
  if (direct !== null) return direct;
  for (const containerKey of ['result', 'data', 'output']) {
    const nested = parsed[containerKey];
    if (!isRecord(nested)) continue;
    const candidate = findLetterBodyField(nested);
    if (candidate !== null) return candidate;
  }
  return null;
}

function findLetterBodyField(value: Record<string, unknown>): string | null {
  for (const key of ['polishedText', 'polished_text', 'body', 'letterBody', 'letter_body', 'text', 'content', 'letter']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePolishedLetter(original: string, polished: string, input: LetterPolishInput): void {
  if (!polished) throw new Error('书信润色 API 返回了空内容，原稿已保留。');
  if (polished.length > MAX_LETTER_INPUT_LENGTH * 2) {
    throw new Error('书信润色结果异常过长，原稿已保留。');
  }
  const originalNumbers = extractProtectedNumberValues(original);
  const polishedNumberCounts = countValues(extractProtectedNumberValues(polished));
  const missingNumber = originalNumbers.some((value) => {
    const remaining = polishedNumberCounts.get(value) ?? 0;
    if (remaining <= 0) return true;
    polishedNumberCounts.set(value, remaining - 1);
    return false;
  });
  if (missingNumber) {
    throw new Error('润色结果遗漏了原文中的数量或日期，原稿已保留。');
  }
  for (const name of [input.senderName, input.recipientName]) {
    const normalized = name.trim();
    if (normalized && original.includes(normalized) && !polished.includes(normalized)) {
      throw new Error(`润色结果遗漏了“${normalized}”，原稿已保留。`);
    }
  }
}

function extractProtectedNumberValues(value: string): string[] {
  const pattern = /[0-9０-９]+(?:[,，][0-9０-９]{3})*(?:[.．][0-9０-９]+)?|[〇零一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟萬億廿卅]+/gu;
  const results: string[] = [];
  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (isSingleChineseDigitToken(token) && !hasNumericContext(value, index, token.length)) continue;
    const normalized = normalizeNumberToken(token);
    if (normalized !== null) results.push(normalized);
  }
  return results;
}

function isSingleChineseDigitToken(token: string): boolean {
  return token.length === 1 && /^[〇零一二两三四五六七八九十壹贰叁肆伍陆柒捌玖拾]$/u.test(token);
}

function hasNumericContext(value: string, index: number, length: number): boolean {
  const before = value.slice(0, index).trimEnd().slice(-1);
  const after = value.slice(index + length).trimStart().slice(0, 1);
  return before === '第' || /^[年月日时刻天旬贯钱石斤两匹人户亩里件支封车骑兵名成倍次回]$/u.test(after);
}

function normalizeNumberToken(token: string): string | null {
  if (/^[0-9０-９]/u.test(token)) {
    const normalized = token
      .replace(/[０-９]/gu, (char) => String(char.charCodeAt(0) - 0xFEE0))
      .replace(/[,，]/gu, '')
      .replace('．', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? String(parsed) : normalized;
  }
  return parseChineseNumber(token);
}

function parseChineseNumber(raw: string): string | null {
  const token = raw
    .replace(/壹/gu, '一').replace(/贰/gu, '二').replace(/叁/gu, '三')
    .replace(/肆/gu, '四').replace(/伍/gu, '五').replace(/陆/gu, '六')
    .replace(/柒/gu, '七').replace(/捌/gu, '八').replace(/玖/gu, '九')
    .replace(/拾/gu, '十').replace(/佰/gu, '百').replace(/仟/gu, '千')
    .replace(/萬/gu, '万').replace(/兩/gu, '两')
    .replace(/廿/gu, '二十').replace(/卅/gu, '三十');
  const digitValues: Record<string, number> = {
    〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (!/[十百千万亿]/u.test(token)) {
    const digits = [...token].map((char) => digitValues[char]);
    if (digits.some((digit) => digit === undefined)) return null;
    return String(Number(digits.join('')));
  }
  const smallUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1_000 };
  const largeUnits: Record<string, number> = { 万: 10_000, 亿: 100_000_000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of token) {
    if (digitValues[char] !== undefined) {
      number = digitValues[char];
      continue;
    }
    const smallUnit = smallUnits[char];
    if (smallUnit) {
      section += (number || 1) * smallUnit;
      number = 0;
      continue;
    }
    const largeUnit = largeUnits[char];
    if (largeUnit) {
      section += number;
      total += section * largeUnit;
      section = 0;
      number = 0;
      continue;
    }
    return null;
  }
  return String(total + section + number);
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
