import { expect, test } from '@playwright/test';

test('backpack supports money display, inventory details, and equipment replacement', async ({ page }) => {
  await page.goto('/');

  await page.evaluate(async () => {
    const worldBookLoader = await import('/src/engine/worldbook/WorldBookLoader.ts');
    const startBookmarkResolver = await import('/src/engine/worldbook/StartBookmarkResolver.ts');
    const openingState = await import('/src/engine/state/createCustomOpeningState.ts');
    const saveManager = await import('/src/engine/save/SaveManager.ts');

    const firstLeaf = (nodes) => {
      for (const node of nodes) {
        if (!node.subLocations?.length) return node;
        const child = firstLeaf(node.subLocations);
        if (child) return child;
      }
      return undefined;
    };

    worldBookLoader.initWorldBookRegistry();
    const manifest = worldBookLoader.listWorldBooks()[0];
    const worldBook = worldBookLoader.getWorldBook(manifest.id);
    const bookmark = startBookmarkResolver.listStartBookmarks(worldBook)[0];
    const location = firstLeaf(worldBook.openingLocationSeed ?? worldBook.mapSeed);

    await saveManager.clearAllSaves();
    const state = openingState.createCustomOpeningState({
      worldBook,
      bookmark,
      playerName: '背包验收',
      courtesyName: '试行',
      playerSex: '男',
      playerAge: 26,
      origin: '军中将校',
      birthOrigin: '寒门武人',
      currentIdentity: '北军军候',
      locationId: location.id,
      situationSummary: '背包验收用开局。',
      equipment: [
        {
          id: 'eq_short_sword',
          slot: 'weapon',
          name: '旧短刀',
          quality: '普通',
          description: '刀身有旧缺口，但仍可防身。',
        },
        {
          id: 'eq_leather_armor',
          slot: 'armor',
          name: '旧皮甲',
          quality: '普通',
          description: '粗旧皮甲，能挡零散箭矢。',
        },
      ],
      inventory: [
        {
          id: 'eq_short_sword',
          name: '旧短刀',
          quantity: 1,
          category: 'equipment',
          equipSlot: 'weapon',
          quality: '普通',
          description: '刀身有旧缺口，但仍可防身。',
        },
        {
          id: 'eq_court_sword',
          name: '军府佩剑',
          quantity: 1,
          category: 'equipment',
          equipSlot: 'weapon',
          quality: '精良',
          description: '军府发下的佩剑，锋口新磨。',
        },
        {
          id: 'doc_commander_token',
          name: '军候印信',
          quantity: 1,
          category: 'token',
          quality: '信物',
          description: '可证明北军军候身份的印信。',
        },
        {
          id: 'supply_dry_food',
          name: '行军干粮',
          quantity: 3,
          category: 'supply',
          quality: '普通',
          description: '随身携带的干粮与水袋。',
        },
      ],
      personalMoney: 3500,
    });
    await saveManager.createSave(state, '背包验收存档');
  });

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.locator('.save-item', { hasText: '背包验收' }).click();

  await expect(page.locator('.equipment-slot-row', { hasText: '旧短刀' })).toBeVisible();

  const backpackButton = page.getByTestId('right-menu-backpack');
  await expect(backpackButton).toBeVisible();
  await backpackButton.click();

  const backpackPanel = page.getByTestId('backpack-panel');
  await expect(backpackPanel).toBeVisible();
  await expect(backpackPanel).toContainText('3贯500钱');
  await expect(backpackPanel).toContainText('旧短刀');
  await expect(backpackPanel).toContainText('军府佩剑');
  await expect(backpackPanel).toContainText('军候印信');
  await expect(backpackPanel).toContainText('行军干粮');
  await expect(backpackPanel.locator('.backpack-item-card', { hasText: '旧短刀' })).toContainText('装');

  await backpackPanel.locator('.backpack-item-card', { hasText: '军府佩剑' }).click();
  await expect(backpackPanel.locator('.backpack-item-detail')).toContainText('锋口新磨');
  await backpackPanel.locator('.backpack-item-card', { hasText: '军府佩剑' }).getByRole('button', { name: '装备' }).click();
  await expect(backpackPanel.locator('.backpack-item-card', { hasText: '军府佩剑' })).toContainText('装');

  await backpackPanel.getByRole('button', { name: '关闭' }).click();
  await expect(page.locator('.equipment-slot-row', { hasText: '军府佩剑' })).toBeVisible();

  await page.locator('.equipment-slot-row', { hasText: '军府佩剑' }).click();
  await expect(backpackPanel).toBeVisible();
  await expect(backpackPanel).toContainText('正在选择');
  await backpackPanel.locator('.backpack-item-card', { hasText: '旧短刀' }).getByRole('button', { name: '换上' }).click();
  await expect(page.locator('.equipment-slot-row', { hasText: '旧短刀' })).toBeVisible();
});
