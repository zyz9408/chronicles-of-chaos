import { describe, expect, it } from 'vitest';
import { createPendingOpeningLoadout } from './openingLoadout';

describe('createPendingOpeningLoadout', () => {
  it('leaves initial loadout for the true opening LLM instead of using a local preset', () => {
    const loadout = createPendingOpeningLoadout();

    expect(loadout.personalMoney).toBe(0);
    expect(loadout.equipment).toEqual([]);
    expect(loadout.inventory).toEqual([]);
    expect(loadout.summary).toContain('真开局 AI');
  });
});