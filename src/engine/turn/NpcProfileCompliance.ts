import type { RuntimeState } from '../types';
import type { NarratorResponse, NarratorWritebackProtocol } from './MockNarrator';

export interface MissingNpcProfileCandidate {
  name: string;
  mentionCount: number;
  reasons: string[];
  evidence: string[];
}

interface CandidateDraft {
  name: string;
  reasons: Set<string>;
  evidence: string[];
  contextHits: number;
  strong: boolean;
}

interface TextEntry {
  label: string;
  text: string;
}

const compoundSurnames = [
  '司马',
  '诸葛',
  '夏侯',
  '公孙',
  '皇甫',
  '上官',
  '欧阳',
  '东方',
  '尉迟',
  '长孙',
  '慕容',
  '司徒',
  '司空',
  '令狐',
  '端木',
  '轩辕',
  '闻人',
  '西门',
  '南宫',
];

const singleSurnames = new Set(
  Array.from(
    '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章云苏潘葛范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴谈宋庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路危江童颜郭梅盛林刁钟徐邱骆高夏蔡田胡凌霍虞万支柯管卢莫房裘干解应宗丁宣邓郁单杭洪包左石崔吉龚程邢裴陆荣翁荀羊惠甄曲家封芮靳汲糜松段巫焦巴牧全班秋仲伊宫宁仇栾甘祖武符刘詹束龙叶幸韶黎白蒲鄂索籍赖卓蔺蒙乔胥闻党翟谭姬申冉雍桑桂牛边尚温庄晏柴瞿阎连习艾鱼向古易廖庾步都耿满弘匡国文寇广东沃利越师巩聂晁辛阚简饶曾丰巢关蒯相查游竺权盖桓公晋楚闫法钦岳',
  ),
);

const roleWords = [
  '大将军',
  '骠骑将军',
  '车骑将军',
  '卫将军',
  '前将军',
  '后将军',
  '左将军',
  '右将军',
  '将军',
  '敌将',
  '都督',
  '太守',
  '刺史',
  '郡守',
  '县令',
  '尚书',
  '侍中',
  '中常侍',
  '校尉',
  '司马',
  '军师',
  '长史',
  '别驾',
  '主簿',
  '从事',
  '使者',
  '管事',
  '先生',
  '丞相',
  '相国',
  '皇帝',
  '陛下',
  '主公',
  '大王',
  '军侯',
];

const actionMarkers = [
  '遣',
  '派',
  '召',
  '率',
  '领',
  '命',
  '令',
  '请',
  '报',
  '告',
  '奏',
  '劝',
  '问',
  '答',
  '说',
  '道',
  '曰',
  '称',
  '笑',
  '叹',
  '议',
  '许',
  '拒',
  '接',
  '迎',
  '阻',
  '查',
  '审',
  '押',
  '护',
  '献',
  '进',
  '拜',
  '传',
  '托',
  '示',
  '攻',
  '守',
  '退',
  '败',
  '降',
];

const exactNonPersonTerms = new Set([
  '主角',
  '玩家',
  '旁白',
  '叙述',
  '太平道',
  '黄巾',
  '汉廷',
  '汉室',
  '大汉',
  '蜀汉',
  '曹魏',
  '东吴',
  '朝廷',
  '郡府',
  '官府',
  '军府',
  '豪族',
  '士族',
  '宗族',
  '部曲',
  '亲兵',
  '郡兵',
  '士卒',
  '百姓',
  '流民',
  '军营',
  '大营',
  '营门',
  '城门',
  '洛阳',
  '颍川',
  '阳翟',
  '成都',
  '汉中',
  '南中',
  '益州',
  '荆州',
  '凉州',
  '扬州',
  '幽州',
  '冀州',
  '关中',
  '江东',
  '河北',
  '天下',
  '风声',
  '纪事',
  '事项',
]);

const invalidNameFragments = [
  '太平',
  '黄巾',
  '朝廷',
  '官府',
  '郡府',
  '军府',
  '豪族',
  '士族',
  '宗族',
  '部曲',
  '亲兵',
  '百姓',
  '流民',
  '郡兵',
  '军营',
  '大营',
  '营门',
  '城门',
  '书信',
  '风声',
  '纪事',
  '事项',
  '粮草',
  '军粮',
  '又',
  '已',
  '便',
  '乃',
  '遂',
  '再',
];

