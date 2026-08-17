import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CorrespondenceCommitment,
  CorrespondenceEntry,
  LuanShiNpc,
  RuntimeState,
} from '../engine/types';
import {
  createCorrespondenceDraft,
  compareGameDate,
  getLetterPolishApiDisplay,
  isCorrespondenceCommitmentKnownToPlayer,
  markCorrespondenceRead,
  normalizeCorrespondenceCommitments,
  normalizeCorrespondenceEntries,
  polishLetterDraft,
  queueCorrespondence,
  upsertCorrespondenceEntry,
} from '../engine/correspondence';
import type { LetterPolishContext } from '../engine/correspondence';
import { deriveActorCurrentAge, deriveNpcCurrentAge } from '../engine/time/npcAge';
import { worldBook_ThreeKingdoms } from '../worldbooks/threeKingdoms';
import { PanelEmptyState, SystemModalHeader } from './SystemPanelPrimitives';

export interface CorrespondencePanelProps {
  runtimeState: RuntimeState;
  onCommit: (state: RuntimeState, successMessage: string) => Promise<void>;
  onClose: () => void;
}

interface ComposeState {
  recipientNpcId: string;
  body: string;
  replyToLetterId?: string;
}

export interface CorrespondenceConversation {
  npcId: string;
  npcName: string;
  npcRole?: string;
  entries: CorrespondenceEntry[];
  latestEntry?: CorrespondenceEntry;
  unreadCount: number;
}

const statusLabels: Record<CorrespondenceEntry['status'], string> = {
  draft: '未寄出',
  queued: '待发',
  inTransit: '传递中',
  deliveredPendingProcessing: '已送达·待处理',
  delivered: '已送达',
  read: '已读',
  processed: '已处理',
  cancelled: '已取消',
  lost: '途中遗失',
};

const commitmentStatusLabels: Record<CorrespondenceCommitment['status'], string> = {
  accepted: '已应允',
  preparing: '筹备中',
  inTransit: '在途',
  due: '已到期·待结算',
  fulfilled: '已履约',
  partial: '部分履约',
  delayed: '延期',
  failed: '未能履约',
  cancelled: '已取消',
};

export function countUnreadCorrespondence(state: RuntimeState): number {
  return normalizeCorrespondenceEntries(state.correspondence)
    .filter((entry) => entry.direction === 'incoming' && entry.status === 'delivered')
    .length;
}

export function getCorrespondenceEntryPartyNpcId(entry: CorrespondenceEntry): string | undefined {
  if (entry.direction === 'incoming' && entry.sender.kind === 'npc') return entry.sender.npcId;
  if (entry.direction === 'outgoing' && entry.recipient.kind === 'npc') return entry.recipient.npcId;
  return undefined;
}

export function getCorrespondenceEntryDisplayTime(entry: CorrespondenceEntry): string {
  if (entry.direction === 'incoming') {
    return entry.deliveredAt ?? entry.sentAt ?? entry.createdAt;
  }
  return entry.sentAt ?? entry.createdAt;
}

export function getCorrespondenceEntryTimeLabel(entry: CorrespondenceEntry): string {
  if (
    entry.direction === 'incoming'
    && entry.sentAt
    && entry.deliveredAt
    && entry.sentAt !== entry.deliveredAt
  ) {
    return `寄出 ${entry.sentAt} · 收到 ${entry.deliveredAt}`;
  }
  return getCorrespondenceEntryDisplayTime(entry);
}

export function isCorrespondenceEntryVisibleToPlayer(entry: CorrespondenceEntry): boolean {
  if (entry.status === 'draft') return false;
  if (entry.direction === 'outgoing') return true;
  return entry.status === 'delivered' || entry.status === 'read' || entry.status === 'processed';
}

