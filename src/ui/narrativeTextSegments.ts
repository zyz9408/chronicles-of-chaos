export type NarrativeTextSegment =
  | {
    type: 'narration';
    text: string;
  }
  | {
    type: 'dialogue';
    speaker: string;
    text: string;
    speakerSource: 'explicit' | 'inferred';
  };

const narrationSpeakers = new Set(['旁白', '叙述', '叙事', 'Narrator', 'narrator']);

function isSpeakerLabel(value: string): boolean {
  return /^[\p{Letter}\p{Number}_·・（）()《》]{1,14}$/u.test(value);
}

function isNumberCharacter(value: string | undefined): boolean {
  return value !== undefined && /^\p{Number}$/u.test(value);
}

function findSpeakerSeparator(line: string): number {
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character !== ':' && character !== '：') continue;

    if (isNumberCharacter(line[index - 1]) && isNumberCharacter(line[index + 1])) {
      continue;
    }

    return index;
  }

  return -1;
}

function parseSpeakerLine(line: string): { speaker: string; text: string } | undefined {
  const separatorIndex = findSpeakerSeparator(line);
  if (separatorIndex <= 0 || separatorIndex > 16) return undefined;

  const speaker = line.slice(0, separatorIndex).trim();
  const text = line.slice(separatorIndex + 1).trim();
  if (!speaker || !text || !isSpeakerLabel(speaker)) return undefined;

  return { speaker, text };
}

function parseBracketSpeakerLine(line: string): { speaker: string; text: string } | undefined {
  const match = /^【([^】]{1,16})】\s*(.*)$/u.exec(line);
  if (!match) return undefined;

  const speaker = match[1].trim();
  const text = match[2].trim();
  if (!speaker || !text || !isSpeakerLabel(speaker)) return undefined;

  return { speaker, text };
}

function parseStandaloneBracketSpeakerLabel(line: string): string | undefined {
  const match = /^\u3010([^\u3011]{1,16})\u3011\s*$/u.exec(line);
  if (!match) return undefined;

  const speaker = match[1].trim();
  if (!speaker || !isSpeakerLabel(speaker)) return undefined;

  return speaker;
}

function normalizeQuotedDialogue(text: string): string {
  const normalized = text
    .trim()
    .replace(/^[“「"]+/u, '')
    .replace(/[”」"]+$/u, '')
    .trim();
  return `「${normalized}」`;
}

function extractLeadingSpeakerCandidate(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith('你')) return '你';

  const match = /^([\p{Letter}\p{Number}_·・]{1,10}?)(?:匆匆|微微|猛地|低声|沉声|冷声|压低|咧|听罢|抱拳|大步|将|把|对|问|说|喝|喊|叹|笑|露|皱|看|转|走|上前|开口|声音|目光|双手|气沉|翻身|纵马)/u.exec(trimmed);
  return match?.[1]?.trim();
}

function inferSpeakerFromQuoteContext(before: string, after: string): string | undefined {
  const beforeTrim = before.trim();
  const afterTrim = after.trim();
  if (!beforeTrim && afterTrim.startsWith('你')) return '你';
  if (beforeTrim.startsWith('你') && /[：:]$/u.test(beforeTrim)) return '你';

  const speechCuePattern = /(道|说道|问道|答道|喝道|喊道|吼道|笑道|叹道|低声|沉声|冷声|压低声音|开口|抱拳|禀|回主公|声音)/u;
  if (beforeTrim && (speechCuePattern.test(beforeTrim) || /[：:]$/u.test(beforeTrim))) {
    return extractLeadingSpeakerCandidate(beforeTrim);
  }

  if (afterTrim.startsWith('你')) return '你';
  return undefined;
}

function parseInlineQuoteLine(line: string): NarrativeTextSegment[] | undefined {
  const match = /([“「"])([^”」"]+)([”」"])/u.exec(line);
  if (!match || match.index === undefined) return undefined;

  const before = line.slice(0, match.index);
  const quoted = match[0];
  const after = line.slice(match.index + quoted.length);
  const speaker = inferSpeakerFromQuoteContext(before, after);
  if (!speaker) return undefined;

  const segments: NarrativeTextSegment[] = [];
  if (before.trim()) {
    segments.push({ type: 'narration', text: before.trim() });
  }
  segments.push({ type: 'dialogue', speaker, text: normalizeQuotedDialogue(quoted), speakerSource: 'inferred' });
  if (after.trim()) {
    segments.push({ type: 'narration', text: after.trim() });
  }

  return segments;
}

export function parseNarrativeTextSegments(text: string): NarrativeTextSegment[] {
  const segments: NarrativeTextSegment[] = [];
  const narrationBuffer: string[] = [];
  let pendingSpeaker: string | undefined;
  const pendingSpeakerBuffer: string[] = [];

  const flushNarration = () => {
    const narration = narrationBuffer.join('\n').trim();
    narrationBuffer.length = 0;
    if (narration) {
      segments.push({ type: 'narration', text: narration });
    }
  };

  const flushPendingSpeaker = () => {
    if (!pendingSpeaker) return;

    const speaker = pendingSpeaker;
    const speakerText = pendingSpeakerBuffer.join('\n').trim();
    pendingSpeaker = undefined;
    pendingSpeakerBuffer.length = 0;

    if (!speakerText) return;

    if (narrationSpeakers.has(speaker)) {
      narrationBuffer.push(speakerText);
      return;
    }

    flushNarration();
    segments.push({
      type: 'dialogue',
      speaker,
      text: speakerText,
      speakerSource: 'explicit',
    });
  };

  text.replace(/\r\n?/g, '\n').split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      flushPendingSpeaker();
      flushNarration();
      return;
    }

    const speakerLine = parseBracketSpeakerLine(line) ?? parseSpeakerLine(line);
    if (!speakerLine) {
      const standaloneSpeaker = parseStandaloneBracketSpeakerLabel(line);
      if (standaloneSpeaker) {
        flushPendingSpeaker();
        flushNarration();
        pendingSpeaker = standaloneSpeaker;
        return;
      }

      if (pendingSpeaker) {
        pendingSpeakerBuffer.push(line);
        return;
      }

      const inlineQuoteSegments = parseInlineQuoteLine(line);
      if (inlineQuoteSegments) {
        flushNarration();
        segments.push(...inlineQuoteSegments);
        return;
      }

      narrationBuffer.push(line);
      return;
    }

    flushPendingSpeaker();

    if (narrationSpeakers.has(speakerLine.speaker)) {
      narrationBuffer.push(speakerLine.text);
      return;
    }

    flushNarration();
    segments.push({
      type: 'dialogue',
      speaker: speakerLine.speaker,
      text: speakerLine.text,
      speakerSource: 'explicit',
    });
  });

  flushPendingSpeaker();
  flushNarration();
  return segments;
}