const invalidNameSuffixes = [
  '将军',
  '敌将',
  '使者',
  '管事',
  '军士',
  '士卒',
  '老卒',
  '门吏',
  '门候',
  '斥候',
  '亲兵',
  '郡兵',
  '县吏',
  '书吏',
  '官吏',
  '百姓',
  '流民',
  '豪族',
  '士族',
  '宗族',
  '官府',
  '朝廷',
  '军府',
  '大营',
  '营门',
  '城门',
];

const nonNpcStructuredLabels = new Set([
  '旁白',
  '动作',
  '叙述',
  '场景',
  '镜头',
  '系统',
  '提示',
]);

export function detectMissingNpcProfileCandidates(input: {
  runtimeState: RuntimeState;
  acceptedRuntimeState?: RuntimeState;
  response: NarratorResponse;
  limit?: number;
}): MissingNpcProfileCandidate[] {
  const knownNames = buildKnownNpcNameSet(input.runtimeState, input.acceptedRuntimeState);
  const textEntries = collectTextEntries(input.response);
  const allText = textEntries.map((entry) => entry.text).join('\n');
  const drafts = new Map<string, CandidateDraft>();

  const addCandidate = (rawName: string, reason: string, evidence: string, strong = false) => {
    const name = normalizeCandidateName(rawName);
    if (!name || !isPlausiblePersonName(name) || knownNames.has(name)) return;
    const existing = drafts.get(name) ?? {
      name,
      reasons: new Set<string>(),
      evidence: [],
      contextHits: 0,
      strong: false,
    };
    existing.reasons.add(reason);
    existing.contextHits += 1;
    existing.strong ||= strong;
    if (evidence && !existing.evidence.includes(evidence) && existing.evidence.length < 4) {
      existing.evidence.push(evidence);
    }
    drafts.set(name, existing);
  };

  for (const suggestion of input.response.writeback?.npcMemorySuggestions ?? []) {
    if (suggestion.npcName) {
      addCandidate(suggestion.npcName, 'NPC记忆姓名', suggestion.content, true);
    }
  }

  for (const entry of textEntries) {
    extractSpeakerLabels(entry.text).forEach((name) => addCandidate(name, '发言标签', entry.text, true));
    extractNamesBeforeRoles(entry.text).forEach((name) => addCandidate(name, '称谓上下文', entry.text, true));
    extractNamesAfterRoles(entry.text).forEach((name) => addCandidate(name, '称谓上下文', entry.text, true));
    extractNamesBeforeActionMarkers(entry.text).forEach((name) => addCandidate(name, '行动上下文', entry.text, false));
  }

  return Array.from(drafts.values())
    .map((draft) => {
      const mentionCount = Math.max(countNameOccurrences(allText, draft.name), draft.contextHits);
      return {
        name: draft.name,
        mentionCount,
        reasons: Array.from(draft.reasons),
        evidence: draft.evidence.map((text) => clipEvidence(text, draft.name)),
      };
    })
    .filter((candidate) => {
      const strongReason = candidate.reasons.some((reason) => reason === '发言标签' || reason === '称谓上下文' || reason === 'NPC记忆姓名');
      return strongReason || candidate.mentionCount >= 2;
    })
    .sort((a, b) => b.mentionCount - a.mentionCount || b.reasons.length - a.reasons.length || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, input.limit ?? 8);
}

function buildKnownNpcNameSet(runtimeState: RuntimeState, acceptedRuntimeState?: RuntimeState): Set<string> {
  const names = new Set<string>([runtimeState.player.name]);
  addKnownNpcNames(names, runtimeState);
  for (const actor of runtimeState.knownActors ?? []) {
    addNameVariants(names, actor.name);
  }
  if (acceptedRuntimeState) addKnownNpcNames(names, acceptedRuntimeState);
  return names;
}

function addKnownNpcNames(names: Set<string>, state: RuntimeState): void {
  for (const npc of state.npcs ?? []) {
    addNameVariants(names, npc.name);
    addNameVariants(names, npc.courtesyName);
    addNameVariants(names, npc.artName);
    addNameVariants(names, npc.commonAddress);
    for (const alias of npc.aliases ?? []) addNameVariants(names, alias);
  }
}

