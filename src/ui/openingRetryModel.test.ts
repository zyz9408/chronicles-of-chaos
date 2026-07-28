import { describe, expect, it } from 'vitest';
import { shouldShowTrueOpeningRetryButton } from './openingRetryModel';

describe('shouldShowTrueOpeningRetryButton', () => {
  it('shows retry only for a failed true opening that has not completed', () => {
    expect(shouldShowTrueOpeningRetryButton({
      message: '\u771f\u5f00\u5c40\u5931\u8d25\uff1aAPI \u8bf7\u6c42\u5931\u8d25\uff08429\uff09',
      isProcessing: false,
      trueOpeningGenerated: false,
    })).toBe(true);
  });

  it('hides retry while processing or after true opening has completed', () => {
    expect(shouldShowTrueOpeningRetryButton({
      message: '\u771f\u5f00\u5c40\u5931\u8d25\uff1aAPI \u8bf7\u6c42\u5931\u8d25\uff08429\uff09',
      isProcessing: true,
      trueOpeningGenerated: false,
    })).toBe(false);

    expect(shouldShowTrueOpeningRetryButton({
      message: '\u771f\u5f00\u5c40\u5931\u8d25\uff1aAPI \u8bf7\u6c42\u5931\u8d25\uff08429\uff09',
      isProcessing: false,
      trueOpeningGenerated: true,
    })).toBe(false);
  });

  it('does not show retry for ordinary game messages', () => {
    expect(shouldShowTrueOpeningRetryButton({
      message: '\u9519\u8bef\uff1a\u56de\u5408\u751f\u6210\u5931\u8d25',
      isProcessing: false,
      trueOpeningGenerated: false,
    })).toBe(false);

    expect(shouldShowTrueOpeningRetryButton({
      message: '\u5f00\u573a\u5267\u60c5\u5df2\u751f\u6210\u5e76\u81ea\u52a8\u4fdd\u5b58',
      isProcessing: false,
      trueOpeningGenerated: false,
    })).toBe(false);
  });
});
