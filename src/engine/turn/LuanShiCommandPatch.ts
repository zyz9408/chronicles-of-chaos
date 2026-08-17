// ============================================================
// Engine - LuanShiCommandPatch
// 统一提取 luanshiCommand patch 中的命令对象
// ============================================================

import type { ConflictJudgement, StatePatch } from '../types';
import type { LuanShiCommand } from '../state/luanshiCommands';
import { normalizeFactionType } from '../state/factionTypeNormalization';
import { normalizeConflictJudgement } from '../conflict/WarJudgementScore';

const LUANSHI_COMMAND_ACTION_TYPES = new Set([
  'pushNpcMemory',
  'recordTurnEvent',
  'updateCharacterIdentity',
  'updatePlayerLoadout',
  'updateNpcLoadout',
  'updatePlayerTraits',
  'updateCharacterUniqueArts',
  'recordCharacterUniqueArtProgress',
  'updateResourceLedger',
  'upsertFactionLedger',
  'recordFactionRecentAction',
  'upsertTroopLedger',
  'startHeavyCavalryFormation',
  'upsertConflictRecord',
  'upsertCombatRecord',
  'upsertCalendarEra',
  'upsertHeroineThread',
  'upsertBondThread',
  'upsertHoldingLedger',
  'upsertDomesticReport',
  'upsertPrivateAsset',
  'upsertPrivateAssetProject',
  'updateCharacterReputation',
  'upsertNpcProfile',
  'updateNpcRelationship',
  'updateNpcPresence',
  'updateNpcBackgroundActivity',
  'updateNpcFemaleProfile',
  'recordPregnancyRisk',
  'resolvePregnancy',
]);

const LUANSHI_COMMAND_ACTION_ALIASES: Record<string, LuanShiCommand['action']> = {
  updateNpcProfile: 'upsertNpcProfile',
};

export function isKnownLuanShiCommandAction(action: unknown): action is LuanShiCommand['action'] {
  return typeof action === 'string' && LUANSHI_COMMAND_ACTION_TYPES.has(action);
}

const MISNESTED_STATE_PATCH_ACTION_TYPES = new Set([
  'timeAdvance',
  'locationChange',
  'questAdded',
  'questUpdated',
  'rumorAdded',
]);

const MISNESTED_STATE_PATCH_ACTION_ALIASES: Record<string, StatePatch['type']> = {
  updateLocation: 'locationChange',
  upsertQuest: 'questUpdated',
};

export function normalizeLuanShiCommandPatch(patch: StatePatch): StatePatch {
  if (patch.type === 'luanshiCommand') {
    return normalizeMisnestedStatePatchCommand(patch);
  }

  if (String(patch.type) === 'worldCommand') {
    const normalizedWorldCommand = normalizeMisnestedLuanShiWorldCommand(patch);
    if (normalizedWorldCommand !== patch) return normalizedWorldCommand;
  }

  const patchType = String(patch.type);
  if (!LUANSHI_COMMAND_ACTION_TYPES.has(patchType)) return patch;

  const payload = isPlainRecord(patch.payload) ? patch.payload : {};
  const commandPayload = isPlainRecord(payload.command)
    ? { ...payload.command, action: typeof payload.command.action === 'string' ? payload.command.action : patchType }
    : { action: patchType, ...payload };
  const normalizedCommandPayload = normalizeLuanShiCommand(commandPayload as LuanShiCommand);

  return {
    ...patch,
    type: 'luanshiCommand',
    payload: {
      command: normalizedCommandPayload,
    },
  } as StatePatch;
}

function normalizeMisnestedLuanShiWorldCommand(patch: StatePatch): StatePatch {
  const payload = isPlainRecord(patch.payload) ? patch.payload : {};
  const command = isPlainRecord(payload.command) ? payload.command : undefined;
  const rawAction = typeof command?.action === 'string' ? command.action.trim() : '';
  const action = LUANSHI_COMMAND_ACTION_ALIASES[rawAction] ?? rawAction;
  if (!command || !LUANSHI_COMMAND_ACTION_TYPES.has(action)) return patch;

  const nestedPayload = isPlainRecord(command.payload) ? command.payload : undefined;
  const commandPayload: Record<string, unknown> = nestedPayload
    ? {
        ...command,
        ...nestedPayload,
        action,
      }
    : {
        ...command,
        action,
      };
  delete commandPayload.payload;

  return {
    ...patch,
    type: 'luanshiCommand',
    payload: {
      command: normalizeLuanShiCommand(commandPayload as unknown as LuanShiCommand),
    },
  } as StatePatch;
}