function addNameVariants(names: Set<string>, value: string | null | undefined): void {
  const normalized = normalizeCandidateName(value ?? '');
  if (normalized) names.add(normalized);
}

function collectTextEntries(response: NarratorResponse): TextEntry[] {
  const entries: TextEntry[] = [];
  pushText(entries, '正文', response.narrativeText);
  for (const action of response.suggestedActions ?? []) {
    pushText(entries, '建议行动', action.label);
    pushText(entries, '建议行动说明', action.description);
  }
  const writeback = response.writeback;
  if (!writeback) return entries;

  pushTurnSummary(entries, writeback);
  pushProtagonistMemory(entries, writeback);
  for (const memory of writeback.npcMemorySuggestions ?? []) {
    pushText(entries, 'NPC记忆姓名', memory.npcName);
    pushText(entries, 'NPC记忆', memory.content);
  }
  for (const quest of writeback.questChanges ?? []) {
    pushText(entries, '任务标题', quest.title);
    pushText(entries, '任务摘要', quest.summary);
    pushText(entries, '任务步骤', quest.currentStep);
    pushText(entries, '任务风险', quest.stakes);
    pushText(entries, '任务结果', quest.outcomeSummary);
    for (const hook of quest.followUpHooks ?? []) pushText(entries, '任务后续', hook);
  }
  for (const signal of writeback.signalChanges ?? []) {
    pushText(entries, '风声标题', signal.title);
    pushText(entries, '风声内容', signal.content);
    pushText(entries, '风声潜在后果', signal.potentialOutcomeSummary);
    for (const hook of signal.followUpHooks ?? []) pushText(entries, '风声后续', hook);
  }
  for (const plan of writeback.plotPlanSuggestions ?? []) {
    pushText(entries, '规划标题', plan.title);
    pushText(entries, '规划摘要', plan.summary);
  }
  for (const event of writeback.worldEventUpdates ?? []) {
    pushText(entries, '纪事标题', event.title);
    pushText(entries, '纪事摘要', event.summary);
    pushText(entries, '纪事结果', event.outcomeSummary);
    for (const hook of event.followUpHooks ?? []) pushText(entries, '纪事后续', hook);
  }
  const worldEvent = writeback.worldEventSummary;
  if (worldEvent) {
    pushText(entries, '纪事标题', worldEvent.title);
    pushText(entries, '纪事摘要', worldEvent.summary);
    pushText(entries, '纪事结果', worldEvent.outcomeSummary);
    for (const hook of worldEvent.followUpHooks ?? []) pushText(entries, '纪事后续', hook);
  }
  return entries;
}

function pushTurnSummary(entries: TextEntry[], writeback: NarratorWritebackProtocol): void {
  pushText(entries, '回合摘要', writeback.turnSummary?.brief);
  pushText(entries, '玩家行动摘要', writeback.turnSummary?.playerActionSummary);
  pushText(entries, '可见后果', writeback.turnSummary?.visibleConsequence);
}

function pushProtagonistMemory(entries: TextEntry[], writeback: NarratorWritebackProtocol): void {
  pushText(entries, '主角近期记忆', writeback.protagonistMemory?.recentTurnSummary);
  pushText(entries, '主角关键事迹', writeback.protagonistMemory?.keyDeed?.summary);
  pushText(entries, '主角关键事迹影响', writeback.protagonistMemory?.keyDeed?.impact);
}

function pushText(entries: TextEntry[], label: string, value: string | null | undefined): void {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return;
  entries.push({ label, text });
}

function extractSpeakerLabels(text: string): string[] {
  const names: string[] = [];
  const pattern = /(?:^|[\n。！？!?；;])[\t ]*(?:【([\u4e00-\u9fff]{2,8})】|([\u4e00-\u9fff]{2,4})[：:])/g;
  for (const paragraph of text.split(/\r?\n[\t ]*\r?\n/)) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(paragraph)) !== null) {
      const structuredName = match[1];
      const name = structuredName ?? match[2];
      if (!name || isInsideQuotedText(paragraph, match.index)) continue;
      if (structuredName && nonNpcStructuredLabels.has(structuredName)) continue;
      names.push(name);
    }
  }
  return names;
}

