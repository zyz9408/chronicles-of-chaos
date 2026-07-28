import { describe, expect, it } from 'vitest';
import apiSettingsSource from './ApiSettingsPanel.tsx?raw';
import gameScreenSource from './GameScreen.tsx?raw';
import mapPanelSource from './MapPanel.tsx?raw';
import helperSource from './modalAccessibility.ts?raw';
import startScreenSource from './StartScreen.tsx?raw';
import worldBookSource from './WorldBookSelect.tsx?raw';

describe('shared modal accessibility contract', () => {
  it('owns focus entry, tab trapping, Escape close, restore, and background inert in one UI helper', () => {
    expect(helperSource).toContain('export function useModalAccessibility');
    expect(helperSource).toContain("event.key === 'Escape'");
    expect(helperSource).toContain("event.key !== 'Tab'");
    expect(helperSource).toContain("setAttribute('inert', '')");
    expect(helperSource).toContain("setAttribute('aria-hidden', 'true')");
    expect(helperSource).toContain('new MutationObserver');
    expect(helperSource).toContain('resolveCurrentDialog()');
    expect(helperSource).toContain('.focus()');
  });

  it('wires the shared helper into GameScreen and StartScreen modal families', () => {
    expect(gameScreenSource).toContain("from './modalAccessibility'");
    expect(gameScreenSource).toContain('useModalAccessibility({');
    expect(startScreenSource).toContain("from './modalAccessibility'");
    expect(startScreenSource).toContain('useModalAccessibility({');
    expect(mapPanelSource).toContain('aria-modal="true"');
  });
});

describe('audited clickable entry semantics', () => {
  it('uses a real button for loading a save while keeping delete separate', () => {
    expect(startScreenSource).toMatch(/<button\s+type="button"\s+className="save-item-main"/);
    expect(startScreenSource).not.toContain('<div key={save.id} className="save-item" onClick=');
  });

  it('uses real buttons for worldbook and API archive selection', () => {
    expect(worldBookSource).toMatch(/<button\s+type="button"\s+className={`worldbook-card/);
    expect(apiSettingsSource).toMatch(/<button\s+type="button"\s+key={config\.id}\s+className={`api-archive-card/);
  });
});
