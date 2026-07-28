import type { LlmMessage } from '../llm/LlmClient';
import {
  DEFAULT_CUSTOM_COT_TEMPLATE,
  loadTavernManagementSettings,
  resolveEffectiveTavernPreset,
  type CreativeNarrativeScope,
  type ResolvedTavernPreset,
  type TavernManagementSettings,
} from './TavernPresetStore';

export interface CreativePromptCompilation {
  messages: LlmMessage[];
  tavern: ResolvedTavernPreset;
  customCotIncluded: boolean;
}

const TAVERN_PRIORITY_PROTOCOL = [
  '## 已启用酒馆预设的优先级',
  '- 在不触碰本局事实、玩家明确行动、成人门禁、人物自主性、封存战果、目标篇幅、合法 JSON 和结构化写回合同的前提下，以下酒馆预设是本次正文的主要创作与语言风格。',
  '- 酒馆预设高于游戏内置的文风兜底和一般措辞建议；不要把它弱化成可有可无的参考。',
  '- 酒馆预设不能改变运行态事实、凭空授予权限或物品、替玩家接受或拒绝关键选择，也不能覆盖战斗/战争本地引擎已经封存的结果。',
].join('\n');

function scopeMatches(
  configured: TavernManagementSettings['customCot']['scope'],
  scope: CreativeNarrativeScope,
): boolean {
  return configured === 'all' || configured === scope;
}

export function compileCreativePromptMessages(options: {
  systemPrompt: string;
  runtimeUserMessage: string;
  scope: CreativeNarrativeScope;
  playerName?: string;
  settings?: TavernManagementSettings;
}): CreativePromptCompilation {
  const settings = options.settings ?? loadTavernManagementSettings();
  const tavern = resolveEffectiveTavernPreset(settings, {
    scope: options.scope,
    playerName: options.playerName,
  });
  const messages: LlmMessage[] = [{
    role: 'system',
    content: options.systemPrompt,
  }];

  const customCotContent = settings.customCot.templateId === 'custom'
    ? settings.customCot.content.trim()
    : DEFAULT_CUSTOM_COT_TEMPLATE;
  const customCotIncluded = Boolean(
    settings.customCot.enabled
    && scopeMatches(settings.customCot.scope, options.scope)
    && customCotContent,
  );
  if (customCotIncluded) {
    messages.push({
      role: 'system',
      content: [
        '## 玩家启用的自定义 CoT / 创作规划',
        customCotContent,
        '',
        '该规划只约束创作过程；不得输出内部思考，不得替代最终 JSON，也不得写入正文、记忆或状态。',
      ].join('\n'),
    });
  }

  const systemItems = tavern.items.filter(
    (item) => item.status === 'included' && item.role === 'system',
  );
  const hasIncludedTavernItem = tavern.items.some((item) => item.status === 'included');
  if (hasIncludedTavernItem) {
    messages.push({
      role: 'system',
      content: [
        TAVERN_PRIORITY_PROTOCOL,
        ...systemItems.map((item) => `### ${item.name}\n${item.content}`),
      ].filter(Boolean).join('\n\n'),
    });
  }

  for (const item of tavern.items) {
    if (item.status !== 'included' || item.role === 'system') continue;
    messages.push({
      role: item.role,
      content: item.content,
    });
  }

  messages.push({
    role: 'user',
    content: options.runtimeUserMessage,
  });

  return {
    messages,
    tavern,
    customCotIncluded,
  };
}
