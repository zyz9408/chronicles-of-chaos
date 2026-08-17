import { describe, expect, it } from 'vitest';
import type { Actor, RuntimeState } from '../engine/types';
import { makeHealingItemProfile } from '../engine/encounterV2/CombatTestFixtures';
import { buildBackpackPanelModel } from './backpackPanelModel';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

const player: Actor = {
  id: 'player',
  name: '刘平',
  roleType: 'player',
  summary: '测试主角',
  personalMoney: 3500,
  equipment: [
    {
      id: 'eq_sword',
      slot: 'weapon',
      name: '军府佩剑',
      quality: '精良',
      description: '军府制式佩剑。',
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
      description: '可证明军中身份。',
    },
    {
      id: 'supply_food',
      name: '行军干粮',
      quantity: 3,
      category: 'supply',
      quality: '普通',
    },
  ],
};

describe('buildBackpackPanelModel', () => {
  it('exposes compact summary rows for the backpack layout', () => {
    const model = buildBackpackPanelModel(player);

    expect(model.summaryRows).toEqual([
      { label: '钱财', value: '3贯500钱' },
      { label: '已装备', value: '1/6' },
      { label: '背包物品', value: '2类' },
      { label: '关键物品', value: '1件' },
    ]);
    expect(model.items.find((item) => item.id === 'doc_token')).toMatchObject({
      categoryLabel: '凭证',
      isKeyItem: true,
    });
    expect(model.items.find((item) => item.id === 'supply_food')).toMatchObject({
      qualityLabel: '普通',
      qualityTone: 'white',
    });
  });

  it('renders backpack summary rows in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const css = await readUiStyleSource();

    expect(source).toContain('backpackPanelModel.summaryRows.map');
    expect(source).toContain('backpack-summary-grid');
    expect(source).toContain('移除物品');
    expect(source).toContain('卸下当前装备');
    expect(source).toContain('卸下装备');
    expect(source).toContain('unequipInventoryItem');
    expect(source).toContain('直接使用');
    expect(source).toContain('item.canUse && !equipmentChooserSlot');
    expect(source).toContain('className="backpack-card-use-button"');
    expect(source).toContain('applyPlayerRestorativeItemUse');
    expect(source).toContain('恢复物品使用失败，物品未消耗');
    expect(source).toContain('pendingInventoryRemoval');
    expect(source).toContain('这是关键物品，移除后可能影响后续剧情');
    expect(source).toContain('该物品已装备，移除后会同时清空对应装备槽');
    expect(source).not.toContain('<small>BACKPACK</small>');
    expect(css).toContain('.backpack-summary-grid');
    expect(css).toContain('.backpack-card-use-button');
    expect(css).toMatch(/@media \(max-width: 960px\)[\s\S]*?\.backpack-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.backpack-item-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('formats color quality codes without changing their visual tone', () => {
    const model = buildBackpackPanelModel({
      ...player,
      inventory: [{
        id: 'order_prefect_search',
        name: '太守搜查手令',
        quantity: 1,
        category: 'token',
        quality: 'blue',
      }],
    });

    expect(model.items[0]).toMatchObject({
      qualityLabel: '蓝',
      qualityTone: 'blue',
    });
    expect(model.items[0].detailTitle).not.toContain('blue');
  });

  it('uses all six internal quality tiers for item labels and icon tones', async () => {
    const tiers = [
      ['white', '白'],
      ['green', '绿'],
      ['blue', '蓝'],
      ['purple', '紫'],
      ['orange', '橙'],
      ['red', '红'],
    ] as const;
    const model = buildBackpackPanelModel({
      ...player,
      inventory: tiers.map(([quality], index) => ({
        id: `item_quality_${quality}`,
        name: `品质物品${index}`,
        quantity: 1,
        category: 'consumable',
        quality,
      })),
    });
    const css = await readUiStyleSource();

    expect(model.items
      .filter((item) => item.id.startsWith('item_quality_'))
      .map(({ qualityTone, qualityLabel }) => ({ qualityTone, qualityLabel })))
      .toEqual(tiers.map(([qualityTone, qualityLabel]) => ({ qualityTone, qualityLabel })));
    for (const [qualityTone] of tiers) {
      expect(css).toContain(`.quality-${qualityTone} .backpack-item-icon`);
    }
  });

  it('exposes direct-use recovery state from the structured Combat V2 item profile', () => {
    const medicinePlayer: Actor = {
      ...player,
      vitals: { hp: 45, maxHp: 100, stamina: 100, maxStamina: 100 },
      inventory: [{
        id: 'item_medicine',
        name: '金创药',
        quantity: 2,
        category: 'consumable',
      }],
    };
    const runtimeState = {
      player: medicinePlayer,
      encounterV2: {
        semanticProjections: [makeHealingItemProfile('item_medicine')],
        appliedResultHashes: [],
        narratedResultHashes: [],
      },
    } as unknown as RuntimeState;

    const model = buildBackpackPanelModel(medicinePlayer, runtimeState);

    expect(model.items[0]).toMatchObject({
      qualityLabel: '绿',
      qualityTone: 'green',
      hasRestorativeUse: true,
      canUse: true,
      useEffectText: '生命 +20',
    });
  });

  it('matches equipped cards one-to-one when a legacy save reused one ID for different items', () => {
    const model = buildBackpackPanelModel({
      ...player,
      equipment: [
        { id: 'eq_duplicate', slot: 'weapon', name: '方天画戟', quality: '传奇', description: '主武器。' },
        { id: 'eq_duplicate', slot: 'armor', name: '玄铁锁卫铠', quality: '名品', description: '护甲。' },
        { id: 'eq_duplicate', slot: 'mount', name: '朔风白翎', quality: '名品', description: '坐骑。' },
      ],
      inventory: [
        { id: 'eq_duplicate', name: '方天画戟', quantity: 1, category: 'equipment', equipSlot: 'weapon' },
        { id: 'eq_duplicate', name: '塞外神弓', quantity: 1, category: 'equipment', equipSlot: 'weapon' },
        { id: 'eq_duplicate', name: '陌刀', quantity: 1, category: 'equipment', equipSlot: 'weapon' },
        { id: 'eq_duplicate', name: '玄铁锁卫铠', quantity: 1, category: 'equipment', equipSlot: 'armor' },
        { id: 'eq_duplicate', name: '朔风白翎', quantity: 1, category: 'equipment', equipSlot: 'mount' },
      ],
    });

    expect(model.summaryRows).toContainEqual({ label: '已装备', value: '3/6' });
    expect(model.items.filter((item) => item.isEquipped).map((item) => item.name)).toEqual([
      '方天画戟',
      '玄铁锁卫铠',
      '朔风白翎',
    ]);
    expect(model.items.find((item) => item.name === '塞外神弓')?.isEquipped).toBe(false);
    expect(model.items.find((item) => item.name === '陌刀')?.isEquipped).toBe(false);
  });

  it('marks only a currently usable structured restorative item for the card shortcut', () => {
    const medicinePlayer: Actor = {
      ...player,
      vitals: { hp: 45, maxHp: 100, stamina: 100, maxStamina: 100 },
      inventory: [
        {
          id: 'item_medicine',
          name: '金创药',
          quantity: 2,
          category: 'consumable',
        },
        {
          id: 'item_old_medicine',
          name: '旧药散',
          quantity: 1,
          category: 'consumable',
          description: '旧说明声称可以恢复生命，但没有结构化投影。',
        },
      ],
    };
    const runtimeState = {
      player: medicinePlayer,
      encounterV2: {
        semanticProjections: [makeHealingItemProfile('item_medicine')],
        appliedResultHashes: [],
        narratedResultHashes: [],
      },
    } as unknown as RuntimeState;

    const usableModel = buildBackpackPanelModel(medicinePlayer, runtimeState);
    expect(usableModel.items.find((item) => item.id === 'item_medicine')).toMatchObject({
      hasRestorativeUse: true,
      canUse: true,
    });
    expect(usableModel.items.find((item) => item.id === 'item_old_medicine')).toMatchObject({
      hasRestorativeUse: false,
      canUse: false,
    });

    const fullVitalsPlayer: Actor = {
      ...medicinePlayer,
      vitals: { hp: 100, maxHp: 100, stamina: 100, maxStamina: 100 },
    };
    const fullVitalsModel = buildBackpackPanelModel(fullVitalsPlayer, {
      ...runtimeState,
      player: fullVitalsPlayer,
    });
    expect(fullVitalsModel.items.find((item) => item.id === 'item_medicine')).toMatchObject({
      hasRestorativeUse: true,
      canUse: false,
      useDisabledReason: '该物品可恢复的生命或体力已经处于上限。',
    });
  });
});
