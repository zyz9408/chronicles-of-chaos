import { describe, expect, it } from 'vitest';
import gameScreenSource from './GameScreen.tsx?raw';
import startScreenSource from './StartScreen.tsx?raw';
import settingsSource from './ApiSettingsPanel.tsx?raw';
import battleVisualSource from './BattleBriefingVisual.tsx?raw';
import mapBaseSource from './MapHistoricalBaseLayer.tsx?raw';
import mapPanelSource from './MapPanel.tsx?raw';

describe('Batch 8 production asset loading boundaries', () => {
  it('keeps settings, Prompt Registry, map, and battle visuals behind lazy boundaries', () => {
    expect(startScreenSource).not.toContain("import { ApiSettingsPanel } from './ApiSettingsPanel'");
    expect(startScreenSource).toContain("import('./ApiSettingsPanel')");
    expect(settingsSource).not.toContain("import { PromptRegistryPanel } from './PromptRegistryPanel'");
    expect(settingsSource).toContain("import('./PromptRegistryPanel')");
    expect(gameScreenSource).not.toContain("import { MapPanel } from './MapPanel'");
    expect(gameScreenSource).toContain("import('./MapPanel')");
    expect(gameScreenSource).not.toContain("from './combatVisualAssets'");
    expect(gameScreenSource).toContain('BattleBriefingVisual');
  });

  it('uses responsive WebP sources with an in-place loading and retry state', () => {
    expect(battleVisualSource).toContain('data-visual-state');
    expect(battleVisualSource).toContain('重试载入');
    expect(battleVisualSource).toContain('srcSet');
    expect(battleVisualSource).toContain("import('./combatVisualAssets')");
    expect(battleVisualSource).toContain('battle-briefing-has-effect--');
    expect(battleVisualSource).not.toContain('...(visual?.effectClassNames ?? [])');
    expect(mapBaseSource).toContain('<picture');
    expect(mapBaseSource).toContain('mapVisualManifest');
    expect(mapBaseSource).toContain('max-width: 760px');
    expect(mapBaseSource).toContain('?retry=');
    expect(mapBaseSource).toContain('draggable={false}');
    expect(mapPanelSource).toContain('button:not(.map-v2-marker)');
    expect(mapPanelSource).toContain('onDragStart={(event) => event.preventDefault()}');
  });
});
