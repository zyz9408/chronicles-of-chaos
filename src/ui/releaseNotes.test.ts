import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  APP_VERSION_LABEL,
  CHANGELOG_DAILY_VIEW_KEY,
  RELEASE_NOTES,
  formatLocalDateKey,
  recordDailyReleaseNotesView,
  shouldShowDailyReleaseNotes,
} from './releaseNotes';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('releaseNotes', () => {
  it('starts the public changelog with one timed official-release feature entry', () => {
    expect(APP_VERSION).toBe('1.0.0');
    expect(APP_VERSION_LABEL).toBe('v1.0.0');
    expect(RELEASE_NOTES).toHaveLength(1);
    expect(RELEASE_NOTES[0]?.id).toBe('2026-07-27');
    expect(RELEASE_NOTES[0]?.date).toBe('2026年7月27日');
    expect(RELEASE_NOTES[0]?.updates).toHaveLength(1);

    const update = RELEASE_NOTES[0]?.updates[0];
    expect(update?.id).toBe('2026-07-27-v1.0.0-official-release');
    expect(update?.time).toBe('13:34');
    expect(update?.version).toBe('v1.0.0');
    expect(update?.title).toBe('游戏正式上线');
    expect(update?.items.join('')).toContain('1500 条');
    expect(`${update?.summary}${update?.items.join('')}`).not.toMatch(/匿名|统计|口令|收集|修复|测试|验收/);
  });

  it('offers the newest changelog once per local day', () => {
    const storage = new MemoryStorage();
    const morning = new Date(2026, 6, 27, 8, 30);

    expect(shouldShowDailyReleaseNotes(storage, morning)).toBe(true);
    recordDailyReleaseNotesView(storage, morning);
    expect(shouldShowDailyReleaseNotes(storage, new Date(2026, 6, 27, 22, 10))).toBe(false);
    expect(shouldShowDailyReleaseNotes(storage, new Date(2026, 6, 28, 0, 1))).toBe(true);
  });

  it('offers the changelog again when a newer update was added on the same day', () => {
    const storage = new MemoryStorage();
    storage.setItem(CHANGELOG_DAILY_VIEW_KEY, JSON.stringify({
      localDate: '2026-07-27',
      latestUpdateId: 'older-update',
    }));

    expect(shouldShowDailyReleaseNotes(storage, new Date(2026, 6, 27, 18, 0))).toBe(true);
  });

  it('uses the local calendar date instead of UTC rollover', () => {
    expect(formatLocalDateKey(new Date(2026, 6, 5, 23, 59))).toBe('2026-07-05');
  });
});
