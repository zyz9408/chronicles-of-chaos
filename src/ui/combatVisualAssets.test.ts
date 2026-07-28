import { describe, expect, it } from 'vitest';
import type { BattleBriefingCard } from './battleBriefingQueueModel';
import { resolveBattleBriefingVisualAssets } from './combatVisualAssets';

function combatCard(overrides: Partial<BattleBriefingCard>): BattleBriefingCard {
  return {
    key: `combat:${overrides.recordId ?? 'combat_test'}`,
    kind: 'combat',
    recordId: overrides.recordId ?? 'combat_test',
    title: overrides.title ?? '测试战斗',
    eyebrow: '战斗简报',
    summary: overrides.summary ?? '测试战斗简报。',
    imageKey: overrides.imageKey,
    visualTags: overrides.visualTags ?? [],
    openPanel: 'combats',
    selectedId: overrides.recordId ?? 'combat_test',
    panelTab: 'playerRelated',
  };
}

function battleCard(overrides: Partial<BattleBriefingCard>): BattleBriefingCard {
  return {
    key: `battle:${overrides.recordId ?? 'battle_test'}`,
    kind: 'battle',
    recordId: overrides.recordId ?? 'battle_test',
    title: overrides.title ?? '测试战事',
    eyebrow: '战事简报',
    summary: overrides.summary ?? '测试战事简报。',
    imageKey: overrides.imageKey,
    visualTags: overrides.visualTags ?? [],
    openPanel: 'battles',
    selectedId: overrides.recordId ?? 'battle_test',
    panelTab: 'selfRelated',
  };
}

