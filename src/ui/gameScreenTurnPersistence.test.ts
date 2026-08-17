import { describe, expect, it, vi } from 'vitest';
import type { RuntimeState } from '../engine/types';
import { commitBeforePublish, getLatestSuggestedActions } from './GameScreen';

describe('GameScreen atomic turn persistence', () => {
  it('commits a successful transition before publishing its result', async () => {
    const order: string[] = [];
    const commit = vi.fn(async () => {
      order.push('commit');
      return { stateId: 'committed' };
    });
    const publish = vi.fn((committed: { stateId: string }) => {
      order.push(`publish:${committed.stateId}`);
    });

    await expect(commitBeforePublish(commit, publish)).resolves.toEqual({ stateId: 'committed' });
    expect(order).toEqual(['commit', 'publish:committed']);
  });

  it('does not publish rollback or reroll state when persistence fails', async () => {
    const error = new Error('commit failed');
    const publish = vi.fn();

    await expect(commitBeforePublish(async () => { throw error; }, publish)).rejects.toBe(error);
    expect(publish).not.toHaveBeenCalled();
  });

  it('restores the latest persisted suggested actions when a save is loaded', () => {
    const makeTurn = (
      turnNumber: number,
      label: string,
    ): RuntimeState['turnLog'][number] => ({
      turnNumber,
      date: '公元194年04月25日 15:30',
      playerInput: `行动 ${turnNumber}`,
      narrativeText: `正文 ${turnNumber}`,
      statePatchSummary: '测试',
      timestamp: `2026-07-16T00:00:0${turnNumber}.000Z`,
      suggestedActions: [{
        label,
        description: `${label}的说明`,
        actionType: 'other',
      }],
    });
    const latest = makeTurn(2, '整顿营门');

    expect(getLatestSuggestedActions({
      turnLog: [makeTurn(1, '巡视城墙'), latest],
    })).toEqual(latest.suggestedActions);
    expect(getLatestSuggestedActions({ turnLog: [] })).toEqual([]);
  });

  it('never renders or retains a streamed draft after a turn fails before persistence', async () => {
    const { readFileSync } = await import('node:' + 'fs') as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('includeLiveEntry: isProcessing');
    expect(source).toMatch(
      /setNarrativeText\(''\);\s*setSuggestedActions\(getLatestSuggestedActions\(baseState\)\);\s*setMessage\(`错误：/,
    );
  });

  it('commits the main turn before running recoverable memory maintenance', async () => {
    const { readFileSync } = await import('node:' + 'fs') as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const actionStart = source.indexOf('const executeActionFromState');
    const actionEnd = source.indexOf('const retryPendingMemorySummary', actionStart);
    const actionSource = source.slice(actionStart, actionEnd);

    expect(actionSource).toContain('deferMemorySummaryCompression: true');
    expect(actionSource.indexOf('queueMemorySummaryMaintenance')).toBeLessThan(
      actionSource.indexOf('commitSuccessfulTurn'),
    );
    expect(actionSource.indexOf('commitSuccessfulTurn')).toBeLessThan(
      actionSource.indexOf('await runMemorySummaryMaintenance'),
    );
  });

  it('offers memory API settings, manual retry, and a non-blocking later choice after compression failure', async () => {
    const { readFileSync } = await import('node:' + 'fs') as {
      readFileSync: (path: URL, encoding: string) => string;
    };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data-testid="memory-summary-recovery-modal"');
    expect(source).toContain('data-testid="memory-summary-later"');
    expect(source).toContain('data-testid="memory-summary-dialog-open-settings"');
    expect(source).toContain('data-testid="memory-summary-dialog-retry"');
    expect(source).toContain('后续回合不会自动重试或等待');
    for (const testId of ['memory-summary-open-settings', 'memory-summary-dialog-open-settings']) {
      const start = source.indexOf(`data-testid="${testId}"`);
      expect(start).toBeGreaterThan(-1);
      expect(source.slice(start, start + 360)).toContain("onOpenSettings('memory')");
      expect(source.slice(start, start + 360)).not.toContain("onOpenSettings('api')");
    }
  });
});
