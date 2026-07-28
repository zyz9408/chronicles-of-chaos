import { describe, expect, it } from 'vitest';
import { formatCurrency } from './currency';

describe('currency', () => {
  it('formats base copper coins into generic money, string, and gold units', () => {
    expect(formatCurrency(45)).toBe('45钱');
    expect(formatCurrency(1200)).toBe('1贯200钱');
    expect(formatCurrency(23045)).toBe('2金3贯45钱');
  });

  it('keeps zero visible instead of producing an empty money label', () => {
    expect(formatCurrency(0)).toBe('0钱');
  });
});
