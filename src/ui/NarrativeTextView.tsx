import React from 'react';
import type { TurnJudgementCard } from '../engine/types';
import { parseNarrativeTextSegments } from './narrativeTextSegments';

type NarrativeTextViewProps = {
  text: string;
  protagonistName?: string;
  judgementCards?: TurnJudgementCard[];
  onOpenJudgementPanel?: (card: TurnJudgementCard) => void;
};

type NarrativeRenderPart =
  | { type: 'text'; text: string }
  | { type: 'judgement'; card: TurnJudgementCard };

function normalizeSpeaker(speaker: string): string {
  return speaker.trim();
}

function isPlayerSpeaker(speaker: string, protagonistName?: string): boolean {
  const normalizedSpeaker = normalizeSpeaker(speaker);
  const normalizedProtagonistName = protagonistName?.trim();

  return normalizedSpeaker === '你' || (!!normalizedProtagonistName && normalizedSpeaker === normalizedProtagonistName);
}

function getDisplaySpeaker(speaker: string, protagonistName?: string): string {
  const normalizedSpeaker = normalizeSpeaker(speaker);
  const normalizedProtagonistName = protagonistName?.trim();

  if (isPlayerSpeaker(normalizedSpeaker, normalizedProtagonistName) && normalizedProtagonistName) {
    return normalizedProtagonistName;
  }

  return normalizedSpeaker;
}

function getSpeakerInitial(speaker: string): string {
  return speaker.trim().slice(0, 1) || '言';
}

function formatSignedNumber(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function normalizeJudgementId(value: string): string {
  const trimmed = value.trim();
  const colonIndex = trimmed.indexOf(':');
  return colonIndex >= 0 ? trimmed.slice(colonIndex + 1).trim() : trimmed;
}

function parseJudgementMarker(line: string): string | undefined {
  const trimmed = line.trim();
  const squareMarker = /^\[\[判定[:：]([^\]]+)\]\]$/u.exec(trimmed)
    ?? /^\[\[judgement[:：]([^\]]+)\]\]$/iu.exec(trimmed);
  if (squareMarker?.[1]) return normalizeJudgementId(squareMarker[1]);

  const bracketMarker = /^【判定[:：]([^】]+)】$/u.exec(trimmed);
  if (bracketMarker?.[1]) return normalizeJudgementId(bracketMarker[1]);

  return undefined;
}

function stripJudgementMarkerText(text: string): string {
  return text
    .replace(/\[\[(?:判定|judgement)[:：][^\]]+\]\]/giu, '')
    .replace(/【判定[:：][^】]+】/gu, '');
}

function findJudgementCard(
  markerId: string,
  cards: TurnJudgementCard[],
  usedCardIds: Set<string>,
): TurnJudgementCard | undefined {
  const normalizedMarkerId = normalizeJudgementId(markerId);
  return cards.find((card) => {
    if (usedCardIds.has(card.cardId)) return false;
    const normalizedCardId = normalizeJudgementId(card.cardId);
    return card.cardId === markerId
      || normalizedCardId === normalizedMarkerId
      || card.cardId.endsWith(`:${normalizedMarkerId}`);
  });
}

function pushToPlacementMap(
  target: Map<number, TurnJudgementCard[]>,
  lineIndex: number,
  card: TurnJudgementCard,
): void {
  const cards = target.get(lineIndex) ?? [];
  cards.push(card);
  target.set(lineIndex, cards);
}