function normalizeMisnestedStatePatchCommand(patch: StatePatch): StatePatch {
  const payload = isPlainRecord(patch.payload) ? patch.payload : {};
  const command = isPlainRecord(payload.command)
    ? payload.command
    : isPlainRecord(payload) && typeof payload.action === 'string'
      ? payload
      : undefined;
  const rawAction = typeof command?.action === 'string' ? command.action.trim() : '';
  const patchType = MISNESTED_STATE_PATCH_ACTION_TYPES.has(rawAction)
    ? rawAction as StatePatch['type']
    : MISNESTED_STATE_PATCH_ACTION_ALIASES[rawAction];

  if (!command || !patchType) return patch;

  const commandPayload = { ...command };
  delete commandPayload.action;
  const normalizedPayload = patchType === 'locationChange'
    ? normalizeMisnestedLocationChangePayload(commandPayload)
    : commandPayload;

  return {
    ...patch,
    type: patchType,
    payload: normalizedPayload,
  } as StatePatch;
}

function normalizeMisnestedLocationChangePayload(command: Record<string, unknown>): Record<string, unknown> {
  const toLocationId = firstNonEmptyString(command.toLocationId, command.locationId);
  const toSceneId = firstNonEmptyString(command.toSceneId, command.sceneId);
  return {
    ...(toLocationId ? { toLocationId } : {}),
    ...(toSceneId ? { toSceneId } : {}),
  };
}

export function extractLuanShiCommandFromPatch(patch: StatePatch): LuanShiCommand | undefined {
  const normalizedPatch = normalizeLuanShiCommandPatch(patch);
  if (normalizedPatch.type !== 'luanshiCommand') return undefined;

  const payload = normalizedPatch.payload;
  if (!payload || typeof payload !== 'object') return undefined;

  const command = (payload as { command?: unknown }).command;
  if (command && typeof command === 'object') {
    return normalizeLuanShiCommand(command as LuanShiCommand);
  }

  const action = (payload as { action?: unknown }).action;
  if (typeof action === 'string' && action.trim().length > 0) {
    return normalizeLuanShiCommand(payload as unknown as LuanShiCommand);
  }

  return undefined;
}

export function normalizeLuanShiCommand(command: LuanShiCommand): LuanShiCommand {
  const aliasedAction = LUANSHI_COMMAND_ACTION_ALIASES[String(command.action)];
  if (aliasedAction) {
    return normalizeLuanShiCommand({ ...command, action: aliasedAction } as LuanShiCommand);
  }

  if (command.action === 'upsertFactionLedger') {
    return normalizeFactionLedgerCommand(command);
  }

  if (command.action === 'upsertTroopLedger') {
    return normalizeTroopLedgerCommand(command);
  }

  if (command.action === 'upsertHoldingLedger') {
    return normalizeHoldingLedgerCommand(command);
  }

  if (command.action === 'updateResourceLedger') {
    return normalizeResourceLedgerCommand(command);
  }

  if (command.action === 'updatePlayerLoadout' || command.action === 'updateNpcLoadout') {
    return normalizeLoadoutCommand(command);
  }

  if (command.action === 'updateCharacterReputation') {
    return normalizeCharacterReputationCommand(command);
  }

  if (command.action === 'upsertNpcProfile') {
    return normalizeNpcProfileCommand(command);
  }

  if (command.action === 'upsertConflictRecord') {
    return normalizeConflictRecordCommand(command);
  }

  if (command.action === 'upsertCombatRecord') {
    return normalizeCombatRecordCommand(command);
  }

  return command;
}

function normalizeFactionLedgerCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const type = normalizeFactionType(entry.type);

  return {
    ...entry,
    ...(type ? { type } : {}),
    stanceToPlayer: normalizeFactionStanceToPlayer(entry.stanceToPlayer),
    recentActions: normalizeFactionRecentActions(entry),
  } as unknown as LuanShiCommand;
}

function normalizeTroopLedgerCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;

  return {
    ...entry,
    relationToPlayer: normalizeTroopRelationToPlayer(entry.relationToPlayer, entry.leaderNpcId),
    upkeepSource: normalizeTroopUpkeepSource(entry.upkeepSource),
    orderStatus: normalizeTroopOrderStatus(entry.orderStatus),
    aliases: normalizeOptionalStringList(entry.aliases),
    statusTags: normalizeOptionalStringList(entry.statusTags),
    childTroopIds: normalizeOptionalStringList(entry.childTroopIds),
  } as unknown as LuanShiCommand;
}

function normalizeTroopOrderStatus(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return value.trim().toLowerCase() === 'ordered' ? 'issued' : value;
}

