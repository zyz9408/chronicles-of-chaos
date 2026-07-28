export interface TokenEstimateResult {
  chars: number;
  estimatedTokens: number;
  lowerBound: number;
  upperBound: number;
}

function isCjkCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf)
    || (codePoint >= 0x4e00 && codePoint <= 0x9fff)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0x3040 && codePoint <= 0x30ff)
    || (codePoint >= 0xac00 && codePoint <= 0xd7af)
  );
}

function isAsciiLetterOrDigit(char: string): boolean {
  return /[A-Za-z0-9]/.test(char);
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isPunctuation(char: string): boolean {
  return /[^\p{L}\p{N}\s]/u.test(char);
}

export function estimatePromptTokens(text: string): TokenEstimateResult {
  if (!text) {
    return {
      chars: 0,
      estimatedTokens: 0,
      lowerBound: 0,
      upperBound: 0,
    };
  }

  const chars = Array.from(text);
  let cjkCount = 0;
  let asciiAlphaNumericCount = 0;
  let whitespaceCount = 0;
  let punctuationCount = 0;
  let otherCount = 0;

  for (const char of chars) {
    if (isCjkCharacter(char)) {
      cjkCount += 1;
    } else if (isAsciiLetterOrDigit(char)) {
      asciiAlphaNumericCount += 1;
    } else if (isWhitespace(char)) {
      whitespaceCount += 1;
    } else if (isPunctuation(char)) {
      punctuationCount += 1;
    } else {
      otherCount += 1;
    }
  }

  const weightedEstimate =
    cjkCount * 1.05
    + asciiAlphaNumericCount / 3.8
    + punctuationCount * 0.35
    + whitespaceCount * 0.12
    + otherCount * 0.8;
  const estimatedTokens = Math.max(1, Math.ceil(weightedEstimate));

  return {
    chars: chars.length,
    estimatedTokens,
    lowerBound: Math.max(1, Math.floor(estimatedTokens * 0.82)),
    upperBound: Math.max(estimatedTokens, Math.ceil(estimatedTokens * 1.28)),
  };
}
