export function hasPersistenceValueChanged(left: unknown, right: unknown): boolean {
  if (left === right) return false;
  const pending: Array<[unknown, unknown]> = [[left, right]];
  const leftToRight = new WeakMap<object, object>();
  const rightToLeft = new WeakMap<object, object>();

  while (pending.length > 0) {
    const pair = pending.pop();
    if (!pair) break;
    const [leftValue, rightValue] = pair;
    if (leftValue === rightValue
      && (leftValue === null || (typeof leftValue !== 'object' && typeof leftValue !== 'function'))) {
      continue;
    }
    if (typeof leftValue !== typeof rightValue || leftValue === null || rightValue === null) {
      return true;
    }
    if (typeof leftValue !== 'object' || typeof rightValue !== 'object') return true;

    const leftObject = leftValue as object;
    const rightObject = rightValue as object;
    const leftSeen = leftToRight.has(leftObject);
    const rightSeen = rightToLeft.has(rightObject);
    if (leftSeen || rightSeen) {
      if (!leftSeen || !rightSeen
        || leftToRight.get(leftObject) !== rightObject
        || rightToLeft.get(rightObject) !== leftObject) {
        return true;
      }
      continue;
    }
    leftToRight.set(leftObject, rightObject);
    rightToLeft.set(rightObject, leftObject);
    if (leftObject === rightObject) continue;

    const leftIsArray = Array.isArray(leftValue);
    if (leftIsArray !== Array.isArray(rightValue)) return true;
    if (leftIsArray && leftValue.length !== (rightValue as unknown[]).length) return true;
    if (leftValue instanceof Date || rightValue instanceof Date) {
      if (!(leftValue instanceof Date) || !(rightValue instanceof Date)) return true;
      if (leftValue.getTime() !== rightValue.getTime()) return true;
      continue;
    }

    const leftRecord = leftValue as Record<string, unknown>;
    const rightRecord = rightValue as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return true;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) return true;
      pending.push([leftRecord[key], rightRecord[key]]);
    }
  }

  return false;
}
