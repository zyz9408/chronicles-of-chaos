import { estimatePromptTokens, type TokenEstimateResult } from '../prompts/PromptTokenEstimator';
import { formatMemoryContextPackageForPrompt, type MemoryContextPackage } from '../memory';
import { buildTurnOutputRequirements, buildTurnUserMessage } from './TurnPromptMessages';

export type RuntimePromptTokenLayerId =
  | 'systemPrompt'
  | 'userPrompt'
  | 'stateWriterContext'
  | 'turnOutputRequirements';

export type RuntimePromptContextBreakdownId =
  | 'narrativeContext'
  | 'memoryContext'
  | 'situationProjection'
  | 'situationCurrentMatters'
  | 'situationSignals'
  | 'situationChronicles'
  | 'situationPlotPlans'
  | 'situationRemoteNpcBeats'
  | 'situationWorldlineHints'
  | 'stateWriterContext';

export interface RuntimePromptTokenLayer extends TokenEstimateResult {
  id: RuntimePromptTokenLayerId | RuntimePromptContextBreakdownId;
  label: string;
}

export interface RuntimePromptTokenEstimate {
  total: TokenEstimateResult;
  layers: RuntimePromptTokenLayer[];
  contextBreakdown: RuntimePromptTokenLayer[];
}

export interface BuildRuntimePromptTokenEstimateInput {
  systemPrompt: string;
  userPrompt: string;
  narrativeContext: string;
  stateWriterContext: string;
  memoryContextPackage: MemoryContextPackage;
  situationProjectionText?: string;
  situationProjectionSections?: RuntimePromptSituationProjectionSection[];
}

export interface RuntimePromptSituationProjectionSection {
  id: 'currentMatters' | 'signals' | 'chronicles' | 'plotPlans' | 'remoteNpcBeats' | 'worldlineHints';
  label: string;
  text: string;
}

export function buildRuntimePromptTokenEstimate(
  input: BuildRuntimePromptTokenEstimateInput,
): RuntimePromptTokenEstimate {
  const memoryContext = formatMemoryContextPackageForPrompt(input.memoryContextPackage).join('\n');
  const turnOutputRequirements = buildTurnOutputRequirements();
  const finalUserMessage = buildTurnUserMessage(input.userPrompt, input.stateWriterContext);
  const totalPrompt = [input.systemPrompt, finalUserMessage].join('\n\n');

  return {
    total: estimatePromptTokens(totalPrompt),
    layers: [
      estimateLayer('systemPrompt', '系统提示词', input.systemPrompt),
      estimateLayer('userPrompt', '主回合用户提示词', input.userPrompt),
      estimateLayer('stateWriterContext', '状态写入上下文', input.stateWriterContext),
      estimateLayer('turnOutputRequirements', '最终输出提醒', turnOutputRequirements),
    ],
    contextBreakdown: [
      estimateLayer('narrativeContext', '叙事上下文', input.narrativeContext),
      estimateLayer('memoryContext', '记忆上下文', memoryContext),
      estimateLayer('situationProjection', '局势投影', input.situationProjectionText ?? ''),
      ...estimateSituationProjectionSections(input.situationProjectionSections ?? []),
      estimateLayer('stateWriterContext', '状态写入上下文', input.stateWriterContext),
    ],
  };
}

function estimateSituationProjectionSections(
  sections: RuntimePromptSituationProjectionSection[],
): RuntimePromptTokenLayer[] {
  return sections
    .filter((section) => section.text.trim().length > 0)
    .map((section) => estimateLayer(
      toSituationLayerId(section.id),
      `局势投影 / ${section.label}`,
      section.text,
    ));
}

function toSituationLayerId(
  id: RuntimePromptSituationProjectionSection['id'],
): RuntimePromptContextBreakdownId {
  switch (id) {
    case 'currentMatters':
      return 'situationCurrentMatters';
    case 'signals':
      return 'situationSignals';
    case 'chronicles':
      return 'situationChronicles';
    case 'plotPlans':
      return 'situationPlotPlans';
    case 'worldlineHints':
      return 'situationWorldlineHints';
    case 'remoteNpcBeats':
    default:
      return 'situationRemoteNpcBeats';
  }
}

function estimateLayer(
  id: RuntimePromptTokenLayer['id'],
  label: string,
  content: string,
): RuntimePromptTokenLayer {
  return {
    id,
    label,
    ...estimatePromptTokens(content),
  };
}
