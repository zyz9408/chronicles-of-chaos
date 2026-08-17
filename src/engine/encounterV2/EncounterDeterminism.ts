import type {
  DeepReadonly,
  SealedEncounterResult,
  UnsealedEncounterResult,
} from './EncounterContracts';

const UINT32_RANGE = 0x1_0000_0000;
const FNV1A_32_OFFSET = 0x811c9dc5;
const FNV1A_32_PRIME = 0x01000193;
const FNV1A_64_OFFSET = 0xcbf29ce484222325n;
const FNV1A_64_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export interface EncounterRandomSnapshot {
  algorithm: 'fnv1a32-mulberry32-v1';
  seed: string;
  state: number;
  draws: number;
}

function hashSeedToUint32(seed: string): number {
  let hash = FNV1A_32_OFFSET;
  const bytes = new TextEncoder().encode(seed);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV1A_32_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export class SeededEncounterRandom {
  private state: number;
  private drawCount: number;
  private readonly seedValue: string;

  constructor(seed: string) {
    if (typeof seed !== 'string' || seed.length === 0) {
      throw new Error('seed 不能为空。');
    }
    this.seedValue = seed;
    this.state = hashSeedToUint32(seed);
    this.drawCount = 0;
  }

  get seed(): string {
    return this.seedValue;
  }

  get draws(): number {
    return this.drawCount;
  }

  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    this.drawCount += 1;
    return (value ^ (value >>> 14)) >>> 0;
  }

  nextIntInclusive(min: number, max: number): number {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
      throw new Error('min/max 必须是整数。');
    }
    if (min > max) throw new Error('min 必须小于或等于 max。');

    const span = max - min + 1;
    if (!Number.isSafeInteger(span) || span <= 0 || span > UINT32_RANGE) {
      throw new Error('min/max 范围不得超过 uint32。');
    }

    const rejectionLimit = Math.floor(UINT32_RANGE / span) * span;
    let draw = this.nextUint32();
    while (draw >= rejectionLimit) draw = this.nextUint32();
    return min + (draw % span);
  }

  snapshot(): Readonly<EncounterRandomSnapshot> {
    return Object.freeze({
      algorithm: 'fnv1a32-mulberry32-v1',
      seed: this.seedValue,
      state: this.state,
      draws: this.drawCount,
    });
  }

  static fromSnapshot(snapshot: EncounterRandomSnapshot): SeededEncounterRandom {
    if (snapshot.algorithm !== 'fnv1a32-mulberry32-v1') {
      throw new Error(`不支持的随机算法：${String(snapshot.algorithm)}。`);
    }
    if (typeof snapshot.seed !== 'string' || snapshot.seed.length === 0) {
      throw new Error('随机快照 seed 不能为空。');
    }
    if (!Number.isInteger(snapshot.state) || snapshot.state < 0 || snapshot.state >= UINT32_RANGE) {
      throw new Error('随机快照 state 必须是 uint32。');
    }
    if (!Number.isSafeInteger(snapshot.draws) || snapshot.draws < 0) {
      throw new Error('随机快照 draws 必须是非负整数。');
    }

    const random = new SeededEncounterRandom(snapshot.seed);
    random.state = snapshot.state >>> 0;
    random.drawCount = snapshot.draws;
    return random;
  }
}

function appendCanonicalObjectPath(path: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${path}.${key}`
    : `${path}[${JSON.stringify(key)}]`;
}

function canonicalError(message: string, path: string): Error {
  return new Error(`${message}路径：${path}。`);
}

function canonicalize(value: unknown, ancestors: WeakSet<object>, path: string): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw canonicalError('规范化只接受有限数字。', path);
    return JSON.stringify(value);
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw canonicalError('规范化只接受 JSON 安全值。', path);
  }

  if (ancestors.has(value)) throw canonicalError('规范化值包含循环引用。', path);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const parts: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw canonicalError('规范化只接受 JSON 安全值。', `${path}[${index}]`);
        }
        parts.push(canonicalize(value[index], ancestors, `${path}[${index}]`));
      }
      return `[${parts.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw canonicalError('规范化只接受普通 JSON 对象。', path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw canonicalError('规范化只接受 JSON 安全值。', path);
    }

    const objectValue = value as Record<string, unknown>;
    const keys = Object.keys(objectValue).sort();
    const entries = keys.map((key) => (
      `${JSON.stringify(key)}:${canonicalize(objectValue[key], ancestors, appendCanonicalObjectPath(path, key))}`
    ));
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function canonicalStringify(value: unknown): string {
  return canonicalize(value, new WeakSet<object>(), '$');
}

export function hashCanonicalValue(value: unknown): string {
  const bytes = new TextEncoder().encode(canonicalStringify(value));
  let hash = FNV1A_64_OFFSET;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV1A_64_PRIME) & UINT64_MASK;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function cloneCanonical<T>(value: T): T {
  return JSON.parse(canonicalStringify(value)) as T;
}

export function sealEncounterResult<T extends UnsealedEncounterResult>(result: T): SealedEncounterResult<T> {
  const cloned = cloneCanonical(result);
  const resultHash = hashCanonicalValue(cloned);
  return deepFreeze({ ...cloned, resultHash }) as SealedEncounterResult<T>;
}

export function verifyEncounterResultHash(result: SealedEncounterResult): boolean {
  const cloned = cloneCanonical(result) as Record<string, unknown>;
  const resultHash = cloned.resultHash;
  delete cloned.resultHash;
  return typeof resultHash === 'string' && hashCanonicalValue(cloned) === resultHash;
}