function normalizeTroopUpkeepSource(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  const lower = text.toLowerCase();
  if (['player_resources', 'player', 'self', 'own', 'personal'].includes(lower)) return 'player_resources';
  if (['superior_provision', 'superior', 'lord', 'faction', 'state'].includes(lower)) return 'superior_provision';
  if (['mixed', 'partial', 'shared'].includes(lower)) return 'mixed';
  if (['unknown', 'unspecified'].includes(lower)) return 'unknown';
  if (/(?:玩家|主角)(?:自家)?(?:府库|资源|钱粮)|(?:玩家|主角)(?:自筹|承担|供养)|私产承担|领地承担/.test(text)) return 'player_resources';
  if (/(?:上级|主公|朝廷|州府|军府|官府|所属势力|本势力|本部|敌方|友方|他方|拨付|供给|供养|俸粮|军饷)/.test(text)) return 'superior_provision';
  // 未说明归属的“府库/自筹”描述的是该部队或其所属势力，不得默认解释为玩家府库。
  if (/(?:府库|自筹|自给|自行筹措)/.test(text)) return 'superior_provision';
  if (/(?:混合|部分|共同|分担|补足)/.test(text)) return 'mixed';
  if (/(?:未知|未定|不明)/.test(text)) return 'unknown';
  return text;
}

function normalizeFactionStanceToPlayer(value: unknown): unknown {
  const score = parseFiniteNumber(value);
  if (score !== undefined) return factionStanceFromScore(score);

  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  const lower = text.toLowerCase();
  if (['self', 'own', 'owned', 'friendly', 'ally', 'allied'].includes(lower)) return '友好';
  if (['neutral', 'observed'].includes(lower)) return '中立';
  if (['hostile', 'enemy'].includes(lower)) return '敌对';
  return text;
}

function normalizeFactionRecentActions(entry: Record<string, unknown>): unknown {
  const normalized = normalizeOptionalStringList(entry.recentActions);
  const fallback = firstNonEmptyString(
    entry.summary,
    entry.sourceNote,
    entry.knownSphere,
    entry.actualController,
  );

  if (Array.isArray(normalized)) {
    const cleaned = normalized
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : fallback ? [fallback] : [];
  }

  if (normalized !== undefined) return fallback ? [fallback] : [];

  return fallback ? [fallback] : [];
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function factionStanceFromScore(score: number): string {
  if (score >= 60) return '亲近';
  if (score > 0) return '略有善意';
  if (score <= -60) return '敌对';
  if (score < 0) return '戒备';
  return '中立';
}

function normalizeTroopRelationToPlayer(value: unknown, leaderNpcId: unknown): unknown {
  const score = parseFiniteNumber(value);
  if (score !== undefined) return troopRelationFromScore(score);

  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (isPlayerLeaderIdValue(leaderNpcId)) return 'self';
  return value;
}

function troopRelationFromScore(score: number): string {
  if (score >= 60) return 'self';
  if (score <= -60) return 'enemy';
  if (score > 0) return 'friendly';
  if (score < 0) return 'hostile';
  return 'neutral';
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPlayerLeaderIdValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim() === 'player';
}

function normalizeHoldingLedgerCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const normalizedEntry = { ...entry };
  delete normalizedEntry.localTreasury;
  delete normalizedEntry.localGranary;

  const optionalFields: Record<string, unknown> = {};
  const assignWhenPresent = (key: string, value: unknown): void => {
    if (Object.prototype.hasOwnProperty.call(entry, key)) {
      optionalFields[key] = value;
    }
  };

  assignWhenPresent(
    'civilAdministrationScope',
    typeof entry.civilAdministrationScope === 'string'
      ? entry.civilAdministrationScope.trim()
      : entry.civilAdministrationScope,
  );
  assignWhenPresent('civilScaleLevel', normalizeOptionalNonNegativeNumber(entry.civilScaleLevel));
  assignWhenPresent('farmlandMu', normalizeOptionalNonNegativeNumber(entry.farmlandMu));
  assignWhenPresent('registeredHouseholds', normalizeOptionalNonNegativeNumber(entry.registeredHouseholds));
  assignWhenPresent('eliteControlledShare', normalizeOptionalNonNegativeNumber(entry.eliteControlledShare));
  assignWhenPresent('localEliteRelation', normalizeOptionalSignedNumber(entry.localEliteRelation));
  assignWhenPresent('riskNotes', normalizeOptionalStringList(entry.riskNotes));
  assignWhenPresent('recentChanges', normalizeOptionalStringList(entry.recentChanges));

  return {
    ...normalizedEntry,
    ...optionalFields,
  } as unknown as LuanShiCommand;
}

function normalizeOptionalNonNegativeNumber(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;

  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return value;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : value;
}

function normalizeOptionalSignedNumber(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return value;

  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return value;

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : value;
}

function normalizeOptionalStringList(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  return trimmed.length > 0 ? [trimmed] : value;
}

function normalizeResourceLedgerCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...entry };

  for (const field of ['weapons', 'documents', 'tokens', 'importantSupplies']) {
    const list = normalizeOptionalStringList(entry[field]);
    if (list !== undefined) normalized[field] = list;
  }

  return normalized as unknown as LuanShiCommand;
}

function normalizeLoadoutCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...entry };
  const inventoryChanges = normalizeInventoryChanges(entry.inventoryChanges);
  const equipmentChanges = normalizeEquipmentChanges(entry.equipmentChanges, {
    filterBlankEquipFromInventory: command.action === 'updatePlayerLoadout',
  });

  if (inventoryChanges !== undefined) {
    normalized.inventoryChanges = inventoryChanges;
  }
  if (equipmentChanges !== undefined) {
    normalized.equipmentChanges = equipmentChanges;
  }

  return normalized as unknown as LuanShiCommand;
}

function normalizeInventoryChanges(
  value: unknown,
): unknown {
  if (!Array.isArray(value)) return value;

  return value
    .map((change) => {
      if (!isPlainRecord(change)) return change;
      if (change.action === 'add') {
        return { ...change, action: 'upsert' };
      }
      if (
        (change.action === 'remove' || change.action === 'setQuantity')
        && typeof change.itemId === 'string'
      ) {
        return { ...change, itemId: change.itemId.trim() };
      }
      return change;
    });
}

function normalizeEquipmentChanges(
  value: unknown,
  options: { filterBlankEquipFromInventory: boolean } = { filterBlankEquipFromInventory: true },
): unknown {
  if (!Array.isArray(value)) return value;

  return value
    .filter((change) => {
      if (!isPlainRecord(change)) return true;
      if (change.action !== 'equipFromInventory') return true;
      if (!options.filterBlankEquipFromInventory) return true;
      return typeof change.itemId === 'string' && change.itemId.trim().length > 0;
    })
    .map((change) => {
      if (!isPlainRecord(change)) return change;
      if (change.action === 'equipFromInventory' && typeof change.itemId === 'string') {
        return { ...change, itemId: change.itemId.trim() };
      }
      if (change.action === 'upsert' && isPlainRecord(change.item)) {
        return { ...change, item: normalizeEquipmentItemSlot(change.item) };
      }
      return change;
    });
}

function normalizeEquipmentItemSlot(item: Record<string, unknown>): Record<string, unknown> {
  if (typeof item.slot === 'string' && item.slot.trim().length > 0) return item;
  if (typeof item.equipSlot !== 'string' || item.equipSlot.trim().length === 0) return item;
  return {
    ...item,
    slot: item.equipSlot.trim(),
  };
}

function normalizeCharacterReputationCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...entry };
  const tags = normalizeReputationTags(entry.tags);

  if (tags !== undefined) {
    normalized.tags = tags;
  }

  return normalized as unknown as LuanShiCommand;
}

function normalizeReputationTags(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  return value
    .map((tag) => {
      if (typeof tag === 'string') {
        const label = tag.trim();
        return label.length > 0 ? { label, source: 'writeback' } : undefined;
      }

      if (isPlainRecord(tag) && typeof tag.label === 'string') {
        const label = tag.label.trim();
        if (label.length === 0) return tag;
        const source =
          typeof tag.source === 'string' && tag.source.trim().length > 0
            ? tag.source.trim()
            : 'writeback';
        return { ...tag, label, source };
      }

      return tag;
    })
    .filter((tag) => tag !== undefined);
}

function normalizeNpcProfileCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...entry };

  const traits = normalizeNpcProfileTraits(entry.traits);
  if (traits !== undefined) {
    normalized.traits = traits;
  }

  if (typeof entry.isFocused !== 'boolean' && typeof entry.isPresent === 'boolean') {
    normalized.isFocused = entry.isPresent;
  }

  return normalized as unknown as LuanShiCommand;
}

function normalizeNpcProfileTraits(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  return value
    .map((trait) => {
      if (!isPlainRecord(trait)) return trait;
      const source =
        typeof trait.source === 'string' && trait.source.trim().length > 0
          ? trait.source.trim()
          : 'writeback';
      return { ...trait, source };
    })
    .filter((trait) => trait !== undefined);
}

const CONFLICT_TYPE_VALUES = new Set([
  '个人战斗',
  '战争',
  '军事冲突',
  '对峙',
  '其他',
  '野战',
  '伏击',
  '追击',
  '围城',
  '守城',
  '夜袭',
  '抢粮',
  '营寨战',
  '巷战',
  '水战',
]);

const CONFLICT_RESULT_VALUES = new Set([
  'decisiveWin',
  'win',
  'minorWin',
  'stalemate',
  'minorLoss',
  'loss',
  'decisiveLoss',
]);

