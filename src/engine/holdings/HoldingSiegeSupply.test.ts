import { describe, expect, it } from 'vitest';
import type { HoldingLedgerEntry } from '../types';
import {
  calculateInitialSiegeEnduranceTurns,
  projectHoldingSiegeSupply,
} from './HoldingSiegeSupply';

function makeHolding(overrides: Partial<HoldingLedgerEntry> = {}): HoldingLedgerEntry {
  return {
    holdingId: 'holding_test',
    name: '测试据点',
    type: 'city',
    status: 'controlled',
    summary: '用于围城补给测试。',
    scaleLevel: 3,
    agriculture: 50,
    commerce: 50,
    population: 50,
    publicOrder: 50,
    popularSupport: 50,
    defense: 50,
    recruitPotential: 50,
    armory: 50,
    horseSupply: 50,
    corruption: 50,
    updatedAt: '189-09-01',
    ...overrides,
  };
}

describe('HoldingSiegeSupply', () => {
  it('gives a non-producing camp a short deterministic endurance without reading legacy money or grain', () => {
    const camp = makeHolding({
      type: 'camp',
      scaleLevel: 1,
      agriculture: 0,
      localTreasury: 200_000,
      localGranary: 200,
    });

    expect(calculateInitialSiegeEnduranceTurns(camp, 'none')).toBe(3);
    expect(calculateInitialSiegeEnduranceTurns(camp, 'stockpiled')).toBe(9);
  });

  it('derives remaining turns from the locally recorded cutoff turn', () => {
    const holding = makeHolding({
      type: 'camp',
      scaleLevel: 1,
      siege: {
        status: 'encircled',
        supplyLine: 'cut',
        preparation: 'none',
        cutOffAtTurn: 10,
        initialEnduranceTurns: 3,
      },
    });

    expect(projectHoldingSiegeSupply(holding, 12)).toMatchObject({
      remainingTurns: 1,
      condition: 'critical',
      supplyText: '濒临断粮（预计可支撑1回合）',
    });
    expect(projectHoldingSiegeSupply(holding, 13)).toMatchObject({
      remainingTurns: 0,
      condition: 'exhausted',
      supplyText: '粮秣告罄',
    });
  });

  it('does not run a stored-supply countdown while an outside supply line remains open', () => {
    const holding = makeHolding({
      siege: {
        status: 'blockaded',
        supplyLine: 'strained',
        preparation: 'prepared',
      },
    });

    const projection = projectHoldingSiegeSupply(holding, 30);
    expect(projection).toMatchObject({
      condition: 'supplied',
      supplyText: '外部补给受压，尚未完全断绝',
    });
    expect(projection).not.toHaveProperty('remainingTurns');
  });
});