function normalizeSearchText(value: string | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

const ignoredJudgementSearchTokens = new Set([
  '判定',
  '战斗',
  '战事',
  '战争',
  '个人',
  '普通',
  '结果',
  '成功',
  '失败',
  '取胜',
  '获胜',
]);

function addSearchToken(tokens: Map<string, number>, token: string, weight: number): void {
  const normalizedToken = normalizeSearchText(token);
  if (normalizedToken.length < 2 || ignoredJudgementSearchTokens.has(normalizedToken)) return;
  tokens.set(normalizedToken, Math.max(tokens.get(normalizedToken) ?? 0, weight));
}

function addShortTextTokens(tokens: Map<string, number>, value: string | undefined, weight: number): void {
  const normalizedValue = normalizeSearchText(value);
  if (normalizedValue.length < 2) return;

  if (normalizedValue.length <= 12) {
    addSearchToken(tokens, normalizedValue, weight + 2);
  }

  [4, 3, 2].forEach((tokenLength) => {
    if (normalizedValue.length < tokenLength) return;
    for (let index = 0; index <= normalizedValue.length - tokenLength; index += 1) {
      addSearchToken(tokens, normalizedValue.slice(index, index + tokenLength), weight);
    }
  });
}

function collectJudgementSearchTokens(card: TurnJudgementCard): Map<string, number> {
  const tokens = new Map<string, number>();
  addShortTextTokens(tokens, card.title, 7);
  addShortTextTokens(tokens, card.target, 5);
  card.tags?.slice(0, 4).forEach((tag) => addShortTextTokens(tokens, tag, 3));
  return tokens;
}

function scoreJudgementLine(line: string, card: TurnJudgementCard): number {
  const normalizedLine = normalizeSearchText(line);
  if (!normalizedLine) return 0;

  let score = 0;
  collectJudgementSearchTokens(card).forEach((weight, token) => {
    if (normalizedLine.includes(token)) score += weight;
  });
  return score;
}

function shouldPlaceJudgementBeforeLine(
  line: string,
  card: TurnJudgementCard,
  isLastContentLine: boolean,
): boolean {
  if (isLastContentLine) return true;
  if (card.result && normalizeSearchText(line).includes(normalizeSearchText(card.result))) return true;
  return /(结果|于是|终于|总算|已经|这才|取胜|获胜|胜过|败退|击退|告捷|告败|心服|口服|喝彩|震动|识破|看出|指出|证明)/u.test(line);
}

function findSemanticJudgementPlacement(
  card: TurnJudgementCard,
  lines: string[],
  markerLineIndexes: Set<number>,
): { lineIndex: number; mode: 'before' | 'after'; score: number } | undefined {
  let bestLineIndex = -1;
  let bestScore = 0;
  const contentLineIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !markerLineIndexes.has(index) && Boolean(line.trim()))
    .map(({ index }) => index);
  const lastContentLineIndex = contentLineIndexes[contentLineIndexes.length - 1];

  contentLineIndexes.forEach((lineIndex) => {
    const score = scoreJudgementLine(lines[lineIndex], card);
    if (score > bestScore) {
      bestLineIndex = lineIndex;
      bestScore = score;
    }
  });

  if (bestLineIndex < 0 || bestScore < 7) return undefined;

  const mode = shouldPlaceJudgementBeforeLine(
    lines[bestLineIndex],
    card,
    bestLineIndex === lastContentLineIndex,
  )
    ? 'before'
    : 'after';

  return { lineIndex: bestLineIndex, mode, score: bestScore };
}

function splitNarrativeByJudgementMarkers(
  text: string,
  cards: TurnJudgementCard[] = [],
): NarrativeRenderPart[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const parts: NarrativeRenderPart[] = [];
  const buffer: string[] = [];
  const markerLineIndexes = new Set<number>();
  const markerCardLineIndexes = new Map<string, number>();
  const markerUsedCardIds = new Set<string>();
  const beforeLinePlacements = new Map<number, TurnJudgementCard[]>();
  const afterLinePlacements = new Map<number, TurnJudgementCard[]>();
  const markerPlacements = new Map<number, TurnJudgementCard[]>();
  const appendPlacements: TurnJudgementCard[] = [];

  lines.forEach((rawLine, lineIndex) => {
    const markerId = parseJudgementMarker(rawLine);
    if (!markerId) return;

    markerLineIndexes.add(lineIndex);
    const card = findJudgementCard(markerId, cards, markerUsedCardIds);
    if (card) {
      markerUsedCardIds.add(card.cardId);
      markerCardLineIndexes.set(card.cardId, lineIndex);
    }
  });

  const contentLineIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => !markerLineIndexes.has(index) && Boolean(line.trim()))
    .map(({ index }) => index);

  const hasContentAfter = (lineIndex: number) => contentLineIndexes.some((index) => index > lineIndex);

  for (const card of cards) {
    const markerLineIndex = markerCardLineIndexes.get(card.cardId);
    if (markerLineIndex !== undefined) {
      const semanticPlacement = !hasContentAfter(markerLineIndex)
        ? findSemanticJudgementPlacement(card, lines, markerLineIndexes)
        : undefined;

      if (semanticPlacement && semanticPlacement.lineIndex < markerLineIndex) {
        pushToPlacementMap(
          semanticPlacement.mode === 'before' ? beforeLinePlacements : afterLinePlacements,
          semanticPlacement.lineIndex,
          card,
        );
        continue;
      }

      pushToPlacementMap(markerPlacements, markerLineIndex, card);
      continue;
    }

    const semanticPlacement = findSemanticJudgementPlacement(card, lines, markerLineIndexes);
    if (semanticPlacement) {
      pushToPlacementMap(
        semanticPlacement.mode === 'before' ? beforeLinePlacements : afterLinePlacements,
        semanticPlacement.lineIndex,
        card,
      );
      continue;
    }

    appendPlacements.push(card);
  }

  const flushText = () => {
    const textPart = stripJudgementMarkerText(buffer.join('\n')).trim();
    buffer.length = 0;
    if (textPart) parts.push({ type: 'text', text: textPart });
  };

  const flushCards = (placementCards: TurnJudgementCard[] | undefined) => {
    if (!placementCards || placementCards.length === 0) return;
    flushText();
    placementCards.forEach((card) => parts.push({ type: 'judgement', card }));
  };

  lines.forEach((rawLine, lineIndex) => {
    flushCards(beforeLinePlacements.get(lineIndex));

    if (markerLineIndexes.has(lineIndex)) {
      flushCards(markerPlacements.get(lineIndex));
      return;
    }

    buffer.push(rawLine);
    flushCards(afterLinePlacements.get(lineIndex));
  });

  flushText();
  appendPlacements.forEach((card) => parts.push({ type: 'judgement', card }));

  return parts.length > 0 ? parts : [{ type: 'text', text: '' }];
}

