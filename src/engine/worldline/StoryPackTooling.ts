import type {
  WorldlineStoryPack,
  WorldlineStoryReusePolicy,
  WorldlineStoryThread,
  WorldlineStoryThreadKind,
} from '../types';

export interface StoryPackCatalogDomain {
  id: string;
  subdomains: ReadonlyArray<{ id: string }>;
}

export interface StoryPackCatalogContract {
  domains: readonly StoryPackCatalogDomain[];
  facets: readonly string[];
  rolePerspectives?: readonly string[];
  eraBands?: ReadonlyArray<{
    id: string;
    startYear: number;
    endYear: number;
  }>;
}

export interface StructuredStoryThreadDraft {
  packId: string;
  worldBookId: string;
  kind: WorldlineStoryThreadKind;
  domain: string;
  subdomain: string;
  motifId: string;
  facet: string;
  title: string;
  summary: string;
  entrySignals: string[];
  escalationShapes?: string[];
  rolePerspectives?: string[];
  relatedNpcNames?: string[];
  relatedFactionIds?: string[];
  relatedPlaceIds?: string[];
  relatedTags?: string[];
  timeRange?: {
    start?: string;
    end?: string;
  };
  reusePolicy: WorldlineStoryReusePolicy;
  cooldownTurns?: number;
  promptSafeVersion: string;
  usageBoundary: string;
}

export interface StoryPackValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  path: string;
  message: string;
}

export interface ValidateStoryPackOptions {
  requireStructuredMetadata?: boolean;
  nearDuplicateThreshold?: number;
  forbiddenHistoricalTerms?: readonly string[];
}

export interface StoryPackNearDuplicate {
  leftId: string;
  rightId: string;
  similarity: number;
}

export interface StoryPackCoverageReport {
  totalThreads: number;
  countsByKind: Record<WorldlineStoryThreadKind, number>;
  countsByDomain: Record<string, number>;
  countsBySubdomain: Record<string, number>;
  countsByFacet: Record<string, number>;
  countsByEraBand: Record<string, number>;
  missingDomainIds: string[];
  missingSubdomainIds: string[];
}

const STORY_THREAD_KINDS: readonly WorldlineStoryThreadKind[] = [
  'structuralPressure',
  'domainSituation',
  'dramaMotif',
  'aftermath',
];

const STORY_REUSE_POLICIES: readonly WorldlineStoryReusePolicy[] = [
  'context_reusable',
  'motif_reusable',
  'save_single_use',
  'arc_singleton',
];

const STORY_THREAD_KIND_ID_SEGMENT: Record<WorldlineStoryThreadKind, string> = {
  structuralPressure: 'structural_pressure',
  domainSituation: 'domain_situation',
  dramaMotif: 'drama_motif',
  aftermath: 'aftermath',
};

const LOW_SIGNAL_TERMS = new Set([
  '继续',
  '看看',
  '现在',
  '然后',
  '下一步',
  '随便',
  'continue',
  'look',
  'now',
]);

const AFTERMATH_SIGNAL_PREFIXES = [
  'aftermath:',
  'combat:',
  'war:',
  'disaster:',
  'regime:',
  'matter:resolved',
];

const STABLE_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PROMPT_FRAGMENT_PATTERN = /(?:\{\{[^}]+\}\}|\$\{[^}]+\}|<%|TODO|TBD|PLACEHOLDER)/i;
const FIXED_PLAYER_IDENTITY_PATTERN = /(?:玩家|主角)(?:身为|是|必须|已经)|刘平/;
const INEVITABLE_OUTCOME_PATTERN = /必然(?:发生|导致|成为)|注定|一定会|最终必定|已经发生/;

