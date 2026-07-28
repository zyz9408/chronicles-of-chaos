import { describe, expect, it } from 'vitest';
import * as gameScreenModule from './GameScreen';

type BuildTurnCompletionMessage = (result: {
  generationMode: 'llm' | 'mock';
  generationModel?: string;
  locationWritebackErrors: string[];
  routeWritebackErrors: string[];
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

describe('GameScreen turn completion message', () => {
  it('clears the status message after a clean LLM turn completes', () => {
    const buildMessage = getMessageBuilder();
    expect(buildMessage).toBeTypeOf('function');
    if (!buildMessage) return;

    expect(buildMessage({
      generationMode: 'llm',
      generationModel: 'test-model',
      locationWritebackErrors: [],
      routeWritebackErrors: [],
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
});