export function buildCorrespondenceConversations(state: RuntimeState): CorrespondenceConversation[] {
  const recipients = selectCorrespondenceRecipients(state);
  const recipientById = new Map(recipients.map((npc) => [npc.npcId, npc]));
  const groups = new Map<string, CorrespondenceEntry[]>();
  for (const entry of normalizeCorrespondenceEntries(state.correspondence)) {
    if (!isCorrespondenceEntryVisibleToPlayer(entry)) continue;
    const npcId = getCorrespondenceEntryPartyNpcId(entry);
    if (!npcId) continue;
    const entries = groups.get(npcId) ?? [];
    entries.push(entry);
    groups.set(npcId, entries);
  }

  const priorityById = new Map(recipients.map((npc, index) => [npc.npcId, recipients.length - index]));
  return [...groups.keys()].map((npcId) => {
    const allEntries = [...(groups.get(npcId) ?? [])].sort(compareCorrespondenceEntries);
    const entries = allEntries;
    const npc = recipientById.get(npcId);
    const knownParty = allEntries
      .map((entry) => entry.sender.kind === 'npc' ? entry.sender : entry.recipient.kind === 'npc' ? entry.recipient : undefined)
      .find(Boolean);
    return {
      npcId,
      npcName: npc?.name ?? knownParty?.name ?? '未登记人物',
      ...(npc?.role ? { npcRole: npc.role } : {}),
      entries,
      ...(entries[entries.length - 1] ? { latestEntry: entries[entries.length - 1] } : {}),
      unreadCount: entries.filter((entry) => entry.direction === 'incoming' && entry.status === 'delivered').length,
    };
  }).filter((conversation) => conversation.entries.length > 0).sort((a, b) => (
    b.unreadCount - a.unreadCount
    || compareOptionalCorrespondenceEntries(b.latestEntry, a.latestEntry)
    || (priorityById.get(b.npcId) ?? 0) - (priorityById.get(a.npcId) ?? 0)
    || a.npcName.localeCompare(b.npcName, 'zh-CN')
  ));
}

export function markCorrespondenceConversationRead(state: RuntimeState, npcId: string): RuntimeState {
  return normalizeCorrespondenceEntries(state.correspondence)
    .filter((entry) => (
      entry.direction === 'incoming'
      && entry.status === 'delivered'
      && getCorrespondenceEntryPartyNpcId(entry) === npcId
    ))
    .reduce((nextState, entry) => markCorrespondenceRead(nextState, entry.letterId), state);
}