export function createStructuredStoryThread(
  draft: StructuredStoryThreadDraft,
): WorldlineStoryThread {
  const stableSegments = [
    draft.packId,
    STORY_THREAD_KIND_ID_SEGMENT[draft.kind],
    draft.domain,
    draft.subdomain,
    draft.motifId,
    draft.facet,
  ];
  stableSegments.forEach(assertStableSegment);
  const id = stableSegments.join('.');

  return {
    id,
    worldBookId: draft.worldBookId,
    kind: draft.kind,
    domain: draft.domain,
    subdomain: draft.subdomain,
    motifId: draft.motifId,
    facet: draft.facet,
    title: draft.title.trim(),
    summary: draft.summary.trim(),
    entrySignals: uniqueNonEmpty(draft.entrySignals),
    ...(draft.escalationShapes?.length
      ? { escalationShapes: uniqueNonEmpty(draft.escalationShapes) }
      : {}),
    ...(draft.rolePerspectives?.length
      ? { rolePerspectives: uniqueNonEmpty(draft.rolePerspectives) }
      : {}),
    ...(draft.relatedNpcNames?.length
      ? { relatedNpcNames: uniqueNonEmpty(draft.relatedNpcNames) }
      : {}),
    ...(draft.relatedFactionIds?.length
      ? { relatedFactionIds: uniqueNonEmpty(draft.relatedFactionIds) }
      : {}),
    ...(draft.relatedPlaceIds?.length
      ? { relatedPlaceIds: uniqueNonEmpty(draft.relatedPlaceIds) }
      : {}),
    ...(draft.relatedTags?.length
      ? { relatedTags: uniqueNonEmpty(draft.relatedTags) }
      : {}),
    ...(draft.timeRange ? { timeRange: draft.timeRange } : {}),
    reusePolicy: draft.reusePolicy,
    ...(draft.cooldownTurns !== undefined ? { cooldownTurns: draft.cooldownTurns } : {}),
    promptSafeVersion: draft.promptSafeVersion.trim(),
    sourceRef: {
      providerId: draft.packId,
      sourceType: 'storyThread',
      sourceId: id,
    },
    usageBoundary: draft.usageBoundary.trim(),
  };
}

export function validateWorldlineStoryPack(
  pack: WorldlineStoryPack,
  catalog: StoryPackCatalogContract,
  options: ValidateStoryPackOptions = {},
): StoryPackValidationIssue[] {
  const issues: StoryPackValidationIssue[] = [];
  const requireStructuredMetadata = options.requireStructuredMetadata ?? true;
  const domainMap = new Map(catalog.domains.map((domain) => [domain.id, domain]));
  const knownFacets = new Set(catalog.facets);
  const knownPerspectives = new Set(catalog.rolePerspectives ?? []);
  const seenIds = new Set<string>();

  if (!pack.id.trim()) {
    issues.push(error('pack.id.required', 'pack.id', 'StoryPack 必须提供稳定 ID。'));
  } else if (!STABLE_SEGMENT_PATTERN.test(pack.id)) {
    issues.push(error('pack.id.invalid', 'pack.id', 'StoryPack ID 只能使用 ASCII 字母、数字、点、下划线和短横线。'));
  }

  pack.threads.forEach((thread, index) => {
    const path = `threads[${index}]`;
    if (seenIds.has(thread.id)) {
      issues.push(error('thread.id.duplicate', `${path}.id`, `重复 StoryThread ID：${thread.id}`));
    }
    seenIds.add(thread.id);

    if (!STABLE_SEGMENT_PATTERN.test(thread.id)) {
      issues.push(error('thread.id.invalid', `${path}.id`, `StoryThread ID 不稳定：${thread.id}`));
    }
    if (thread.worldBookId !== pack.worldBookId) {
      issues.push(error(
        'thread.worldBookId.mismatch',
        `${path}.worldBookId`,
        `线程 worldBookId=${thread.worldBookId} 与包 ${pack.worldBookId} 不一致。`,
      ));
    }
    if (!thread.title.trim()) {
      issues.push(error('thread.title.required', `${path}.title`, '标题不能为空。'));
    }
    if (!thread.summary.trim()) {
      issues.push(error('thread.summary.required', `${path}.summary`, '摘要不能为空。'));
    }
    if (!thread.usageBoundary.trim()) {
      issues.push(error('thread.usageBoundary.required', `${path}.usageBoundary`, '使用边界不能为空。'));
    }
    if (PROMPT_FRAGMENT_PATTERN.test(`${thread.title}\n${thread.summary}\n${thread.usageBoundary}`)) {
      issues.push(error(
        'thread.promptFragment',
        path,
        '内容含生成器残片、占位符或未完成标记。',
      ));
    }
    if (FIXED_PLAYER_IDENTITY_PATTERN.test(`${thread.title}\n${thread.summary}`)) {
      issues.push(error(
        'thread.fixedPlayerIdentity',
        path,
        'StoryPack 不得绑定固定玩家姓名、身份或必做行动。',
      ));
    }
    if (INEVITABLE_OUTCOME_PATTERN.test(thread.summary)) {
      issues.push(error(
        'thread.inevitableOutcome',
        `${path}.summary`,
        'summary 只能描述压力、线索和参与方，不得宣告必然结局或既成事件。',
      ));
    }
    const historicalTerm = findForbiddenHistoricalTerm(
      `${thread.title}\n${thread.summary}`,
      options.forbiddenHistoricalTerms,
    );
    if (historicalTerm) {
      issues.push(error(
        'thread.historicalEventLeak',
        path,
        `StoryPack 命中 KnowledgeBase 历史事件名“${historicalTerm}”，应改写为不宣称史实的通用情境。`,
      ));
    }

    if (!requireStructuredMetadata) return;

    validateStructuredMetadata({
      thread,
      path,
      pack,
      domainMap,
      knownFacets,
      knownPerspectives,
      issues,
    });
  });

  for (const duplicate of findNearDuplicateStoryThreads(
    pack.threads,
    options.nearDuplicateThreshold ?? 0.86,
  )) {
    issues.push(error(
      'thread.nearDuplicate',
      `threads:${duplicate.leftId}/${duplicate.rightId}`,
      `近重复素材 similarity=${duplicate.similarity.toFixed(3)}。`,
    ));
  }

  return issues;
}

