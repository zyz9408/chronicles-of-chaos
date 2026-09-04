import { describe, expect, it } from 'vitest';
import * as gameScreenModule from './GameScreen';

type BuildTurnCompletionMessage = (result: {
  generationMode: 'llm' | 'mock';
  generationModel?: string;
  locationWritebackErrors: string[];
  routeWritebackErrors: string[];
  stateWritebackWarnings: string[];
  locationWritebackDiagnostics: Array<{
    code: 'location-canonical-ambiguous' | 'location-writeback-rolled-back';
    message: string;
    incomingLocationId: string;
    candidateIds: string[];
    suggestionIndex: number;
  }>;
}) => string;

function getMessageBuilder(): BuildTurnCompletionMessage | undefined {
  const candidate = (gameScreenModule as Record<string, unknown>).buildTurnCompletionMessage;
  return candidate as BuildTurnCompletionMessage | undefined;
}

function getDismissibleClassifier(): ((message: string) => boolean) | undefined {
  return (gameScreenModule as Record<string, unknown>).isDismissibleTurnCompletionMessage as
    | ((message: string) => boolean)
    | undefined;
}

describe('GameScreen turn completion message', () => {
  it('makes only per-turn completion warnings dismissible', () => {
    const classify = getDismissibleClassifier();
    expect(classify).toBeTypeOf('function');
    expect(classify?.('本回合已自动保存，但部分状态写回未通过校验。')).toBe(true);
    expect(classify?.('错误：回合生成失败')).toBe(false);
  });

  it('clears the status message after a clean LLM turn completes', () => {
    const buildMessage = getMessageBuilder();
    expect(buildMessage).toBeTypeOf('function');
    if (!buildMessage) return;

    expect(buildMessage({
      generationMode: 'llm',
      generationModel: 'test-model',
      locationWritebackErrors: [],
      routeWritebackErrors: [],
      stateWritebackWarnings: [],
      locationWritebackDiagnostics: [],
    })).toBe('');
  });

  it('returns a concise map warning without exposing incoming or candidate IDs', () => {
    const buildMessage = getMessageBuilder();
    expect(buildMessage).toBeTypeOf('function');
    if (!buildMessage) return;

    const message = buildMessage({
      generationMode: 'llm',
      generationModel: 'test-model',
      locationWritebackErrors: ['地点 canonical 身份歧义：incoming_xinye'],
      routeWritebackErrors: ['route_candidate_a failed'],
      stateWritebackWarnings: [],
      locationWritebackDiagnostics: [{
        code: 'location-canonical-ambiguous',
        message: 'incoming_xinye matches place_candidate_a and place_candidate_b',
        incomingLocationId: 'incoming_xinye',
        candidateIds: ['place_candidate_a', 'place_candidate_b'],
        suggestionIndex: 0,
      }],
    });

    expect(message).toContain('地图写回存在警告');
    expect(message).not.toContain('incoming_xinye');
    expect(message).not.toContain('place_candidate_a');
    expect(message).not.toContain('place_candidate_b');
    expect(message).not.toContain('route_candidate_a');
  });

  it('does not present a rolled-back map writeback as an ordinary success', () => {
    const buildMessage = getMessageBuilder();
    expect(buildMessage).toBeTypeOf('function');
    if (!buildMessage) return;

    const message = buildMessage({
      generationMode: 'llm',
      generationModel: 'test-model',
      locationWritebackErrors: ['因状态补丁校验失败，本回合地图写回已回滚。'],
      routeWritebackErrors: [],
      stateWritebackWarnings: [],
      locationWritebackDiagnostics: [{
        code: 'location-writeback-rolled-back',
        message: '因状态补丁校验失败，本回合地图写回已回滚。',
        incomingLocationId: '',
        candidateIds: [],
        suggestionIndex: 0,
      }],
    });

    expect(message).toContain('地图写回存在警告');
    expect(message).not.toContain('AI 回合已生成并自动保存');
    expect(message).not.toContain('incoming_outpost');
    expect(message).not.toContain('place_candidate');
  });

  it('distinguishes a quarantined state patch from a map writeback warning', () => {
    const buildMessage = getMessageBuilder();
    expect(buildMessage).toBeTypeOf('function');
    if (!buildMessage) return;

    const message = buildMessage({
      generationMode: 'llm',
      generationModel: 'test-model',
      locationWritebackErrors: [],
      routeWritebackErrors: [],
      stateWritebackWarnings: ['resourceChanged: conflicting fields'],
      locationWritebackDiagnostics: [],
    });

    expect(message).toContain('部分状态写回未通过校验');
    expect(message).toContain('地图与其余合法状态已保留');
    expect(message).not.toContain('地图写回存在警告');
  });
});
