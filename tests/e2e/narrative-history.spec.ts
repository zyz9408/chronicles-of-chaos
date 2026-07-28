import { expect, type Page, test } from '@playwright/test';
import { installSuccessfulTurnApi, seedMainNarrativeApi } from './e2eStorage';

async function enterDebugGame(page: Page) {
  await installSuccessfulTurnApi(page);
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

async function submitAction(page: Page, action: string) {
  await page.locator('.input-row textarea').fill(action);
  await page.getByRole('button', { name: '执行行动' }).click();
}

test('narrative history gives every rendered turn its own header in chronological order', async ({ page }) => {
  await enterDebugGame(page);

  await submitAction(page, '第一步：去市集打听消息');
  await submitAction(page, '第二步：拜访县衙小吏');
  await submitAction(page, '第三步：回到客舍整理情报');

  const turns = page.getByTestId('narrative-turn');
  await expect(turns).toHaveCount(3);

  const titles = page.getByTestId('turn-display-title');
  await expect(titles).toHaveCount(3);
  await expect(titles.nth(0)).toContainText('1');
  await expect(titles.nth(1)).toContainText('2');
  await expect(titles.nth(2)).toContainText('3');

  const isAtBottom = await page.locator('.narrative-scroll').evaluate((element) => {
    return Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight - 2;
  });
  expect(isAtBottom).toBe(true);
});
