import { describe, expect, it } from 'vitest';
import type { Actor } from '../engine/types';
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
  });

  it('renders backpack summary rows in GameScreen', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const css = await readUiStyleSource();

    expect(source).toContain('backpackPanelModel.summaryRows.map');
    expect(source).toContain('backpack-summary-grid');
    expect(source).toContain('移除物品');
    expect(source).toContain('pendingInventoryRemoval');
    expect(source).toContain('这是关键物品，移除后可能影响后续剧情');
    expect(source).toContain('该物品已装备，移除后会同时清空对应装备槽');
    expect(source).not.toContain('<small>BACKPACK</small>');
    expect(css).toContain('.backpack-summary-grid');
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
});
