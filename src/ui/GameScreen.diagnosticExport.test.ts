import { describe, expect, it, vi } from 'vitest';
import {
  FULL_DIAGNOSTIC_EXPORT_WARNING,
  confirmFullDiagnosticExport,
} from './GameScreen';

describe('GameScreen diagnostic export confirmation', () => {
  it('does not expose full diagnostic material when the warning is declined', () => {
    const confirm = vi.fn(() => false);

    expect(confirmFullDiagnosticExport(confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledWith(FULL_DIAGNOSTIC_EXPORT_WARNING);
  });

  it('allows an explicit full export only after acknowledging the sensitive-data warning', () => {
    const confirm = vi.fn(() => true);

    expect(confirmFullDiagnosticExport(confirm)).toBe(true);
    expect(FULL_DIAGNOSTIC_EXPORT_WARNING).toContain('原始模型响应');
    expect(FULL_DIAGNOSTIC_EXPORT_WARNING).toContain('私密资料');
  });
});
