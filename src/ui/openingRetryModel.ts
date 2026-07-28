const TRUE_OPENING_FAILED_PREFIX = '\u771f\u5f00\u5c40\u5931\u8d25\uff1a';

export interface OpeningRetryState {
  message: string;
  isProcessing: boolean;
  trueOpeningGenerated?: boolean;
}

export function shouldShowTrueOpeningRetryButton(state: OpeningRetryState): boolean {
  return (
    !state.isProcessing
    && !state.trueOpeningGenerated
    && state.message.trim().startsWith(TRUE_OPENING_FAILED_PREFIX)
  );
}
