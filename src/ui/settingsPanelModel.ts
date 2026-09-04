import type { ApiTaskId } from '../engine/settings/ApiConfigManager';
import { getNarrativeLengthContract } from '../engine/prompts/NarrativeLengthGuidance';
import {
  DEFAULT_NARRATIVE_LENGTH,
  DEFAULT_PREGNANCY_MODE,
  NARRATIVE_LENGTH_OPTIONS,
  PREGNANCY_MODE_OPTIONS,
  type NarrativeLengthPreference,
  type PregnancyModePreference,
} from '../engine/settings/DisplaySettings';

export type SettingsMainTab = 'game' | 'display' | 'avg' | 'api' | 'tavern' | 'promptRegistry' | 'promptTokenEstimate' | 'save' | 'variables' | 'data';
export type SettingsFunctionTab = 'memory' | 'vector' | 'npcProfile' | 'npcSimulation' | 'worldEvolution' | 'stateWriteback';
export type SettingsTab = SettingsMainTab | SettingsFunctionTab;

export interface SettingsNavItem {
  tab?: SettingsTab;
  label: string;
  disabled: boolean;
  group: 'common' | 'ai' | 'tools';
}

export interface FunctionConfigPanel {
  tab: SettingsFunctionTab;
  label: string;
  description: string;
  routeTaskIds: ApiTaskId[];
  status: 'active' | 'planned';
}

export interface InlineApiEditorState {
  inlineApiEditorFor: null;
  notice: string;
}