const CONFLICT_TURNING_POINT_VALUES = new Set([
  'duelVictory',
  'duelDefeat',
  'commanderSlain',
  'commanderCaptured',
  'commanderWounded',
  'commanderFled',
  'ambush',
  'fireAttack',
  'supplyDestroyed',
  'gateBreached',
  'reinforcementArrived',
  'moraleCollapse',
  'terrainBreakthrough',
  'playerAction',
  'other',
]);

const CONFLICT_TURNING_POINT_IMPACT_VALUES = new Set(['minor', 'moderate', 'major', 'critical']);

function normalizeConflictRecordCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...entry };

  normalized.type = normalizeConflictType(entry.type, entry);
  normalized.resultLevel = normalizeConflictResultLevel(entry.resultLevel, entry.outcome, entry.result);

  for (const key of [
    'sides',
    'commanderNpcIds',
    'involvedTroopIds',
    'involvedFactionIds',
    'involvedNpcIds',
    'decisiveFactors',
    'troopEffects',
    'factionEffects',
    'placeEffects',
    'relatedQuestIds',
    'relatedTrendIds',
    'resultTags',
  ]) {
    const list = normalizeOptionalStringList(entry[key]);
    if (list !== undefined) normalized[key] = list;
  }

  if (isPlainRecord(entry.judgement)) {
    const judgement: ConflictJudgement = {
      ...entry.judgement,
      method: 'warJudgementV1',
    } as ConflictJudgement;
    if (typeof judgement.underdogReason === 'string' && judgement.underdogReason.trim().length === 0) {
      delete judgement.underdogReason;
    }
    normalized.judgement = normalizeConflictJudgement(judgement);
  }

  if (entry.turningPoints !== undefined) {
    normalized.turningPoints = normalizeConflictTurningPoints(entry.turningPoints);
  }

  return normalized as unknown as LuanShiCommand;
}

function normalizeConflictType(value: unknown, entry: Record<string, unknown>): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (CONFLICT_TYPE_VALUES.has(text)) return text;

  const context = [text, entry.title, entry.summary, entry.outcome, entry.result]
    .map((item) => String(item ?? ''))
    .join(' ');
  if (/水战|舟战|江战|河战|水军/.test(context)) return '水战';
  if (/巷战|街巷|城内混战/.test(context)) return '巷战';
  if (/守城|防守城|城门防御|城墙防御/.test(context)) return '守城';
  if (/攻城|围城|城池攻防/.test(context)) return '围城';
  if (/夜袭|夜战|劫营/.test(context)) return '夜袭';
  if (/伏击|伏兵|设伏|埋伏|ambush/i.test(context)) return '伏击';
  if (/追击|追杀|追歼/.test(context)) return '追击';
  if (/抢粮|劫粮|粮道|辎重/.test(context)) return '抢粮';
  if (/营寨|军营|寨战/.test(context)) return '营寨战';
  if (/遭遇战|野战|会战|平原战/.test(context)) return '野战';
  if (/对峙|僵持/.test(context)) return '对峙';
  if (/奇袭|突袭|清剿|阻击|防御反击|袭扰|交战|冲突/.test(context)) return '军事冲突';
  return text;
}

function normalizeConflictResultLevel(value: unknown, outcome: unknown, result: unknown): unknown {
  if (typeof value === 'string' && CONFLICT_RESULT_VALUES.has(value.trim())) return value.trim();
  const text = `${String(value ?? '')} ${String(outcome ?? '')} ${String(result ?? '')}`.toLowerCase();
  if (/decisivewin|大胜|完胜|全胜|压倒性胜利|彻底击败/.test(text)) return 'decisiveWin';
  if (/minorwin|小胜|略胜|险胜/.test(text)) return 'minorWin';
  if (/\bwin\b|success|成功|获胜|胜利|击败/.test(text)) return 'win';
  if (/stalemate|draw|平局|僵持|相持|未分胜负/.test(text)) return 'stalemate';
  if (/minorloss|小败|略败|受挫/.test(text)) return 'minorLoss';
  if (/decisiveloss|大败|惨败|溃败|全军覆没/.test(text)) return 'decisiveLoss';
  if (/\bloss\b|fail|失败|战败|失利/.test(text)) return 'loss';
  return value;
}

function normalizeConflictTurningPoints(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isPlainRecord(item)) return item;
    const scoreModifier = normalizeBoundedSignedNumber(item.scoreModifier, 100);
    return {
      ...item,
      type: normalizeConflictTurningPointType(item.type, item.summary),
      impact: normalizeConflictTurningPointImpact(
        item.impact,
        typeof scoreModifier === 'number' ? scoreModifier : undefined,
      ),
      ...(scoreModifier !== undefined ? { scoreModifier } : {}),
      relatedNpcIds: normalizeOptionalStringList(item.relatedNpcIds),
      relatedTroopIds: normalizeOptionalStringList(item.relatedTroopIds),
    };
  });
}

