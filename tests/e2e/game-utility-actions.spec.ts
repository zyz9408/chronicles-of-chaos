import { expect, test } from '@playwright/test';
import { seedMainNarrativeApi } from './e2eStorage';

async function startDebugGame(page: import('@playwright/test').Page) {
  await seedMainNarrativeApi(page);
  await page.getByRole('button', { name: '新的征程' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByRole('button', { name: /宗室支脉/ }).click();
  await page.getByRole('button', { name: /在野士人/ }).click();
  // DEBUG 直接开局按钮已从 UI 移除，改用代码层暴露的 window.__cocDebugStart
  await page.evaluate(() => (window as unknown as { __cocDebugStart: () => Promise<void> }).__cocDebugStart());
  await expect(page.locator('.game-frame')).toBeVisible();
}

test('game screen opens save, load, and settings from the right-side utility area', async ({ page }) => {
  await startDebugGame(page);

  const utilityArea = page.getByTestId('game-utility-actions');
  await expect(utilityArea).toBeVisible();
  await expect(utilityArea.getByRole('button')).toHaveText(['保存进度', '读取进度', '设置']);

  await page.getByTestId('game-save-progress').click();
  let saveModal = page.locator('.save-modal');
  await expect(page.getByRole('heading', { name: '风云入卷' })).toBeVisible();
  await expect(saveModal.locator('.save-modal-actions').getByRole('button')).toHaveText(['保存进度']);
  const saveManualSection = saveModal.locator('.save-section').filter({ hasText: '手动存档' });
  await expect(saveManualSection).toContainText('暂无手动存档');
  await saveModal.locator('.save-modal-actions').getByRole('button', { name: '保存进度' }).click();
  await expect(page.getByText('当前进度已保存到手动存档。')).toBeVisible();
  await expect(saveManualSection).toContainText('无名氏');
  await saveManualSection.locator('.save-item-delete').first().click();
  await expect(page.getByText('确定要删除这个存档吗？此操作不可恢复。')).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await page.locator('.save-modal-head .save-modal-close').click();

  await page.getByTestId('game-load-progress').click();
  saveModal = page.locator('.save-modal');
  await expect(page.getByRole('heading', { name: '兵戈再起' })).toBeVisible();
  await expect(page.getByText('读取已有存档，继续当前乱世。')).toBeVisible();
  const loadManualSection = saveModal.locator('.save-section').filter({ hasText: '手动存档' });
  await expect(loadManualSection).toContainText('无名氏');
  await loadManualSection.locator('.save-item-delete').first().click();
  await expect(page.getByText('确定要删除这个存档吗？此操作不可恢复。')).toBeVisible();
  await page.getByRole('button', { name: '确认删除' }).click();
  await expect(loadManualSection).toContainText('暂无手动存档');
  await page.locator('.save-modal-head .save-modal-close').click();

  await page.getByTestId('game-open-settings').click();
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
  await expect(page.getByRole('button', { name: '游戏设定' })).toBeVisible();
});
