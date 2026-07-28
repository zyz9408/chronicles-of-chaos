import { describe, expect, it } from 'vitest';
import { hasPersistenceValueChanged } from './persistenceChange';

function makeDeepValue(depth: number, leaf: string): unknown {
  let value: unknown = { leaf };
  for (let index = depth - 1; index >= 0; index -= 1) {
    value = { index, child: value };
  }
  return value;
}

describe('persistence changed detection', () => {
  it('compares equal 5000-level persistence values without recursion', () => {
    const left = makeDeepValue(5000, 'same');
    const right = makeDeepValue(5000, 'same');

    expect(() => hasPersistenceValueChanged(left, right)).not.toThrow();
    expect(hasPersistenceValueChanged(left, right)).toBe(false);
  });

  it('detects deep value changes and missing fields without recursion', () => {
    const left = makeDeepValue(5000, 'left');
    const right = makeDeepValue(5000, 'right');

    expect(hasPersistenceValueChanged(left, right)).toBe(true);
    expect(hasPersistenceValueChanged({ value: undefined }, {})).toBe(true);
    expect(hasPersistenceValueChanged([1, 2], [2, 1])).toBe(true);
  });

  it('compares sparse array length explicitly', () => {
    expect(hasPersistenceValueChanged(new Array(2), new Array(3))).toBe(true);
    expect(hasPersistenceValueChanged(new Array(3), new Array(3))).toBe(false);
  });

  it('treats a sparse slot and an explicit undefined slot as different IndexedDB shapes', () => {
    const sparse = new Array(1);
    const explicitUndefined = [undefined];

    expect(0 in sparse).toBe(false);
    expect(0 in explicitUndefined).toBe(true);
    expect(hasPersistenceValueChanged(sparse, explicitUndefined)).toBe(true);
  });

  it('conservatively changes a one-node cycle compared with a two-node cycle', () => {
    const oneNode: { next?: unknown } = {};
    oneNode.next = oneNode;
    const first: { next?: unknown } = {};
    const second: { next?: unknown } = {};
    first.next = second;
    second.next = first;

    expect(hasPersistenceValueChanged(oneNode, first)).toBe(true);
  });

  it('compares isomorphic shared-reference graphs as unchanged', () => {
    const leftShared = { value: 1 };
    const left = { first: leftShared, second: leftShared };
    const rightDifferentTopology = { first: { value: 1 }, second: { value: 1 } };
    const rightShared = { value: 1 };
    const rightSameTopology = { first: rightShared, second: rightShared };

    expect(hasPersistenceValueChanged(left, rightDifferentTopology)).toBe(true);
    expect(hasPersistenceValueChanged(left, rightSameTopology)).toBe(false);
  });

  it('compares distinct isomorphic one-node cycles as unchanged', () => {
    const left: { next?: unknown } = {};
    const right: { next?: unknown } = {};
    left.next = left;
    right.next = right;

    expect(hasPersistenceValueChanged(left, right)).toBe(false);
  });

  it('compares distinct isomorphic two-node cycles as unchanged', () => {
    const leftFirst: { next?: unknown } = {};
    const leftSecond: { next?: unknown } = {};
    leftFirst.next = leftSecond;
    leftSecond.next = leftFirst;
    const rightFirst: { next?: unknown } = {};
    const rightSecond: { next?: unknown } = {};
    rightFirst.next = rightSecond;
    rightSecond.next = rightFirst;

    expect(hasPersistenceValueChanged(leftFirst, rightFirst)).toBe(false);
  });

  it('detects partial shared-reference topology in both directions', () => {
    const shared = { value: 1 };
    const fullyShared = { first: shared, second: shared };
    const partiallyShared = { first: shared, second: { value: 1 } };

    expect(hasPersistenceValueChanged(fullyShared, partiallyShared)).toBe(true);
    expect(hasPersistenceValueChanged(partiallyShared, fullyShared)).toBe(true);
  });

  it('treats the exact same cyclic reference as unchanged', () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(hasPersistenceValueChanged(value, value)).toBe(false);
  });
});