function isInsideQuotedText(text: string, endIndex: number): boolean {
  let chineseDoubleDepth = 0;
  let chineseSingleDepth = 0;
  let cornerDepth = 0;
  let doubleCornerDepth = 0;
  let asciiDoubleOpen = false;

  for (let index = 0; index < endIndex; index += 1) {
    const char = text[index];
    if (char === '“') chineseDoubleDepth += 1;
    else if (char === '”') chineseDoubleDepth = Math.max(0, chineseDoubleDepth - 1);
    else if (char === '‘') chineseSingleDepth += 1;
    else if (char === '’') chineseSingleDepth = Math.max(0, chineseSingleDepth - 1);
    else if (char === '「') cornerDepth += 1;
    else if (char === '」') cornerDepth = Math.max(0, cornerDepth - 1);
    else if (char === '『') doubleCornerDepth += 1;
    else if (char === '』') doubleCornerDepth = Math.max(0, doubleCornerDepth - 1);
    else if (char === '"' && text[index - 1] !== '\\') asciiDoubleOpen = !asciiDoubleOpen;
  }

  return chineseDoubleDepth > 0
    || chineseSingleDepth > 0
    || cornerDepth > 0
    || doubleCornerDepth > 0
    || asciiDoubleOpen;
}

function extractNamesBeforeRoles(text: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(`([\\u4e00-\\u9fff]{2,8})(${roleWords.map(escapeRegExp).join('|')})`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = extractTrailingName(match[1] ?? '');
    if (name) names.push(name);
  }
  return names;
}

function extractNamesAfterRoles(text: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(`(${roleWords.map(escapeRegExp).join('|')})([\\u4e00-\\u9fff]{2,8})`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const name = extractLeadingName(match[2] ?? '');
    if (name) names.push(name);
  }
  return names;
}

function extractNamesBeforeActionMarkers(text: string): string[] {
  const names: string[] = [];
  const pattern = new RegExp(`(?:又|已|便|乃|遂|再)?(${actionMarkers.map(escapeRegExp).join('|')})`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const before = text.slice(Math.max(0, match.index - 8), match.index);
    const run = before.match(/[\u4e00-\u9fff]+$/)?.[0] ?? '';
    const name = extractTrailingName(run);
    if (name) names.push(name);
  }
  return names;
}

function extractTrailingName(text: string): string | null {
  const cleaned = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let length = Math.min(4, cleaned.length); length >= 2; length -= 1) {
    const candidate = cleaned.slice(-length);
    if (isPlausiblePersonName(candidate)) return candidate;
  }
  return null;
}

function extractLeadingName(text: string): string | null {
  const cleaned = text.replace(/[^\u4e00-\u9fff]/g, '');
  for (let length = Math.min(4, cleaned.length); length >= 2; length -= 1) {
    const candidate = cleaned.slice(0, length);
    if (isPlausiblePersonName(candidate)) return candidate;
  }
  return null;
}

function normalizeCandidateName(value: string): string | null {
  const normalized = value.replace(/[^\u4e00-\u9fff]/g, '').trim();
  if (normalized.length < 2 || normalized.length > 4) return null;
  return normalized;
}

function isPlausiblePersonName(name: string): boolean {
  if (exactNonPersonTerms.has(name)) return false;
  if (/^[一二三四五六七八九十百千万年月日时辰公元]+$/.test(name)) return false;
  if (invalidNameFragments.some((fragment) => name.includes(fragment))) return false;
  if (invalidNameSuffixes.some((suffix) => name.endsWith(suffix))) return false;
  if (!hasKnownSurname(name)) return false;
  return true;
}

function hasKnownSurname(name: string): boolean {
  if (compoundSurnames.some((surname) => name.startsWith(surname) && name.length > surname.length)) {
    return true;
  }
  return singleSurnames.has(name[0]);
}

function countNameOccurrences(text: string, name: string): number {
  if (!name) return 0;
  return text.match(new RegExp(escapeRegExp(name), 'g'))?.length ?? 0;
}

function clipEvidence(text: string, name: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  const index = trimmed.indexOf(name);
  if (index < 0) return trimmed.slice(0, 80);
  return trimmed.slice(Math.max(0, index - 24), Math.min(trimmed.length, index + name.length + 56));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
