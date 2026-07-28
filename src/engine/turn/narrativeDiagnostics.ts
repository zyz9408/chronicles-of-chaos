import type {
  DomesticReportResourceDelta,
  RuntimeState,
  TurnHoldingAnnualSettlementMeta,
  TurnProcessingStageEvent,
  TurnPromptTokenEstimateMeta,
  TurnPromptTokenLayerMeta,
  WorldBook,
} from '../types';
import { selectPromptContext } from '../state/selectPromptContext';
import { buildCurrentLocationDisplayPath, buildCurrentMapProjection } from '../map/runtimeMap';
import type { NarrativeRenderEntry } from './narrativeDisplay';
import { formatElapsedTime } from './turnDisplay';

export interface NarrativeDiagnosticExportOptions {
  runtimeState: RuntimeState;
  worldBook: WorldBook;
  renderedEntries: NarrativeRenderEntry[];
  saveId: string;
  generatedAt?: string;
  getLocationName?: (locationId: string) => string;
  mode?: 'default' | 'full';
}

export function buildNarrativeDiagnosticExport({
  runtimeState,
  worldBook,
  renderedEntries,
  saveId,
  generatedAt = new Date().toISOString(),
  getLocationName,
  mode = 'default',
}: NarrativeDiagnosticExportOptions): string {
  const mapLocationPath = buildCurrentLocationDisplayPath(worldBook, runtimeState);
  const legacyLocationName = getLocationName?.(runtimeState.currentLocationId);
  const locationName = mapLocationPath === runtimeState.currentLocationId
    ? legacyLocationName ?? mapLocationPath
    : mapLocationPath;
  const player = runtimeState.player;
  const lines: string[] = [
    '# 乱世风云录诊断导出',
    `导出时间：${generatedAt}`,
    `存档：${saveId}`,
    `世界书：${worldBook.manifest.name} ${worldBook.manifest.id} v${worldBook.manifest.version}`,
    `当前时间：${runtimeState.currentDate}`,
    `当前位置：${locationName}`,
    `玩家：${player.name}${player.courtesyName ? `（字${player.courtesyName}）` : ''}`,
    `当前身份：${player.currentIdentity ?? player.roleType ?? '未指定'}`,
    '',
    '---',
    '',
  ];

  const worldlineKnowledgeDiagnostic = formatWorldlineKnowledgeDiagnostic(runtimeState);
  const situationProjectionDiagnostic = formatSituationProjectionDiagnostic(runtimeState);
  const mapProjectionDiagnostic = formatMapProjectionDiagnostic(runtimeState, worldBook);
  lines.splice(
    lines.length - 2,
    0,
    worldlineKnowledgeDiagnostic,
    '',
    situationProjectionDiagnostic,
    '',
    mapProjectionDiagnostic,
    '',
  );

  if (renderedEntries.length === 0) {
    lines.push('当前没有可导出的正文回合。');
    return finalizeDiagnosticExport(lines, mode);
  }

  const turnLogByKey = new Map(
    runtimeState.turnLog.map((turn) => [`${turn.turnNumber}-${turn.timestamp}`, turn]),
  );

  for (const entry of renderedEntries) {
    const turnLog = turnLogByKey.get(entry.key);
    const meta = entry.displayMeta;

    lines.push(`## ${entry.title}`);
    if (entry.isLive) {
      lines.push('提交状态：未提交预览（不属于存档回合）');
    }
    if (entry.date) lines.push(`回合时间：${entry.date}`);
    if (entry.playerInput) lines.push(`玩家输入：${entry.playerInput}`);
    if (meta) lines.push(`生成信息：${formatGenerationMeta(meta)}`);
    if (meta?.processingStages?.length) {
      lines.push('');
      lines.push(formatProcessingStages(meta.processingStages));
    }
    if (meta?.promptTokenEstimate) {
      lines.push('');
      lines.push(formatPromptTokenEstimate(meta.promptTokenEstimate));
    }
    if (turnLog?.statePatchSummary) lines.push(`状态补丁摘要：${turnLog.statePatchSummary}`);
    if (meta?.holdingAnnualSettlement) {
      lines.push('');
      lines.push(formatHoldingAnnualSettlementMeta(meta.holdingAnnualSettlement));
    }
    if (meta?.npcIntentSimulation) {
      lines.push('');
      lines.push(formatNpcIntentSimulationMeta(meta.npcIntentSimulation));
    }
    if (meta?.locationWriteback) {
      lines.push('');
      lines.push(formatLocationWritebackDiagnostics(meta.locationWriteback));
    }
    lines.push('');
    lines.push('正文：');
    lines.push(entry.narrativeText || '（空）');

    if (meta?.reasoningSummary) {
      lines.push('');
      lines.push('公开思路摘要：');
      lines.push(meta.reasoningSummary);
    }

    if (mode === 'full' && meta?.rawResponse) {
      lines.push('');
      lines.push('原文：');
      lines.push(meta.rawResponse);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return finalizeDiagnosticExport(lines, mode);
}

function finalizeDiagnosticExport(lines: string[], mode: NonNullable<NarrativeDiagnosticExportOptions['mode']>): string {
  const text = lines.join('\n').trimEnd();
  if (mode === 'full') return redactCredentialText(text);
  return redactPrivateDiagnosticText(redactCredentialText(text));
}

function redactCredentialText(text: string): string {
  return text
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^"',\s}]+/gi, '[REDACTED_CREDENTIAL_HEADER]')
    .replace(/\bBearer\s+[^"',\s}]+/gi, '[REDACTED_BEARER_TOKEN]')
    .replace(/\bsk-[A-Za-z0-9._-]+/gi, '[REDACTED_SECRET_KEY]')
    .replace(/"?x-api-key"?\s*:\s*"[^"]*"/gi, '"redactedKeyHeader":"[REDACTED]"')
    .replace(/\bx-api-key\b/gi, 'redactedKeyHeader')
    .replace(/"?apiKey"?\s*:\s*"[^"]*"/gi, '"redactedKey":"[REDACTED]"')
    .replace(/\bapiKey\b/gi, 'redactedKey')
    .replace(/\bAuthorization\b/gi, 'redactedAuthHeader')
    .replace(/\bBearer\b/gi, 'redactedToken');
}

function redactPrivateDiagnosticText(text: string): string {
  return text
    .replace(/\badultPrivateProfile\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bbreastDescription\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bvaginaDescription\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\banusDescription\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bsexualPreferenceNotes\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bsensitiveSpotNotes\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bpreferenceNotes\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bboundaryNotes\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bwombProfile\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/\bfirstNight[A-Za-z]*\b/g, '[REDACTED_PRIVATE_PROFILE_FIELD]')
    .replace(/成人私密档案|成人私密锚点|私密摘要|胸部描述|小穴描述|屁穴描述|性癖|敏感点|偏好记录|边界记录|子宫状态|初夜/g, '[REDACTED_PRIVATE_PROFILE]');
}

function formatLocationWritebackDiagnostics(
  writeback: NonNullable<NonNullable<NarrativeRenderEntry['displayMeta']>['locationWriteback']>,
): string {
  const lines = [
    'Location Writeback Diagnostics / 地图写回诊断：',
    `errors=${writeback.errors.length}`,
    `routeErrors=${writeback.routeErrors.length}`,
  ];
  for (const error of writeback.errors) {
    lines.push(`- locationError=${error}`);
  }
  for (const error of writeback.routeErrors) {
    lines.push(`- routeError=${error}`);
  }
  for (const diagnostic of writeback.diagnostics) {
    lines.push(
      `- code=${diagnostic.code}; incomingLocationId=${diagnostic.incomingLocationId}; candidateIds=${diagnostic.candidateIds.join(',')}; suggestionIndex=${diagnostic.suggestionIndex ?? 'none'}`,
    );
    lines.push(`  message=${diagnostic.message}`);
  }
  return lines.join('\n');
}

function formatWorldlineKnowledgeDiagnostic(runtimeState: RuntimeState): string {
  const settings = runtimeState.worldlineSettings;
  const mode = settings?.knowledgeMode ?? 'default';
  const knowledgeBaseId = settings?.knowledgeBaseId ?? 'none';
  const storyPackIds = settings?.storyPackIds?.join(',') || 'none';
  const promptContext = selectPromptContext(runtimeState);
  const hints = promptContext.worldlineKnowledgeHints;
  const lines = [
    'Worldline Knowledge Projection / 资料库投影：',
    `mode=${mode}`,
    `knowledgeBaseId=${knowledgeBaseId}`,
    `storyPackIds=${storyPackIds}`,
    `projected=${hints.length}`,
  ];

  if (hints.length === 0) {
    lines.push('- none');
    return lines.join('\n');
  }

  for (const hint of hints) {
    const sourceRef = hint.sourceRef
      ? `${hint.sourceRef.providerId}/${hint.sourceRef.sourceType}/${hint.sourceRef.sourceId}`
      : 'none';
    lines.push(
      `- ${hint.id} | anchor=${hint.historicalAnchorId ?? hint.id} | sourceRef=${sourceRef} | ${hint.title} | source=${hint.sourceType} | importance=${hint.importance} | strictness=${hint.strictness} | reason=${hint.reason}`,
    );
    lines.push(`  text=${hint.text}`);
  }

  return lines.join('\n');
}

function formatSituationProjectionDiagnostic(runtimeState: RuntimeState): string {
  const promptContext = selectPromptContext(runtimeState);
  const projection = promptContext.situationProjection;
  const lines = [
    'Situation Projection Diagnostics / 局势投影诊断：',
  ];

  for (const id of [
    'currentMatters',
    'signals',
    'chronicles',
    'plotPlans',
    'remoteNpcBeats',
    'worldlineHints',
  ] as const) {
    lines.push(
      `- ${id}: source=${projection.sourceCounts[id]} projected=${projection.projectedCounts[id]} omitted=${projection.omittedCounts[id]} truncated=${projection.truncatedCounts[id]}`,
    );
  }

  if (projection.sections.length === 0) {
    lines.push('- none');
    return lines.join('\n');
  }

  for (const section of projection.sections) {
    lines.push(`## ${section.id} | ${section.label}`);
    for (const sectionLine of section.lines) {
      lines.push(sectionLine);
    }
  }

  return lines.join('\n');
}

function formatMapProjectionDiagnostic(runtimeState: RuntimeState, worldBook: WorldBook): string {
  const projection = buildCurrentMapProjection(worldBook, runtimeState);
  const lines = [
    'Map V1 Projection Diagnostics / 地图投影诊断：',
    `currentPlaceId=${projection.currentPlaceId}`,
    `currentSceneId=${projection.currentSceneId ?? 'none'}`,
    `displayPath=${projection.displayPath || 'unknown'}`,
    `runtimeMapNodes=${runtimeState.mapNodes?.length ?? 0}`,
    `runtimeRouteEdges=${runtimeState.routeEdges?.length ?? 0}`,
  ];

  if (projection.scenes.length > 0) {
    lines.push('scenes:');
    for (const scene of projection.scenes) {
      lines.push(`- scene ${scene.id} | ${scene.name} | ${scene.summary}`);
    }
  } else {
    lines.push('scenes: none');
  }

  if (projection.nearbyRoutes.length > 0) {
    lines.push('nearbyRoutes:');
    for (const route of projection.nearbyRoutes) {
      const travel = route.travelTimeText
        ?? (route.standardTravelMinutes ? `${route.standardTravelMinutes} minutes` : 'unknown');
      lines.push(
        `- route ${route.routeId} | ${route.name} | to=${route.toPlaceName}(${route.toPlaceId}) | kind=${route.routeKind ?? 'unknown'} | status=${route.status} | travel=${travel}`,
      );
    }
  } else {
    lines.push('nearbyRoutes: none');
  }

  if (projection.locationMemorySummaries.length > 0) {
    lines.push('locationMemories:');
    for (const memory of projection.locationMemorySummaries) {
      lines.push(`- memory ${memory.locationId} | ${memory.summary}`);
    }
  } else {
    lines.push('locationMemories: none');
  }

  return lines.join('\n');
}

function formatPromptTokenEstimate(estimate: TurnPromptTokenEstimateMeta): string {
  const lines = [
    'Prompt Token 分层估算：',
    `总计：约 ${estimate.total.estimatedTokens} tokens（${estimate.total.chars} 字符，范围 ${estimate.total.lowerBound}-${estimate.total.upperBound}）`,
  ];

  if (estimate.layers.length > 0) {
    lines.push('顶层消息：');
    for (const layer of estimate.layers) {
      lines.push(formatPromptTokenLayer(layer));
    }
  }

  if (estimate.contextBreakdown.length > 0) {
    lines.push('上下文拆分：');
    for (const layer of estimate.contextBreakdown) {
      lines.push(formatPromptTokenLayer(layer));
    }
  }

  return lines.join('\n');
}

function formatPromptTokenLayer(layer: TurnPromptTokenLayerMeta): string {
  return `- ${layer.label}：约 ${layer.estimatedTokens} tokens（${layer.chars} 字符，范围 ${layer.lowerBound}-${layer.upperBound}）`;
}

function formatProcessingStages(stages: TurnProcessingStageEvent[]): string {
  const lines = ['处理阶段：'];
  for (const stage of stages) {
    const parts = [`- ${stage.label}：${stage.status}`];
    if (typeof stage.elapsedMs === 'number') parts.push(`耗时 ${formatElapsedTime(stage.elapsedMs)}`);
    if (stage.model) parts.push(`模型 ${stage.model}`);
    if (stage.detail) parts.push(`详情：${stage.detail}`);
    lines.push(parts.join('，'));
  }
  return lines.join('\n');
}

function formatNpcIntentSimulationMeta(
  meta: NonNullable<NarrativeRenderEntry['displayMeta']>['npcIntentSimulation'],
): string {
  if (!meta) return '';

  const lines = [
    'NPC 动态模拟：',
    `状态：${meta.status}${meta.reason ? `（${meta.reason}）` : ''}`,
    `目标 NPC：${meta.targetNpcIds.length > 0 ? meta.targetNpcIds.join('、') : '无'}`,
  ];

  if (meta.provider || meta.model) {
    lines.push(`模型：${meta.provider ?? 'unknown'} / ${meta.model ?? 'unknown'}`);
  }

  const usage = formatNpcSimulationUsage(meta.usage);
  if (usage) lines.push(`消耗：${usage}`);

  if (meta.package?.intents.length) {
    lines.push('意图：');
    for (const intent of meta.package.intents) {
      lines.push(`- ${intent.npcName}(${intent.npcId})：${intent.shouldAct ? intent.intent : '暂无明显意图'}`);
      lines.push(`  触发：${intent.trigger}`);
      const details = [
        intent.perceptionBasis ? `感知：${intent.perceptionBasis}` : '',
        intent.relationshipBasis ? `关系/利益：${intent.relationshipBasis}` : '',
        intent.emotionalState ? `情绪：${intent.emotionalState}` : '',
        typeof intent.confidence === 'number' ? `置信度：${intent.confidence}` : '',
      ].filter(Boolean);
      if (details.length > 0) lines.push(`  依据：${details.join('；')}`);
    }
  }

  return lines.join('\n');
}

function formatHoldingAnnualSettlementMeta(meta: TurnHoldingAnnualSettlementMeta): string {
  return [
    '年度内政结算：',
    `状态：${meta.status}`,
    `报告：${meta.reportId}`,
    `年份：${meta.year}`,
    `结算时间：${meta.settledAt}`,
    `收入：${formatDomesticResourceDelta(meta.income)}`,
    `支出：${formatDomesticResourceDelta(meta.expenses)}`,
    `净变：${formatDomesticResourceDelta(meta.netChange)}`,
    `到期私产工程：${meta.completedProjectIds.length > 0 ? meta.completedProjectIds.join('、') : '无'}`,
    `影响领地：${meta.affectedHoldingIds.length > 0 ? meta.affectedHoldingIds.join('、') : '无'}`,
    `影响私产：${meta.affectedPrivateAssetIds.length > 0 ? meta.affectedPrivateAssetIds.join('、') : '无'}`,
  ].join('\n');
}

function formatDomesticResourceDelta(delta: DomesticReportResourceDelta): string {
  const parts = [
    ['money', delta.money],
    ['grain', delta.grain],
    ['horses', delta.horses],
    ['arms', delta.arms],
    ['recruits', delta.recruits],
  ]
    .filter(([, value]) => value !== 0)
    .map(([label, value]) => `${label}${Number(value) > 0 ? '+' : ''}${value}`);

  return parts.length > 0 ? parts.join(', ') : 'no change';
}

function formatNpcSimulationUsage(
  usage: NonNullable<NonNullable<NarrativeRenderEntry['displayMeta']>['npcIntentSimulation']>['usage'],
): string {
  if (!usage) return '';
  const parts: string[] = [];
  if (typeof usage.promptTokens === 'number') parts.push(`prompt=${usage.promptTokens}`);
  if (typeof usage.completionTokens === 'number') parts.push(`completion=${usage.completionTokens}`);
  if (typeof usage.totalTokens === 'number') parts.push(`total=${usage.totalTokens}`);
  return parts.join(', ');
}

function formatGenerationMeta(meta: NonNullable<NarrativeRenderEntry['displayMeta']>): string {
  const parts: string[] = [];
  if (meta.provider) parts.push(`provider=${meta.provider}`);
  if (meta.model) parts.push(`model=${meta.model}`);
  if (typeof meta.promptTokens === 'number') parts.push(`prompt=${meta.promptTokens}`);
  if (typeof meta.completionTokens === 'number') parts.push(`completion=${meta.completionTokens}`);
  if (typeof meta.totalTokens === 'number') parts.push(`total=${meta.totalTokens}`);
  if (typeof meta.elapsedMs === 'number') parts.push(`elapsed=${formatElapsedTime(meta.elapsedMs)}`);
  return parts.length > 0 ? parts.join(', ') : '无统计信息';
}