function normalizeConflictTurningPointType(value: unknown, summary: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (CONFLICT_TURNING_POINT_VALUES.has(text)) return text;
  const context = `${text} ${String(summary ?? '')}`;
  if (/duelvictory|单挑获胜|斗将获胜/i.test(context)) return 'duelVictory';
  if (/dueldefeat|单挑失败|斗将失败/i.test(context)) return 'duelDefeat';
  if (/commanderslain|主将被斩|斩杀主将|阵斩/i.test(context)) return 'commanderSlain';
  if (/commandercaptured|主将被俘|擒获主将/i.test(context)) return 'commanderCaptured';
  if (/commanderwounded|主将重伤|击伤主将/i.test(context)) return 'commanderWounded';
  if (/commanderfled|主将逃|敌将逃/i.test(context)) return 'commanderFled';
  if (/ambushsuccess|surpriseattack|伏击|伏兵|奇袭/i.test(context)) return 'ambush';
  if (/fireattack|火攻|纵火/i.test(context)) return 'fireAttack';
  if (/supplydestroyed|粮道|辎重|补给.*毁/i.test(context)) return 'supplyDestroyed';
  if (/gatebreached|破门|城门.*破/i.test(context)) return 'gateBreached';
  if (/reinforcementarrived|援军|增援/i.test(context)) return 'reinforcementArrived';
  if (/moralecollapse|士气.*崩|军心.*溃/i.test(context)) return 'moraleCollapse';
  if (/terrainbreakthrough|突破|侧翼|迂回/i.test(context)) return 'terrainBreakthrough';
  if (/playeraction|玩家行动|主角行动/i.test(context)) return 'playerAction';
  return text.length > 0 ? 'other' : value;
}

function normalizeConflictTurningPointImpact(value: unknown, scoreModifier: number | undefined): unknown {
  if (typeof value === 'string') {
    const text = value.trim();
    if (CONFLICT_TURNING_POINT_IMPACT_VALUES.has(text)) return text;
    if (/critical|决定性|致命|扭转|关键/i.test(text)) return 'critical';
    if (/major|重大|严重|显著/i.test(text)) return 'major';
    if (/minor|轻微|有限|不大/i.test(text)) return 'minor';
    if (/moderate|中等|一般/i.test(text)) return 'moderate';
  }
  const magnitude = Math.abs(scoreModifier ?? 0);
  if (magnitude >= 50) return 'critical';
  if (magnitude >= 25) return 'major';
  if (magnitude > 0 && magnitude < 10) return 'minor';
  return value === undefined ? value : 'moderate';
}

function normalizeBoundedSignedNumber(value: unknown, limit: number): unknown {
  const normalized = normalizeOptionalSignedNumber(value);
  return typeof normalized === 'number' && Number.isFinite(normalized)
    ? Math.max(-limit, Math.min(limit, normalized))
    : normalized;
}

const COMBAT_KIND_VALUES = new Set([
  'duel',
  'melee',
  'assassination',
  'escape',
  'capture',
  'battlefieldDuel',
  'other',
]);

const COMBAT_RESULT_VALUES = new Set([
  'decisiveWin',
  'win',
  'stalemate',
  'loss',
  'decisiveLoss',
]);

const COMBAT_SIGNIFICANCE_VALUES = new Set([
  'minor',
  'notable',
  'major',
  'legendary',
]);

const COMBAT_ADVANTAGE_VALUES = new Set([
  'overwhelmingAdvantage',
  'clearAdvantage',
  'slightAdvantage',
  'even',
  'slightDisadvantage',
  'clearDisadvantage',
  'overwhelmingDisadvantage',
]);

const COMBAT_PARTICIPANT_SIDES = new Set([
  'player',
  'ally',
  'enemy',
  'neutral',
]);

const COMBAT_OUTCOME_TAG_VALUES = new Set([
  'kill',
  'wound',
  'seriousWound',
  'capture',
  'forceRetreat',
  'escape',
  'woundedRetreat',
  'disarm',
  'rout',
]);

const COMBAT_SCORE_FIELDS = [
  'personalBase',
  'equipment',
  'status',
  'environment',
  'combatMethod',
  'uniqueArts',
  'playerAction',
  'turningPoint',
  'total',
] as const;

