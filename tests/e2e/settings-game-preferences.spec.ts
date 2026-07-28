import { expect, test } from '@playwright/test';

test('game settings exposes narrative render depth and reroll snapshot depth', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置' }).click();

  await expect(page.getByRole('heading', { name: '游戏设定' })).toBeVisible();
  await expect(page.getByLabel('渲染层数')).toHaveValue('30');
  await expect(page.getByLabel('回溯快照数量')).toHaveValue('10');
  await expect(page.getByText('用于重 ROLL 和修改最近回合输入')).toBeVisible();

  await page.getByLabel('回溯快照数量').fill('18');
  await expect(page.getByLabel('回溯快照数量')).toHaveValue('18');
});
