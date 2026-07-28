export interface TurnActionContextMenuContext {
  playerInput?: string | null;
  turnNumber?: number;
  isLatestTurn?: boolean;
  hasRollbackSnapshot?: boolean;
}

export type TurnActionContextMenuDecision =
  | {
      type: 'fill-input';
      inputText: string;
      message: string;
    }
  | {
      type: 'noop';
    };

export const decideTurnActionContextMenu = (
  context: TurnActionContextMenuContext,
): TurnActionContextMenuDecision => {
  if (!context.playerInput || context.playerInput.trim().length === 0) {
    return { type: 'noop' };
  }

  return {
    type: 'fill-input',
    inputText: context.playerInput,
    message: '已把该回合行动放入输入框。回溯需点击“编辑”或“重发”。',
  };
};
