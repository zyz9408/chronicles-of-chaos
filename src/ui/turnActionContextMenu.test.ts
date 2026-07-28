import { describe, expect, it } from 'vitest';
import { decideTurnActionContextMenu } from './turnActionContextMenu';

describe('decideTurnActionContextMenu', () => {
  it('fills the input instead of rolling back when the action still has a snapshot', () => {
    const decision = decideTurnActionContextMenu({
      playerInput: '先整肃军队',
      turnNumber: 2,
      isLatestTurn: true,
      hasRollbackSnapshot: true,
    });

    expect(decision).toEqual({
      type: 'fill-input',
      inputText: '先整肃军队',
      message: '已把该回合行动放入输入框。回溯需点击“编辑”或“重发”。',
    });
  });

  it('does nothing when the turn has no player input', () => {
    expect(decideTurnActionContextMenu({ playerInput: '' })).toEqual({
      type: 'noop',
    });
  });
});