describe('combatVisualAssets', () => {
  it('selects one stable enemy layer from two variants for the same enemy archetype', () => {
    const first = resolveBattleBriefingVisualAssets(combatCard({
      recordId: 'combat_bandit_a',
      visualTags: ['bandit', 'street'],
    }));
    const firstAgain = resolveBattleBriefingVisualAssets(combatCard({
      recordId: 'combat_bandit_a',
      visualTags: ['bandit', 'street'],
    }));
    const second = resolveBattleBriefingVisualAssets(combatCard({
      recordId: 'combat_bandit_b',
      visualTags: ['bandit', 'street'],
    }));

    expect(first.enemyLayerUrl).toContain('combat_enemy_bandit_raider_front_v0');
    expect(first.enemyLayerUrl).toBe(firstAgain.enemyLayerUrl);
    expect(second.enemyLayerUrl).toContain('combat_enemy_bandit_raider_front_v0');
    expect(second.enemyLayerUrl).not.toBe(first.enemyLayerUrl);
  });

  it('resolves scene and player layers from combat visual tags with defaults', () => {
    const visual = resolveBattleBriefingVisualAssets(combatCard({
      recordId: 'combat_gate_spear',
      visualTags: ['gate', 'spear'],
    }));

    expect(visual.backgroundUrl).toContain('combat_scene_city_gate_wall_v01');
    expect(visual.backgroundUrl).toContain('.webp');
    expect(visual.playerLayerUrl).toContain('combat_player_over_shoulder_halberd_v01');
    expect(visual.playerLayerUrl).toContain('.webp');
    expect(visual.enemyLayerUrl).toContain('combat_enemy_han_soldier_spear_front_v0');
    expect(visual.enemyLayerUrl).toContain('.webp');
  });

  it('resolves battle-scale effects from conflict tags without adding character layers', () => {
    const visual = resolveBattleBriefingVisualAssets(battleCard({
      title: '营寨夜袭，火攻破门',
      summary: '箭雨压住寨墙，败兵卷起尘土向后溃散。',
      visualTags: ['night', 'fireAttack', 'gateBreached', 'arrowRain', 'rout'],
    }));

    expect(visual.playerLayerUrl).toBeUndefined();
    expect(visual.enemyLayerUrl).toBeUndefined();
    expect(visual.effects.map((effect) => effect.key)).toEqual([
      'night',
      'fire',
      'arrows',
      'dust',
      'shock',
    ]);
    expect(visual.effectClassNames).toContain('battle-briefing-effect--fire');
    expect(visual.effectLabel).toBe('夜色 / 火光 / 箭雨 / 尘土 / 冲击');
  });

  it.each([
    [
      'open field formation',
      battleCard({
        title: '平原野战，军阵推进',
        summary: '两军列阵于旷野，前锋缓缓压上。',
        visualTags: ['formation', 'openField'],
      }),
      'war_scene_open_field_formation_v01',
      '平原军阵',
    ],
    [
      'city siege outer wall',
      battleCard({
        title: '攻城云梯逼近外墙',
        summary: '城墙外攻守僵持，云梯与攻城车推向城门。',
        visualTags: ['siege', 'outerWall'],
      }),
      'war_scene_city_siege_outer_wall_v01',
      '城墙攻守',
    ],
    [
      'city defense inner gate',
      battleCard({
        title: '破门之后守军退入城门',
        summary: '城门内设置拒马与盾阵，巷战将起。',
        visualTags: ['gateBreached', 'innerGate'],
      }),
      'war_scene_city_defense_inner_gate_v01',
      '城门内防',
    ],
    [
      'military camp raid',
      battleCard({
        title: '夜袭敌营，营门大乱',
        summary: '营寨栅栏外号角骤起，巡卒与辎重车散乱。',
        visualTags: ['campRaid', 'militaryCamp'],
      }),
      'war_scene_military_camp_raid_v01',
      '营寨劫营',
    ],
    [
      'river battle bank',
      battleCard({
        title: '渡口争夺，舟船逼岸',
        summary: '河岸阵线拉开，水军从渡船上靠近。',
        visualTags: ['riverBattle', 'boats'],
      }),
      'war_scene_river_battle_bank_v01',
      '河岸水战',
    ],
    [
      'mountain ambush pass',
      battleCard({
        title: '山谷伏击截断后队',
        summary: '狭道两侧旌旗隐现，追兵入谷后阵形拉长。',
        visualTags: ['mountainPass', 'ambush'],
      }),
      'war_scene_mountain_ambush_pass_v01',
      '山谷伏击',
    ],
    [
      'supply route raid',
      battleCard({
        title: '粮道遇袭，辎重受阻',
        summary: '押运粮车停在道路中央，护送队列收拢防御。',
        visualTags: ['supplyRoute', 'logisticsRaid'],
      }),
      'war_scene_supply_route_raid_v01',
      '粮道辎重',
    ],
    [
      'rout pursuit dust',
      battleCard({
        title: '败兵溃退，骑队追击',
        summary: '尘土沿战场边缘卷起，断旗与散兵一路后撤。',
        visualTags: ['rout', 'pursuit'],
      }),
      'war_scene_rout_pursuit_dust_v01',
      '溃退追击',
    ],
  ])('resolves war-scale battle background for %s', (_name, card, expectedFile, expectedLabel) => {
    const visual = resolveBattleBriefingVisualAssets(card);

    expect(visual.backgroundUrl).toContain(expectedFile);
    expect(visual.backgroundUrl).toContain('.webp');
    expect(visual.sceneLabel).toBe(expectedLabel);
    expect(visual.playerLayerUrl).toBeUndefined();
    expect(visual.enemyLayerUrl).toBeUndefined();
  });

  it('keeps an ambush scene when the same report also mentions the enemy rout', () => {
    const visual = resolveBattleBriefingVisualAssets(battleCard({
      title: '枯林坡伏击大捷',
      summary: '弩兵齐射后，败兵溃退，骑队追击。',
      visualTags: ['ambush', 'rout', 'cavalry'],
    }));

    expect(visual.backgroundUrl).toContain('war_scene_mountain_ambush_pass_v01');
    expect(visual.sceneLabel).toBe('山谷伏击');
  });

  it.each([
    [
      'infantry line',
      battleCard({
        title: '平原野战，军阵推进',
        summary: '两军列阵于旷野，前锋缓缓压上。',
        visualTags: ['formation', 'openField'],
      }),
      'war_force_infantry_line_v01',
      '步卒阵线',
    ],
    [
      'cavalry charge',
      battleCard({
        title: '骑兵侧翼突入，追击敌军',
        summary: '骑队从侧翼卷入战场，迫使敌军后队动摇。',
        visualTags: ['cavalry', 'charge'],
      }),
      'war_force_cavalry_charge_v01',
      '骑兵冲锋',
    ],
    [
      'routed soldiers',
      battleCard({
        title: '败兵溃退，后阵崩散',
        summary: '尘土沿战场边缘卷起，断旗与散兵一路后撤。',
        visualTags: ['rout', 'moraleCollapse'],
      }),
      'war_force_routed_soldiers_v01',
      '溃兵奔散',
    ],
    [
      'siege assault',
      battleCard({
        title: '攻城云梯逼近外墙',
        summary: '城墙外攻守僵持，云梯与攻城车推向城门。',
        visualTags: ['siege', 'outerWall'],
      }),
      'war_force_siege_assault_v01',
      '攻城兵群',
    ],
    [
      'wall defenders',
      battleCard({
        title: '守军退入城门，墙头弓弩压制',
        summary: '城门内设置拒马与盾阵，墙头守军稳住阵脚。',
        visualTags: ['gateBreached', 'innerGate', 'wallDefenders'],
      }),
      'war_force_wall_defenders_v01',
      '守城士卒',
    ],
    [
      'river boats',
      battleCard({
        title: '渡口争夺，舟船逼岸',
        summary: '河岸阵线拉开，水军从渡船上靠近。',
        visualTags: ['riverBattle', 'boats'],
      }),
      'war_force_river_boats_v01',
      '舟船水军',
    ],
    [
      'supply convoy',
      battleCard({
        title: '粮道遇袭，辎重受阻',
        summary: '押运粮车停在道路中央，护送队列收拢防御。',
        visualTags: ['supplyRoute', 'logisticsRaid'],
      }),
      'war_force_supply_convoy_v01',
      '辎重护队',
    ],
    [
      'camp raid',
      battleCard({
        title: '夜袭敌营，营门大乱',
        summary: '营寨栅栏外号角骤起，巡卒与辎重车散乱。',
        visualTags: ['campRaid', 'militaryCamp'],
      }),
      'war_force_camp_raid_v01',
      '营寨乱兵',
    ],
  ])('resolves war-force overlay for %s', (_name, card, expectedFile, expectedLabel) => {
    const visual = resolveBattleBriefingVisualAssets(card);

    expect(visual.forceLayerUrl).toContain(expectedFile);
    expect(visual.forceLayerUrl).toContain('.webp');
    expect(visual.forceLabel).toBe(expectedLabel);
    expect(visual.playerLayerUrl).toBeUndefined();
    expect(visual.enemyLayerUrl).toBeUndefined();
  });

  it('does not add a war-force overlay to personal combat cards', () => {
    const visual = resolveBattleBriefingVisualAssets(combatCard({
      title: '雨夜巷战',
      summary: '短刃贴身抢入，肩甲被划出血痕。',
      visualTags: ['rain', 'night', 'wound', 'assassin'],
    }));

    expect(visual.forceLayerUrl).toBeUndefined();
    expect(visual.forceLabel).toBeUndefined();
  });

  it('resolves combat weather and hit feedback effects from personal combat tags', () => {
    const visual = resolveBattleBriefingVisualAssets(combatCard({
      title: '雨夜巷战',
      summary: '短刃贴身抢入，肩甲被划出血痕。',
      visualTags: ['rain', 'night', 'wound', 'assassin'],
    }));

    expect(visual.effects.map((effect) => effect.key)).toEqual(['night', 'rain', 'impact']);
    expect(visual.effectClassNames).toContain('battle-briefing-effect--rain');
    expect(visual.effectLabel).toBe('夜色 / 雨幕 / 受击');
  });
});
