import {
  loadNarrativeLengthFromStorage,
  type NarrativeLengthPreference,
} from '../settings/DisplaySettings';

interface NarrativeLengthSpec {
  label: string;
  rangeText: string;
  guidance: string;
}

const NARRATIVE_LENGTH_SPECS: Record<NarrativeLengthPreference, NarrativeLengthSpec> = {
  compact: {
    label: '精简',
    rangeText: '300-600 字',
    guidance: '只保留关键场面、行动反馈和必要对白，不展开支线细节。',
  },
  standard: {
    label: '标准',
    rangeText: '600-1000 字',
    guidance: '写清关键互动、行动反馈、人物取舍和局面变化，避免只做摘要。',
  },
  rich: {
    label: '丰富',
    rangeText: '1000-1600 字',
    guidance: '增加有效阻力、动作细节、对话往复、心理变化和关系余波；环境只有实际参与因果时才展开。',
  },
  long: {
    label: '长篇',
    rangeText: '1600-2400 字',
    guidance: '以完整因果链推进为目标，充分展开动作、对话、人物取舍、局势代价和后续钩子；环境只有实际参与因果时才展开。除非玩家行动极短且确实无事发生，不要压缩成 600-800 字短段。',
  },
};

export function buildNarrativeLengthGuidance(): string {
  const preference = loadNarrativeLengthFromStorage();
  const spec = NARRATIVE_LENGTH_SPECS[preference] ?? NARRATIVE_LENGTH_SPECS.standard;

  return [
    '## 正文篇幅要求',
    `当前设置：${spec.label}（目标 narrativeText 正文约 ${spec.rangeText}）。`,
    spec.guidance,
    '这里的字数只指 narrativeText 正文；不要把建议行动、状态写回、公开思路摘要计入正文篇幅。',
    '不要为了凑字机械复述背景、重复资料库或堆砌空泛总结；应把篇幅用在可见事实、人物互动、行动过程、判定前后反馈和关系/局势后果上。',
  ].join('\n');
}
