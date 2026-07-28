import { describe, expect, it } from 'vitest';
import {
  COMBAT_RULESET_VERSION,
  ENCOUNTER_CONTRACT_VERSION,
  type UnsealedCombatResult,
} from './EncounterContracts';
import {
  SeededEncounterRandom,
  canonicalStringify,
  hashCanonicalValue,
  sealEncounterResult,
  verifyEncounterResultHash,
} from './EncounterDeterminism';

function createResult(): UnsealedCombatResult {
  return {
    contractVersion: ENCOUNTER_CONTRACT_VERSION,
    sessionId: 'session_hash_001',
    encounterId: 'encounter_hash_001',
    kind: 'personal_combat',
    rulesetVersion: COMBAT_RULESET_VERSION,
    sourceTurnNumber: 12,
    seed: 'encounter_hash_001:seed',
    resolvedAt: '2026-07-20T00:15:00.000Z',
    outcome: 'player_victory',
    elapsedMinutes: 15,
    actionLog: [],
    deltas: [],
    combatants: [
      { actorId: 'player_liuping', side: 'player', hp: 100, stamina: 100, downCount: 0, statuses: [] },
      { actorId: 'npc_enemy_guard', side: 'enemy', hp: 0, stamina: 20, downCount: 1, statuses: ['downed'] },
    ],
    experienceAward: 0,
    lootItemIds: [],
    capturedEquipmentItemIds: [],
  };
}

describe('EncounterDeterminism', () => {
  it('produces a stable golden sequence for the same seed', () => {
    const first = new SeededEncounterRandom('battle-seed-001');
    const second = new SeededEncounterRandom('battle-seed-001');

    const firstValues = Array.from({ length: 5 }, () => first.nextUint32());
    const secondValues = Array.from({ length: 5 }, () => second.nextUint32());

    expect(firstValues).toEqual(secondValues);
    expect(firstValues).toEqual([2679404007, 2468448958, 1506334648, 2013612320, 1326496105]);
  });

  it('restores an exact random stream from a snapshot', () => {
    const random = new SeededEncounterRandom('battle-seed-restore');
    random.nextUint32();
    random.nextUint32();
    const snapshot = random.snapshot();
    const expected = [random.nextUint32(), random.nextUint32(), random.nextUint32()];

    const restored = SeededEncounterRandom.fromSnapshot(snapshot);

    expect([restored.nextUint32(), restored.nextUint32(), restored.nextUint32()]).toEqual(expected);
    expect(restored.draws).toBe(5);
  });

  it('generates inclusive bounded integers and rejects invalid ranges', () => {
    const random = new SeededEncounterRandom('battle-seed-range');
    const values = Array.from({ length: 100 }, () => random.nextIntInclusive(-2, 2));

    expect(values.every((value) => Number.isInteger(value) && value >= -2 && value <= 2)).toBe(true);
    expect(() => random.nextIntInclusive(3, 2)).toThrow('min 必须小于或等于 max');
    expect(() => random.nextIntInclusive(0.5, 2)).toThrow('min/max 必须是整数');
  });

  it('canonicalizes object key order while preserving array order', () => {
    const left = { b: 2, a: { y: 2, x: 1 }, list: ['a', 'b'] };
    const reordered = { list: ['a', 'b'], a: { x: 1, y: 2 }, b: 2 };
    const changedArray = { list: ['b', 'a'], a: { x: 1, y: 2 }, b: 2 };

    expect(canonicalStringify(left)).toBe(canonicalStringify(reordered));
    expect(hashCanonicalValue(left)).toBe(hashCanonicalValue(reordered));
    expect(hashCanonicalValue(left)).not.toBe(hashCanonicalValue(changedArray));
  });

  it('rejects non-JSON-safe and circular canonical values', () => {
    expect(() => canonicalStringify({ invalid: Number.NaN })).toThrow('有限数字');
    expect(() => canonicalStringify({ invalid: undefined })).toThrow('JSON 安全值');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => canonicalStringify(circular)).toThrow('循环引用');
  });

  it('seals a deeply frozen immutable result and detects tampering', () => {
    const source = createResult();
    const sealed = sealEncounterResult(source);

    expect(sealed.resultHash).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(verifyEncounterResultHash(sealed)).toBe(true);
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.deltas)).toBe(true);
    expect(Object.isFrozen(sealed.combatants)).toBe(true);

    const tampered = JSON.parse(JSON.stringify(sealed)) as typeof sealed;
    Object.defineProperty(tampered, 'elapsedMinutes', { value: 30, writable: true });
    expect(verifyEncounterResultHash(tampered)).toBe(false);
  });
});