export function CorrespondencePanel({ runtimeState, onCommit, onClose }: CorrespondencePanelProps): React.ReactElement {
  const [selectedNpcId, setSelectedNpcId] = useState('');
  const [composeByNpc, setComposeByNpc] = useState<Record<string, ComposeState>>({});
  const [isStartingNewLetter, setIsStartingNewLetter] = useState(false);
  const [newRecipientNpcId, setNewRecipientNpcId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isPolishing, setIsPolishing] = useState(false);
  const [panelMessage, setPanelMessage] = useState('');
  const [polishApiDisplay, setPolishApiDisplay] = useState('读取配置中…');
  const readingNpcIdsRef = useRef(new Set<string>());
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const npcs = useMemo(() => selectCorrespondenceRecipients(runtimeState), [runtimeState]);
  const conversations = useMemo(() => buildCorrespondenceConversations(runtimeState), [runtimeState]);
  const conversationNpcIds = useMemo(
    () => new Set(conversations.map((conversation) => conversation.npcId)),
    [conversations],
  );
  const newRecipients = useMemo(
    () => npcs.filter((npc) => !conversationNpcIds.has(npc.npcId)),
    [conversationNpcIds, npcs],
  );
  const allCommitments = useMemo(
    () => normalizeCorrespondenceCommitments(runtimeState.correspondenceCommitments)
      .filter((commitment) => isCorrespondenceCommitmentKnownToPlayer(runtimeState, commitment))
      .reverse(),
    [runtimeState],
  );
  const selectedNpc = useMemo(
    () => npcs.find((npc) => npc.npcId === selectedNpcId),
    [npcs, selectedNpcId],
  );
  const selectedConversation = useMemo(() => {
    const existing = conversations.find((conversation) => conversation.npcId === selectedNpcId);
    if (existing || !selectedNpc) return existing;
    return {
      npcId: selectedNpc.npcId,
      npcName: selectedNpc.name,
      ...(selectedNpc.role ? { npcRole: selectedNpc.role } : {}),
      entries: [],
      unreadCount: 0,
    };
  }, [conversations, selectedNpc, selectedNpcId]);
  const selectedCommitments = useMemo(
    () => allCommitments.filter((commitment) => commitment.promisorNpcId === selectedNpcId),
    [allCommitments, selectedNpcId],
  );
  const compose = selectedNpcId
    ? composeByNpc[selectedNpcId] ?? composeFromConversation(selectedConversation)
    : undefined;

  useEffect(() => {
    let cancelled = false;
    void getLetterPolishApiDisplay()
      .then((label) => { if (!cancelled) setPolishApiDisplay(label); })
      .catch(() => { if (!cancelled) setPolishApiDisplay('读取失败'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedNpcId && npcs.some((npc) => npc.npcId === selectedNpcId)) return;
    setSelectedNpcId(conversations[0]?.npcId ?? '');
  }, [conversations, npcs, selectedNpcId]);

  useEffect(() => {
    if (!selectedConversation?.unreadCount || readingNpcIdsRef.current.has(selectedConversation.npcId)) return;
    const npcId = selectedConversation.npcId;
    readingNpcIdsRef.current.add(npcId);
    void onCommit(markCorrespondenceConversationRead(runtimeState, npcId), '来信已读。')
      .catch((error) => setPanelMessage(`已读状态保存失败：${toErrorMessage(error)}`))
      .finally(() => readingNpcIdsRef.current.delete(npcId));
  }, [onCommit, runtimeState, selectedConversation]);

  useEffect(() => {
    const messages = messagesRef.current;
    if (!messages) return;
    messages.scrollTop = messages.scrollHeight;
  }, [selectedNpcId, selectedConversation?.entries.length]);

  const updateCompose = (patch: Partial<ComposeState>): void => {
    if (!selectedNpcId || !compose) return;
    setComposeByNpc((current) => ({
      ...current,
      [selectedNpcId]: { ...compose, ...patch },
    }));
  };

  const buildDraftState = (): { state: RuntimeState; letter: CorrespondenceEntry } => {
    if (!compose) throw new Error('当前没有正在编辑的书信。');
    const npc = npcs.find((candidate) => candidate.npcId === compose.recipientNpcId);
    if (!npc) throw new Error('请选择人物志中已登记的收信人。');
    const letter = createCorrespondenceDraft({
      sender: { kind: 'player', playerId: runtimeState.player.id, name: runtimeState.player.name },
      recipient: { kind: 'npc', npcId: npc.npcId, name: npc.name },
      // 主题不再要求玩家维护；只保留结构化字段兼容。
      subject: compose.replyToLetterId ? '回信' : '书信',
      body: compose.body,
      source: 'ui',
      replyToLetterId: compose.replyToLetterId,
      channel: 'letter',
      originLocationId: runtimeState.currentPlaceId ?? runtimeState.currentLocationId,
      targetLocationId: npc.locationId,
      createdAt: runtimeState.currentDate,
    });
    return { state: upsertCorrespondenceEntry(runtimeState, letter), letter };
  };

  const sendLetter = async (): Promise<void> => {
    if (!compose || isSaving) return;
    setIsSaving(true);
    setPanelMessage('');
    try {
      const { state: draftState, letter } = buildDraftState();
      const queuedState = queueCorrespondence(draftState, letter.letterId, { sentAt: runtimeState.currentDate });
      const queued = normalizeCorrespondenceEntries(queuedState.correspondence)
        .find((entry) => entry.letterId === letter.letterId);
      await onCommit(
        queuedState,
        queued?.deliveryDueAt
          ? `书信已交付驿使，预计 ${queued.deliveryDueAt} 送达。`
          : '书信已交付驿使。',
      );
      setComposeByNpc((current) => ({
        ...current,
        [compose.recipientNpcId]: {
          recipientNpcId: compose.recipientNpcId,
          body: '',
          replyToLetterId: letter.letterId,
        },
      }));
      setPanelMessage(queued?.deliveryDueAt ? `预计 ${queued.deliveryDueAt} 送达。` : '书信已寄出。');
    } catch (error) {
      setPanelMessage(`寄信失败：${toErrorMessage(error)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const polishDraft = async (): Promise<void> => {
    if (!compose || isPolishing) return;
    const npc = npcs.find((candidate) => candidate.npcId === compose.recipientNpcId);
    if (!npc) {
      setPanelMessage('请先选择收信人。');
      return;
    }
    setIsPolishing(true);
    setPanelMessage('正在润色，原稿会保留到成功返回。');
    try {
      const result = await polishLetterDraft({
        body: compose.body,
        senderName: runtimeState.player.name,
        recipientName: npc.name,
        currentDate: runtimeState.currentDate,
        context: buildLetterPolishContext(runtimeState, npc),
      });
      updateCompose({ body: result.body });
      setPolishApiDisplay(`${result.routeLabel}：${result.configName} · ${result.model}`);
      setPanelMessage(result.retriedAfterEmptyContent
        ? '接口首次未返回正文，已用同一原稿安全重试并完成润色；请确认后再保存或寄出。'
        : '润色完成；请确认内容后再保存或寄出。');
    } catch (error) {
      setPanelMessage(`${toErrorMessage(error)}`);
    } finally {
      setIsPolishing(false);
    }
  };

  return (
    <div className="system-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="system-modal ui-system-workspace correspondence-modal"
        data-testid="correspondence-panel"
        role="dialog"
        aria-modal="true"
        aria-label="书信"
        onClick={(event) => event.stopPropagation()}
      >
        <SystemModalHeader title="书信" subtitle="人物往来、在途消息与约定" onClose={onClose} />

        {panelMessage && <p className="correspondence-message" role="status">{panelMessage}</p>}

        <div className="correspondence-layout">
          <aside className="correspondence-conversation-list" aria-label="书信往来人物">
            <div className="correspondence-list-heading">
              <strong>往来人物</strong>
              <div>
                {countUnreadCorrespondence(runtimeState) > 0 && (
                  <span>{countUnreadCorrespondence(runtimeState)} 封未读</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (newRecipients.length === 0) {
                      setPanelMessage('人物志中所有可通信人物都已有书信往来。');
                      return;
                    }
                    setNewRecipientNpcId((current) => current || newRecipients[0]?.npcId || '');
                    setIsStartingNewLetter((current) => !current);
                    setPanelMessage('');
                  }}
                >
                  写信
                </button>
              </div>
            </div>
            {isStartingNewLetter && (
              <div className="correspondence-new-letter-picker">
                <select
                  aria-label="选择新的收信人"
                  value={newRecipientNpcId}
                  onChange={(event) => setNewRecipientNpcId(event.target.value)}
                >
                  {newRecipients.map((npc) => (
                    <option key={npc.npcId} value={npc.npcId}>
                      {npc.name}{npc.currentIdentity || npc.role ? ` · ${npc.currentIdentity ?? npc.role}` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!newRecipientNpcId}
                  onClick={() => {
                    setSelectedNpcId(newRecipientNpcId);
                    setIsStartingNewLetter(false);
                    setPanelMessage('');
                  }}
                >
                  开始写信
                </button>
              </div>
            )}
            {conversations.length === 0 ? (
              <PanelEmptyState>还没有书信往来；可以点击上方“写信”联系人物志中的 NPC。</PanelEmptyState>
            ) : conversations.map((conversation) => (
              <button
                key={conversation.npcId}
                type="button"
                className={conversation.npcId === selectedNpcId ? 'active' : ''}
                data-unread={conversation.unreadCount > 0}
                onClick={() => { setSelectedNpcId(conversation.npcId); setPanelMessage(''); }}
              >
                <span className="correspondence-list-party">
                  <strong>{conversation.npcName}</strong>
                  {conversation.npcRole && <small>{conversation.npcRole}</small>}
                </span>
                <span className="correspondence-list-preview">
                  {conversation.latestEntry ? getCorrespondenceEntryPreview(conversation.latestEntry) : '尚未往来'}
                </span>
                <span className="correspondence-list-meta">
                  {conversation.latestEntry ? getCorrespondenceEntryDisplayTime(conversation.latestEntry) : '可写信'}
                  {conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}
                </span>
              </button>
            ))}
          </aside>

          <main className="correspondence-thread" data-testid="correspondence-thread">
            {selectedConversation && compose ? (
              <>
                <header className="correspondence-thread-header">
                  <div>
                    <strong>{selectedConversation.npcName}</strong>
                    <span>{selectedConversation.npcRole ?? selectedNpc?.currentIdentity ?? '人物志联系人'}</span>
                  </div>
                  <small>书信按游戏时间在途传递；新回信只在此处提醒，不会打断当前正文。</small>
                </header>

                {selectedCommitments.length > 0 && (
                  <details className="correspondence-thread-commitments">
                    <summary>相关约定 {selectedCommitments.length}</summary>
                    <div>
                      {selectedCommitments.slice(0, 8).map((commitment) => (
                        <article key={commitment.commitmentId} data-status={commitment.status}>
                          <strong>{commitmentStatusLabels[commitment.status]} · {commitment.summary}</strong>
                          <span>预计 {commitment.expectedAt} · {commitment.targetLocationId}</span>
                        </article>
                      ))}
                    </div>
                  </details>
                )}

                <div className="correspondence-messages" ref={messagesRef} aria-label={`与${selectedConversation.npcName}的书信往来`}>
                  {selectedConversation.entries.length === 0 ? (
                    <PanelEmptyState>尚无往来书信，可以从下方写第一封信。</PanelEmptyState>
                  ) : selectedConversation.entries.map((entry) => (
                    <div
                      key={entry.letterId}
                      className={`correspondence-message-group ${entry.direction}`}
                      data-testid="correspondence-message-entry"
                    >
                      <time>{getCorrespondenceEntryTimeLabel(entry)}</time>
                      <article className="correspondence-bubble">
                        {entry.body}
                      </article>
                      <small>
                        {statusLabels[entry.status]}
                        {entry.status === 'cancelled' && entry.cancelReason
                          ? ` · ${entry.cancelReason}`
                          : ''}
                        {entry.deliveryDueAt && ['queued', 'inTransit'].includes(entry.status)
                          ? ` · 预计 ${entry.deliveryDueAt} 送达`
                          : ''}
                      </small>
                    </div>
                  ))}
                </div>

                <div className="correspondence-chat-composer" data-testid="correspondence-compose">
                  <textarea
                    value={compose.body}
                    maxLength={4_000}
                    aria-label={`写给${selectedConversation.npcName}的书信`}
                    placeholder={`写给${selectedConversation.npcName}……`}
                    onChange={(event) => updateCompose({ body: event.target.value })}
                  />
                  <div className="correspondence-polish-row">
                    <button type="button" disabled={isPolishing || !compose.body.trim()} onClick={() => void polishDraft()}>
                      {isPolishing ? '润色中…' : 'AI 润色'}
                    </button>
                    <small>
                      通常调用一次：{polishApiDisplay}；未单独配置时复用 NPC 建档主要 API。绝不会自动寄出。
                    </small>
                  </div>
                  <div className="correspondence-compose-actions">
                    <button type="button" disabled={isSaving || !compose.body.trim() || !selectedNpc} onClick={() => void sendLetter()}>
                      寄出书信
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <PanelEmptyState>{npcs.length > 0 ? '请从左侧选择往来人物。' : '人物志中还没有可通信的人物。'}</PanelEmptyState>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function composeFromConversation(conversation: CorrespondenceConversation | undefined): ComposeState | undefined {
  if (!conversation) return undefined;
  const latestIncoming = [...conversation.entries]
    .reverse()
    .find((entry) => entry.direction === 'incoming');
  return {
    recipientNpcId: conversation.npcId,
    body: '',
    replyToLetterId: latestIncoming?.letterId,
  };
}

function compareCorrespondenceEntries(a: CorrespondenceEntry, b: CorrespondenceEntry): number {
  const aTime = getCorrespondenceEntryDisplayTime(a);
  const bTime = getCorrespondenceEntryDisplayTime(b);
  try {
    return compareGameDate(aTime, bTime);
  } catch {
    return aTime.localeCompare(bTime, 'zh-CN');
  }
}

function compareOptionalCorrespondenceEntries(
  a: CorrespondenceEntry | undefined,
  b: CorrespondenceEntry | undefined,
): number {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return compareCorrespondenceEntries(a, b);
}

export function getCorrespondenceEntryPreview(entry: CorrespondenceEntry): string {
  const compact = entry.body.replace(/\s+/g, ' ').trim();
  if (!compact) return '（空白书信）';
  return compact.length > 42 ? `${compact.slice(0, 42)}…` : compact;
}

export function buildLetterPolishContext(state: RuntimeState, npc: LuanShiNpc): LetterPolishContext {
  const bookmark = state.worldBookId === worldBook_ThreeKingdoms.manifest.id
    ? worldBook_ThreeKingdoms.startBookmarks.find((entry) => entry.id === state.startBookmarkId)
    : undefined;
  const worldSummary = state.worldBookId === worldBook_ThreeKingdoms.manifest.id
    ? [
      worldBook_ThreeKingdoms.manifest.description,
      bookmark ? `当前剧本：${bookmark.label}。${bookmark.situationSummary}` : '',
    ].filter(Boolean).join(' ')
    : `当前世界包：${state.worldBookId || '自定义世界'}。`;

  const directRelationship = (state.relationships ?? []).find((relationship) => (
    (relationship.actorId === state.player.id && relationship.targetId === npc.npcId)
    || (relationship.actorId === npc.npcId && relationship.targetId === state.player.id)
  ));
  const heroineThread = (state.heroineThreads ?? []).find((thread) => (
    thread.npcId === npc.npcId && thread.status !== 'archived'
  ));
  const bondThread = (state.bondThreads ?? []).find((thread) => (
    thread.status !== 'archived'
    && ((thread.targetNpcIds ?? []).includes(npc.npcId) || thread.targetNames.includes(npc.name))
  ));

  return {
    worldSummary,
    senderProfile: formatLetterPersonProfile({
      name: state.player.name,
      courtesyName: state.player.courtesyName,
      sex: state.player.sex,
      age: deriveActorCurrentAge(state.player, state.currentDate),
      identities: [
        state.player.currentIdentity,
        state.player.officeTitle,
        state.player.militaryTitle,
        state.player.nobleTitle,
        state.player.roleType,
      ],
      factionName: state.player.factionName,
    }),
    recipientProfile: formatLetterPersonProfile({
      name: npc.name,
      courtesyName: npc.courtesyName,
      sex: npc.sex,
      age: deriveNpcCurrentAge(npc, state.currentDate),
      identities: [npc.currentIdentity, npc.officeTitle, npc.militaryTitle, npc.nobleTitle, npc.role],
      factionName: npc.factionName,
    }),
    relationshipSummary: uniqueTextParts([
      npc.relationToPlayer,
      `往来度 ${Math.max(0, Math.round(npc.contactLevel ?? 0))}`,
      npc.recentAttitude ? `近期态度：${npc.recentAttitude}` : '',
      directRelationship
        ? `关系账本：${formatRelationshipType(directRelationship.type)} ${Math.round(directRelationship.value)}${directRelationship.description ? `（${directRelationship.description}）` : ''}`
        : '',
      heroineThread ? `红颜：${heroineThread.relationshipRole}/${heroineThread.stage}` : '',
      bondThread ? `羁绊：${formatBondType(bondThread.bondType)}` : '',
    ]).join('；'),
  };
}

interface LetterPersonProfileInput {
  name: string;
  courtesyName?: string;
  sex?: string;
  age?: number;
  identities: Array<string | undefined>;
  factionName?: string;
}

function formatLetterPersonProfile(input: LetterPersonProfileInput): string {
  const displayName = input.courtesyName?.trim()
    ? `${input.name}（字${input.courtesyName.trim()}）`
    : input.name;
  const identities = uniqueTextParts(input.identities).slice(0, 2);
  return uniqueTextParts([
    displayName,
    input.sex,
    input.age === undefined ? '' : `${input.age}岁`,
    ...identities,
    input.factionName,
  ]).join('，');
}

function uniqueTextParts(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function formatRelationshipType(type: string): string {
  const labels: Record<string, string> = {
    friend: '友人',
    ally: '盟友',
    family: '亲族',
    lover: '爱侣',
    mentor: '师友',
    subordinate: '部属',
    superior: '上级',
    rival: '对手',
    enemy: '敌对',
    neutral: '一般往来',
  };
  return labels[type] ?? type;
}

function formatBondType(type: NonNullable<RuntimeState['bondThreads']>[number]['bondType']): string {
  const labels: Record<typeof type, string> = {
    sworn: '结义',
    kinship: '亲族',
    mentor: '师徒',
    lordVassal: '主臣',
    ally: '盟友',
    debt: '恩义',
    rival: '对手',
    enemy: '仇敌',
    other: '其他',
  };
  return labels[type];
}

function selectCorrespondenceRecipients(state: RuntimeState): LuanShiNpc[] {
  const heroineIds = new Set((state.heroineThreads ?? []).map((thread) => thread.npcId));
  const bondIds = new Set((state.bondThreads ?? []).flatMap((thread) => thread.targetNpcIds ?? []));
  return [...(state.npcs ?? [])]
    .filter((npc) => Boolean(npc.npcId && npc.name))
    .sort((a, b) => {
      const priority = (npc: LuanShiNpc) => (
        (heroineIds.has(npc.npcId) ? 1_000 : 0)
        + (bondIds.has(npc.npcId) ? 800 : 0)
        + (npc.isFocused ? 300 : 0)
        + Math.max(0, npc.contactLevel ?? 0)
      );
      return priority(b) - priority(a) || a.name.localeCompare(b.name, 'zh-CN');
    });
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}