function validateStructuredMetadata(input: {
  thread: WorldlineStoryThread;
  path: string;
  pack: WorldlineStoryPack;
  domainMap: Map<string, StoryPackCatalogDomain>;
  knownFacets: Set<string>;
  knownPerspectives: Set<string>;
  issues: StoryPackValidationIssue[];
}): void {
  const {
    thread,
    path,
    pack,
    domainMap,
    knownFacets,
    knownPerspectives,
    issues,
  } = input;

  if (!thread.kind || !STORY_THREAD_KINDS.includes(thread.kind)) {
    issues.push(error('thread.kind.invalid', `${path}.kind`, '缺少或无法识别 StoryThread kind。'));
  }

  const domain = thread.domain ? domainMap.get(thread.domain) : undefined;
  if (!domain) {
    issues.push(error('thread.domain.invalid', `${path}.domain`, `未知领域：${thread.domain ?? 'missing'}`));
  }
  if (
    domain
    && (!thread.subdomain || !domain.subdomains.some((subdomain) => subdomain.id === thread.subdomain))
  ) {
    issues.push(error(
      'thread.subdomain.invalid',
      `${path}.subdomain`,
      `领域 ${domain.id} 下不存在小类：${thread.subdomain ?? 'missing'}`,
    ));
  }
  if (!thread.motifId || !STABLE_SEGMENT_PATTERN.test(thread.motifId)) {
    issues.push(error('thread.motifId.invalid', `${path}.motifId`, 'motifId 必须是稳定 ASCII 标识。'));
  }
  if (!thread.facet || !knownFacets.has(thread.facet)) {
    issues.push(error('thread.facet.invalid', `${path}.facet`, `未知叙事切面：${thread.facet ?? 'missing'}`));
  }

  if (!thread.entrySignals?.length) {
    issues.push(error('thread.entrySignals.required', `${path}.entrySignals`, '至少需要一个具体进入信号。'));
  } else {
    for (const signal of thread.entrySignals) {
      if (LOW_SIGNAL_TERMS.has(normalizeText(signal))) {
        issues.push(error(
          'thread.entrySignals.lowSignal',
          `${path}.entrySignals`,
          `“${signal}”属于无具体语境的低信号词，不能单独触发 StoryPack。`,
        ));
      }
    }
  }

  if (
    thread.kind === 'aftermath'
    && !(thread.entrySignals ?? []).some((signal) => (
      AFTERMATH_SIGNAL_PREFIXES.some((prefix) => normalizeText(signal).startsWith(prefix))
    ))
  ) {
    issues.push(error(
      'thread.aftermath.missingResultSignal',
      `${path}.entrySignals`,
      'Aftermath 必须引用战斗、战争、灾害、政权变化或已结事项等结构化结果信号。',
    ));
  }

  for (const perspective of thread.rolePerspectives ?? []) {
    if (knownPerspectives.size > 0 && !knownPerspectives.has(perspective)) {
      issues.push(error(
        'thread.rolePerspective.invalid',
        `${path}.rolePerspectives`,
        `未知角色视角：${perspective}`,
      ));
    }
  }
  if (thread.relatedNpcNames?.length) {
    issues.push(warning(
      'thread.relatedNpcNames.discouraged',
      `${path}.relatedNpcNames`,
      '通用 StoryPack 原则上不绑定历史人物；确认该姓名确有必要且不会抬高无关相关度。',
    ));
  }
  if (!thread.reusePolicy || !STORY_REUSE_POLICIES.includes(thread.reusePolicy)) {
    issues.push(error(
      'thread.reusePolicy.invalid',
      `${path}.reusePolicy`,
      '缺少或无法识别 reusePolicy。',
    ));
  }
  if (
    thread.cooldownTurns !== undefined
    && (!Number.isInteger(thread.cooldownTurns) || thread.cooldownTurns < 0 || thread.cooldownTurns > 200)
  ) {
    issues.push(error(
      'thread.cooldownTurns.invalid',
      `${path}.cooldownTurns`,
      'cooldownTurns 必须是 0—200 的整数。',
    ));
  }
  if (!thread.promptSafeVersion?.trim() || PROMPT_FRAGMENT_PATTERN.test(thread.promptSafeVersion)) {
    issues.push(error(
      'thread.promptSafeVersion.invalid',
      `${path}.promptSafeVersion`,
      '缺少合法 promptSafeVersion。',
    ));
  }
  if (
    !thread.sourceRef
    || thread.sourceRef.providerId !== pack.id
    || thread.sourceRef.sourceType !== 'storyThread'
    || thread.sourceRef.sourceId !== thread.id
  ) {
    issues.push(error(
      'thread.sourceRef.invalid',
      `${path}.sourceRef`,
      'sourceRef 必须稳定指向当前 StoryPack 和 StoryThread。',
    ));
  }
}

