import { describe, expect, it } from 'vitest';
import { threeKingdomsPrompts } from '../../worldbooks/threeKingdoms/prompts';
import { getPromptRegistry } from './PromptRegistry';

const canonicalLocationProtocolClauses = [
  'locationWriteSuggestions must include locationId, name, aliases, kind, mapLayer, parentId, summary, permanence; aliases are optional exact identity tokens.',
  'canonical key = parentId + mapLayer + kind/level + normalized name/aliases.',
  'Normalize name/aliases with NFKC, trim, collapse whitespace, and lowercase only; do not remove suffixes such as 县/郡/城.',
  'Exact locationId reuse is allowed only when parentId + mapLayer + kind/level scope matches.',
  'Worldbook seed identity is authoritative; incoming writeback must not change a seed parentId, mapLayer, or kind/level.',
  'If multiple canonical candidates match, do not guess or publish an alias mapping; return a structured diagnostic.',
] as const;

describe('PromptRegistry', () => {
  it('registers the complete shared canonical location contract in state writer and Map V1 templates', () => {
    const registry = getPromptRegistry();
    const entries = ['main.stateWriterProtocol', 'map.writebackProtocol'].map((id) => {
      const entry = registry.find((item) => item.id === id);
      expect(entry, `missing prompt registry entry ${id}`).toBeDefined();
      return entry!;
    });

    for (const entry of entries) {
      for (const clause of canonicalLocationProtocolClauses) {
        expect(entry.defaultContentTemplate, `${entry.id} missing clause: ${clause}`).toContain(clause);
      }
    }
  });

  it('returns a non-empty read-only prompt metadata list with unique ids', () => {
    const registry = getPromptRegistry();

    expect(registry.length).toBeGreaterThan(0);
    expect(new Set(registry.map((entry) => entry.id)).size).toBe(registry.length);
  });

  it('registers required metadata for every prompt entry', () => {
    for (const entry of getPromptRegistry()) {
      expect(entry.id.trim()).not.toBe('');
      expect(entry.category.trim()).not.toBe('');
      expect(entry.title.trim()).not.toBe('');
      expect(entry.description.trim()).not.toBe('');
      expect(entry.sourceFile.trim()).not.toBe('');
      expect(entry.usedBy.length).toBeGreaterThan(0);
      expect(entry.order).toBeGreaterThan(0);
      expect(['low', 'medium', 'high']).toContain(entry.riskLevel);
      expect(['safe', 'advanced', 'locked']).toContain(entry.editLevel);
    }
  });

  it('marks high-risk protocol entries as locked', () => {
    const highRiskEntries = getPromptRegistry().filter((entry) => entry.riskLevel === 'high');

    expect(highRiskEntries.length).toBeGreaterThan(0);
    expect(highRiskEntries.every((entry) => entry.editLevel === 'locked')).toBe(true);
  });

  it('contains stable entries for the first read-only registry slice', () => {
    const ids = getPromptRegistry().map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining([
      'main.systemPrompt',
      'worldline.knowledgeProjectionPolicy',
      'main.userPrompt',
      'main.stateWriterProtocol',
      'opening.trueOpeningPrompt',
      'opening.reputationProtocol',
      'opening.factionLedgerProtocol',
      'opening.holdingAssetProtocol',
      'npc.profileWritebackProtocol',
      'npcSimulation.systemPrompt',
      'npcSimulation.userPrompt',
      'femaleProfile.writebackProtocol',
      'time.advanceProtocol',
      'time.derivedAgeProtocol',
      'map.writebackProtocol',
      'dynamic.currentMatterProtocol',
      'dynamic.signalProtocol',
      'holding.ledgerWritebackProtocol',
      'holding.domesticReportProtocol',
      'memory.summaryCompressionPrompt',
      'worldbook.prompts',
    ]));
  });

  it('adds user-facing content view metadata for the major entries', () => {
    const registry = getPromptRegistry();
    const requiredIds = [
      'worldbook.narrativeBaseline',
      'worldbook.toneGuide',
      'main.systemPrompt',
      'worldline.knowledgeProjectionPolicy',
      'main.userPrompt',
      'opening.trueOpeningPrompt',
      'opening.reputationProtocol',
      'opening.factionLedgerProtocol',
      'opening.holdingAssetProtocol',
      'npc.profileWritebackProtocol',
      'npc.memoryWritebackProtocol',
      'npcSimulation.systemPrompt',
      'npcSimulation.userPrompt',
      'femaleProfile.writebackProtocol',
      'time.advanceProtocol',
      'time.derivedAgeProtocol',
      'map.writebackProtocol',
      'memory.summaryCompressionPrompt',
      'dynamic.currentMatterProtocol',
      'dynamic.signalProtocol',
      'holding.ledgerWritebackProtocol',
      'holding.domesticReportProtocol',
      'world.worldEventWriteback',
      'world.plotPlanSuggestions',
    ];

    for (const id of requiredIds) {
      const entry = registry.find((item) => item.id === id);
      expect(entry, id).toBeTruthy();
      expect(entry?.displayTitleZh?.trim(), id).not.toBe('');
      expect(entry?.displayCategoryZh?.trim(), id).not.toBe('');
      expect(entry?.userFacingDescription?.trim(), id).not.toBe('');
      expect(entry?.contentViewType, id).toBeTruthy();
    }
  });

  it('references source constants for worldbook full-text prompt content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'worldbook.narrativeBaseline');

    expect(entry?.contentViewType).toBe('fullText');
    expect(entry?.defaultContent?.trim()).toBe(threeKingdomsPrompts.narrativeBaseline.trim());
  });

  it('uses templates with placeholders for dynamic runtime prompts', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.userPrompt');

    expect(entry?.contentViewType).toBe('lockedProtocol');
    expect(entry?.defaultContentTemplate).toContain('{playerInput}');
    expect(entry?.defaultContentTemplate).toContain('{memoryContext}');
    expect(entry?.defaultContentTemplate).toContain('narrativeText 显示格式');
    expect(entry?.defaultContentTemplate).toContain('【旁白】');
    expect(entry?.defaultContentTemplate).toContain('当前主角姓名');
    expect(entry?.defaultContentTemplate).toContain('不要使用 `【你】`');
    expect(entry?.defaultContentTemplate).toContain('临时出现的军士、门吏、仆从、路人等人物');
    expect(entry?.defaultContentTemplate).toContain('不要把直接台词塞进 `【旁白】` 段');
    expect(entry?.defaultContentTemplate).not.toContain('或 `【你】` 开头');

    const opening = getPromptRegistry().find((item) => item.id === 'opening.trueOpeningPrompt');
    expect(opening?.defaultContentTemplate).toContain('narrativeText 显示格式');
    expect(opening?.defaultContentTemplate).toContain('【角色名】');
    expect(opening?.defaultContentTemplate).toContain('当前主角姓名');
    expect(opening?.defaultContentTemplate).toContain('不要使用 `【你】`');
    expect(opening?.defaultContentTemplate).toContain('临时出现的军士、门吏、仆从、路人等人物');
    expect(opening?.defaultContentTemplate).toContain('不要把直接台词塞进 `【旁白】` 段');
    expect(opening?.defaultContentTemplate).not.toContain('或 `【你】` 开头');
  });

  it('keeps NPC profile protocol explicit about trait source fields', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'npc.profileWritebackProtocol');

    expect(entry?.defaultContentTemplate).toContain('traits[].source 不得省略或写空字符串');
    expect(entry?.defaultContentTemplate).toContain('traits[].rarity 必须使用 white/green/blue/purple/orange/red');
  });

  it('documents consumable and one-use inventory lifecycle writeback', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.stateWriterProtocol');

    expect(entry?.defaultContentTemplate).toContain('一次性凭证的权益已经兑现');
    expect(entry?.defaultContentTemplate).toContain('inventoryChanges.remove');
    expect(entry?.defaultContentTemplate).toContain('仅出示、核验或仍可重复使用');
    expect(entry?.defaultContentTemplate).toContain('关键物品也不等于永久不可移除');
  });

  it('documents troop regroup retirement semantics in the locked state writer protocol', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.stateWriterProtocol');

    expect(entry?.defaultContentTemplate).toContain('终态旧建制只保留历史');
    expect(entry?.defaultContentTemplate).toContain('不得继续计入当前兵力');
    expect(entry?.defaultContentTemplate).toContain('逐一复用旧 troopId');
  });

  it('documents structured troop fatigue recovery instead of prose inference', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.stateWriterProtocol');

    expect(entry?.defaultContentTemplate).toContain('复用稳定 troopId 更新 activityTempo');
    expect(entry?.defaultContentTemplate).toContain('只有确实进入连续休整才写 resting');
    expect(entry?.defaultContentTemplate).toContain('不得直接编造或降低 fatigue/warFatiguePercent');
  });

  it('keeps female profile protocol explicit about long-term private anchors', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'femaleProfile.writebackProtocol');

    expect(entry?.defaultContentTemplate).toContain('红颜、夫人外交、内宅牵引或长期亲密关系目标');
    expect(entry?.defaultContentTemplate).toContain('adultPrivateProfile 作为长期私密锚点');
    expect(entry?.defaultContentTemplate).toContain('不得因为尚未进入成人场景就忽略已形成的长期私密边界、偏好与风险锚点');
    expect(entry?.defaultContentTemplate).toContain('直白、具体、稳定的档案真值');
    expect(entry?.defaultContentTemplate).toContain('身体字段是长期私密锚点和未来文生图锚点');
    expect(entry?.defaultContentTemplate).toContain('偏好、边界、敏感、风险、子宫和初夜字段是长期信息');
    expect(entry?.defaultContentTemplate).toContain('不得用诗化比喻');
    expect(entry?.defaultContentTemplate).toContain('年龄与出生信息只写 NPC 基础档案 age/birthDate');
    expect(entry?.defaultContentTemplate).toContain('“三十多岁”“四十出头”“熟女”“熟透”等词都允许在正文自然使用');
    expect(entry?.defaultContentTemplate).toContain('不设禁词');
    expect(entry?.defaultContentTemplate).toContain('每回合必读标签');
    expect(entry?.defaultContentTemplate).toContain('不得写成正文小作文');
  });

  it('documents worldline knowledge projection priority and boundary rules', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'worldline.knowledgeProjectionPolicy');

    expect(entry).toMatchObject({
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
      worldbookBound: true,
    });
    expect(entry?.contentViewType).toBe('lockedProtocol');
    expect(entry?.defaultContentTemplate).toContain('当前存档与动态系统已落库真值');
    expect(entry?.defaultContentTemplate).toContain('玩家行动意图或主张');
    expect(entry?.defaultContentTemplate).toContain('KnowledgeBase');
    expect(entry?.defaultContentTemplate).toContain('不是铁轨');
  });

  it('documents time advance and derived age rules for prompt management', () => {
    const registry = getPromptRegistry();
    const timeAdvance = registry.find((item) => item.id === 'time.advanceProtocol');
    const derivedAge = registry.find((item) => item.id === 'time.derivedAgeProtocol');

    expect(timeAdvance?.contentViewType).toBe('lockedProtocol');
    expect(timeAdvance?.defaultContentTemplate).toContain('timeAdvance');
    expect(timeAdvance?.defaultContentTemplate).toContain('不要按回合数固定推进');
    expect(derivedAge?.contentViewType).toBe('lockedProtocol');
    expect(derivedAge?.defaultContentTemplate).toContain('ageKnownAtDate');
    expect(derivedAge?.defaultContentTemplate).toContain('femaleProfile.birthday 不作为年龄派生来源');
    expect(derivedAge?.defaultContentTemplate).toContain('NPC 基础档案 birthDate');
    expect(derivedAge?.defaultContentTemplate).toContain('不批量改写 NPC.age');
  });

  it('documents current matter writeback rules for prompt management', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'dynamic.currentMatterProtocol');

    expect(entry?.contentViewType).toBe('lockedProtocol');
    expect(entry?.defaultContentTemplate).toContain('questAdded');
    expect(entry?.defaultContentTemplate).toContain('questUpdated');
    expect(entry?.defaultContentTemplate).toContain('status=invalidated');
    expect(entry?.defaultContentTemplate).toContain('不把远方大势本身写成任务');
  });

  it('documents signal writeback rules for prompt management', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'dynamic.signalProtocol');

    expect(entry?.contentViewType).toBe('lockedProtocol');
    expect(entry?.defaultContentTemplate).toContain('rumorAdded');
    expect(entry?.defaultContentTemplate).toContain('potentialOutcomeSummary');
    expect(entry?.defaultContentTemplate).toContain('confidence');
    expect(entry?.defaultContentTemplate).toContain('signalType');
    expect(entry?.defaultContentTemplate).toContain('不得只写入风声线索');
  });

  it('documents the global fact and evidence gate', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.factEvidenceGate');

    expect(entry).toMatchObject({
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
    });
    expect(entry?.defaultContentTemplate).toContain('玩家输入首先是行动意图');
    expect(entry?.defaultContentTemplate).toContain('不得机械拒绝玩家');
    expect(entry?.defaultContentTemplate).toContain('缺少任一关键依据时省略该写回');
  });

  it('documents concrete story resource changes as resource ledger writeback', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'holding.ledgerWritebackProtocol');

    expect(entry?.defaultContentTemplate).toContain('领取军饷粮草、缴获粮草军械、豪族捐赠钱粮');
    expect(entry?.defaultContentTemplate).toContain('当前总量，不是本回合增量');
    expect(entry?.defaultContentTemplate).toContain('月度军需和九月年度结算仍由本地计算');
  });

  it('documents world chronicle writeback rules for prompt management', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'world.worldEventWriteback');

    expect(entry?.contentViewType).toBe('lockedProtocol');
    expect(entry?.defaultContentTemplate).toContain('worldEventSummary');
    expect(entry?.defaultContentTemplate).toContain('outcomeSummary');
    expect(entry?.defaultContentTemplate).toContain('sourceSignalIds');
    expect(entry?.defaultContentTemplate).toContain('entity state changes require separate structured writeback');
  });

  it('documents plot plan timing fields for prompt management', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'world.plotPlanSuggestions');

    expect(entry?.contentViewType).toBe('lockedProtocol');
    expect(entry?.defaultContentTemplate).toContain('plotPlanSuggestions');
    expect(entry?.defaultContentTemplate).toContain('notBeforeAt');
    expect(entry?.defaultContentTemplate).toContain('lastAdvancedAt');
  });

  it('documents holding and domestic report writeback rules for prompt management', () => {
    const registry = getPromptRegistry();
    const holding = registry.find((item) => item.id === 'holding.ledgerWritebackProtocol');
    const report = registry.find((item) => item.id === 'holding.domesticReportProtocol');

    expect(holding).toMatchObject({
      category: 'main.stateWriter',
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
    });
    expect(holding?.defaultContentTemplate).toContain('upsertHoldingLedger');
    expect(holding?.defaultContentTemplate).toContain('holdingId');
    expect(holding?.defaultContentTemplate).toContain('已有领地再次更新时必须复用原 holdingId');
    expect(holding?.defaultContentTemplate).toContain('不得用同一 locationId 另造 holding_xxx 新条目');
    expect(holding?.defaultContentTemplate).toContain('corruption');
    expect(holding?.defaultContentTemplate).toContain('farmlandMu / registeredHouseholds');
    expect(holding?.defaultContentTemplate).toContain('eliteControlledShare / localEliteRelation');
    expect(holding?.defaultContentTemplate).toContain('地方豪强关系');
    expect(holding?.defaultContentTemplate).toContain('stewardNpcId / governanceOfficerNpcIds');
    expect(holding?.defaultContentTemplate).toContain('仅在正文明确发生任命、调任或免职时更新');
    expect(holding?.defaultContentTemplate).toContain('不得仅因 NPC 能力高、与玩家亲近或当前在场就自动任命');
    expect(holding?.defaultContentTemplate).toContain('没有实际控制、临时控制、争夺、治理或失去具体领地时，不得输出 upsertHoldingLedger');
    expect(holding?.defaultContentTemplate).toContain('私人庄园、田产、工坊、马场、铺面等应使用 upsertPrivateAsset');
    expect(holding?.defaultContentTemplate).toContain('不得输出 localTreasury/localGranary');
    expect(holding?.defaultContentTemplate).toContain('可支撑回合由本地计算');
    expect(holding?.defaultContentTemplate).toContain('不得直接写 estimatedOutput/actualCollection/collectionRate');
    expect(holding?.defaultContentTemplate).toContain('默认守城士卒不自动写入部队账本');
    expect(holding?.defaultContentTemplate).toContain('previousMoneyGuan、moneyDeltaGuan、moneyGuan');
    expect(holding?.defaultContentTemplate).toContain('府库/势力公共钱财固定以贯为底层单位');
    expect(report).toMatchObject({
      category: 'main.stateWriter',
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
    });
    expect(report?.defaultContentTemplate).toContain('upsertDomesticReport');
    expect(report?.defaultContentTemplate).toContain('system: 命名空间只由本地规则写入');
    expect(report?.defaultContentTemplate).toContain("合法模型报告统一使用 source='llm'");
    expect(report?.defaultContentTemplate).toContain('本地九月年度结算报告无需模型生成');
    expect(report?.defaultContentTemplate).not.toContain('LLM 负责把计算结果写成有信息量的报告');
    expect(report?.defaultContentTemplate).toContain('部队粮草、军饷、马匹、军械维持由本地按月扣除');
  });

  it('documents opening unique arts protocol metadata and content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'opening.uniqueArtsProtocol');

    expect(entry).toMatchObject({
      category: 'opening.trueOpening',
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
    });
    expect(entry?.defaultContentTemplate).toContain('updateCharacterUniqueArts');
    expect(entry?.defaultContentTemplate).toContain('acquisition');
    expect(entry?.defaultContentTemplate).toContain('kind:"opening"');
    expect(entry?.defaultContentTemplate).toContain('white/green/blue/purple/orange/red');
    expect(entry?.defaultContentTemplate).toContain('personalCombat/warfare/strategy/social/governance/survival/craft/other');
  });

  it('documents opening reputation carryover protocol metadata and content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'opening.reputationProtocol');

    expect(entry).toMatchObject({
      category: 'opening.trueOpening',
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
    });
    expect(entry?.defaultContentTemplate).toContain('开局声名与德行承接');
    expect(entry?.defaultContentTemplate).toContain('旁人称呼、第一印象、信任或戒备');
    expect(entry?.defaultContentTemplate).toContain('updateCharacterReputation');
    expect(entry?.defaultContentTemplate).toContain('不得机械复述数值');
  });

  it('documents opening faction ledger protocol metadata and content', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'opening.factionLedgerProtocol');

    expect(entry).toMatchObject({
      category: 'opening.trueOpening',
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
      worldbookBound: true,
    });
    expect(entry?.defaultContentTemplate).toContain('Opening faction ledger protocol');
    expect(entry?.defaultContentTemplate).toContain('upsertFactionLedger');
    expect(entry?.defaultContentTemplate).toContain('actualController');
    expect(entry?.defaultContentTemplate).toContain('knownSphere');
    expect(entry?.defaultContentTemplate).toContain('recentActions 不得省略');
    expect(entry?.defaultContentTemplate).toContain('type 必须使用中文势力类型');
    expect(entry?.defaultContentTemplate).toContain('不得输出 warlord');
    expect(entry?.defaultContentTemplate).toContain('不得输出 clan/local_government/government');
    expect(entry?.defaultContentTemplate).toContain('stanceToPlayer 必须写简短关系文本');
    expect(entry?.defaultContentTemplate).toContain('upsertTroopLedger');
    expect(entry?.defaultContentTemplate).toContain('relationToPlayer 必须写简短关系文本');
    expect(entry?.defaultContentTemplate).toContain('leaderNpcId 记录实际带兵将领');
    expect(entry?.defaultContentTemplate).toContain('deputyNpcIds（最多两名）');
    expect(entry?.defaultContentTemplate).toContain('军师使用 strategistNpcId');
    expect(entry?.defaultContentTemplate).toContain('新建部队必须包含 quality、readiness、fatigue、lifecycleStatus');
    expect(entry?.defaultContentTemplate).toContain('KnowledgeBase');
    expect(entry?.defaultContentTemplate).toContain('model knowledge');
    expect(entry?.defaultContentTemplate).toContain('开局时间');
    expect(entry?.defaultContentTemplate).toContain('玩家身份');
    expect(entry?.defaultContentTemplate).toContain('玩家地点');
    expect(entry?.defaultContentTemplate).toContain('不得由静态种子预填');
    expect(entry?.defaultContentTemplate).toContain('不要生成天下所有势力');
    expect(entry?.defaultContentTemplate).not.toContain('worldBook.factionsSeed 只是稳定 factionId');
  });

  it('documents opening holding and private asset boundary protocol', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'opening.holdingAssetProtocol');

    expect(entry).toMatchObject({
      category: 'opening.trueOpening',
      riskLevel: 'high',
      editLevel: 'locked',
      runtimeUsed: true,
      protocolBound: true,
    });
    expect(entry?.defaultContentTemplate).toContain('开局领地与私人产业边界');
    expect(entry?.defaultContentTemplate).toContain('没有实际控制、临时控制或争夺的具体领地时，不得输出 upsertHoldingLedger');
    expect(entry?.defaultContentTemplate).toContain('私人庄园、田产、工坊、马场、铺面等使用 upsertPrivateAsset');
    expect(entry?.defaultContentTemplate).toContain('明确拥有私人产业时，必须使用 upsertPrivateAsset 写回');
    expect(entry?.defaultContentTemplate).toContain('明确掌管具体领地时，必须使用 upsertHoldingLedger 写回');
    expect(entry?.defaultContentTemplate).toContain('不得只写进正文、记忆或摘要');
    expect(entry?.defaultContentTemplate).toContain('不得输出 localTreasury/localGranary');
    expect(entry?.defaultContentTemplate).toContain('只写 siege 的事实枚举');
    expect(entry?.defaultContentTemplate).toContain('可支撑回合由本地计算');
  });

  it('documents resource-ledger-only deposits and withdrawals', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'holding.ledgerWritebackProtocol');

    expect(entry?.defaultContentTemplate).toContain('调拨、提取或存入钱粮时只更新真实资金去向');
    expect(entry?.defaultContentTemplate).toContain('不要另造地方精确库存');
    expect(entry?.defaultContentTemplate).toContain('updateResourceLedger 或 updatePlayerLoadout');
  });

  it('explains locked protocol entries as read-only protocol-bound prompts', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.userPrompt');

    expect(entry?.contentNotes).toContain('协议锁定');
    expect(entry?.editLevel).toBe('locked');
  });

  it('registers NPC dynamic simulation prompts as runtime-overridable protocol entries', () => {
    const registry = getPromptRegistry();
    const ids = registry.map((entry) => entry.id);

    expect(ids).toEqual(expect.arrayContaining([
      'npcSimulation.systemPrompt',
      'npcSimulation.userPrompt',
    ]));
    expect(registry.find((entry) => entry.id === 'npcSimulation.systemPrompt')).toMatchObject({
      runtimeUsed: true,
      protocolBound: true,
      editLevel: 'locked',
    });
  });

  it('registers one adaptive adult intimacy prompt instead of two competing styles', () => {
    const registry = getPromptRegistry();
    const ids = registry.map((entry) => entry.id);
    expect(ids).toContain('nsfw.adultIntimacy.commonProtocol');
    expect(ids).not.toContain('nsfw.adultIntimacy.relationshipImmersion');
    expect(ids).not.toContain('nsfw.adultIntimacy.directRealism');

    const commonProtocol = registry.find((item) => item.id === 'nsfw.adultIntimacy.commonProtocol');
    expect(commonProtocol).toMatchObject({
      category: 'nsfw.adultIntimacy',
      riskLevel: 'medium',
      editLevel: 'advanced',
      runtimeUsed: true,
      protocolBound: false,
      worldbookBound: false,
    });
    expect(commonProtocol?.defaultContentTemplate).toContain('未进入成人场景时完全忽略本协议');
    expect(commonProtocol?.defaultContentTemplate).toContain('乳房、乳头、阴茎、龟头、阴蒂、阴唇、阴道、肛门、精液');
    expect(commonProtocol?.defaultContentTemplate).toContain('只有人物对白、身份和现场语气确实粗俗时');
    expect(commonProtocol?.defaultContentTemplate).toContain('才使用相应口语');
    expect(commonProtocol?.defaultContentTemplate).not.toContain('蜜液');
    expect(commonProtocol?.defaultContentTemplate).toContain('不做重复的感官检查表');
    expect(commonProtocol?.defaultContentTemplate).toContain('用作实际部位与动作的替代称呼');
    expect(commonProtocol?.defaultContentTemplate).toContain('白腻、雪乳、红梅、蓓蕾、花心、花径、花穴、甬道、蜜壶、玉峰、肉刃、天鹅颈、弓起如满弓');
    expect(commonProtocol?.defaultContentTemplate).toContain('不做脱离上下文的全局禁词');
    expect(commonProtocol?.defaultContentTemplate).toContain('每回合只推进一个有意义的亲密阶段');
    expect(commonProtocol?.defaultContentTemplate).toContain('动作或试探—对方可观察的身体、言语或选择回应');
    expect(commonProtocol?.defaultContentTemplate).toContain('私密档案只提供事实连续性，不是文风范本');
    expect(commonProtocol?.defaultContentTemplate).toContain('当前剧情事实 > 当前人物状态 > 私密档案事实锚点 > 本协议');
    expect(commonProtocol?.defaultContentTemplate).not.toContain('动作—接触变化—可观察反馈—顺势调整—关系或局面变化');
  });

  it('registers narrative prose style guide as a runtime-overridable advanced prompt', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.narrativeProseStyleGuide');

    expect(entry).toMatchObject({
      category: 'main.narrativeStyle',
      riskLevel: 'medium',
      editLevel: 'advanced',
      runtimeUsed: true,
      protocolBound: false,
      worldbookBound: false,
    });
    expect(entry?.displayTitleZh).toBe('【正文文风】普通正文描写指南');
    expect(entry?.displayCategoryZh).toBe('主剧情 / 正文文风');
    expect(entry?.defaultContentTemplate).toContain('让 narrativeText 既准确推进事实');
    expect(entry?.defaultContentTemplate).toContain('先静默判断当前场景的主要功能');
    expect(entry?.defaultContentTemplate).toContain('空间要可理解');
    expect(entry?.defaultContentTemplate).toContain('行动要连续');
    expect(entry?.defaultContentTemplate).toContain('感官细节服务当下行动与判断');
    expect(entry?.defaultContentTemplate).toContain('从“近期正文回放”中先识别已经用过的人物反应方式');
    expect(entry?.defaultContentTemplate).toContain('改用近期未出现');
    expect(entry?.defaultContentTemplate).toContain('不要把正文压缩成干巴巴的问答纪要');
    expect(entry?.defaultContentTemplate).toContain('治理、账目和军政回合');
    expect(entry?.defaultContentTemplate).toContain('探索和战斗衔接回合');
    expect(entry?.defaultContentTemplate).toContain('不列举需要避开的词语');
    expect(entry?.defaultContentTemplate).not.toContain('目光、眼神、视线、眼底或眸色');
    expect(entry?.defaultContentTemplate).toContain('没有逐字引号时，不得把它扩写成 `【主角名】` 直接台词');
    expect(entry?.defaultContentTemplate).not.toContain('每回合至少给出');
    expect(entry?.defaultContentTemplate).toContain('NPC 要保留自己的事务、节奏、顾虑和边界');
    expect(entry?.defaultContentTemplate).toContain('只写玩家当前能看见、听见或合理感知到的信息');
    expect(entry?.defaultContentTemplate).toContain('对照“近期正文回放”检查重复模式');
    expect(entry?.defaultContentTemplate).toContain('不是词语黑名单');
    expect(entry?.defaultContentTemplate).not.toContain('雪中悍刀行');
  });

  it('registers the same-generation prose final review as a runtime-overridable advanced prompt', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.narrativeProseFinalReview');

    expect(entry).toMatchObject({
      category: 'main.narrativeStyle',
      riskLevel: 'medium',
      editLevel: 'advanced',
      runtimeUsed: true,
      protocolBound: false,
      worldbookBound: false,
    });
    expect(entry?.displayTitleZh).toBe('【正文文风】提交前静默终检');
    expect(entry?.displayCategoryZh).toBe('主剧情 / 正文文风');
    expect(entry?.defaultContentTemplate).toContain('同一次主正文生成');
    expect(entry?.defaultContentTemplate).toContain('不得新增第二次正文 API');
    expect(entry?.defaultContentTemplate).toContain('近期正文回放');
    expect(entry?.defaultContentTemplate).toContain('若没有，narrativeText 中 `【主角名】` 台词段数量必须为 0');
    expect(entry?.defaultContentTemplate).toContain('空间与行动连续性');
    expect(entry?.defaultContentTemplate).toContain('保留能让现场可理解、可感知的必要细节');
    expect(entry?.defaultContentTemplate).toContain('关键场景至少应有明确空间锚点');
    expect(entry?.defaultContentTemplate).toContain('治理与对话回合也应让数字、条件和执行阻力落到人物行动中');
    expect(entry?.defaultContentTemplate).toContain('不是词语黑名单');
  });

  it('registers relationship thread projection guide as a runtime-overridable advanced prompt', () => {
    const entry = getPromptRegistry().find((item) => item.id === 'main.relationshipThreadProjectionGuide');

    expect(entry).toMatchObject({
      category: 'main.narrativeStyle',
      riskLevel: 'medium',
      editLevel: 'advanced',
      runtimeUsed: true,
      protocolBound: false,
      worldbookBound: false,
    });
    expect(entry?.displayTitleZh).toBe('【关系线承接】红颜/羁绊投喂纪律');
    expect(entry?.displayCategoryZh).toBe('主剧情 / 正文文风');
    expect(entry?.defaultContentTemplate).toContain('已成立长期关系线');
    expect(entry?.defaultContentTemplate).toContain('不是待生成任务池');
    expect(entry?.defaultContentTemplate).toContain('upsertHeroineThread');
    expect(entry?.defaultContentTemplate).toContain('upsertBondThread');
  });
});
