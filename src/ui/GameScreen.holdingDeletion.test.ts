import { describe, expect, it } from 'vitest';
import gameScreenSource from './GameScreen.tsx?raw';

describe('GameScreen 领地删除控制', () => {
  it('只在选中领地详情提供删除入口，并要求两阶段确认', () => {
    expect(gameScreenSource).toContain('data-testid="holding-delete-trigger"');
    expect(gameScreenSource).toContain("step: 1 | 2");
    expect(gameScreenSource).toContain("pendingHoldingDeletion.step === 1 ? '确认删除领地' : '再次确认删除'");
    expect(gameScreenSource).toContain('data-testid="holding-delete-continue"');
    expect(gameScreenSource).toContain('data-testid="holding-delete-final"');
    expect(gameScreenSource).toContain("isDeletingHolding ? '正在删除…' : '永久删除'");
  });

  it('最终删除前重新检查依赖并先持久化、后发布到界面', () => {
    const handlerStart = gameScreenSource.indexOf('const handleConfirmHoldingDeletion = useCallback');
    const handlerEnd = gameScreenSource.indexOf('const handleConfirmInventoryRemoval', handlerStart);
    const handlerSource = gameScreenSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerSource).toContain('deleteHoldingSafely(runtimeState, pendingHoldingDeletion.analysis.holdingId)');
    expect(handlerSource).toContain('await commitBeforePublish(');
    expect(handlerSource.indexOf('await saveCurrentState(saveId, result.state)'))
      .toBeLessThan(handlerSource.indexOf('setRuntimeState(result.state)'));
    expect(handlerSource).toContain('领地删除保存失败，账本仍保留');
  });
});
