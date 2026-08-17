import { describe, expect, it } from 'vitest';
import type { HoldingLedgerEntry } from '../types';
import {
  holdingHasHouseholdAdministration,
  holdingHasLandAdministration,
  normalizeLegacyHoldingCivilAdministration,
  resolveHoldingCivilAdministrationScope,
  validateHoldingCivilAdministrationFields,
} from './HoldingCivilAdministration';

function makeHolding(overrides: Partial<HoldingLedgerEntry> = {}): HoldingLedgerEntry {
  return {
    holdingId: 'holding_test',
    name: '测试领地',
    type: 'camp',
    status: 'controlled',
    summary: '用于民政范围测试。',
    scaleLevel: 1,
    agriculture: 10,
    commerce: 10,
    population: 10,
    publicOrder: 50,
    popularSupport: 50,
    defense: 50,
    recruitPotential: 10,
    armory: 20,
    horseSupply: 20,
    corruption: 10,
    updatedAt: '189-01-01',
    ...overrides,
  };
}

describe('holding civil administration scope', () => {
  it('keeps stable territorial legacy types without reading names or prose', () => {
    expect(resolveHoldingCivilAdministrationScope(makeHolding({ type: 'county' }))).toBe('territorial');
    expect(resolveHoldingCivilAdministrationScope(makeHolding({ type: 'commandery' }))).toBe('territorial');
    expect(resolveHoldingCivilAdministrationScope(makeHolding({ type: 'village' }))).toBe('territorial');
  });

  it('normalizes an ordinary legacy camp to a non-civil facility', () => {
    const normalized = normalizeLegacyHoldingCivilAdministration(makeHolding());

    expect(normalized.civilAdministrationScope).toBe('none');
    expect(normalized).toMatchObject({
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
      defense: 50,
      armory: 20,
      horseSupply: 20,
    });
    expect(normalized.corruption).toBeUndefined();
    expect(normalized.civilScaleLevel).toBeUndefined();
    expect(holdingHasHouseholdAdministration(normalized)).toBe(false);
    expect(holdingHasLandAdministration(normalized)).toBe(false);
  });

  it('preserves a structurally established legacy tuntian camp as mixed', () => {
    const normalized = normalizeLegacyHoldingCivilAdministration(makeHolding({
      farmlandMu: 2500,
      registeredHouseholds: 295,
      eliteControlledShare: 36,
      localEliteRelation: -20,
    }));

    expect(normalized.civilAdministrationScope).toBe('mixed');
    expect(normalized.civilScaleLevel).toBe(2);
    expect(normalized.farmlandMu).toBe(2500);
    expect(normalized.registeredHouseholds).toBe(295);
    expect(holdingHasHouseholdAdministration(normalized)).toBe(true);
    expect(holdingHasLandAdministration(normalized)).toBe(true);
  });

  it('distinguishes a household port from a pure port without name matching', () => {
    expect(resolveHoldingCivilAdministrationScope(makeHolding({
      type: 'port',
      registeredHouseholds: 180,
    }))).toBe('households');
    expect(resolveHoldingCivilAdministrationScope(makeHolding({
      type: 'port',
      agriculture: 0,
    }))).toBe('none');
  });

  it('rejects civil fields outside their explicit structured scope', () => {
    expect(validateHoldingCivilAdministrationFields(makeHolding({
      civilAdministrationScope: 'none',
      farmlandMu: 100,
    }))).toEqual(expect.arrayContaining([
      expect.stringContaining('agriculture'),
      expect.stringContaining('corruption'),
      expect.stringContaining('farmlandMu'),
    ]));

    expect(validateHoldingCivilAdministrationFields(makeHolding({
      civilAdministrationScope: 'none',
      agriculture: 0,
      commerce: 0,
      population: 0,
      publicOrder: 0,
      popularSupport: 0,
      recruitPotential: 0,
      corruption: undefined,
    }))).toEqual([]);

    expect(validateHoldingCivilAdministrationFields(makeHolding({
      civilAdministrationScope: 'households',
      agriculture: 10,
      farmlandMu: 100,
    }))).toEqual([
      expect.stringContaining('agriculture'),
      expect.stringContaining('farmlandMu'),
    ]);

    expect(validateHoldingCivilAdministrationFields(makeHolding({
      civilAdministrationScope: 'mixed',
      farmlandMu: 100,
      registeredHouseholds: 20,
    }))).toEqual([]);

    expect(validateHoldingCivilAdministrationFields(makeHolding({
      civilAdministrationScope: 'territorial',
      corruption: undefined,
    }))).toEqual([
      expect.stringContaining('corruption'),
    ]);
  });
});
