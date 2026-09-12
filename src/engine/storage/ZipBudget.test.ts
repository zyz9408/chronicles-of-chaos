import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { createZipBudgetFilter } from './ZipBudget';

describe('ZIP expansion budgets', () => {
  it('rejects excessive cumulative expansion before returning any entries', () => {
    const zip = zipSync({ 'a.bin': new Uint8Array(1024), 'b.bin': new Uint8Array(1024) });
    expect(() => unzipSync(zip, { filter: createZipBudgetFilter(1500, 10) })).toThrow('安全上限');
    expect(() => unzipSync(zip, { filter: createZipBudgetFilter(4096, 1) })).toThrow('安全上限');
    expect(() => unzipSync(zip, { filter: createZipBudgetFilter(4096, 10, 512) })).toThrow('安全上限');
  });
  it('rejects duplicate and unsafe paths', () => {
    const filter = createZipBudgetFilter(1000, 10);
    filter({ name: 'manifest.json', originalSize: 1 });
    expect(() => filter({ name: 'manifest.json', originalSize: 1 })).toThrow('重复');
    expect(() => filter({ name: '../secret', originalSize: 1 })).toThrow('非法');
  });
});