export interface GameSettingsToggleControl {
  id: 'npcPresenceHints' | 'narrativeLengthRetry';
  type: 'toggle';
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export interface GameSettingsNarrativeLengthSelectControl {
  id: 'narrativeLength';
  type: 'select';
  label: string;
  description: string;
  defaultValue: NarrativeLengthPreference;
  options: Array<{
    value: NarrativeLengthPreference;
    label: string;
    wordCountHint: string;
    description: string;
  }>;
}

export interface GameSettingsPregnancyModeSelectControl {
  id: 'pregnancyMode';
  type: 'select';
  label: string;
  description: string;
  defaultValue: PregnancyModePreference;
  options: Array<{
    value: PregnancyModePreference;
    label: string;
    description: string;
  }>;
}

export type GameSettingsSelectControl =
  | GameSettingsNarrativeLengthSelectControl
  | GameSettingsPregnancyModeSelectControl;

export type GameSettingsControl = GameSettingsToggleControl | GameSettingsSelectControl;

export const FUNCTION_CONFIG_PANELS: FunctionConfigPanel[] = [
  {
    tab: 'memory',
    label: '记忆配置',
    description: '管理正文剧情、主角经历、NPC、地点与分层摘要的记忆压缩、摘要 API 和投喂预算。',
    routeTaskIds: ['memorySummary'],
    status: 'active',
  },
  {
    tab: 'vector',
    label: '向量检索配置',
    description: '管理记忆向量嵌入 API、语义检索与本地回退策略。',
    routeTaskIds: ['embedding'],
    status: 'active',
  },
  {
    tab: 'npcProfile',
    label: 'NPC建档配置',
    description: '管理开局历史人物补全与 NPC 基础档案生成的主要、备用 API；主要 API 失败 60 秒后自动切换备用 API。',
    routeTaskIds: ['npcCompletion', 'npcCompletionFallback'],
    status: 'active',
  },
  {
    tab: 'npcSimulation',
    label: 'NPC动态模拟配置',
    description: '管理本回合相关 NPC 的心态预处理、反应建议和辅助模型路由；未选择 API 时不额外调用。',
    routeTaskIds: ['npcSimulation'],
    status: 'active',
  },
  {
    tab: 'worldEvolution',
    label: '后台世界演化配置',
    description: '管理离场羁绊与红颜人物的到期行动、历史轨迹推进和近况投递；它独立于当前回合 NPC 反应模拟。未单独选择 API 时跟随主剧情 API。',
    routeTaskIds: ['worldEvolution'],
    status: 'active',
  },
  {
    tab: 'stateWriteback',
    label: '状态写回配置',
    description: '管理主回合后的状态补丁与写回结构整理 API；未选择 API 时不额外调用。',
    routeTaskIds: ['stateWriteback', 'stateWritebackFallback'],
    status: 'active',
  },
];

const hiddenRouteTaskIds: ApiTaskId[] = ['quickInteraction', 'imagePrompt'];

export function getSettingsNavItems(): SettingsNavItem[] {
  return [
    { tab: 'game', label: '游戏设定', disabled: false, group: 'common' },
    { tab: 'display', label: '阅读与动效', disabled: false, group: 'common' },
    { tab: 'save', label: '存档管理', disabled: false, group: 'common' },
    { tab: 'variables', label: '变量管理', disabled: false, group: 'common' },
    { tab: 'data', label: '数据管理', disabled: false, group: 'common' },
    { tab: 'api', label: 'API 配置', disabled: false, group: 'ai' },
    { label: '功能配置', disabled: false, group: 'ai' },
    { tab: 'tavern', label: '酒馆预设与 CoT', disabled: false, group: 'ai' },
    { tab: 'promptRegistry', label: '提示词管理', disabled: false, group: 'tools' },
    { tab: 'promptTokenEstimate', label: 'Token 估算', disabled: false, group: 'tools' },
  ];
}

export function getApiConfigRouteTaskIds(): ApiTaskId[] {
  return ['mainNarrative'];
}

export function getFunctionConfigPanel(tab: SettingsTab): FunctionConfigPanel | undefined {
  return FUNCTION_CONFIG_PANELS.find((panel) => panel.tab === tab);
}

export function isFunctionConfigTab(tab: SettingsTab): tab is SettingsFunctionTab {
  return FUNCTION_CONFIG_PANELS.some((panel) => panel.tab === tab);
}

export function getHiddenRouteTaskIds(): ApiTaskId[] {
  return hiddenRouteTaskIds;
}

export function getInlineApiSaveState(): InlineApiEditorState {
  return {
    inlineApiEditorFor: null,
    notice: 'API 已保存在 API 配置中统一管理。',
  };
}

export function getInlineApiCancelState(): InlineApiEditorState {
  return {
    inlineApiEditorFor: null,
    notice: '',
  };
}

export function getGameSettingsControls(): GameSettingsControl[] {
  return [
    {
      id: 'narrativeLength',
      type: 'select',
      label: '正文篇幅',
      description: '选择主剧情正文的目标字数范围；实际长度会随剧情复杂度和模型输出略有浮动。',
      defaultValue: DEFAULT_NARRATIVE_LENGTH,
      options: NARRATIVE_LENGTH_OPTIONS.map((value) => {
        const contract = getNarrativeLengthContract(value);
        return {
          value,
          label: contract.label,
          wordCountHint: `约 ${contract.rangeText}`,
          description: `约 ${contract.rangeText}，${contract.settingsDescription}`,
        };
      }),
    },
    {
      id: 'pregnancyMode',
      type: 'select',
      label: '怀孕与子嗣承接',
      description: '控制成年女性 NPC 产生新怀孕判定的概率。结果在机会建立时写入存档，读档和重试不会重掷；关闭不会删除或冻结已经存在的孕期。',
      defaultValue: DEFAULT_PREGNANCY_MODE,
      options: PREGNANCY_MODE_OPTIONS.map((value) => {
        const labels: Record<PregnancyModePreference, string> = {
          off: '关闭',
          low: '低',
          standard: '标准',
          high: '高',
        };
        const descriptions: Record<PregnancyModePreference, string> = {
          off: '不再建立新的怀孕判定；既有孕期仍会随游戏时间正常推进。',
          low: '基础概率按标准档的 60% 计算，仍保留年龄差异和单周期上限。',
          standard: '默认概率：每30日最多一次判定，多次有效行为只小幅提高同一次机会。',
          high: '基础概率按标准档的 150% 计算，但单次机会仍不超过 30%。',
        };
        return { value, label: labels[value], description: descriptions[value] };
      }),
    },
    {
      id: 'narrativeLengthRetry',
      type: 'toggle',
      label: '字数不足时自动重写',
      description: '开启后，“丰富/长篇”正文低于目标下限的 90% 时会整份重写一次；关闭后仍保留目标字数要求和篇幅诊断，但不会因字数不足重写或拒绝本回合。',
      defaultEnabled: true,
    },
    {
      id: 'npcPresenceHints',
      type: 'toggle',
      label: '人物志近况提示',
      description: 'NPC 有新的远场近况时，在人物志列表显示红点并临时置顶；关闭后只隐藏提示，不删除近况记录。',
      defaultEnabled: true,
    },
  ];
}
