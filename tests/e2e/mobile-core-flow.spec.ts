import { expect, test, type Locator, type Page } from '@playwright/test';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function startDebugGame(page: Page): Promise<void> {
  await page.setViewportSize(MOBILE_VIEWPORT);
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

async function expectWithinViewport(locator: Locator): Promise<void> {
  let box: Awaited<ReturnType<Locator['boundingBox']>> = null;
  await expect.poll(async () => {
    box = await locator.boundingBox();
    return box;
  }).not.toBeNull();
  if (!box) throw new Error('Visible panel did not expose a viewport box.');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);
  expect(box.y + box.height).toBeLessThanOrEqual(MOBILE_VIEWPORT.height);
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual({ clientWidth: MOBILE_VIEWPORT.width, scrollWidth: MOBILE_VIEWPORT.width });
}

async function expectMapLabelsNotToOverlap(mapPanel: Locator): Promise<void> {
  await expect.poll(() => mapPanel.locator('.map-v2-marker strong').evaluateAll((nodes) => {
    const rects = nodes
      .map((node) => node.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);
    let overlaps = 0;
    for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
        const left = rects[leftIndex];
        const right = rects[rightIndex];
        if (
          Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
          && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
        ) {
          overlaps += 1;
        }
      }
    }
    return overlaps;
  })).toBe(0);
}

test('390x844 core flow uses explicit regions and keeps narrative, settings, saves, NPCs, and map reachable', async ({ page }) => {
  await startDebugGame(page);

  const regionSwitcher = page.getByTestId('mobile-region-switcher');
  await expect(regionSwitcher).toBeVisible();
  await expect(page.locator('.game-panel-center')).toBeVisible();
  await expect(page.locator('.game-panel-left')).toBeHidden();
  await expect(page.locator('.game-panel-right')).toBeHidden();
  await expect(page.locator('.narrative-scroll .context-box')).toContainText('时代背景');
  const actionInput = page.getByPlaceholder(/输入你的行动/);
  await actionInput.fill('巡视营地并整顿军纪');
  await expect(actionInput).toHaveValue('巡视营地并整顿军纪');
  await expectNoDocumentHorizontalOverflow(page);

  await page.getByTestId('mobile-region-profile').click();
  await expect(page.locator('.game-panel-left')).toBeVisible();
  await expect(page.getByTestId('player-profile-entry')).toBeVisible();

  await page.getByTestId('mobile-region-systems').click();
  await expect(page.locator('.game-panel-right')).toBeVisible();
  await expect(page.locator('.game-panel-center')).toBeHidden();
  await expect(page.getByTestId('game-utility-actions')).toBeVisible();
  await expectNoDocumentHorizontalOverflow(page);

  await page.getByTestId('game-open-settings').click();
  const settingsModal = page.locator('.settings-modal');
  await expect(settingsModal).toBeVisible();
  await expectWithinViewport(settingsModal);
  await page.getByRole('button', { name: 'API 配置', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'API 配置中心' })).toBeVisible();
  await page.getByRole('button', { name: '新建 API' }).click();
  await expect(page.getByRole('button', { name: '保存 API 配置' })).toBeVisible();
  await page.getByRole('button', { name: '游戏设定' }).click();
  await expect(page.getByLabel('渲染层数')).toBeVisible();
  await page.getByRole('button', { name: '关闭设置' }).click();

  await page.getByTestId('game-save-progress').click();
  let saveModal = page.locator('.save-modal');
  await expect(saveModal).toBeVisible();
  await expectWithinViewport(saveModal);
  await expect(saveModal.locator('.save-section').filter({ hasText: '手动存档' })).toBeVisible();
  await saveModal.getByRole('button', { name: '保存进度' }).click();
  await expect(page.getByText('当前进度已保存到手动存档。')).toBeVisible();
  await saveModal.locator('.save-modal-close').click();

  await page.getByTestId('game-load-progress').click();
  saveModal = page.locator('.save-modal');
  await expect(saveModal).toBeVisible();
  await expectWithinViewport(saveModal);
  await expect(saveModal.locator('.save-section').filter({ hasText: '手动存档' }).locator('.save-item').first()).toBeVisible();
  await expect(saveModal.getByRole('button', { name: '读取最近存档' })).toBeEnabled();
  await saveModal.locator('.save-modal-close').click();

  await page.getByTestId('right-menu-npcs').click();
  const npcPanel = page.getByTestId('npc-panel');
  await expect(npcPanel).toBeVisible();
  await expectWithinViewport(npcPanel);
  await expect(npcPanel.getByText(/已记录|暂无已记录人物/).first()).toBeVisible();
  await npcPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-map').click();
  const mapPanel = page.getByTestId('map-panel');
  await expect(mapPanel).toBeVisible();
  await expectWithinViewport(mapPanel);
  await expect(mapPanel.locator('.map-v2-map-surface')).toBeVisible();
  await expect(mapPanel.getByRole('button', { name: '聚焦当前位置' })).toBeVisible();
  await expectMapLabelsNotToOverlap(mapPanel);
  await expect.poll(async () => {
    const stage = await mapPanel.locator('.map-v2-national-stage').boundingBox();
    const side = await mapPanel.locator('.map-v2-side').boundingBox();
    const toolbar = await mapPanel.locator('.map-v2-toolbar').boundingBox();
    const surface = await mapPanel.locator('.map-v2-map-surface').boundingBox();
    return Boolean(
      stage
      && side
      && toolbar
      && surface
      && stage.y < side.y
      && toolbar.y + toolbar.height <= surface.y
    );
  }).toBe(true);
  await expect.poll(() => mapPanel.locator('.map-v2-side').evaluate((element) => (
    element.clientHeight === element.scrollHeight
  ))).toBe(true);
  await mapPanel.getByRole('button', { name: '聚焦当前位置' }).click();
  await expect(mapPanel.locator('.map-v2-zoom-level')).toHaveText('详图 12.0×');
  await expectMapLabelsNotToOverlap(mapPanel);
  await expectNoDocumentHorizontalOverflow(page);
  await mapPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('mobile-region-narrative').click();
  await expect(page.locator('.game-panel-center')).toBeVisible();
  await expect(actionInput).toHaveValue('巡视营地并整顿军纪');
  await expectNoDocumentHorizontalOverflow(page);
});