export function buildStoryPackCoverageReport(
  pack: WorldlineStoryPack,
  catalog: StoryPackCatalogContract,
): StoryPackCoverageReport {
  const countsByKind = Object.fromEntries(
    STORY_THREAD_KINDS.map((kind) => [kind, 0]),
  ) as Record<WorldlineStoryThreadKind, number>;
  const countsByDomain = Object.fromEntries(
    catalog.domains.map((domain) => [domain.id, 0]),
  ) as Record<string, number>;
  const countsBySubdomain = Object.fromEntries(
    catalog.domains.flatMap((domain) => (
      domain.subdomains.map((subdomain) => [`${domain.id}/${subdomain.id}`, 0])
    )),
  ) as Record<string, number>;
  const countsByFacet = Object.fromEntries(
    catalog.facets.map((facet) => [facet, 0]),
  ) as Record<string, number>;
  const countsByEraBand = Object.fromEntries(
    (catalog.eraBands ?? []).map((eraBand) => [eraBand.id, 0]),
  ) as Record<string, number>;

  for (const thread of pack.threads) {
    if (thread.kind && thread.kind in countsByKind) countsByKind[thread.kind] += 1;
    if (thread.domain && thread.domain in countsByDomain) countsByDomain[thread.domain] += 1;
    const subdomainKey = thread.domain && thread.subdomain
      ? `${thread.domain}/${thread.subdomain}`
      : undefined;
    if (subdomainKey && subdomainKey in countsBySubdomain) countsBySubdomain[subdomainKey] += 1;
    if (thread.facet && thread.facet in countsByFacet) countsByFacet[thread.facet] += 1;

    const startYear = extractYear(thread.timeRange?.start);
    const endYear = extractYear(thread.timeRange?.end);
    for (const eraBand of catalog.eraBands ?? []) {
      if (rangesOverlap(startYear, endYear, eraBand.startYear, eraBand.endYear)) {
        countsByEraBand[eraBand.id] += 1;
      }
    }
  }

  return {
    totalThreads: pack.threads.length,
    countsByKind,
    countsByDomain,
    countsBySubdomain,
    countsByFacet,
    countsByEraBand,
    missingDomainIds: Object.entries(countsByDomain)
      .filter(([, count]) => count === 0)
      .map(([id]) => id),
    missingSubdomainIds: Object.entries(countsBySubdomain)
      .filter(([, count]) => count === 0)
      .map(([id]) => id),
  };
}

