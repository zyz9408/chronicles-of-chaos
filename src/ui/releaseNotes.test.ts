import { describe, expect, it } from 'vitest';
import {
  APP_VERSION,
  APP_VERSION_LABEL,
  CHANGELOG_DAILY_VIEW_KEY,
  RELEASE_NOTES as RAW_RELEASE_NOTES,
  formatLocalDateKey,
  recordDailyReleaseNotesView,
  shouldShowDailyReleaseNotes,
} from './releaseNotes';

const ALL_RELEASE_NOTES = RAW_RELEASE_NOTES.slice(9);
const RELEASE_NOTES = RAW_RELEASE_NOTES.slice(14);

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('releaseNotes', () => {
  it('exposes the current release and its exact publication time', () => {
    expect(APP_VERSION).toBe('1.7.24');
    expect(APP_VERSION_LABEL).toBe('v1.7.24');
    expect(RAW_RELEASE_NOTES).toHaveLength(19);
    expect(RAW_RELEASE_NOTES[0]?.id).toBe('2026-08-18');
    expect(RAW_RELEASE_NOTES[0]?.date).toBe('2026年8月18日');
    expect(RAW_RELEASE_NOTES[0]?.updates).toHaveLength(1);

    const latestRelease = RAW_RELEASE_NOTES[0]?.updates[0];
    expect(latestRelease?.id).toBe('2026-08-18-v1.7.24-glm-minimax-compatibility');
    expect(latestRelease?.time).toBe('00:10');
    expect(latestRelease?.version).toBe('v1.7.24');
    expect(latestRelease?.title).toBe('GLM 与 MiniMax 接口兼容优化');
    expect(latestRelease?.items.join('')).toContain('累计正文片段');

    const augustTwelfthRelease = RAW_RELEASE_NOTES[2];
    expect(augustTwelfthRelease?.id).toBe('2026-08-12');
    expect(augustTwelfthRelease?.updates).toHaveLength(2);

    const augustEleventhRelease = RAW_RELEASE_NOTES[3];
    expect(augustEleventhRelease?.id).toBe('2026-08-11');
    expect(augustEleventhRelease?.updates).toHaveLength(2);

    const confirmedNpcAdmissionRelease = augustEleventhRelease?.updates[1];
    expect(confirmedNpcAdmissionRelease?.id).toBe('2026-08-11-v1.7.19-confirmed-npc-admission');
    expect(confirmedNpcAdmissionRelease?.time).toBe('00:17');
    expect(confirmedNpcAdmissionRelease?.items.join('')).toContain('强制建档');

    const augustTenthRelease = RAW_RELEASE_NOTES[4];
    expect(augustTenthRelease?.id).toBe('2026-08-10');
    expect(augustTenthRelease?.date).toBe('2026年8月10日');
    expect(augustTenthRelease?.updates).toHaveLength(2);

    const augustNinthRelease = RAW_RELEASE_NOTES[5];
    expect(augustNinthRelease?.id).toBe('2026-08-09');
    expect(augustNinthRelease?.date).toBe('2026年8月9日');
    expect(augustNinthRelease?.updates).toHaveLength(1);

    const augustEighthRelease = RAW_RELEASE_NOTES[6];
    expect(augustEighthRelease?.id).toBe('2026-08-08');
    expect(augustEighthRelease?.date).toBe('2026年8月8日');
    expect(augustEighthRelease?.updates).toHaveLength(6);

    const augustSeventhRelease = RAW_RELEASE_NOTES[7];
    expect(augustSeventhRelease?.id).toBe('2026-08-07');
    expect(augustSeventhRelease?.date).toBe('2026年8月7日');
    expect(augustSeventhRelease?.updates).toHaveLength(6);

    const npcAdmissionRelease = augustSeventhRelease?.updates[0];
    expect(npcAdmissionRelease?.id).toBe('2026-08-07-v1.7.9-npc-admission-writeback');
    expect(npcAdmissionRelease?.time).toBe('22:13');
    expect(npcAdmissionRelease?.version).toBe('v1.7.9');
    expect(npcAdmissionRelease?.title).toBe('人物志与长期关系写回修复');
    expect(npcAdmissionRelease?.items.join('')).toContain('结构化人物准入事实');

    const equipmentRelease = augustSeventhRelease?.updates[1];
    expect(equipmentRelease?.id).toBe('2026-08-07-v1.7.8-equipment-unequip');
    expect(equipmentRelease?.time).toBe('19:06');
    expect(equipmentRelease?.items.join('')).toContain('自动补回背包');

    const mobileSwitchesRelease = augustSeventhRelease?.updates[2];
    expect(mobileSwitchesRelease?.id).toBe('2026-08-07-v1.7.7-mobile-tavern-switches');
    expect(mobileSwitchesRelease?.time).toBe('14:31');
    expect(mobileSwitchesRelease?.items.join('')).toContain('提示词开关管理入口');

    const mobileImportRelease = augustSeventhRelease?.updates[3];
    expect(mobileImportRelease?.id).toBe('2026-08-07-v1.7.6-mobile-tavern-import');
    expect(mobileImportRelease?.time).toBe('11:53');
    expect(mobileImportRelease?.items.join('')).toContain('系统文件选择器');

    const lightThemeRelease = augustSeventhRelease?.updates[4];
    expect(lightThemeRelease?.id).toBe('2026-08-07-v1.7.5-light-theme');
    expect(lightThemeRelease?.time).toBe('11:17');
    expect(lightThemeRelease?.items.join('')).toContain('颜色反转');

    const runtimeStabilityRelease = augustSeventhRelease?.updates[5];
    expect(runtimeStabilityRelease?.id).toBe('2026-08-07-v1.7.4-runtime-stability');
    expect(runtimeStabilityRelease?.time).toBe('07:48');
    expect(runtimeStabilityRelease?.items.join('')).toContain('连续作战');

    const previousRelease = RAW_RELEASE_NOTES[8];
    expect(previousRelease?.id).toBe('2026-08-06');
    expect(previousRelease?.updates).toHaveLength(8);

    const correspondenceFixRelease = previousRelease?.updates[0];
    expect(correspondenceFixRelease?.id).toBe(
      '2026-08-06-v1.7.3-correspondence-id-collision-fix',
    );
    expect(correspondenceFixRelease?.time).toBe('22:22');
    expect(correspondenceFixRelease?.items.join('')).toContain('幂等');

    const troopRelease = previousRelease?.updates[1];
    expect(troopRelease?.id).toBe('2026-08-06-v1.7.2-troop-fatigue-and-upkeep');
    expect(troopRelease?.time).toBe('21:53');
    expect(troopRelease?.version).toBe('v1.7.2');
    expect(troopRelease?.title).toBe('部队疲劳恢复与军需展示');
    expect(troopRelease?.items.join('')).toContain('战争引擎的精确数值');

    const profileRelease = previousRelease?.updates[2];
    expect(profileRelease?.id).toBe('2026-08-06-v1.7.1-character-profile-deduplication');
    expect(profileRelease?.time).toBe('21:44');
    expect(profileRelease?.version).toBe('v1.7.1');
    expect(profileRelease?.title).toBe('人物特质与绝艺稳定性修复');
    expect(profileRelease?.items.join('')).toContain('本地自修复');

    const correspondenceRelease = previousRelease?.updates[3];
    expect(correspondenceRelease?.id).toBe('2026-08-06-v1.7.0-correspondence-system');
    expect(correspondenceRelease?.time).toBe('21:26');
    expect(correspondenceRelease?.version).toBe('v1.7.0');
    expect(correspondenceRelease?.title).toBe('书信往来与约定系统');
    expect(correspondenceRelease?.items.join('')).toContain('不提供草稿功能');

    const deepSeekV4Release = previousRelease?.updates[4];
    expect(deepSeekV4Release?.id).toBe('2026-08-06-v1.6.15-deepseek-v4-flash-empty-output-hotfix');
    expect(deepSeekV4Release?.time).toBe('16:12');
    expect(deepSeekV4Release?.version).toBe('v1.6.15');
    expect(deepSeekV4Release?.title).toBe('DeepSeek V4 Flash 空输出修复');
    expect(deepSeekV4Release?.items.join('')).toContain('命中率可能回落');

    const holdingRelease = previousRelease?.updates[5];
    expect(holdingRelease?.id).toBe('2026-08-06-v1.6.14-holding-cash-tax');
    expect(holdingRelease?.time).toBe('11:44');
    expect(holdingRelease?.version).toBe('v1.6.14');
    expect(holdingRelease?.title).toBe('领地钱税结算优化');
    expect(holdingRelease?.items.join('')).toContain('编户基础钱税');

    const deepSeekRelease = previousRelease?.updates[6];
    expect(deepSeekRelease?.id).toBe('2026-08-06-v1.6.13-deepseek-prefix-cache');
    expect(deepSeekRelease?.time).toBe('11:01');
    expect(deepSeekRelease?.items.join('')).toContain('第三方 OpenAI 兼容接口');

    const openingTemplateRelease = previousRelease?.updates[7];
    expect(openingTemplateRelease?.id).toBe('2026-08-06-v1.6.12-opening-template-extra-request');
    expect(openingTemplateRelease?.time).toBe('08:47');
    expect(openingTemplateRelease?.items.join('')).toContain('旧人物模板');
  });

  it('keeps previous patch releases ahead of the timed official-release baseline', () => {
    expect(ALL_RELEASE_NOTES).toHaveLength(10);
    expect(ALL_RELEASE_NOTES[0]?.id).toBe('2026-08-05');
    expect(ALL_RELEASE_NOTES[0]?.date).toBe('2026年8月5日');
    expect(ALL_RELEASE_NOTES[0]?.updates).toHaveLength(8);

    const latestRelease = ALL_RELEASE_NOTES[0]?.updates[0];
    expect(latestRelease?.id).toBe('2026-08-05-v1.6.11-holding-safe-deletion');
    expect(latestRelease?.time).toBe('23:28');
    expect(latestRelease?.version).toBe('v1.6.11');
    expect(latestRelease?.title).toBe('领地账本安全删除');
    expect(latestRelease?.items.join('')).toContain('驻军部队');

    const developerFactOverrideRelease = ALL_RELEASE_NOTES[0]?.updates[1];
    expect(developerFactOverrideRelease?.id).toBe('2026-08-05-v1.6.10-developer-fact-override');
    expect(developerFactOverrideRelease?.time).toBe('22:08');
    expect(developerFactOverrideRelease?.version).toBe('v1.6.10');
    expect(developerFactOverrideRelease?.title).toBe('本局事实纠错命令');
    expect(developerFactOverrideRelease?.items.join('')).toContain('/dev');

    const troopLedgerRelease = ALL_RELEASE_NOTES[0]?.updates[2];
    expect(troopLedgerRelease?.id).toBe('2026-08-05-v1.6.9-unified-troop-ledger-theater-war');
    expect(troopLedgerRelease?.time).toBe('21:22');
    expect(troopLedgerRelease?.version).toBe('v1.6.9');
    expect(troopLedgerRelease?.title).toBe('部队账本与战区战争优化');
    expect(troopLedgerRelease?.items.join('')).toContain('本场实际投入');

    const relationshipRelease = ALL_RELEASE_NOTES[0]?.updates[3];
    expect(relationshipRelease?.id).toBe('2026-08-05-v1.6.8-relationship-admission-evolution');
    expect(relationshipRelease?.time).toBe('17:23');
    expect(relationshipRelease?.version).toBe('v1.6.8');
    expect(relationshipRelease?.title).toBe('羁绊与红颜写入及演化优化');
    expect(relationshipRelease?.items.join('')).toContain('结构化成立事实');

    const narrativeLengthRelease = ALL_RELEASE_NOTES[0]?.updates[4];
    expect(narrativeLengthRelease?.id).toBe('2026-08-05-v1.6.7-narrative-length-retry-setting');
    expect(narrativeLengthRelease?.time).toBe('14:23');
    expect(narrativeLengthRelease?.version).toBe('v1.6.7');
    expect(narrativeLengthRelease?.title).toBe('正文字数自动重写设置');
    expect(narrativeLengthRelease?.items.join('')).toContain('90%');

    const threeTreasureRelease = ALL_RELEASE_NOTES[0]?.updates[5];
    expect(threeTreasureRelease?.id).toBe('2026-08-05-v1.6.6-three-treasure-combat');
    expect(threeTreasureRelease?.time).toBe('13:01');
    expect(threeTreasureRelease?.version).toBe('v1.6.6');
    expect(threeTreasureRelease?.title).toBe('三宝物槽战斗兼容修复');
    expect(threeTreasureRelease?.items.join('')).toContain('三件');

    const derivedPlayerAgeRelease = ALL_RELEASE_NOTES[0]?.updates[6];
    expect(derivedPlayerAgeRelease?.id).toBe('2026-08-05-v1.6.5-derived-player-age');
    expect(derivedPlayerAgeRelease?.time).toBe('11:13');
    expect(derivedPlayerAgeRelease?.version).toBe('v1.6.5');
    expect(derivedPlayerAgeRelease?.title).toBe('玩家年龄显示修复');
    expect(derivedPlayerAgeRelease?.items.join('')).toContain('出生日期');

    const stateWritebackRelease = ALL_RELEASE_NOTES[0]?.updates[7];
    expect(stateWritebackRelease?.id).toBe('2026-08-05-v1.6.4-state-writeback-isolation');
    expect(stateWritebackRelease?.time).toBe('10:52');
    expect(stateWritebackRelease?.version).toBe('v1.6.4');
    expect(stateWritebackRelease?.title).toBe('身份与产业写回稳定性修复');
    expect(stateWritebackRelease?.items.join('')).toContain('单独隔离');

    expect(ALL_RELEASE_NOTES[1]?.id).toBe('2026-08-04');
    expect(ALL_RELEASE_NOTES[1]?.updates).toHaveLength(7);

    const encounterDifficultyRelease = ALL_RELEASE_NOTES[1]?.updates[0];
    expect(encounterDifficultyRelease?.id).toBe('2026-08-04-v1.6.3-combat-war-difficulty');
    expect(encounterDifficultyRelease?.time).toBe('22:50');
    expect(encounterDifficultyRelease?.version).toBe('v1.6.3');
    expect(encounterDifficultyRelease?.title).toBe('个人战斗与战争难度设置');
    expect(encounterDifficultyRelease?.items.join('')).toContain('2.00、1.50、1.00、0.80、0.50');

    const privateAssetRelease = ALL_RELEASE_NOTES[1]?.updates[1];
    expect(privateAssetRelease?.id).toBe(
      '2026-08-04-v1.6.2-private-asset-management-and-acquisition',
    );
    expect(privateAssetRelease?.time).toBe('21:54');
    expect(privateAssetRelease?.version).toBe('v1.6.2');
    expect(privateAssetRelease?.title).toBe('私人产业治理与取得写回优化');
    expect(privateAssetRelease?.items.join('')).toContain('结构化产权事实');
    expect(privateAssetRelease?.items.join('')).toContain('重ROLL');

    const troopTypeDisplayRelease = ALL_RELEASE_NOTES[1]?.updates[2];
    expect(troopTypeDisplayRelease?.id).toBe('2026-08-04-v1.6.1-troop-type-display');
    expect(troopTypeDisplayRelease?.time).toBe('21:14');
    expect(troopTypeDisplayRelease?.version).toBe('v1.6.1');
    expect(troopTypeDisplayRelease?.title).toBe('兵种分类显示优化');

    const warAndHeavyCavalryRelease = ALL_RELEASE_NOTES[1]?.updates[3];
    expect(warAndHeavyCavalryRelease?.id).toBe(
      '2026-08-04-v1.6.0-war-and-heavy-cavalry-logistics',
    );
    expect(warAndHeavyCavalryRelease?.time).toBe('20:29');
    expect(warAndHeavyCavalryRelease?.version).toBe('v1.6.0');
    expect(warAndHeavyCavalryRelease?.title).toBe('战争与重骑后勤优化');
    expect(warAndHeavyCavalryRelease?.items.join('')).toContain('60至120天');

    const identityAndPrivateAssetsRelease = ALL_RELEASE_NOTES[1]?.updates[4];
    expect(identityAndPrivateAssetsRelease?.id).toBe(
      '2026-08-04-v1.5.7-identity-private-assets-writeback',
    );
    expect(identityAndPrivateAssetsRelease?.time).toBe('17:57');
    expect(identityAndPrivateAssetsRelease?.version).toBe('v1.5.7');
    expect(identityAndPrivateAssetsRelease?.title).toBe('身份与私人产业写回修复');
    expect(identityAndPrivateAssetsRelease?.items.join('')).toContain('不再必须等待九月年度结算');

    const treasureSlotRelease = ALL_RELEASE_NOTES[1]?.updates[5];
    expect(treasureSlotRelease?.id).toBe(
      '2026-08-04-v1.5.6-treasure-slot-consistency',
    );
    expect(treasureSlotRelease?.time).toBe('15:22');
    expect(treasureSlotRelease?.version).toBe('v1.5.6');
    expect(treasureSlotRelease?.title).toBe('宝物装备槽修复');
    expect(treasureSlotRelease?.items.join('')).toContain('无需先卸下第一件宝物');

    const mapAndArtRelease = ALL_RELEASE_NOTES[1]?.updates[6];
    expect(mapAndArtRelease?.id).toBe(
      '2026-08-04-v1.5.5-map-writeback-and-unique-art-growth',
    );
    expect(mapAndArtRelease?.time).toBe('11:16');
    expect(mapAndArtRelease?.version).toBe('v1.5.5');
    expect(mapAndArtRelease?.title).toBe('地图写回与绝艺成长修复');
    expect(mapAndArtRelease?.items.join('')).toContain('玩家实际到访的临时地点');
    expect(mapAndArtRelease?.items.join('')).toContain('封存战果');

    expect(ALL_RELEASE_NOTES[2]?.id).toBe('2026-08-03');
    expect(ALL_RELEASE_NOTES[2]?.date).toBe('2026年8月3日');
    expect(ALL_RELEASE_NOTES[2]?.updates).toHaveLength(5);

    const npcMemoryRelease = ALL_RELEASE_NOTES[2]?.updates[0];
    expect(npcMemoryRelease?.id).toBe(
      '2026-08-03-v1.5.4-npc-memory-and-prompt-cache',
    );
    expect(npcMemoryRelease?.time).toBe('20:57');
    expect(npcMemoryRelease?.version).toBe('v1.5.4');
    expect(npcMemoryRelease?.title).toBe('人物记忆查看与提示缓存优化');
    expect(npcMemoryRelease?.items.join('')).toContain('近期、中期、长期');
    expect(npcMemoryRelease?.items.join('')).toContain('缓存读取');

    const birthdayRelease = ALL_RELEASE_NOTES[2]?.updates[1];
    expect(birthdayRelease?.id).toBe(
      '2026-08-03-v1.5.3-character-birthdate-and-combat-support',
    );
    expect(birthdayRelease?.time).toBe('17:11');
    expect(birthdayRelease?.version).toBe('v1.5.3');
    expect(birthdayRelease?.title).toBe('角色生日与战斗援护优化');
    expect(birthdayRelease?.items.join('')).toContain('完整出生日期');
    expect(birthdayRelease?.items.join('')).toContain('真实消耗援护者生命');

    const stableProjectionRelease = ALL_RELEASE_NOTES[2]?.updates[2];
    expect(stableProjectionRelease?.id).toBe(
      '2026-08-03-v1.5.2-stable-unique-art-projections',
    );
    expect(stableProjectionRelease?.time).toBe('13:14');
    expect(stableProjectionRelease?.version).toBe('v1.5.2');
    expect(stableProjectionRelease?.title).toBe('绝艺战斗联动优化');
    expect(stableProjectionRelease?.items.join('')).toContain('不会替换、重置');
    expect(stableProjectionRelease?.items.join('')).toContain('实际可执行');

    const writebackTimeoutRelease = ALL_RELEASE_NOTES[2]?.updates[3];
    expect(writebackTimeoutRelease?.id).toBe(
      '2026-08-03-v1.5.1-writeback-timeout-budget',
    );
    expect(writebackTimeoutRelease?.time).toBe('10:02');
    expect(writebackTimeoutRelease?.version).toBe('v1.5.1');
    expect(writebackTimeoutRelease?.title).toBe('状态写回等待时间优化');
    expect(writebackTimeoutRelease?.items.join('')).toContain('120 秒');
    expect(writebackTimeoutRelease?.items.join('')).toContain('同一路由失败保护');

    const relationshipEvolutionRelease = ALL_RELEASE_NOTES[2]?.updates[4];
    expect(relationshipEvolutionRelease?.id).toBe(
      '2026-08-03-v1.5.0-relationship-world-evolution',
    );
    expect(relationshipEvolutionRelease?.time).toBe('09:52');
    expect(relationshipEvolutionRelease?.version).toBe('v1.5.0');
    expect(relationshipEvolutionRelease?.title).toBe('关系人物近况与世界演化');
    expect(relationshipEvolutionRelease?.items.join('')).toContain('历史人物');
    expect(relationshipEvolutionRelease?.items.join('')).toContain('世界纪事');

    expect(ALL_RELEASE_NOTES[3]?.id).toBe('2026-08-02');
    expect(ALL_RELEASE_NOTES[3]?.date).toBe('2026年8月2日');
    expect(ALL_RELEASE_NOTES[3]?.updates).toHaveLength(6);

    const combatBalanceRelease = ALL_RELEASE_NOTES[3]?.updates[0];
    expect(combatBalanceRelease?.id).toBe(
      '2026-08-02-v1.4.2-combat-balance-and-equipment-quality',
    );
    expect(combatBalanceRelease?.time).toBe('22:40');
    expect(combatBalanceRelease?.version).toBe('v1.4.2');
    expect(combatBalanceRelease?.title).toBe('战斗平衡与装备品级优化');
    expect(combatBalanceRelease?.items.join('')).toContain('普通、良好、精良、珍贵、传说、绝世');
    expect(combatBalanceRelease?.items.join('')).toContain('组合预算');

    const mobileFeatureSettingsRelease = ALL_RELEASE_NOTES[3]?.updates[1];
    expect(mobileFeatureSettingsRelease?.id).toBe(
      '2026-08-02-v1.4.1-mobile-feature-settings-navigation',
    );
    expect(mobileFeatureSettingsRelease?.time).toBe('20:35');
    expect(mobileFeatureSettingsRelease?.version).toBe('v1.4.1');
    expect(mobileFeatureSettingsRelease?.title).toBe('手机端功能配置入口优化');
    expect(mobileFeatureSettingsRelease?.items.join('')).toContain('直接进入记忆配置');
    expect(mobileFeatureSettingsRelease?.items.join('')).toContain('横滑标签');

    const cloudSaveRelease = ALL_RELEASE_NOTES[3]?.updates[2];
    expect(cloudSaveRelease?.id).toBe('2026-08-02-v1.4.0-cloud-save-and-core-systems');
    expect(cloudSaveRelease?.time).toBe('19:45');
    expect(cloudSaveRelease?.version).toBe('v1.4.0');
    expect(cloudSaveRelease?.title).toBe('云存档与核心系统大更新');
    expect(cloudSaveRelease?.items.join('')).toContain('Discord 云存档');
    expect(cloudSaveRelease?.items.join('')).toContain('API 配置默认不上传');
    expect(cloudSaveRelease?.items.join('')).toContain('提示词');
    expect(cloudSaveRelease?.items.join('')).toContain('备用 API');

    const factionAndSaveRelease = ALL_RELEASE_NOTES[3]?.updates[3];
    expect(factionAndSaveRelease?.id).toBe(
      '2026-08-02-v1.3.10-faction-history-and-mobile-save-import',
    );
    expect(factionAndSaveRelease?.time).toBe('09:00');
    expect(factionAndSaveRelease?.version).toBe('v1.3.10');
    expect(factionAndSaveRelease?.title).toBe('势力记录与跨端存档优化');
    expect(factionAndSaveRelease?.items.join('')).toContain('独立滚动区域');
    expect(factionAndSaveRelease?.items.join('')).toContain('时间未详');
    expect(factionAndSaveRelease?.items.join('')).toContain('兼容读取方式');
    expect(factionAndSaveRelease?.items.join('')).toContain('原子导入边界');

    const resourceLedgerRelease = ALL_RELEASE_NOTES[3]?.updates[4];
    expect(resourceLedgerRelease?.id).toBe('2026-08-02-v1.3.9-resource-ledger-writeback');
    expect(resourceLedgerRelease?.time).toBe('01:12');
    expect(resourceLedgerRelease?.version).toBe('v1.3.9');
    expect(resourceLedgerRelease?.title).toBe('府库资源写回修复');
    expect(resourceLedgerRelease?.items.join('')).toContain('不会按正文关键词擅自增减资源');
    expect(resourceLedgerRelease?.items.join('')).toContain('实际写入的资源目标和值');

    const writebackAndFailedTraceRelease = ALL_RELEASE_NOTES[3]?.updates[5];
    expect(writebackAndFailedTraceRelease?.id).toBe(
      '2026-08-02-v1.3.8-writeback-review-and-failed-trace',
    );
    expect(writebackAndFailedTraceRelease?.time).toBe('00:47');
    expect(writebackAndFailedTraceRelease?.version).toBe('v1.3.8');
    expect(writebackAndFailedTraceRelease?.title).toBe('写回核对与失败轨迹优化');
    expect(writebackAndFailedTraceRelease?.items.join('')).toContain('高风险破坏性变化');
    expect(writebackAndFailedTraceRelease?.items.join('')).toContain('自动展开最近一次 AI 处理轨迹');
    expect(writebackAndFailedTraceRelease?.items.join('')).toContain('未写入存档');

    expect(ALL_RELEASE_NOTES[4]?.id).toBe('2026-08-01');
    expect(ALL_RELEASE_NOTES[4]?.date).toBe('2026年8月1日');
    expect(ALL_RELEASE_NOTES[4]?.updates).toHaveLength(10);

    const governanceAndPerspectiveRelease = ALL_RELEASE_NOTES[4]?.updates[0];
    expect(governanceAndPerspectiveRelease?.id).toBe(
      '2026-08-01-v1.3.7-holding-governance-and-narrative-perspective',
    );
    expect(governanceAndPerspectiveRelease?.time).toBe('23:48');
    expect(governanceAndPerspectiveRelease?.version).toBe('v1.3.7');
    expect(governanceAndPerspectiveRelease?.title).toBe('领地治理与叙事人称优化');
    expect(governanceAndPerspectiveRelease?.items.join('')).toContain('郡国继续作为区域层级');
    expect(governanceAndPerspectiveRelease?.items.join('')).toContain('不会使用表字');
    expect(governanceAndPerspectiveRelease?.items.join('')).toContain('不改写历史正文');

    const saveImportRelease = ALL_RELEASE_NOTES[4]?.updates[1];
    expect(saveImportRelease?.id).toBe('2026-08-01-v1.3.6-save-import-route-notes');
    expect(saveImportRelease?.time).toBe('21:48');
    expect(saveImportRelease?.version).toBe('v1.3.6');
    expect(saveImportRelease?.title).toBe('存档导入兼容修复');
    expect(saveImportRelease?.items.join('')).toContain('地图路线');
    expect(saveImportRelease?.items.join('')).toContain('无需手动修改存档');
    expect(saveImportRelease?.items.join('')).toContain('仍会严格校验');

    const crossDeviceSaveRelease = ALL_RELEASE_NOTES[4]?.updates[2];
    expect(crossDeviceSaveRelease?.id).toBe('2026-08-01-v1.3.5-cross-device-save-export');
    expect(crossDeviceSaveRelease?.time).toBe('21:30');
    expect(crossDeviceSaveRelease?.version).toBe('v1.3.5');
    expect(crossDeviceSaveRelease?.title).toBe('跨设备存档导出修复');
    expect(crossDeviceSaveRelease?.items.join('')).toContain('不完整压缩包');
    expect(crossDeviceSaveRelease?.items.join('')).toContain('旧版 JSON');
    expect(crossDeviceSaveRelease?.items.join('')).toContain('不改变玩家已有存档');

    const seasonalClockRelease = ALL_RELEASE_NOTES[4]?.updates[3];
    expect(seasonalClockRelease?.id).toBe('2026-08-01-v1.3.4-seasonal-opening-clock');
    expect(seasonalClockRelease?.time).toBe('20:37');
    expect(seasonalClockRelease?.version).toBe('v1.3.4');
    expect(seasonalClockRelease?.title).toBe('季节开局时间修复');
    expect(seasonalClockRelease?.items.join('')).toContain('不再把无法解析的季节日期');
    expect(seasonalClockRelease?.items.join('')).toContain('保留此前已经推进的分钟数');

    const mapAndPostprocessRelease = ALL_RELEASE_NOTES[4]?.updates[4];
    expect(mapAndPostprocessRelease?.id).toBe('2026-08-01-v1.3.3-map-detail-and-npc-postprocess');
    expect(mapAndPostprocessRelease?.time).toBe('20:23');
    expect(mapAndPostprocessRelease?.version).toBe('v1.3.3');
    expect(mapAndPostprocessRelease?.title).toBe('地图详图与回合提速优化');
    expect(mapAndPostprocessRelease?.items.join('')).toContain('24 倍');
    expect(mapAndPostprocessRelease?.items.join('')).toContain('不再触发人物志补全');
    expect(mapAndPostprocessRelease?.items.join('')).toContain('不再额外请求 API');

    const terminalTroopRelease = ALL_RELEASE_NOTES[4]?.updates[5];
    expect(terminalTroopRelease?.id).toBe('2026-08-01-v1.3.2-terminal-troop-narrative-fallback');
    expect(terminalTroopRelease?.time).toBe('18:20');
    expect(terminalTroopRelease?.version).toBe('v1.3.2');
    expect(terminalTroopRelease?.title).toBe('溃散部队剧情承接优化');
    expect(terminalTroopRelease?.items.join('')).toContain('继续开放剧情');
    expect(terminalTroopRelease?.items.join('')).toContain('不会以原番号重新作为完整军队参战');
    expect(terminalTroopRelease?.items.join('')).toContain('不会额外重试 API');
    expect(terminalTroopRelease?.items.join('')).toContain('仍会严格拦截');

    const narrativeWaitRelease = ALL_RELEASE_NOTES[4]?.updates[6];
    expect(narrativeWaitRelease?.id).toBe('2026-08-01-v1.3.1-encounter-narrative-wait');
    expect(narrativeWaitRelease?.time).toBe('17:26');
    expect(narrativeWaitRelease?.version).toBe('v1.3.1');
    expect(narrativeWaitRelease?.title).toBe('战后正文等待提示优化');
    expect(narrativeWaitRelease?.items.join('')).toContain('战场中央');
    expect(narrativeWaitRelease?.items.join('')).toContain('中止生成');
    expect(narrativeWaitRelease?.items.join('')).toContain('不改变战斗、战争的结算结果');

    const governanceRelease = ALL_RELEASE_NOTES[4]?.updates[7];
    expect(governanceRelease?.id).toBe('2026-08-01-v1.3.0-unique-art-growth-and-governance');
    expect(governanceRelease?.time).toBe('15:50');
    expect(governanceRelease?.version).toBe('v1.3.0');
    expect(governanceRelease?.title).toBe('绝艺成长与领地治理');
    expect(governanceRelease?.items.join('')).toContain('积累进度并升级');
    expect(governanceRelease?.items.join('')).toContain('八类领地治理项目');
    expect(governanceRelease?.items.join('')).toContain('纯军事设施');
    expect(governanceRelease?.items.join('')).toContain('显示正则');
    expect(governanceRelease?.items.join('')).toContain('状态写回均不会改变');

    const warArtRelease = ALL_RELEASE_NOTES[4]?.updates[8];
    expect(warArtRelease?.id).toBe('2026-08-01-v1.2.22-war-art-projection-compatibility');
    expect(warArtRelease?.time).toBe('11:48');
    expect(warArtRelease?.version).toBe('v1.2.22');
    expect(warArtRelease?.title).toBe('战争绝艺施展修复');
    expect(warArtRelease?.items.join('')).toContain('不存在或没有可执行战争投影');
    expect(warArtRelease?.items.join('')).toContain('长期绝艺档案');
    expect(warArtRelease?.items.join('')).toContain('开战检查点');

    const processingTraceRelease = ALL_RELEASE_NOTES[4]?.updates[9];
    expect(processingTraceRelease?.id).toBe('2026-08-01-v1.2.21-fact-gate-and-processing-trace');
    expect(processingTraceRelease?.time).toBe('09:18');
    expect(processingTraceRelease?.version).toBe('v1.2.21');
    expect(processingTraceRelease?.title).toBe('事实写回与 AI 处理轨迹优化');
    expect(processingTraceRelease?.items.join('')).toContain('不会直接改写账本');
    expect(processingTraceRelease?.items.join('')).toContain('取得依据');
    expect(processingTraceRelease?.items.join('')).toContain('自动重试一次');
    expect(processingTraceRelease?.items.join('')).toContain('不会额外调用 API');

    expect(RELEASE_NOTES).toHaveLength(5);
    expect(RELEASE_NOTES[0]?.id).toBe('2026-07-31');
    expect(RELEASE_NOTES[0]?.date).toBe('2026年7月31日');
    expect(RELEASE_NOTES[0]?.updates).toHaveLength(8);

    const uniqueArtRelease = RELEASE_NOTES[0]?.updates[0];
    expect(uniqueArtRelease?.id).toBe('2026-07-31-v1.2.20-unique-art-append');
    expect(uniqueArtRelease?.time).toBe('22:28');
    expect(uniqueArtRelease?.version).toBe('v1.2.20');
    expect(uniqueArtRelease?.title).toBe('绝艺追加与保留修复');
    expect(uniqueArtRelease?.items.join('')).toContain('追加到现有列表');
    expect(uniqueArtRelease?.items.join('')).toContain('不会被意外清空或降级');
    expect(uniqueArtRelease?.items.join('')).toContain('主角与 NPC');

    const escortRelease = RELEASE_NOTES[0]?.updates[1];
    expect(escortRelease?.id).toBe('2026-07-31-v1.2.19-personal-combat-escorts');
    expect(escortRelease?.time).toBe('22:14');
    expect(escortRelease?.version).toBe('v1.2.19');
    expect(escortRelease?.title).toBe('个人战随身护卫优化');
    expect(escortRelease?.items.join('')).toContain('最多两名随身护卫');
    expect(escortRelease?.items.join('')).toContain('不会凭空生成临时队友');
    expect(escortRelease?.items.join('')).toContain('不会进入人物志');

    const combatResultRelease = RELEASE_NOTES[0]?.updates[2];
    expect(combatResultRelease?.id).toBe('2026-07-31-v1.2.18-combat-result-player-identity');
    expect(combatResultRelease?.time).toBe('19:11');
    expect(combatResultRelease?.version).toBe('v1.2.18');
    expect(combatResultRelease?.title).toBe('个人战战果保存修复');
    expect(combatResultRelease?.items.join('')).toContain('真实玩家');
    expect(combatResultRelease?.items.join('')).toContain('重新封存战果');
    expect(combatResultRelease?.items.join('')).toContain('同一事务中提交');

    const encounterStartRelease = RELEASE_NOTES[0]?.updates[3];
    expect(encounterStartRelease?.id).toBe('2026-07-31-v1.2.17-encounter-start-layout');
    expect(encounterStartRelease?.time).toBe('18:42');
    expect(encounterStartRelease?.version).toBe('v1.2.17');
    expect(encounterStartRelease?.title).toBe('战斗与战争开战入口优化');
    expect(encounterStartRelease?.items.join('')).toContain('战场中央');
    expect(encounterStartRelease?.items.join('')).toContain('手机窄屏');
    expect(encounterStartRelease?.items.join('')).toContain('流程保持不变');

    const customTraitRelease = RELEASE_NOTES[0]?.updates[4];
    expect(customTraitRelease?.id).toBe('2026-07-31-v1.2.16-custom-trait-management');
    expect(customTraitRelease?.time).toBe('17:57');
    expect(customTraitRelease?.version).toBe('v1.2.16');
    expect(customTraitRelease?.title).toBe('开局自定义特质管理优化');
    expect(customTraitRelease?.items.join('')).toContain('按世界书保存在本地');
    expect(customTraitRelease?.items.join('')).toContain('新增编辑入口');
    expect(customTraitRelease?.items.join('')).toContain('再次确认');
    expect(customTraitRelease?.items.join('')).toContain('预设特质不会出现编辑或删除入口');

    const actionShortcutRelease = RELEASE_NOTES[0]?.updates[5];
    expect(actionShortcutRelease?.id).toBe('2026-07-31-v1.2.15-action-input-shortcut');
    expect(actionShortcutRelease?.time).toBe('17:26');
    expect(actionShortcutRelease?.version).toBe('v1.2.15');
    expect(actionShortcutRelease?.title).toBe('行动输入快捷键优化');
    expect(actionShortcutRelease?.items.join('')).toContain('普通回车现在只负责换行');
    expect(actionShortcutRelease?.items.join('')).toContain('键盘右侧 Ctrl');
    expect(actionShortcutRelease?.items.join('')).toContain('左侧 Ctrl 不会');

    const npcArchiveRelease = RELEASE_NOTES[0]?.updates[6];
    expect(npcArchiveRelease?.id).toBe('2026-07-31-v1.2.14-npc-archive-management');
    expect(npcArchiveRelease?.time).toBe('16:54');
    expect(npcArchiveRelease?.version).toBe('v1.2.14');
    expect(npcArchiveRelease?.title).toBe('人物志整理与建档优化');
    expect(npcArchiveRelease?.items.join('')).toContain('不会仅因有姓名或说过话');
    expect(npcArchiveRelease?.items.join('')).toContain('完成招募、收留、正式任命');
    expect(npcArchiveRelease?.items.join('')).toContain('二次确认');
    expect(npcArchiveRelease?.items.join('')).toContain('阻止删除');

    const npcContactRelease = RELEASE_NOTES[0]?.updates[7];
    expect(npcContactRelease?.id).toBe('2026-07-31-v1.2.13-npc-contact-growth');
    expect(npcContactRelease?.time).toBe('00:25');
    expect(npcContactRelease?.version).toBe('v1.2.13');
    expect(npcContactRelease?.title).toBe('NPC往来度成长优化');
    expect(npcContactRelease?.items.join('')).toContain('并不等同好感');
    expect(npcContactRelease?.items.join('')).toContain('不会重复累计');
    expect(npcContactRelease?.items.join('')).toContain('红颜与羁绊关系');

    expect(RELEASE_NOTES[1]?.id).toBe('2026-07-30');
    expect(RELEASE_NOTES[1]?.date).toBe('2026年7月30日');
    expect(RELEASE_NOTES[1]?.updates).toHaveLength(10);

    const warCommandRelease = RELEASE_NOTES[1]?.updates[0];
    expect(warCommandRelease?.id).toBe('2026-07-30-v1.2.12-war-command-and-officers');
    expect(warCommandRelease?.time).toBe('23:43');
    expect(warCommandRelease?.version).toBe('v1.2.12');
    expect(warCommandRelease?.title).toBe('战争指挥与随军计策优化');
    expect(warCommandRelease?.items.join('')).toContain('统率系数');
    expect(warCommandRelease?.items.join('')).toContain('副将、军师或带兵将领');
    expect(warCommandRelease?.items.join('')).toContain('每方每场仍只能主动施展一次');

    const privateAssetsAndCurrencyRelease = RELEASE_NOTES[1]?.updates[1];
    expect(privateAssetsAndCurrencyRelease?.id).toBe('2026-07-30-v1.2.11-private-assets-and-currency');
    expect(privateAssetsAndCurrencyRelease?.time).toBe('22:11');
    expect(privateAssetsAndCurrencyRelease?.version).toBe('v1.2.11');
    expect(privateAssetsAndCurrencyRelease?.title).toBe('私人产业与钱货账本修复');
    expect(privateAssetsAndCurrencyRelease?.items.join('')).toContain('必须有明确取得依据');
    expect(privateAssetsAndCurrencyRelease?.items.join('')).toContain('1000钱=1贯');
    expect(privateAssetsAndCurrencyRelease?.items.join('')).toContain('不会自动改变铜钱余额');

    const update = RELEASE_NOTES[1]?.updates[2];
    expect(update?.id).toBe('2026-07-30-v1.2.10-npc-unique-art-archives');
    expect(update?.time).toBe('19:12');
    expect(update?.version).toBe('v1.2.10');
    expect(update?.title).toBe('NPC绝艺档案稳定性优化');
    expect(update?.items.join('')).toContain('90—94 传说、95 以上绝世');
    expect(update?.items.join('')).toContain('不会删除、降级、改名或替换其稳定 ID');
    expect(update?.items.join('')).toContain('当回合相关人物');

    const playerRecoveryRelease = RELEASE_NOTES[1]?.updates[3];
    expect(playerRecoveryRelease?.id).toBe('2026-07-30-v1.2.9-player-recovery-semantics');
    expect(playerRecoveryRelease?.time).toBe('16:59');
    expect(playerRecoveryRelease?.version).toBe('v1.2.9');
    expect(playerRecoveryRelease?.title).toBe('休息与疗伤结算修复');
    expect(playerRecoveryRelease?.items.join('')).toContain('实际完成并推进了游戏时间');
    expect(playerRecoveryRelease?.items.join('')).toContain('不再扫描玩家输入或正文关键词');
    expect(playerRecoveryRelease?.items.join('')).toContain('生命和体力保持原值');

    const warReferenceRelease = RELEASE_NOTES[1]?.updates[4];
    expect(warReferenceRelease?.id).toBe('2026-07-30-v1.2.8-war-reference-integrity');
    expect(warReferenceRelease?.time).toBe('15:14');
    expect(warReferenceRelease?.version).toBe('v1.2.8');
    expect(warReferenceRelease?.title).toBe('战争目标与部队建档修复');
    expect(warReferenceRelease?.items.join('')).toContain('同一回合先完成结构化建档');
    expect(warReferenceRelease?.items.join('')).toContain('整回合不会保存');
    expect(warReferenceRelease?.items.join('')).toContain('战争系统本地结算');

    const encounterTransitionRelease = RELEASE_NOTES[1]?.updates[5];
    expect(encounterTransitionRelease?.id).toBe('2026-07-30-v1.2.7-encounter-transition');
    expect(encounterTransitionRelease?.time).toBe('13:42');
    expect(encounterTransitionRelease?.version).toBe('v1.2.7');
    expect(encounterTransitionRelease?.title).toBe('战斗场景切入优化');
    expect(encounterTransitionRelease?.items.join('')).toContain('迎战 / 暂不交锋');
    expect(encounterTransitionRelease?.items.join('')).toContain('临时参战者');
    expect(encounterTransitionRelease?.items.join('')).toContain('不调用 API');

    const loadoutRelease = RELEASE_NOTES[1]?.updates[6];
    expect(loadoutRelease?.id).toBe('2026-07-30-v1.2.6-loadout-identity');
    expect(loadoutRelease?.time).toBe('12:14');
    expect(loadoutRelease?.version).toBe('v1.2.6');
    expect(loadoutRelease?.title).toBe('人物装备身份与槽位修复');
    expect(loadoutRelease?.items.join('')).toContain('真正占据装备槽');
    expect(loadoutRelease?.items.join('')).toContain('宝物最多三件');
    expect(loadoutRelease?.items.join('')).toContain('超出槽位的装备会安全回到背包');

    const factionRelease = RELEASE_NOTES[1]?.updates[7];
    expect(factionRelease?.id).toBe('2026-07-30-v1.2.5-faction-actions-and-defeated-troops');
    expect(factionRelease?.time).toBe('11:40');
    expect(factionRelease?.version).toBe('v1.2.5');
    expect(factionRelease?.title).toBe('势力动态与败军归档修复');
    expect(factionRelease?.items.join('')).toContain('同一回合更新近期动作');
    expect(factionRelease?.items.join('')).toContain('退出当前部队面板');
    expect(factionRelease?.items.join('')).toContain('真正的新建制');

    const combatRelease = RELEASE_NOTES[1]?.updates[8];
    expect(combatRelease?.id).toBe('2026-07-30-v1.2.4-combat-equipment-balance');
    expect(combatRelease?.time).toBe('09:57');
    expect(combatRelease?.version).toBe('v1.2.4');
    expect(combatRelease?.title).toBe('个人战装备与实力差距优化');
    expect(combatRelease?.items.join('')).toContain('伤害、命中、破甲和行动速度');
    expect(combatRelease?.items.join('')).toContain('不引入玩家等级体系');

    const encounterSafetyRelease = RELEASE_NOTES[1]?.updates[9];
    expect(encounterSafetyRelease?.id).toBe('2026-07-30-v1.2.3-encounter-json-safety');
    expect(encounterSafetyRelease?.time).toBe('00:19');
    expect(encounterSafetyRelease?.version).toBe('v1.2.3');
    expect(encounterSafetyRelease?.title).toBe('战争触发可靠性修复');
    expect(encounterSafetyRelease?.items.join('')).toContain('不指定主将');
    expect(encounterSafetyRelease?.items.join('')).toContain('具体字段位置');

    const outputLimitRelease = RELEASE_NOTES[2]?.updates[0];
    expect(outputLimitRelease?.id).toBe('2026-07-29-v1.2.2-api-output-limits');
    expect(outputLimitRelease?.time).toBe('21:41');
    expect(outputLimitRelease?.version).toBe('v1.2.2');
    expect(outputLimitRelease?.title).toBe('API 输出上限设置优化');
    expect(outputLimitRelease?.items.join('')).toContain('8K、32K、64K');
    expect(outputLimitRelease?.items.join('')).toContain('不会自动改善');

    const restorativeRelease = RELEASE_NOTES[2]?.updates[1];
    expect(restorativeRelease?.id).toBe('2026-07-29-v1.2.1-restorative-items');
    expect(restorativeRelease?.time).toBe('20:59');
    expect(restorativeRelease?.version).toBe('v1.2.1');
    expect(restorativeRelease?.title).toBe('恢复品直用与品质体系优化');
    expect(restorativeRelease?.items.join('')).toContain('不调用 API');
    expect(restorativeRelease?.items.join('')).toContain('10、20、30、50、80、100');

    const progressionRelease = RELEASE_NOTES[2]?.updates[2];
    expect(progressionRelease?.id).toBe('2026-07-29-v1.2.0-progression-growth');
    expect(progressionRelease?.time).toBe('18:37');
    expect(progressionRelease?.version).toBe('v1.2.0');
    expect(progressionRelease?.title).toBe('阅历成长体系优化');
    expect(progressionRelease?.items.join('')).toContain('每个合法普通判定');
    expect(progressionRelease?.items.join('')).toContain('不直接增减阅历倍率');

    const memoryRelease = RELEASE_NOTES[2]?.updates[3];
    expect(memoryRelease?.id).toBe('2026-07-29-v1.1.1-memory-and-opening-wait');
    expect(memoryRelease?.time).toBe('12:33');
    expect(memoryRelease?.version).toBe('v1.1.1');
    expect(memoryRelease?.title).toBe('记忆整理与开局等待优化');
    expect(memoryRelease?.items.join('')).toContain('本回合内容和原始记忆');
    expect(memoryRelease?.items.join('')).toContain('不再重复第二个完整请求窗口');

    const difficultyRelease = RELEASE_NOTES[2]?.updates[4];
    expect(difficultyRelease?.id).toBe('2026-07-29-v1.1.0-difficulty-and-opening-layout');
    expect(difficultyRelease?.time).toBe('07:35');
    expect(difficultyRelease?.version).toBe('v1.1.0');
    expect(difficultyRelease?.title).toBe('五档难度与开局剧本排版优化');
    expect(difficultyRelease?.items.join('')).toContain('剧情、轻松、标准、困难或严酷');
    expect(difficultyRelease?.items.join('')).toContain('桌面四列紧凑卡片排版');

    const openingLayoutPatch = RELEASE_NOTES[3]?.updates[0];
    expect(openingLayoutPatch?.id).toBe('2026-07-28-v1.0.2-opening-period-cards');
    expect(openingLayoutPatch?.title).toBe('开局年代卡片排版优化');
    expect(`${openingLayoutPatch?.summary}${openingLayoutPatch?.items.join('')}`).not.toContain('恢复');

    const mapPatch = RELEASE_NOTES[3]?.updates[1];
    expect(mapPatch?.id).toBe('2026-07-28-v1.0.1-map-drag-fix');
    expect(mapPatch?.time).toBe('18:34');
    expect(mapPatch?.version).toBe('v1.0.1');
    expect(mapPatch?.title).toBe('地图拖动交互修复');
    expect(mapPatch?.items.join('')).toContain('完整地图同步平移');

    const officialRelease = RELEASE_NOTES[4]?.updates[0];
    expect(officialRelease?.id).toBe('2026-07-27-v1.0.0-official-release');
    expect(officialRelease?.time).toBe('13:34');
    expect(officialRelease?.version).toBe('v1.0.0');
    expect(officialRelease?.title).toBe('游戏正式上线');
    expect(officialRelease?.items.join('')).toContain('1500 条');
    expect(`${officialRelease?.summary}${officialRelease?.items.join('')}`).not.toMatch(/匿名|统计|口令|收集|修复|测试|验收/);
  });

  it('offers the newest changelog once per local day', () => {
    const storage = new MemoryStorage();
    const morning = new Date(2026, 6, 29, 8, 30);

    expect(shouldShowDailyReleaseNotes(storage, morning)).toBe(true);
    recordDailyReleaseNotesView(storage, morning);
    expect(shouldShowDailyReleaseNotes(storage, new Date(2026, 6, 29, 22, 10))).toBe(false);
    expect(shouldShowDailyReleaseNotes(storage, new Date(2026, 6, 30, 0, 1))).toBe(true);
  });

  it('offers the changelog again when a newer update was added on the same day', () => {
    const storage = new MemoryStorage();
    storage.setItem(CHANGELOG_DAILY_VIEW_KEY, JSON.stringify({
      localDate: '2026-07-27',
      latestUpdateId: 'older-update',
    }));

    expect(shouldShowDailyReleaseNotes(storage, new Date(2026, 6, 27, 18, 0))).toBe(true);
  });

  it('uses the local calendar date instead of UTC rollover', () => {
    expect(formatLocalDateKey(new Date(2026, 6, 5, 23, 59))).toBe('2026-07-05');
  });
});