function renderJudgementCard(
  card: TurnJudgementCard,
  onOpenJudgementPanel: ((card: TurnJudgementCard) => void) | undefined,
  key: string,
): React.ReactElement {
  return (
    <div className="turn-judgement-card-list turn-judgement-card-list-inline" key={key}>
      <details
        className={`turn-judgement-card ${card.kind}`}
        data-testid="turn-judgement-card"
      >
        <summary>
          <span className="turn-judgement-mark" aria-hidden="true">判</span>
          <span className="turn-judgement-eyebrow">{card.eyebrow}</span>
          <strong>{card.title}</strong>
          {card.result && <span className="turn-judgement-result">结果 {card.result}</span>}
          <span className="turn-judgement-toggle">展开</span>
        </summary>
        <div className="turn-judgement-body">
          <div className="turn-judgement-metrics">
            {card.target && <span>对象 <strong>{card.target}</strong></span>}
            {card.difficulty !== undefined && <span>难度 <strong>{card.difficulty}</strong></span>}
            {card.total !== undefined && <span>判定 <strong>{card.total}</strong></span>}
            {card.margin !== undefined && <span>差额 <strong>{formatSignedNumber(card.margin)}</strong></span>}
          </div>
          {card.summary && <p>{card.summary}</p>}
          {card.details && card.details.length > 0 && (
            <div className="turn-judgement-details">
              {card.details.map((detail, index) => (
                <span key={`${detail.label}-${index}`}>
                  <b>{detail.label}</b>
                  {detail.value !== undefined && <strong>{formatSignedNumber(detail.value)}</strong>}
                  {detail.text && <em>{detail.text}</em>}
                </span>
              ))}
            </div>
          )}
          {card.tags && card.tags.length > 0 && (
            <div className="turn-judgement-tags">
              {card.tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
            </div>
          )}
          {card.panel && onOpenJudgementPanel && (
            <div className="turn-judgement-actions">
              <button type="button" onClick={() => onOpenJudgementPanel(card)}>
                查看详情
              </button>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function renderNarrativeTextSegments(
  text: string,
  protagonistName: string | undefined,
  keyPrefix: string,
): React.ReactElement[] {
  const segments = parseNarrativeTextSegments(text);

  return segments.map((segment, index) => {
    if (segment.type === 'narration') {
      return (
        <div className="narrative-segment narrative-segment-narration" key={`${keyPrefix}-narration-${index}`}>
          {segment.text}
        </div>
      );
    }

    const displaySpeaker = getDisplaySpeaker(segment.speaker, protagonistName);
    const speakerIsPlayer = isPlayerSpeaker(segment.speaker, protagonistName);

    return (
      <div
        className={`narrative-dialogue-row ${
          speakerIsPlayer ? 'narrative-dialogue-row-player' : 'narrative-dialogue-row-npc'
        }`}
        key={`${keyPrefix}-dialogue-${segment.speaker}-${index}`}
      >
        <div className="narrative-dialogue-avatar" aria-hidden="true">
          {getSpeakerInitial(displaySpeaker)}
        </div>
        <div className="narrative-dialogue-content">
          <div className="narrative-dialogue-speaker">{displaySpeaker}</div>
          <div className="narrative-dialogue-bubble">{segment.text}</div>
        </div>
      </div>
    );
  });
}

export function NarrativeTextView({
  text,
  protagonistName,
  judgementCards,
  onOpenJudgementPanel,
}: NarrativeTextViewProps) {
  const parts = splitNarrativeByJudgementMarkers(text, judgementCards);

  return (
    <div className="narrative-text-view" data-testid="narrative-text-view">
      {parts.map((part, index) => {
        if (part.type === 'judgement') {
          return renderJudgementCard(part.card, onOpenJudgementPanel, `judgement-${part.card.cardId}-${index}`);
        }

        return (
          <React.Fragment key={`text-${index}`}>
            {renderNarrativeTextSegments(part.text, protagonistName, `text-${index}`)}
          </React.Fragment>
        );
      })}
    </div>
  );
}
