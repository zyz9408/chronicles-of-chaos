import { describe, expect, it } from 'vitest';
import {
  OPENING_ABILITY_POINT_BUDGET,
  type OpeningAbilityScores,
  adjustOpeningAbilityAllocation,
  canDecreaseOpeningAbility,
  canIncreaseOpeningAbility,
  getOpeningAbilityPointsRemaining,
  normalizeOpeningAbilityAllocation,
} from './openingAbilityPoints';

const keys = ['武力', '统率', '智力', '政治', '魅力'];
const base = { 武力: 52, 统率: 52, 智力: 52, 政治: 52, 魅力: 52, 机运: 50 };

describe('opening ability point allocation', () => {
  it('caps all visible opening additions at a shared 30-point budget', () => {
    let current: OpeningAbilityScores = { ...base };
    for (let index = 0; index < 40; index += 1) {
      current = adjustOpeningAbilityAllocation(base, current, keys, '武力', 1);
    }

    expect(current.武力).toBe(82);
    expect(getOpeningAbilityPointsRemaining(base, current, keys)).toBe(0);
    expect(canIncreaseOpeningAbility(base, current, keys, '统率')).toBe(false);
    expect(OPENING_ABILITY_POINT_BUDGET).toBe(30);
  });

  it('returns points when an initial score is decreased and permits recovery down to the global minimum', () => {
    let current: OpeningAbilityScores = adjustOpeningAbilityAllocation(base, base, keys, '武力', -1);

    expect(current.武力).toBe(51);
    expect(getOpeningAbilityPointsRemaining(base, current, keys)).toBe(31);
    expect(canDecreaseOpeningAbility(base, current, keys, '武力')).toBe(true);

    current = adjustOpeningAbilityAllocation(base, current, keys, '智力', 12);
    current = adjustOpeningAbilityAllocation(base, current, keys, '智力', -5);

    expect(current.智力).toBe(59);
    expect(getOpeningAbilityPointsRemaining(base, current, keys)).toBe(24);

    current = adjustOpeningAbilityAllocation(base, current, keys, '智力', -99);
    expect(current.智力).toBe(1);
    expect(canDecreaseOpeningAbility(base, current, keys, '智力')).toBe(false);
    expect(getOpeningAbilityPointsRemaining(base, current, keys)).toBe(82);
  });

  it('lets recovered initial points be redistributed to another ability', () => {
    let current: OpeningAbilityScores = adjustOpeningAbilityAllocation(base, base, keys, '智力', 12);
    current = adjustOpeningAbilityAllocation(base, current, keys, '智力', -22);
    current = adjustOpeningAbilityAllocation(base, current, keys, '武力', 40);

    expect(current.智力).toBe(42);
    expect(current.武力).toBe(92);
    expect(getOpeningAbilityPointsRemaining(base, current, keys)).toBe(0);
  });

  it('normalizes an oversized payload before runtime state generation', () => {
    const normalized = normalizeOpeningAbilityAllocation(base, {
      ...base,
      武力: 99,
      统率: 99,
      机运: 88,
    }, keys);

    expect(normalized.武力).toBe(82);
    expect(normalized.统率).toBe(52);
    expect(normalized.机运).toBe(88);
    expect(getOpeningAbilityPointsRemaining(base, normalized, keys)).toBe(0);
  });

  it('does not spend the five-dimension budget on hidden abilities', () => {
    const current = adjustOpeningAbilityAllocation(base, { ...base, 机运: 99 }, keys, '机运', 1);

    expect(current.机运).toBe(99);
    expect(getOpeningAbilityPointsRemaining(base, current, keys)).toBe(30);
  });

  it('normalizes decreases before additions so recovered points do not depend on key order', () => {
    const normalized = normalizeOpeningAbilityAllocation(base, {
      ...base,
      武力: 99,
      统率: 99,
      智力: 1,
    }, keys);

    expect(normalized.武力).toBe(99);
    expect(normalized.统率).toBe(86);
    expect(normalized.智力).toBe(1);
    expect(getOpeningAbilityPointsRemaining(base, normalized, keys)).toBe(0);
  });
});
