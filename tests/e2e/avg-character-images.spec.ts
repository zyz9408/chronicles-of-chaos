import { expect, test, type Page } from '@playwright/test';
import { assertE2eStorageIsolation } from './e2eStorage';

async function mountStage(page: Page, setup = true) {
  await page.goto('/');
  await assertE2eStorageIsolation(page);
  await page.evaluate(async (setupProfile) => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ default: React }, { default: ReactDOM }, { AvgNarrativeStage }, profiles] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/ui/AvgNarrativeStage.tsx'), load('/src/engine/avg/AvgImageGenerationProfiles.ts'),
    ]);
    if (setupProfile) {
      await new profiles.IndexedDbAvgImageGenerationProfileRepository().saveProfile({
        ...profiles.createAvgImageGenerationProfile(), id: 'test-images', name: '测试图片服务',
        baseUrl: 'https://images.example.test/v1', model: 'test-model', size: '1024x1536',
      }, 'test-key');
    }
    const state = {
      player: { id: 'player', name: '彭亮', sex: '男', age: 18, roleType: '流亡者' },
      worldBookId: 'threeKingdoms', currentDate: '公元184年03月01日', currentLocationId: '襄阳', currentPlaceId: '集市',
      knownActors: [{ id: 'guan-yu', name: '关羽', sex: '男', age: 25, roleType: '武将' }],
      npcs: ['甲', '乙'].map((suffix, index) => ({ npcId: `guard-${index}`, name: `差役${suffix}`, sex: '男', age: 30, role: '差役', isPresent: true, isFocused: false })),
      avgPresentation: { visualPartitionId: 'test-avg-partition' },
    };
    document.getElementById('root')!.hidden = true;
    const host = document.createElement('div');
    host.id = 'avg-test-host'; host.style.padding = '16px'; document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(AvgNarrativeStage, {
      entryKey: 'test-turn', narrativeText: '【旁白】市集晨雾散去。\n【差役甲】来者何人？\n【差役乙】请出示凭证。\n【关羽】在下关羽。',
      runtimeState: state, saveId: 'test-save', worldBookId: 'threeKingdoms', playerPortraitMode: 'hidden', onReturnClassic: () => undefined,
    }));
  }, setup);
  await expect(page.getByTestId('avg-narrative-stage')).toBeVisible();
}

async function imageResponse(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 300; canvas.height = 480;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#566878'; context.fillRect(65, 150, 170, 320);
    context.fillStyle = '#d4b58c'; context.beginPath(); context.arc(150, 95, 55, 0, Math.PI * 2); context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
}

async function readVisuals(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/engine/avg/AvgVisualOverrideRepository.ts';
    const { IndexedDbAvgVisualOverrideRepository } = await import(/* @vite-ignore */ path);
    const snapshot = await new IndexedDbAvgVisualOverrideRepository().exportPartition('test-avg-partition');
    return { actorCount: snapshot.actorCount, records: snapshot.records, assets: snapshot.assets.length };
  });
}

