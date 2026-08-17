import { expect, test, type Page } from '@playwright/test';

async function openMapFixture(page: Page) {
  await page.goto('/');

  await page.evaluate(async () => {
    const worldBookLoader = await import('/src/engine/worldbook/WorldBookLoader.ts');
    const startBookmarkResolver = await import('/src/engine/worldbook/StartBookmarkResolver.ts');
    const openingState = await import('/src/engine/state/createCustomOpeningState.ts');
    const saveManager = await import('/src/engine/save/SaveManager.ts');

    worldBookLoader.initWorldBookRegistry();
    const manifest = worldBookLoader.listWorldBooks()[0];
    const worldBook = worldBookLoader.getWorldBook(manifest.id);
    const bookmark = startBookmarkResolver.listStartBookmarks(worldBook)[0];
    await saveManager.clearAllSaves();

    const state = openingState.createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '地图投影验收',
      courtesyName: '校准',
      playerSex: '男',
      playerAge: 29,
      origin: '颍川游侠',
      birthOrigin: '寒门武人',
      currentIdentity: '游侠',
      locationId: 'place_yingchuan_yangdi',
      situationSummary: '地图坐标、底图切换与拖动验收。',
    });
    await saveManager.createSave(state, '地图投影验收存档');
  });

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByText('地图投影验收', { exact: true }).click();
  await page.getByTestId('right-menu-map').click();
  await expect(page.getByTestId('map-panel')).toBeVisible();
}

test('map uses exclusive bases and stable historical anchor directions', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openMapFixture(page);

  const panel = page.getByTestId('map-panel');
  const base = panel.getByTestId('map-historical-base-layer');
  await expect(base).toHaveAttribute('data-visual-state', 'ready');
  await expect(base).toHaveAttribute('data-base-mode', 'art');
  await expect(panel.locator('[data-render-role="geographic-base"]')).toHaveCount(0);

  const zoomIn = panel.getByRole('button', { name: '放大地图' });
  await zoomIn.click();
  await zoomIn.click();
  await zoomIn.click();
  await panel.getByRole('button', { name: '聚焦当前位置' }).click();
  await expect(panel.locator('.map-v2-zoom-level')).toHaveText('详图 12.0×');
  await expect(base).toHaveAttribute('data-base-mode', 'geographic');
  await expect(panel.locator('[data-render-role="geographic-base"]')).toHaveCount(1);
  await expect(panel.locator('.map-v2-base-map-art')).toHaveCSS('opacity', '0');

  const point = async (name: string) => {
    const marker = panel.getByRole('button', { name, exact: true });
    await expect(marker).toHaveCount(1);
    return marker.evaluate((element) => ({
      x: Number.parseFloat((element as HTMLElement).style.left),
      y: Number.parseFloat((element as HTMLElement).style.top),
    }));
  };
  const luoyang = await point('洛阳城');
  const hulao = await point('虎牢关');
  const hangu = await point('函谷关');
  const mengjin = await point('孟津渡口');
  const huanyuan = await point('轘辕关');
  const changshe = await point('长社');

  expect(hulao.x).toBeGreaterThan(luoyang.x);
  expect(hangu.x).toBeLessThan(luoyang.x);
  expect(mengjin.y).toBeLessThan(luoyang.y);
  expect(huanyuan.x).toBeGreaterThan(luoyang.x);
  expect(huanyuan.y).toBeGreaterThan(luoyang.y);
  expect(changshe.x).toBeGreaterThan(luoyang.x);
  expect(changshe.y).toBeGreaterThan(luoyang.y);

  const focusClusterCount = await panel.locator('.map-v2-marker').evaluateAll((markers) => (
    markers.reduce((sum, marker) => sum + Number(marker.getAttribute('data-cluster-count') ?? 0), 0)
  ));
  for (let index = 0; index < 6; index += 1) {
    if (await zoomIn.isDisabled()) break;
    await zoomIn.click();
  }
  await expect(panel.locator('.map-v2-zoom-level')).toHaveText('详图 24.0×');
  await expect(zoomIn).toBeDisabled();
  const maxClusterCount = await panel.locator('.map-v2-marker').evaluateAll((markers) => (
    markers.reduce((sum, marker) => sum + Number(marker.getAttribute('data-cluster-count') ?? 0), 0)
  ));
  expect(maxClusterCount).toBeLessThan(focusClusterCount);
  const markerDotSizes = await panel.locator('.map-v2-marker-dot').evaluateAll((dots) => (
    dots.map((dot) => {
      const rect = dot.getBoundingClientRect();
      return Math.max(rect.width, rect.height);
    })
  ));
  expect(Math.max(...markerDotSizes)).toBeLessThanOrEqual(18);

  const surface = panel.locator('.map-v2-map-surface');
  const canvas = panel.locator('.map-v2-canvas');
  const focusDelta = await panel.evaluate((element) => {
    const surfaceRect = element.querySelector('.map-v2-map-surface')?.getBoundingClientRect();
    const currentDotRect = element.querySelector('.map-v2-current-marker .map-v2-marker-dot')?.getBoundingClientRect();
    if (!surfaceRect || !currentDotRect) return undefined;
    return {
      x: (currentDotRect.x + (currentDotRect.width / 2)) - (surfaceRect.x + (surfaceRect.width / 2)),
      y: (currentDotRect.y + (currentDotRect.height / 2)) - (surfaceRect.y + (surfaceRect.height / 2)),
    };
  });
  expect(focusDelta).toBeDefined();
  expect(Math.abs(focusDelta!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(focusDelta!.y)).toBeLessThanOrEqual(2);
  const beforeDrag = await canvas.getAttribute('style');
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width * 0.55, box!.y + box!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.42, box!.y + box!.height * 0.42, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => canvas.getAttribute('style')).not.toBe(beforeDrag);
  await expect(base).toHaveAttribute('data-base-mode', 'geographic');
  expect(await panel.evaluate((element) => element.scrollWidth - element.clientWidth)).toBe(0);
});
