import { describe, expect, it } from 'vitest';
import { formatCurrency } from './currency';

describe('currency', () => {
  it('formats base copper coins without converting them into gold', () => {
    expect(formatCurrency(45)).toBe('45钱');
    expect(formatCurrency(1200)).toBe('1贯200钱');
    expect(formatCurrency(23045)).toBe('23贯45钱');
    expect(formatCurrency(10000)).toBe('10贯');
    expect(formatCurrency(10000)).not.toContain('金');
  });

  it('keeps zero visible instead of producing an empty money label', () => {
    expect(formatCurrency(0)).toBe('0钱');
  });
});
