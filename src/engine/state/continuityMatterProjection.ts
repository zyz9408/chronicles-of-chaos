import type { Quest, QuestPriority } from '../types';
import { isOpenCurrentMatter } from './currentMatterLifecycle';

export const CONTINUITY_MATTER_TAGS = {
  ongoingAgreement: 'continuity:ongoing_agreement',
  externalSupply: 'continuity:external_supply',
  unresolvedDisposition: 'continuity:unresolved_disposition',
  scheduledAgreedAction: 'continuity:scheduled_agreed_action',
} as const;

export const CONTINUITY_MATTER_PROJECTION_LIMITS = {
  items: 6,
  textChars: 1400,
  valueChars: 160,
} as const;

const continuityTags = new Set<string>(Object.values(CONTINUITY_MATTER_TAGS));

export interface ContinuityMatterProjectionEntry {
  matterId: string;
  title: string;
  currentStep?: string;
  priority?: QuestPriority;
  deadlineAt?: string;
  updatedAt: string;
  tags: string[];
  linkedNpcIds: string[];
  linkedFactionIds: string[];
  linkedTroopIds: string[];
  linkedHoldingIds: string[];
  linkedPlaceIds: string[];
}

export interface ContinuityMatterProjection {
  entries: ContinuityMatterProjectionEntry[];
  omittedCount: number;
  text: string;
}

export function buildContinuityMatterProjection(matters: Quest[], currentDate: string): ContinuityMatterProjection {
  const candidates = matters
    .filter(isOpenCurrentMatter)
    .filter(hasContinuityTag)
    .map(projectContinuityMatter)
    .sort((left, right) => compareContinuityMatters(left, right, currentDate));
  const seenIds = new Set<string>();
  const entries: ContinuityMatterProjectionEntry[] = [];
  let textChars = 0;
  for (const candidate of candidates) {
    if (seenIds.has(candidate.matterId)) continue;
    seenIds.add(candidate.matterId);
    const line = formatContinuityMatterEntry(candidate);
    if (entries.length >= CONTINUITY_MATTER_PROJECTION_LIMITS.items
      || (entries.length > 0 && textChars + line.length > CONTINUITY_MATTER_PROJECTION_LIMITS.textChars)) continue;
    entries.push(candidate);
    textChars += line.length;
  }
  const omittedCount = seenIds.size - entries.length;
  return { entries, omittedCount, text: formatContinuityMatterProjection(entries, omittedCount) };
}

export function compareContinuityMatters(left: ContinuityMatterProjectionEntry, right: ContinuityMatterProjectionEntry, currentDate: string): number {
  return priorityRank(left.priority) - priorityRank(right.priority)
    || deadlineRank(left.deadlineAt, currentDate) - deadlineRank(right.deadlineAt, currentDate)
    || (left.deadlineAt ?? '').localeCompare(right.deadlineAt ?? '')
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.matterId.localeCompare(right.matterId);
}

export function formatContinuityMatterProjection(entries: ContinuityMatterProjectionEntry[], omittedCount: number): string {
  if (entries.length === 0) return '';
  return [
    '持续事项常驻真值（不受人物在场、地点、查询相关性或普通事项配额影响）：',
    ...entries.map(formatContinuityMatterEntry),
    omittedCount > 0 ? `- 另有 ${omittedCount} 条低优先级持续事项因固定预算未展开。` : '',
    '- 叙事必须保持上述未结协议与承诺连续；当前事项及其关联实体账本是事实真值，NPC/势力记忆只作辅助回忆。',
  ].filter(Boolean).join('\n');
}

function hasContinuityTag(matter: Quest): boolean {
  return (matter.consequenceTags ?? []).some((tag) => continuityTags.has(tag));
}

function projectContinuityMatter(matter: Quest): ContinuityMatterProjectionEntry {
  return {
    matterId: matter.id,
    title: compactValue(matter.title),
    currentStep: compactValue(matter.currentStep) || undefined,
    priority: matter.priority,
    deadlineAt: matter.deadlineAt?.trim() || undefined,
    updatedAt: matter.updatedAt,
    tags: uniqueSorted((matter.consequenceTags ?? []).filter((tag) => continuityTags.has(tag))),
    linkedNpcIds: uniqueSorted([matter.giverId, ...(matter.relatedNpcIds ?? []), ...(matter.affectedNpcIds ?? [])]),
    linkedFactionIds: uniqueSorted([...(matter.relatedFactionIds ?? []), ...(matter.affectedFactionIds ?? [])]),
    linkedTroopIds: uniqueSorted(matter.affectedForceIds ?? []),
    linkedHoldingIds: uniqueSorted(matter.affectedHoldingIds ?? []),
    linkedPlaceIds: uniqueSorted([matter.targetLocationId, ...(matter.relatedLocationIds ?? []), ...(matter.affectedPlaceIds ?? [])]),
  };
}

function formatContinuityMatterEntry(entry: ContinuityMatterProjectionEntry): string {
  const links = [
    formatLinks('npc', entry.linkedNpcIds), formatLinks('faction', entry.linkedFactionIds),
    formatLinks('troop', entry.linkedTroopIds), formatLinks('holding', entry.linkedHoldingIds),
    formatLinks('place', entry.linkedPlaceIds),
  ].filter(Boolean).join(' ');
  return [
    `- [${entry.matterId}]`, `tags=${entry.tags.join(',')}`, `priority=${entry.priority}`,
    entry.deadlineAt ? `deadline=${entry.deadlineAt}` : '', `title=${compactValue(entry.title)}`,
    entry.currentStep ? `step=${compactValue(entry.currentStep)}` : '', links ? `links=${links}` : '',
  ].filter(Boolean).join('; ');
}

function priorityRank(priority: QuestPriority | undefined): number {
  if (priority === 'high') return 0;
  if (priority === 'medium') return 1;
  return 2;
}

function deadlineRank(deadlineAt: string | undefined, currentDate: string): number {
  if (!deadlineAt) return 2;
  return deadlineAt.localeCompare(currentDate) <= 0 ? 0 : 1;
}

function formatLinks(label: string, values: string[]): string {
  return values.length > 0 ? `${label}:${values.join(',')}` : '';
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();
}

function compactValue(value: string | undefined): string {
  return (value ?? '').replace(/\r/g, ' ').replace(/\n/g, ' ').trim()
    .slice(0, CONTINUITY_MATTER_PROJECTION_LIMITS.valueChars);
}
