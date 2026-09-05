import { describe, expect, it } from 'vitest';
import type { RuntimeState } from '../engine/types';
import registry from '../engine/avg/ThreeKingdomsAvgRegistry.generated.json';
import { getAvgRuntimeVisualStatus } from './AvgSettingsPanel';

describe('getAvgRuntimeVisualStatus', () => {
  it('reports reference-compatible frozen portrait, speaker, and scene counts', () => {
    const portraitSetId = registry.fixedPortraitSets[0].portraitSetId;
    const sceneResourceId = registry.scenes[0].sceneResourceId;
    const state = {
      worldBookId: 'threeKingdoms',
      avgPresentation: {
        visualPartitionId: 'save-a',
        portraitBindings: [
          {
            bindingKey: 'binding-a',
            saveId: 'save-a',
            worldBookId: 'threeKingdoms',
            actorId: 'actor-a',
            portraitSetId,
            profileSnapshot: {},
            manifestId: registry.registryManifestId,
          },
          {
            bindingKey: 'binding-b',
            saveId: 'another-save',
            worldBookId: 'threeKingdoms',
            actorId: 'actor-b',
            portraitSetId: 'missing-set',
            profileSnapshot: {},
          },
        ],
      },
      turnLog: [
        {
          avgPresentation: {
            speakerBindings: [
              { status: 'frozen', actorId: 'actor-a' },
              { status: 'unbound' },
            ],
            sceneBinding: { sceneResourceId },
          },
        },
        { avgPresentation: { sceneBinding: { sceneResourceId: 'missing-scene' } } },
      ],
    } as unknown as RuntimeState;

    expect(getAvgRuntimeVisualStatus(state, 'save-a')).toEqual({
      availability: 'available',
      portraitBindings: { active: 1, orphaned: 1 },
      speakerSegments: { frozen: 1, unbound: 1 },
      scenes: { active: 1, unbound: 1 },
    });
  });

  it('does not invent a current-save status outside gameplay', () => {
    expect(getAvgRuntimeVisualStatus(undefined, undefined).availability).toBe('no-save');
  });
});