function normalizeCombatRecordCommand(command: LuanShiCommand): LuanShiCommand {
  const entry = command as unknown as Record<string, unknown>;
  const normalized: Record<string, unknown> = { ...entry };
  const resultLevel = normalizeCombatResultLevel(entry.resultLevel, entry.outcome);

  normalized.kind = normalizeCombatKind(entry.kind);
  normalized.resultLevel = resultLevel;
  normalized.significance = normalizeCombatSignificance(entry.significance, entry.summary, entry.outcome);
  normalized.playerInvolved = normalizeBoolean(entry.playerInvolved) ?? inferPlayerInvolved(entry.participants);
  normalized.participants = normalizeCombatParticipants(entry.participants, normalized.playerInvolved === true);

  const outcomeTags = normalizeCombatOutcomeTags(entry.outcomeTags);
  if (outcomeTags !== undefined) normalized.outcomeTags = outcomeTags;

  for (const key of ['relatedNpcIds', 'relatedConflictIds', 'relatedQuestIds', 'relatedTrendIds', 'visualTags', 'reputationEffects']) {
    const list = normalizeOptionalStringList(entry[key]);
    if (list !== undefined) normalized[key] = list;
  }

  if (entry.judgement !== undefined) {
    normalized.judgement = normalizeCombatJudgement(entry.judgement, resultLevel);
  }

  return normalized as unknown as LuanShiCommand;
}

function normalizeCombatKind(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (COMBAT_KIND_VALUES.has(text)) return text;
  if (/刺杀|暗杀/.test(text)) return 'assassination';
  if (/突围|逃脱|脱身/.test(text)) return 'escape';
  if (/擒|拿|俘/.test(text)) return 'capture';
  if (/阵前|叫阵|斗将|战场/.test(text)) return 'battlefieldDuel';
  if (/单挑|决斗|比武|较量|立威|切磋/.test(text)) return 'duel';
  if (/混战|肉搏|械斗|搏杀/.test(text)) return 'melee';
  return text.length > 0 ? 'other' : value;
}

function normalizeCombatResultLevel(value: unknown, outcome: unknown): unknown {
  if (typeof value === 'string' && COMBAT_RESULT_VALUES.has(value.trim())) return value.trim();
  const text = `${String(value ?? '')} ${String(outcome ?? '')}`.toLowerCase();
  if (/decisivewin|大胜|完胜|压倒|全胜|彻底击败/.test(text)) return 'decisiveWin';
  if (/\bwin\b|success|成功|胜|击败|压制/.test(text)) return 'win';
  if (/stalemate|draw|平|僵持|相持|未分胜负/.test(text)) return 'stalemate';
  if (/decisiveloss|大败|惨败|溃败/.test(text)) return 'decisiveLoss';
  if (/\bloss\b|fail|失败|败|失利/.test(text)) return 'loss';
  return value;
}

function normalizeCombatSignificance(value: unknown, summary: unknown, outcome: unknown): unknown {
  if (typeof value === 'string' && COMBAT_SIGNIFICANCE_VALUES.has(value.trim())) return value.trim();
  if (typeof value !== 'string') return value;

  const text = `${value} ${String(summary ?? '')} ${String(outcome ?? '')}`;
  if (/传奇|天下|名震|史册|名将/.test(text)) return 'legendary';
  if (/重大|关键|全军|士气|权威|转折|决定|提振|俘|擒|斩|重伤|战局/.test(text)) return 'major';
  if (/轻微|小事|私下|无大影响/.test(text)) return 'minor';
  return value.trim().length > 0 ? 'notable' : value;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (['true', 'yes', 'y', '1', '是', '有', '参与', '玩家参与'].includes(text)) return true;
  if (['false', 'no', 'n', '0', '否', '无', '未参与'].includes(text)) return false;
  return undefined;
}

function inferPlayerInvolved(participants: unknown): boolean | undefined {
  if (!Array.isArray(participants)) return undefined;
  return participants.some((participant, index) => {
    if (index === 0 && typeof participant === 'string' && /(玩家|主角|本人)/.test(participant)) return true;
    if (!isPlainRecord(participant)) return false;
    return normalizeCombatParticipantSide(participant.side, index, false, participant.name) === 'player';
  }) || undefined;
}

function normalizeCombatParticipants(value: unknown, playerInvolved: boolean): unknown {
  if (!Array.isArray(value)) return value;

  return value
    .map((participant, index) => {
      if (typeof participant === 'string') {
        const name = participant.trim();
        if (!name) return undefined;
        return {
          name,
          side: index === 0 && playerInvolved ? 'player' : 'neutral',
        };
      }

      if (!isPlainRecord(participant)) return participant;
      const name = normalizeParticipantName(participant);
      if (!name) return participant;
      return {
        ...participant,
        name,
        side: normalizeCombatParticipantSide(participant.side, index, playerInvolved, name),
        ...(participant.reputationFame !== undefined
          ? { reputationFame: normalizeOptionalNonNegativeNumber(participant.reputationFame) }
          : {}),
      };
    })
    .filter((participant) => participant !== undefined);
}