test('homepage buttons generate, preview, bind, reuse and persist character pictures', async ({ page }) => {
  await mountStage(page);
  let requests = 0;
  const image = await imageResponse(page);
  await page.route('https://images.example.test/v1/images/generations', async (route) => {
    requests += 1;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: image }] }) });
  });
  const buttons = page.getByRole('group', { name: 'AVG 图片生成' });
  await expect(buttons.getByRole('button')).toHaveText(['生成候选图', '生成人物图']);
  await buttons.getByRole('button', { name: '生成候选图', exact: true }).click();
  const visuals = page.getByRole('dialog', { name: 'AVG 视觉管理' });
  await expect(visuals.getByLabel('AI 候选图提示词')).toContainText('无人物场景背景');
  await visuals.getByRole('button', { name: '关闭视觉管理' }).click();

  await buttons.getByRole('button', { name: '生成人物图', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '生成人物图', exact: true });
  await dialog.getByLabel('生成图片的人物').selectOption('guard-0');
  await expect(dialog.getByLabel('特殊人物专属绑定')).not.toBeChecked();
  expect(requests).toBe(0);
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await expect(dialog.getByAltText(/AI 候选图预览/)).toBeVisible();
  expect((await readVisuals(page)).actorCount).toBe(0);
  await dialog.getByRole('button', { name: '应用并加入 AVG 图库' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役甲');
  const stored = await readVisuals(page);
  expect(stored.records.filter((record: { portraitScope?: string }) => record.portraitScope === 'adaptive-candidate')).toHaveLength(1);
  await page.getByRole('button', { name: '→', exact: true }).click();
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役乙');
  await expect.poll(async () => (await readVisuals(page)).actorCount).toBe(2);
  expect(requests).toBe(1);

  await page.getByRole('button', { name: '→', exact: true }).click();
  await buttons.getByRole('button', { name: '生成人物图', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '生成人物图', exact: true });
  await expect(dialog.getByLabel('生成图片的人物')).toHaveValue('guan-yu');
  await expect(dialog.getByLabel('特殊人物专属绑定')).toBeChecked();
  await expect(dialog.getByLabel('特殊人物专属绑定')).toBeDisabled();
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await expect(dialog.getByAltText(/AI 候选图预览/)).toBeVisible();
  await dialog.getByRole('button', { name: '应用并加入 AVG 图库' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await readVisuals(page)).records.filter((record: { portraitScope?: string }) => record.portraitScope === 'adaptive-candidate')).toHaveLength(1);

  await mountStage(page, false);
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役甲');
  await page.getByRole('button', { name: '→', exact: true }).click();
  await expect(page.locator('.avg-stage-portrait img')).toHaveAttribute('alt', '差役乙');
  expect(requests).toBe(2);
  const libraryData = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ default: React }, { default: ReactDOM }, { AvgPortraitLibraryPanel }, { IndexedDbAvgVisualOverrideRepository }] = await Promise.all([
      load('/node_modules/.vite/deps/react.js'), load('/node_modules/.vite/deps/react-dom_client.js'),
      load('/src/ui/AvgPortraitLibraryPanel.tsx'), load('/src/engine/avg/AvgVisualOverrideRepository.ts'),
    ]);
    const snapshot = await new IndexedDbAvgVisualOverrideRepository().exportPartition('test-avg-partition');
    const host = document.createElement('div'); document.body.append(host);
    ReactDOM.createRoot(host).render(React.createElement(AvgPortraitLibraryPanel, { snapshot, state: {
      worldBookId: 'threeKingdoms', player: { id: 'player', name: '彭亮' }, knownActors: [{ id: 'guan-yu', name: '关羽' }],
      npcs: [{ npcId: 'guard-0', name: '差役甲' }, { npcId: 'guard-1', name: '差役乙' }],
    } }));
    return snapshot.actorCount;
  });
  expect(libraryData).toBe(3);
  await expect(page.getByRole('region', { name: 'AVG 人物图库' })).toContainText('已绑定 3 人 · 通用人物图 1 张');
  await expect(page.getByRole('region', { name: 'AVG 人物图库' }).getByRole('img')).toHaveCount(3);
  await page.screenshot({ path: 'output/playwright/avg-character-library-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(buttons.getByRole('button', { name: '生成人物图', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'output/playwright/avg-character-library-mobile.png', fullPage: true });
});

test('failed and cancelled image requests keep existing pictures and do not create bindings', async ({ page }) => {
  await mountStage(page);
  const picture = await imageResponse(page);
  await page.evaluate(async (base64) => {
    const path = '/src/engine/avg/AvgVisualOverrideRepository.ts';
    const { IndexedDbAvgVisualOverrideRepository, createAvgActorTarget, validateAvgImage } = await import(/* @vite-ignore */ path);
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    await new IndexedDbAvgVisualOverrideRepository().replace(createAvgActorTarget('test-avg-partition', 'threeKingdoms', 'guard-0'), await validateAvgImage(blob));
  }, picture);
  const before = await readVisuals(page);
  await page.route('https://images.example.test/v1/images/generations', async (route) => {
    await route.fulfill({ status: 401, body: '{}' });
  });
  await page.getByRole('button', { name: '生成人物图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '生成人物图', exact: true });
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('鉴权失败');
  expect(await readVisuals(page)).toEqual(before);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('https://images.example.test/v1/images/generations', async (route) => {
    await gate;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: picture }] }) }).catch(() => undefined);
  });
  const requestStarted = page.waitForRequest('https://images.example.test/v1/images/generations');
  await dialog.getByRole('button', { name: '生成候选图', exact: true }).click();
  await requestStarted;
  await dialog.getByRole('button', { name: '取消生成' }).click();
  await expect(dialog.getByRole('status')).toContainText('已取消');
  release();
  expect(await readVisuals(page)).toEqual(before);
  await expect(dialog.getByRole('button', { name: '应用并加入 AVG 图库' })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭人物图生成' }).click();
  await expect(dialog).toHaveCount(0);
});
