import { expect, type Page, test } from '@playwright/test';

async function enterDebugGame(page: Page) {
  await page.goto('/');
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

test('rollback restores the previous turn state and puts the last action back into the input box', async ({ page }) => {
  await enterDebugGame(page);

  await submitAction(page, '第一步：去市集打听消息');
  await submitAction(page, '第二步：拜访县衙小吏');

  await expect(page.getByTestId('narrative-turn')).toHaveCount(2);
  await expect(page.getByTestId('player-action-bubble')).toHaveCount(2);
  await expect(page.getByTestId('player-action-bubble').nth(1)).toContainText('第二步：拜访县衙小吏');

  await page.getByRole('button', { name: '回退上一轮' }).click();

  await expect(page.getByTestId('narrative-turn')).toHaveCount(1);
  await expect(page.locator('.input-row textarea')).toHaveValue('第二步：拜访县衙小吏');
  await expect(page.getByText('回合：1')).toBeVisible();
});

test('editing a historical action can cancel or resend from that turn snapshot', async ({ page }) => {
  await enterDebugGame(page);

  await submitAction(page, '第一步：去市集打听消息');
  await submitAction(page, '第二步：拜访县衙小吏');

  await expect(page.getByTestId('narrative-turn')).toHaveCount(2);

  await page.getByTestId('player-action-bubble').first().hover();
  await page.getByTestId('player-action-edit').first().click();
  await expect(page.getByTestId('player-action-editor')).toBeVisible();
  await page.getByTestId('player-action-edit-input').fill('第一步改写：先观察城门守卒');
  await page.getByTestId('player-action-cancel-edit').click();
  await expect(page.getByTestId('player-action-editor')).toHaveCount(0);
  await expect(page.getByTestId('player-action-bubble').first()).toContainText('第一步：去市集打听消息');

  await page.getByTestId('player-action-bubble').first().hover();
  await page.getByTestId('player-action-edit').first().click();
  await page.getByTestId('player-action-edit-input').fill('第一步改写：先观察城门守卒');
  await page.getByTestId('player-action-send-edit').click();

  await expect(page.getByTestId('narrative-turn')).toHaveCount(1);
  await expect(page.getByTestId('player-action-bubble')).toHaveCount(1);
  await expect(page.getByTestId('player-action-bubble').first()).toContainText('第一步改写：先观察城门守卒');
});
