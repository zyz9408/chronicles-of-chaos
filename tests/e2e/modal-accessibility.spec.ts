import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedMainNarrativeApi } from './e2eStorage';

async function startDebugGame(page: Page): Promise<void> {
  await seedMainNarrativeApi(page);
  await page.getByRole('button', { name: '新的征程' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.locator('.game-frame')).toBeVisible();
}

async function expectModalKeyboardBoundary(page: Page, dialog: Locator, opener: Locator): Promise<void> {
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await expect.poll(() => opener.evaluate((element) => Boolean(element.closest('[inert]')))).toBe(true);

  const focusable = dialog.locator(
    'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  await expect.poll(() => focusable.count()).toBeGreaterThan(1);

  await focusable.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(focusable.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
}

test('start-screen settings traps focus, inerts the menu, closes on Escape, and restores its opener', async ({ page }) => {
  await page.goto('/');
  const opener = page.locator('.main-menu .menu-btn').filter({ hasText: '设置' });
  await opener.click();

  const dialog = page.getByRole('dialog', { name: '设置' });
  await expectModalKeyboardBoundary(page, dialog, opener);
  await page.keyboard.press('Escape');

  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('in-game settings and map share the keyboard boundary and restore their own openers', async ({ page }) => {
  await startDebugGame(page);

  const settingsOpener = page.getByTestId('game-open-settings');
  await settingsOpener.click();
  const settingsDialog = page.getByRole('dialog', { name: '设置' });
  await expectModalKeyboardBoundary(page, settingsDialog, settingsOpener);
  await page.keyboard.press('Escape');
  await expect(settingsDialog).toBeHidden();
  await expect(settingsOpener).toBeFocused();

  const mapOpener = page.getByTestId('right-menu-map');
  await mapOpener.click();
  const mapDialog = page.getByRole('dialog', { name: '地图' });
  await expectModalKeyboardBoundary(page, mapDialog, mapOpener);
  await page.keyboard.press('Escape');
  await expect(mapDialog).toBeHidden();
  await expect(mapOpener).toBeFocused();
});