function normalizeParticipantName(participant: Record<string, unknown>): string | undefined {
  for (const key of ['name', 'npcName', 'participantName', 'characterName']) {
    const value = participant[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeCombatParticipantSide(
  value: unknown,
  index: number,
  playerInvolved: boolean,
  name: unknown,
): string {
  if (typeof value === 'string') {
    const text = value.trim();
    if (COMBAT_PARTICIPANT_SIDES.has(text)) return text;
    if (/player|玩家|主角|本人/.test(text)) return 'player';
    if (/ally|友|己方|同伴|部下|下属/.test(text)) return 'ally';
    if (/enemy|敌|对手|敌方/.test(text)) return 'enemy';
    if (/neutral|中立|旁观/.test(text)) return 'neutral';
  }

  if (typeof name === 'string' && /(玩家|主角|本人)/.test(name)) return 'player';
  return index === 0 && playerInvolved ? 'player' : 'neutral';
}

function normalizeCombatOutcomeTags(value: unknown): unknown {
  const raw = normalizeOptionalStringList(value);
  if (!Array.isArray(raw)) return raw;
  const tags = raw
    .map((item) => normalizeCombatOutcomeTag(item))
    .filter((item): item is string => Boolean(item));
  return tags.length > 0 ? tags : undefined;
}

function normalizeCombatOutcomeTag(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (COMBAT_OUTCOME_TAG_VALUES.has(text)) return text;
  if (/击杀|杀|斩/.test(text)) return 'kill';
  if (/重伤/.test(text)) return 'seriousWound';
  if (/受伤|伤/.test(text)) return 'wound';
  if (/俘|擒/.test(text)) return 'capture';
  if (/退|逼退/.test(text)) return 'forceRetreat';
  if (/逃|突围/.test(text)) return 'escape';
  if (/缴械|夺兵器/.test(text)) return 'disarm';
  if (/溃|崩/.test(text)) return 'rout';
  return undefined;
}

function normalizeCombatJudgement(value: unknown, resultLevel: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const scoreBreakdown = normalizeCombatScoreBreakdown(value.scoreBreakdown);
  return {
    ...value,
    method: 'combatJudgementV1',
    advantageBand: normalizeCombatAdvantageBand(value.advantageBand, scoreBreakdown, resultLevel),
    ...(scoreBreakdown !== undefined ? { scoreBreakdown } : {}),
  };
}

function normalizeCombatScoreBreakdown(value: unknown): unknown {
  if (!isPlainRecord(value)) return value;
  const normalized: Record<string, unknown> = { ...value };
  for (const field of COMBAT_SCORE_FIELDS) {
    normalized[field] = normalizeOptionalSignedNumber(value[field]);
  }
  normalized.notes = normalizeOptionalStringList(value.notes);
  return normalized;
}

function normalizeCombatAdvantageBand(value: unknown, scoreBreakdown: unknown, resultLevel: unknown): unknown {
  if (typeof value === 'string') {
    const text = value.trim();
    if (COMBAT_ADVANTAGE_VALUES.has(text)) return text;
    const lower = text.toLowerCase();
    if (/overwhelmingdisadvantage|decisiveloss|大劣|大败|惨败/.test(lower)) return 'overwhelmingDisadvantage';
    if (/\bloss\b|fail|败|劣势/.test(lower)) return 'clearDisadvantage';
    if (/overwhelming|decisive|大优|压倒|大胜/.test(lower)) return 'overwhelmingAdvantage';
    if (/\bwin\b|success|成功|胜|优势/.test(lower)) return 'clearAdvantage';
    if (/slight|minor|小优|小胜/.test(lower)) return 'slightAdvantage';
    if (/even|draw|平|相持/.test(lower)) return 'even';
  }

  if (isPlainRecord(scoreBreakdown)) {
    const total = typeof scoreBreakdown.total === 'number' ? scoreBreakdown.total : undefined;
    if (total !== undefined) {
      if (total >= 46) return 'overwhelmingAdvantage';
      if (total >= 20) return 'clearAdvantage';
      if (total >= 5) return 'slightAdvantage';
      if (total <= -46) return 'overwhelmingDisadvantage';
      if (total <= -20) return 'clearDisadvantage';
      if (total <= -5) return 'slightDisadvantage';
      return 'even';
    }
  }

  if (resultLevel === 'decisiveWin') return 'overwhelmingAdvantage';
  if (resultLevel === 'win') return 'clearAdvantage';
  if (resultLevel === 'stalemate') return 'even';
  if (resultLevel === 'loss') return 'clearDisadvantage';
  if (resultLevel === 'decisiveLoss') return 'overwhelmingDisadvantage';
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
