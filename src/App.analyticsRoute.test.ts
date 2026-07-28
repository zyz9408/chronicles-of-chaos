import { describe, expect, it } from 'vitest';
import { resolveApplicationSurface } from './App';

describe('analytics application route', () => {
  it('keeps the private dashboard on an exact dedicated path', () => {
    expect(resolveApplicationSurface('/')).toBe('game');
    expect(resolveApplicationSurface('/admin/analytics')).toBe('admin-analytics');
    expect(resolveApplicationSurface('/admin/analytics/')).toBe('admin-analytics');
    expect(resolveApplicationSurface('/admin/analytics/extra')).toBe('game');
  });
});
