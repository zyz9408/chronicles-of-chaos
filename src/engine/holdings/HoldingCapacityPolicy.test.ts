import { describe, expect, it } from 'vitest';
import type { HoldingLedgerEntry } from '../types';
import {
  getHoldingCapacityLimits,
  getMinimumHoldingCivilScaleLevelForValues,
  getHoldingTypeMaxScale,
  resolveHoldingCivilScaleLevel,
  validateHoldingCapacityUpdate,
} from './HoldingCapacityPolicy';

function makeHolding(overrides: Partial<HoldingLedgerEntry> = {}): HoldingLedgerEntry {
  return {
    holdingId: 'holding_test',
    name: '测试县城',
    type: 'county',
    status: 'controlled',
    summary: '测试具体领地。',
    civilAdministrationScope: 'territorial',
    scaleLevel: 2,
    agriculture: 50,
    commerce: 50,
    population: 50,
    publicOrder: 50,
    popularSupport: 50,
    defense: 50,
    recruitPotential: 50,
    armory: 50,
    horseSupply: 50,
    corruption: 20,
    farmlandMu: 4_500,
    registeredHouseholds: 700,
    updatedAt: '189-09-01',
    ...overrides,
  };
}

describe('HoldingCapacityPolicy', () => {
  it('caps concrete holding scale by type', () => {
    expect(getHoldingTypeMaxScale('city')).toBe(5);
    expect(getHoldingTypeMaxScale('county')).toBe(4);
    expect(getHoldingTypeMaxScale('fort')).toBe(4);
    expect(getHoldingTypeMaxScale('estate')).toBe(3);
    expect(getHoldingTypeMaxScale('village')).toBe(2);
  });

  it('derives hard cadastral totals from scale, type and civil scope', () => {
    expect(getHoldingCapacityLimits(makeHolding({ type: 'village', scaleLevel: 2 }))).toMatchObject({
      civilScaleLevel: 2,
      maxFarmlandMu: 21_000,
      maxRegisteredHouseholds: 1_500,
    });
    expect(getHoldingCapacityLimits(makeHolding({
      type: 'camp',
      scaleLevel: 4,
      civilAdministrationScope: 'mixed',
    }))).toMatchObject({
      civilScaleLevel: 4,
      maxFarmlandMu: 90_000,
      maxRegisteredHouseholds: 7_500,
    });
    expect(getHoldingCapacityLimits(makeHolding({
      type: 'fort',
      scaleLevel: 4,
      civilAdministrationScope: 'none',
    }))).toMatchObject({
      maxFarmlandMu: 0,
      maxRegisteredHouseholds: 0,
    });
  });

  it('grandfathers an over-cap legacy value only when it does not grow', () => {
    const previous = makeHolding({
      type: 'village',
      scaleLevel: 3,
      civilScaleLevel: 2,
      farmlandMu: 25_000,
      registeredHouseholds: 2_000,
    });
    expect(validateHoldingCapacityUpdate({ ...previous }, previous)).toEqual([]);
    expect(validateHoldingCapacityUpdate({ ...previous, farmlandMu: 25_001 }, previous).join('\n'))
      .toContain('farmlandMu');
  });

  it('uses stable location profiles for major cities without reading the holding name', () => {
    const wancheng = makeHolding({
      name: '任意名称',
      type: 'city',
      locationId: 'place_nanyang_wan',
      scaleLevel: 2,
      farmlandMu: 1_200_000,
      registeredHouseholds: 100_000,
    });

    expect(resolveHoldingCivilScaleLevel(wancheng)).toBe(5);
    expect(getHoldingCapacityLimits(wancheng)).toMatchObject({
      civilScaleLevel: 5,
      maxFarmlandMu: 1_500_000,
      maxRegisteredHouseholds: 120_000,
    });
    expect(validateHoldingCapacityUpdate(wancheng)).toEqual([]);
  });

  it('finds the minimum fitting civil scale within each concrete type hard cap', () => {
    expect(getMinimumHoldingCivilScaleLevelForValues(makeHolding({
      type: 'city',
      farmlandMu: 1_200_000,
      registeredHouseholds: 90_000,
    }), 'territorial')).toBe(5);
    expect(getMinimumHoldingCivilScaleLevelForValues(makeHolding({
      type: 'county',
      farmlandMu: 1_200_000,
      registeredHouseholds: 90_000,
    }), 'territorial')).toBeUndefined();
  });

  it('allows commandery only as an exact legacy record', () => {
    const commandery = makeHolding({ type: 'commandery' });
    expect(validateHoldingCapacityUpdate(commandery).join('\n')).toContain('区域层级');
    expect(validateHoldingCapacityUpdate(commandery, commandery)).toEqual([]);
  });
});
