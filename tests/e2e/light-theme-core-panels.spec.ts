import { expect, test, type Locator, type Page } from '@playwright/test';

const LIGHT_THEME_STORAGE_KEY = 'coc_v2_color_theme';

async function expectLightSurface(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const channels = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    const effectiveBackground = channels(style.backgroundColor);
    const alpha = effectiveBackground[3] ?? 1;
    return {
      background: effectiveBackground.slice(0, 3).map((value) => (value * alpha) + (248 * (1 - alpha))),
      foreground: channels(style.color).slice(0, 3),
    };
  });
  expect(colors.background).toHaveLength(3);
  expect(colors.foreground).toHaveLength(3);
  expect(colors.background.reduce((sum, value) => sum + value, 0) / 3).toBeGreaterThan(180);
  expect(colors.foreground.reduce((sum, value) => sum + value, 0) / 3).toBeLessThan(150);
}

async function expectNoHorizontalOverflow(locator: Locator): Promise<void> {
  const overflow = await locator.evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function openLightThemeFixture(page: Page): Promise<void> {
  await page.route('**/api/cloud/auth/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({
        ok: true,
        configured: false,
        authConfigured: false,
        authenticated: false,
        limits: {
          globalBytes: 0,
          userBytes: 0,
          uploadBytes: 0,
          slots: 0,
          dailyUploads: 0,
          userDailyUploads: 0,
        },
      }),
    });
  });
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, 'light');
  }, LIGHT_THEME_STORAGE_KEY);
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
      playerName: '亮色面板验收',
      courtesyName: '宣明',
      playerSex: '男',
      playerAge: 28,
      origin: '地方军吏',
      birthOrigin: '寒门武人',
      currentIdentity: '军中从事',
      locationId: 'place_yingchuan_yangdi',
      situationSummary: '亮色人物志、背包、地图、局势与永久提示词验收。',
      inventory: [
        {
          id: 'light_theme_token',
          name: '行军令符',
          quantity: 1,
          category: 'token',
          quality: '珍贵',
          description: '验收亮色背包品质色与纸面承载层。',
        },
      ],
      personalMoney: 2800,
    });
    state.npcs = [
      {
        npcId: 'npc_light_theme',
        name: '陈明',
        courtesyName: '仲达',
        sex: '男',
        age: 34,
        role: '军中主簿',
        currentIdentity: '行军主簿',
        factionName: '汉军',
        isPresent: true,
        isFocused: true,
        relationToPlayer: '同营共事',
        contactLevel: 24,
        recentAttitude: '愿意协助清点军资',
        memories: [],
        traits: [],
        effects: [],
      },
    ];
    await saveManager.createSave(state, '亮色面板验收存档');
  });

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByText('亮色面板验收', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-coc-theme', 'light');
}

test('light theme reaches NPC, backpack, map, situation, and persistent-prompt workspaces', async ({ page }) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      const source = message.location().url;
      browserErrors.push(source ? `${message.text()} @ ${source}` : message.text());
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await openLightThemeFixture(page);

  await page.getByTestId('right-menu-npcs').click();
  const npcPanel = page.getByTestId('npc-panel');
  await expectLightSurface(npcPanel.locator('.npc-roster-panel'));
  await expectLightSurface(npcPanel.locator('.npc-roster-card').first());
  await npcPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-backpack').click();
  const backpackPanel = page.getByTestId('backpack-panel');
  await expectLightSurface(backpackPanel.locator('.backpack-sidebar'));
  await expectLightSurface(backpackPanel.locator('.backpack-item-card').first());
  await backpackPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-map').click();
  const mapPanel = page.getByTestId('map-panel');
  await expectLightSurface(mapPanel.locator('.map-v2-side'));
  await expectLightSurface(mapPanel.locator('.map-v2-toolbar'));
  await mapPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-dynamics').click();
  const dynamicPanel = page.getByTestId('dynamic-panel');
  await expectLightSurface(dynamicPanel.locator('.dynamic-stage-tab').first());
  await expectLightSurface(dynamicPanel.locator('.dynamic-panel-summary span').first());
  await dynamicPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('persistent-prompt-desktop-trigger').click();
  const promptPanel = page.getByTestId('persistent-prompt-panel');
  await expectLightSurface(promptPanel.locator('.persistent-prompt-compose'));
  await expectLightSurface(promptPanel.locator('.persistent-prompt-empty'));

  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(promptPanel);
  await promptPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('mobile-region-systems').click();
  for (const panelName of ['npcs', 'backpack', 'map', 'dynamics'] as const) {
    await page.getByTestId(`right-menu-${panelName}`).click();
    const panel = page.getByTestId(panelName === 'npcs' ? 'npc-panel' : `${panelName === 'dynamics' ? 'dynamic' : panelName}-panel`);
    await expect(panel).toBeVisible();
    await expectNoHorizontalOverflow(panel);
    await panel.getByRole('button', { name: '关闭' }).click();
  }
  expect(browserErrors).toEqual([]);
});
