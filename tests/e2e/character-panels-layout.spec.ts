import { expect, test } from '@playwright/test';

test('character panels render compact profile, NPC, backpack, and unique-art layouts', async ({ page }) => {
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
      playerName: '角色面板验收',
      courtesyName: '定版',
      playerSex: '男',
      playerAge: 27,
      origin: '军中将校',
      birthOrigin: '寒门武人',
      currentIdentity: '北军军候',
      locationId: location.id,
      situationSummary: '角色面板排版验收用开局。',
      equipment: [
        {
          id: 'eq_sword',
          slot: 'weapon',
          name: '军府佩剑',
          quality: '精良',
          description: '军府发下的佩剑，锋口新磨。',
        },
      ],
      inventory: [
        {
          id: 'doc_token',
          name: '军候印信',
          quantity: 1,
          category: 'token',
          quality: '信物',
          keyItem: true,
          description: '可证明北军军候身份。',
        },
        {
          id: 'supply_food',
          name: '行军干粮',
          quantity: 3,
          category: 'supply',
          quality: '普通',
        },
      ],
      personalMoney: 3500,
    });

    state.player.uniqueArts = [
      {
        id: 'art_cavalry_command',
        name: '骑阵节度',
        rarity: 'blue',
        domain: 'warfare',
        level: 2,
        maxLevel: 5,
        progress: 45,
        description: '能在骑兵进退之间稳住节奏。',
        effectSummary: '统率骑兵或应对骑兵威胁时更有优势。',
        source: 'opening',
      },
    ];
    state.player.reputation = {
      fame: 8,
      morality: 50,
      tags: [{ label: '略有名声', source: 'opening' }],
      summary: '只在营中略有人知。',
    };
    state.locations = [
      ...(state.locations ?? []),
      {
        locationId: 'location_yingchuan_xuchang',
        name: '颍川许昌驿站',
        type: '驿站',
        summary: '往来颍川与洛阳的旧驿。',
        knownLevel: '听闻',
        recentEvents: [],
      },
    ];
    state.npcs = [
      {
        npcId: 'npc_chen_heng',
        name: '陈衡',
        courtesyName: '子平',
        sex: '男',
        age: 43,
        role: '北军老卒',
        factionName: '北军',
        isPresent: true,
        isFocused: true,
        currentIdentity: '伍长',
        relationToPlayer: '同营旧识，对主角略有照拂。',
        contactLevel: 38,
        recentAttitude: '谨慎但愿意说实话',
        presenceUpdates: [
          {
            id: 'presence_chen_1',
            summary: '刚从北营巡哨返回，带来西门换防的确切消息。',
            createdAt: '公元189年09月01日 11:40（午时）',
            kind: '现场',
            source: '亲历',
            certainty: 'confirmed',
            readByPlayer: false,
          },
        ],
        memories: [
          {
            memoryId: 'mem_chen_1',
            source: '亲历',
            content: '见过主角在营门前压住慌乱。',
            createdAt: '公元189年09月01日 09:30（巳时）',
          },
        ],
        traits: [],
        effects: [],
        equipment: [
          {
            id: 'eq_chen_sabre',
            slot: 'weapon',
            name: '环首刀',
            quality: '军中旧制',
          },
        ],
        inventory: [
          {
            id: 'item_gate_token',
            name: '营门木符',
            quantity: 1,
            category: 'token',
            keyItem: true,
          },
        ],
        uniqueArts: [
          {
            id: 'art_gate_guard',
            name: '守门刀势',
            rarity: 'green',
            domain: 'personalCombat',
            level: 1,
            description: '擅守狭门。',
            effectSummary: '狭窄地形守御时可得小幅优势。',
            source: 'event',
          },
        ],
      },
      {
        npcId: 'npc_absent_long',
        name: '荀氏宗族使者荀文若从事',
        courtesyName: '景和',
        sex: '男',
        age: 36,
        role: '颍川联络使',
        factionName: '颍川士族',
        locationId: 'location_yingchuan_xuchang',
        isPresent: false,
        isFocused: true,
        currentIdentity: '远行联络使',
        relationToPlayer: '此前达成互通军情的谨慎合作。',
        contactLevel: 46,
        recentAttitude: '数回合未见，最近一封书信仍维持合作意向',
        presenceUpdates: [
          {
            id: 'presence_absent_1',
            summary: '三日前在许昌驿站留下密函，尚未返回洛阳。',
            createdAt: '公元189年08月29日 18:20（酉时）',
            kind: '书信',
            source: '传闻',
            certainty: 'reported',
            readByPlayer: true,
          },
        ],
        memories: [],
        traits: [],
        effects: [],
      },
      {
        npcId: 'npc_he_lady',
        name: '何氏',
        sex: '女',
        age: 24,
        role: '地方士族女眷',
        factionName: '洛阳何氏',
        isPresent: true,
        isFocused: true,
        currentIdentity: '士族女眷',
        summary: '与主角保持谨慎接触。',
        appearance: '衣饰端正，举止克制。',
        personality: '谨慎敏锐，重视家族边界。',
        motivation: '希望在乱局中保全家族。',
        relationToPlayer: '礼节往来，仍在观察。',
        contactLevel: 22,
        recentAttitude: '戒备但愿意交谈',
        memories: [],
        traits: [],
        effects: [],
        femaleProfile: {
          relationshipNotes: '公开关系仍停留在礼节往来。',
          publicIntimacyNotes: '公开场合保持距离。',
          appearanceDescription: '仪态端庄，衣饰合乎身份。',
          bodyDescription: '身形与仪态已有稳定印象。',
          clothingStyle: '常穿素色深衣，配饰克制。',
          personalityCore: '谨慎克制，重视边界。',
          adultPrivateProfile: {
            enabled: true,
            ageConfirmedAdult: true,
            breastDescription: '成年女性私密部位记录。',
            vaginaDescription: '成年女性私密部位记录。',
            anusDescription: '成年女性隐私部位记录。',
            sexualPreferenceNotes: '偏好长期信任后的亲密关系。',
            sensitiveSpotNotes: '敏感点记录。',
            wombProfile: {
              status: '健康',
              cervixStatus: '未记录',
              inseminationRecords: [],
            },
            updatedAt: '公元189年09月01日 09:30（巳时）',
            source: '亲历',
          },
        },
      },
    ];
    state.bondThreads = [
      {
        bondThreadId: 'bond_chen',
        targetNpcIds: ['npc_chen_heng'],
        targetNames: ['陈衡'],
        bondType: 'sworn',
        status: 'active',
        summary: '共患难后已形成可靠的袍泽情谊。',
        currentTension: '陈衡希望尽快救出被困在西门的旧部。',
        promiseNotes: '主角许诺分粮安置并亲自接应。',
        recentProgress: '并肩夺回粮车后信任加深。',
        tags: ['袍泽', '旧部'],
        milestones: [{ milestoneId: 'bond_m1', happenedAt: '公元189年09月01日 11:00（午时）', summary: '共同夺回粮车。' }],
        lastUpdatedAt: '公元189年09月01日 12:00（午时）',
      },
    ];
    state.heroineThreads = [
      {
        heroineThreadId: 'heroine_he',
        npcId: 'npc_he_lady',
        npcName: '何氏',
        status: 'active',
        stage: '信任初成',
        relationshipRole: '红颜知己',
        summary: '在洛阳乱局中与主角建立私下信任。',
        currentPull: '担忧主角卷入宫门风波。',
        riskNotes: '外戚与宦官交争会牵连二人。',
        promiseNotes: '主角承诺护她离开险地。',
        recentProgress: '通过密信再次确认彼此立场。',
        tags: ['宫闱', '信任'],
        milestones: [{ milestoneId: 'heroine_m1', happenedAt: '公元189年09月01日 10:00（巳时）', summary: '第一次私下交换信物。' }],
        lastUpdatedAt: '公元189年09月01日 12:00（午时）',
      },
    ];

    await saveManager.createSave(state, '角色面板验收存档');
  });

  await page.reload();
  await page.getByRole('button', { name: '兵戈再起' }).click();
  await page.getByText('角色面板验收', { exact: true }).click();

  await page.getByTestId('player-profile-entry').click();
  const profilePanel = page.getByTestId('player-profile-panel');
  await expect(profilePanel).toBeVisible();
  await expect(profilePanel.locator('.character-summary-grid')).toContainText('行装');
  await expect(profilePanel).toContainText('随身物品');
  await expect(profilePanel).not.toContainText('PLAYER PROFILE');
  await profilePanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-npcs').click();
  const npcPanel = page.getByTestId('npc-panel');
  await expect(npcPanel).toBeVisible();
  await expect(npcPanel.locator('.npc-detail-overview-grid')).toContainText('行装');
  await expect(npcPanel).toContainText('环首刀');
  await expect(npcPanel).toContainText('营门木符');
  await npcPanel.getByText('荀氏宗族使者荀文若从事', { exact: true }).click();
  await expect(npcPanel.locator('.npc-detail-location-line')).toContainText('颍川许昌驿站');
  await expect(npcPanel.locator('.npc-detail-location-line')).not.toContainText('location_yingchuan_xuchang');
  await expect(npcPanel.locator('.npc-presence-updates-section')).toContainText('三日前在许昌驿站留下密函');
  await npcPanel.getByText('何氏').first().click();
  const femaleDisclosure = npcPanel.locator('.npc-female-profile-disclosure');
  await expect(femaleDisclosure).toBeVisible();
  await expect(femaleDisclosure.locator('.npc-female-profile-summary')).toContainText('女性档案');
  await expect(femaleDisclosure.locator('.npc-female-profile-summary')).toContainText('含香闺秘档');
  await expect(npcPanel.locator('.npc-adult-private-profile')).not.toBeVisible();
  await expect(npcPanel.locator('.npc-detail-side-archive')).toHaveCount(0);
  await femaleDisclosure.locator('.npc-female-profile-summary').click();
  await expect(npcPanel.locator('.npc-adult-private-profile')).toBeVisible();
  await expect(npcPanel.locator('.npc-adult-private-profile')).toContainText('香闺秘档');
  await expect(npcPanel.locator('.npc-adult-private-profile')).toContainText('TOP SECRET');
  await expect(npcPanel.locator('.npc-secret-body-card')).toHaveCount(3);
  await expect(npcPanel.locator('.npc-secret-preference-card')).toHaveCount(2);
  await expect(npcPanel.locator('.npc-secret-womb-card')).toContainText('子宫档案');
  await npcPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-bonds').click();
  const bondPanel = page.getByTestId('bond-panel');
  await expect(bondPanel).toContainText('共患难后已形成可靠的袍泽情谊');
  await expect(bondPanel).toContainText('当前张力');
  await bondPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-heroines').click();
  const heroinePanel = page.getByTestId('heroine-panel');
  await expect(heroinePanel).toContainText('红颜关系');
  await expect(heroinePanel).toContainText('信任初成');
  await heroinePanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-backpack').click();
  const backpackPanel = page.getByTestId('backpack-panel');
  await expect(backpackPanel).toBeVisible();
  await expect(backpackPanel.locator('.backpack-summary-grid')).toContainText('关键物品');
  await expect(backpackPanel).not.toContainText('BACKPACK');
  await backpackPanel.getByRole('button', { name: '关闭' }).click();

  await page.getByTestId('right-menu-uniqueArts').click();
  const uniqueArtsPanel = page.getByTestId('unique-arts-panel');
  await expect(uniqueArtsPanel).toBeVisible();
  await expect(uniqueArtsPanel).toContainText('主角绝艺');
  await expect(uniqueArtsPanel).toContainText('人物绝艺');
  await expect(uniqueArtsPanel).toContainText('持有者');
  await expect(uniqueArtsPanel).toContainText('效果');
  await expect(uniqueArtsPanel).not.toContainText('UNIQUE ARTS');
  await expect(uniqueArtsPanel).not.toContainText('updateCharacterUniqueArts');
  await uniqueArtsPanel.getByRole('button', { name: '关闭' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('mobile-region-systems').click();
  await page.getByTestId('right-menu-backpack').click();
  const mobileBackpackPanel = page.getByTestId('backpack-panel');
  await expect(mobileBackpackPanel).toBeVisible();
  const backpackLayout = await mobileBackpackPanel.locator('.backpack-grid').evaluate((element) => ({
    columns: getComputedStyle(element).gridTemplateColumns,
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
  }));
  expect(backpackLayout.columns.trim().split(/\s+/)).toHaveLength(1);
  expect(backpackLayout.scrollWidth).toBeLessThanOrEqual(backpackLayout.clientWidth + 1);
  const firstMobileItem = await mobileBackpackPanel.locator('.backpack-item-card').first().boundingBox();
  expect(firstMobileItem?.width ?? 0).toBeGreaterThan(120);
  await mobileBackpackPanel.getByRole('button', { name: '关闭' }).click();
});