export function findNearDuplicateStoryThreads(
  threads: readonly WorldlineStoryThread[],
  threshold = 0.86,
): StoryPackNearDuplicate[] {
  const duplicates: StoryPackNearDuplicate[] = [];
  const normalized = threads.map((thread) => ({
    id: thread.id,
    shingles: buildShingles(`${thread.title}${thread.summary}`),
  }));

  for (let leftIndex = 0; leftIndex < normalized.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < normalized.length; rightIndex += 1) {
      const left = normalized[leftIndex];
      const right = normalized[rightIndex];
      const similarity = jaccard(left.shingles, right.shingles);
      if (similarity >= threshold) {
        duplicates.push({
          leftId: left.id,
          rightId: right.id,
          similarity,
        });
      }
    }
  }

  return duplicates.sort((left, right) => (
    right.similarity - left.similarity
    || left.leftId.localeCompare(right.leftId)
    || left.rightId.localeCompare(right.rightId)
  ));
}

function assertStableSegment(segment: string): void {
  if (!STABLE_SEGMENT_PATTERN.test(segment)) {
    throw new Error(`StoryPack stable ID segment is invalid: ${segment}`);
  }
}

function uniqueNonEmpty(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function findForbiddenHistoricalTerm(
  text: string,
  terms: readonly string[] | undefined,
): string | undefined {
  const normalizedText = normalizeText(text);
  return (terms ?? []).find((term) => {
    const normalizedTerm = normalizeText(term);
    return normalizedTerm.length >= 3 && normalizedText.includes(normalizedTerm);
  });
}

function extractYear(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:公元)?\s*(\d{2,4})\s*年/);
  if (!match) return undefined;
  const year = Number.parseInt(match[1], 10);
  return Number.isFinite(year) ? year : undefined;
}

function rangesOverlap(
  startYear: number | undefined,
  endYear: number | undefined,
  bandStart: number,
  bandEnd: number,
): boolean {
  if (startYear === undefined && endYear === undefined) return false;
  const effectiveStart = startYear ?? endYear ?? bandStart;
  const effectiveEnd = endYear ?? startYear ?? bandEnd;
  return effectiveStart <= bandEnd && effectiveEnd >= bandStart;
}

function buildShingles(value: string): Set<string> {
  const normalized = value
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  const shingles = new Set<string>();
  if (normalized.length < 2) {
    if (normalized) shingles.add(normalized);
    return shingles;
  }
  for (let index = 0; index < normalized.length - 1; index += 1) {
    shingles.add(normalized.slice(index, index + 2));
  }
  return shingles;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function error(code: string, path: string, message: string): StoryPackValidationIssue {
  return { severity: 'error', code, path, message };
}

function warning(code: string, path: string, message: string): StoryPackValidationIssue {
  return { severity: 'warning', code, path, message };
}
