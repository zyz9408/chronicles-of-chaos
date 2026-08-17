import type { NarrativePerspective, RuntimeState } from '../types/runtimeState';

export interface NarrativePerspectiveProfile {
  id: NarrativePerspective;
  label: string;
  marker: string;
  summary: string;
}

export interface NarrativePerspectiveSubject {
  playerName: string;
  playerSex?: '男' | '女' | '其他';
}

export const narrativePerspectiveProfiles: readonly NarrativePerspectiveProfile[] = [
  {
    id: 'first_person',
    label: '第一人称',
    marker: '我',
    summary: '旁白以“我”承接主角的可见行动与处境，沉浸感更强。',
  },
  {
    id: 'second_person',
    label: '第二人称',
    marker: '你 · 默认',
    summary: '旁白以“你”直接承接主角，保持当前互动叙事风格。',
  },
  {
    id: 'third_person',
    label: '第三人称',
    marker: '姓名 / 他 / 她',
    summary: '旁白使用主角姓名，主体明确时可用“他”或“她”，更接近历史小说。',
  },
] as const;

export function getNarrativePerspectiveProfile(
  perspective: NarrativePerspective | string | null | undefined,
): NarrativePerspectiveProfile {
  return narrativePerspectiveProfiles.find((profile) => profile.id === perspective)
    ?? narrativePerspectiveProfiles[1];
}

export function normalizeNarrativePerspective(
  perspective: NarrativePerspective | string | null | undefined,
): NarrativePerspective {
  return getNarrativePerspectiveProfile(perspective).id;
}

export function applyNarrativePerspectiveToRuntimeState(
  state: RuntimeState,
  perspective: NarrativePerspective | string | null | undefined,
): RuntimeState {
  return {
    ...state,
    narrativePerspective: normalizeNarrativePerspective(perspective),
  };
}

export function formatNarrativePerspectiveForPrompt(
  perspective: NarrativePerspective | string | null | undefined,
  subject: NarrativePerspectiveSubject,
): string {
  const normalized = normalizeNarrativePerspective(perspective);
  const playerName = subject.playerName.trim() || '主角';
  const playerPronoun = subject.playerSex === '男'
    ? '他'
    : subject.playerSex === '女'
      ? '她'
      : '';
  const sharedRules = [
    '本合同只约束 `【旁白】` 中如何指代当前主角；NPC 与主角直接对白中的自然人称不受影响。',
    '人称只改变语法主语，绝不授权补写玩家未输入的对白、心理决定、立场承诺、额外行动、未知信息、情绪或身体感受。',
    '只有玩家输入已经提供逐字台词时，才可按既有玩家对白合同忠实承接；不得使用 `【我】`、`【你】`、`【他】` 或 `【她】` 作为说话人标签。',
    '同一段正文与同一回合必须保持所选人称，不得混用其他叙事人称；历史正文中的旧人称不构成本回合改写依据。',
  ];

  if (normalized === 'first_person') {
    return [
      '## 本局正文叙事人称：第一人称',
      `在 \`【旁白】\` 中指代当前主角 ${playerName} 时统一使用“我”；不得改用“你”、主角姓名、“他”或“她”。`,
      ...sharedRules,
    ].join('\n');
  }

  if (normalized === 'third_person') {
    return [
      '## 本局正文叙事人称：第三人称',
      `在 \`【旁白】\` 中指代当前主角时使用姓名“${playerName}”；每段首次提及主角或叙事主体切换回主角时，必须重新使用“${playerName}”。`,
      playerPronoun
        ? `只有同段主体完全明确、不会与其他人物混淆时，后续才可使用“${playerPronoun}”；一旦出现多人或主体切换，立即恢复姓名“${playerName}”。`
        : `不得擅自为主角指定“他”或“她”；后续仍使用姓名“${playerName}”。`,
      '不得用主角表字、号、官职、身份或泛称替代姓名来承担第三人称主语。',
      '不得改用“我”或“你”叙述主角。',
      ...sharedRules,
    ].join('\n');
  }

  return [
    '## 本局正文叙事人称：第二人称',
    `在 \`【旁白】\` 中指代当前主角 ${playerName} 时统一使用“你”；不得改用“我”、主角姓名、“他”或“她”。`,
    ...sharedRules,
  ].join('\n');
}
