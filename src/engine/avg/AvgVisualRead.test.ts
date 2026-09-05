import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAvgVisualWithDeadline } from './AvgVisualRead';

afterEach(() => vi.useRealTimers());

describe('bounded AVG visual reads', () => {
  it('returns successful reads and clears the deadline', async () => {
    vi.useFakeTimers();
    await expect(readAvgVisualWithDeadline(async () => 'image')).resolves.toBe('image');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports stalled reads and stops subsequent fallback requests after timeout', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const fallback = vi.fn();
    const read = readAvgVisualWithDeadline(async (signal) => {
      await new Promise<void>((resolve) => { release = resolve; });
      signal.throwIfAborted();
      fallback();
    });
    const assertion = expect(read).rejects.toThrow('AVG 图片读取超时');
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    release();
    await Promise.resolve();
    expect(fallback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels obsolete frame reads immediately and never starts an already cancelled read', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const read = readAvgVisualWithDeadline(() => new Promise(() => undefined), { signal: controller.signal });
    const assertion = expect(read).rejects.toThrow('切换回合');
    controller.abort(new Error('切换回合'));
    await assertion;
    const obsolete = vi.fn();
    await expect(readAvgVisualWithDeadline(obsolete, { signal: controller.signal })).rejects.toThrow('切换回合');
    expect(obsolete).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates read failures and handles late rejections without changing the timeout result', async () => {
    await expect(readAvgVisualWithDeadline(async () => { throw new Error('读取失败'); })).rejects.toThrow('读取失败');
    vi.useFakeTimers();
    let fail!: (error: Error) => void;
    const read = readAvgVisualWithDeadline(() => new Promise((_resolve, reject) => { fail = reject; }));
    const assertion = expect(read).rejects.toThrow('超时');
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    fail(new Error('迟到失败'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });
});
