import { describe, expect, it } from 'vitest';
import { readUiStyleSource } from './readUiStyleSource.test-helper';

describe('UI Batch 7 record and inspection contracts', () => {
  it('keeps diagnostics in the topbar and removes the duplicate utility entry', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const topbarSource = source.slice(source.indexOf('<div className="game-topbar">'), source.indexOf('<MobileRegionSwitcher'));

    expect(topbarSource).toContain('data-testid="diagnostic-export-button"');
    expect(topbarSource).toContain('onClick={openDiagnosticExport}');
    expect(topbarSource).toContain('诊断导出');
    expect(source).not.toContain('data-testid="game-open-diagnostics"');
    expect(source).toContain('<details className="turn-inspection-menu"');
    expect(source).toContain('className="turn-inspection-popover"');
    expect(source).toContain('data-testid="turn-display-stats"');
  });

  it('renders archive rows as four scan facts and keeps long report modals stable', async () => {
    const { readFileSync } = await import('node:' + 'fs') as { readFileSync: (path: URL, encoding: string) => string };
    const source = readFileSync(new URL('./GameScreen.tsx', import.meta.url), 'utf8');
    const css = await readUiStyleSource();

    expect(source).toContain('archive-record-facts');
    expect(source).toContain('时间');
    expect(source).toContain('结果');
    expect(source).toContain('重要性');
    expect(css).toContain('.archive-report-modal');
    expect(css).toContain('height: min(860px, calc(100dvh - 2rem))');
    expect(css).toContain('scrollbar-gutter: stable');
    expect(css).toContain('@media (max-width: 960px)');
  });
});
