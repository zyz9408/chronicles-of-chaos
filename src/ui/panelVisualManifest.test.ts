import { describe, expect, it } from 'vitest';
import { loadHoldingVisualManifest } from './holdingVisualAssets';
import { loadTroopVisualManifest } from './troopVisualAssets';
import { combatBackgroundVisualManifest } from '../generated/panelVisuals/combatBackgroundVisualManifest';
import { combatCharacterVisualManifest } from '../generated/panelVisuals/combatCharacterVisualManifest';
import { warBackgroundVisualManifest } from '../generated/panelVisuals/warBackgroundVisualManifest';
import { warForceVisualManifest } from '../generated/panelVisuals/warForceVisualManifest';
import { mapVisualManifest } from '../generated/panelVisuals/mapVisualManifest';

const generatedHoldingFiles = import.meta.glob('../assets/generated/holdings/**/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const generatedTroopFiles = import.meta.glob('../assets/generated/troops/**/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const generatedCombatFiles = import.meta.glob('../assets/generated/combat/**/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const generatedWarFiles = import.meta.glob('../assets/generated/war/**/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const generatedMapFiles = import.meta.glob('../assets/generated/maps/**/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

describe('panel visual manifests', () => {
  it('lists exactly 60 holding and 72 troop identities without eager glob imports', async () => {
    const [holdings, troops] = await Promise.all([
      loadHoldingVisualManifest(),
      loadTroopVisualManifest(),
    ]);

    expect(Object.keys(holdings)).toHaveLength(60);
    expect(Object.keys(troops)).toHaveLength(72);
    expect(new Set(Object.keys(holdings)).size).toBe(60);
    expect(new Set(Object.keys(troops)).size).toBe(72);

    for (const [sourceKey, entry] of Object.entries({ ...holdings, ...troops })) {
      expect(entry).toEqual({
        sourceKey,
        thumbnail: expect.objectContaining({ url: expect.stringContaining('.webp'), width: 320, height: 180 }),
        display: expect.objectContaining({ url: expect.stringContaining('.webp'), width: 1280, height: 720 }),
      });
    }
  });

  it('keeps every generated WebP on disk and removes both eager glob forms from runtime selectors', async () => {
    const [holdings, troops] = await Promise.all([
      loadHoldingVisualManifest(),
      loadTroopVisualManifest(),
    ]);

    expect(Object.keys(generatedHoldingFiles)).toHaveLength(Object.keys(holdings).length * 2);
    expect(Object.keys(generatedTroopFiles)).toHaveLength(Object.keys(troops).length * 2);

    const runtimeSources = await Promise.all([
      import('./holdingVisualAssets.ts?raw').then((module) => module.default),
      import('./troopVisualAssets.ts?raw').then((module) => module.default),
    ]);
    expect(runtimeSources.join('\n')).not.toContain('import.meta.glob');
    expect(runtimeSources.join('\n')).not.toContain('eager: true');
  });

  it('maps every combat, war, and map master to responsive WebP output only', async () => {
    const combatEntries = {
      ...combatBackgroundVisualManifest,
      ...combatCharacterVisualManifest,
    };
    const warEntries = {
      ...warBackgroundVisualManifest,
      ...warForceVisualManifest,
    };

    expect(Object.keys(combatBackgroundVisualManifest)).toHaveLength(8);
    expect(Object.keys(combatCharacterVisualManifest)).toHaveLength(21);
    expect(Object.keys(warBackgroundVisualManifest)).toHaveLength(8);
    expect(Object.keys(warForceVisualManifest)).toHaveLength(8);
    expect(Object.keys(mapVisualManifest)).toHaveLength(1);
    expect(Object.keys(generatedCombatFiles)).toHaveLength(Object.keys(combatEntries).length * 2);
    expect(Object.keys(generatedWarFiles)).toHaveLength(Object.keys(warEntries).length * 2);
    expect(Object.keys(generatedMapFiles)).toHaveLength(2);

    for (const entry of Object.values({ ...combatEntries, ...warEntries, ...mapVisualManifest })) {
      expect(entry.sourceKey).toMatch(/\.png$/);
      expect(entry.mobile.url).toContain('.webp');
      expect(entry.display.url).toContain('.webp');
      expect(entry.mobile.width).toBeLessThan(entry.display.width);
    }

    const combatRuntimeSource = await import('./combatVisualAssets.ts?raw').then((module) => module.default);
    expect(combatRuntimeSource).not.toContain("../assets/combat/");
    expect(combatRuntimeSource).not.toContain("../assets/war/");
    expect(combatRuntimeSource).not.toContain("new URL('../assets/");
  });
});
