import { describe, expect, it } from 'vitest';
import gameScreenSource from './GameScreen.tsx?raw';

describe('GameScreen NPC deletion controls', () => {
  it('exposes a second-confirmation dialog from the selected NPC detail', () => {
    expect(gameScreenSource).toContain('删除人物');
    expect(gameScreenSource).toContain('确认删除人物');
    expect(gameScreenSource).toContain('pendingNpcDeletion.blockers.length > 0');
    expect(gameScreenSource).toContain('disabled={!pendingNpcDeletion.canDelete || isDeletingNpc}');
  });

  it('persists the next state before publishing the deletion to the UI', () => {
    const handlerStart = gameScreenSource.indexOf('const handleConfirmNpcDeletion = useCallback');
    const handlerEnd = gameScreenSource.indexOf('const openBackpackForEquipmentSlot', handlerStart);
    const handlerSource = gameScreenSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerSource).toContain('await commitBeforePublish(');
    expect(handlerSource.indexOf('await saveCurrentState(saveId, result.state)'))
      .toBeLessThan(handlerSource.indexOf('setRuntimeState(result.state)'));
    expect(handlerSource).toContain('人物删除保存失败，档案仍保留');
  });
});
