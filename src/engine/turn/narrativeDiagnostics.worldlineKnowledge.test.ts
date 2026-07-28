import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeState, WorldBook, WorldlineKnowledgeBase } from '../types';
import {
  clearWorldlineKnowledgeRegistryForTest,
  registerWorldlineKnowledgeBase,
} from '../worldline/WorldlineKnowledgeRegistry';
import { buildNarrativeDiagnosticExport } from './narrativeDiagnostics';

const worldBook: WorldBook = {
  manifest: {
    id: 'three-kingdoms',
    name: 'Three Kingdoms',
    version: '0.1.0',
    author: 'test',
    language: 'zh-CN',
    genre: 'historical',
    source: 'official',
    compatibleEngineVersion: '0.1.0',
  },
  ontology: {
    regionLevels: [],
    factionTypes: [],
    actorRoleTypes: [],
    socialClasses: [],
    resourceTypes: [],
    conflictTypes: [],
    actionTypes: [],
    relationshipTypes: [],
  },
  lore: '',
  mapSeed: [],
  factionsSeed: [],
  timelineAnchors: [],
  startBookmarks: [],
  openingCrisisTemplates: [],
  prompts: {
    narrativeBaseline: '',
    toneGuide: '',
    forbiddenTopics: [],
    outputFormat: '',
  },
  validationRules: [],
};

const knowledgeBase: WorldlineKnowledgeBase = {
  id: 'kb_diag_test',
  worldBookId: 'three-kingdoms',
  name: 'Diagnostic Test Knowledge Base',
  version: '0.1.0',
  description: 'Used by narrative diagnostic tests.',
  cards: [
    {
      id: 'kb_luoyang_189',
      worldBookId: 'three-kingdoms',
      kind: 'event',
      title: 'Luoyang turmoil anchor',
      summary: 'Dong Zhuo and Luoyang turmoil are reference anchors, not forced plot.',
      relatedPlaceIds: ['loc_luoyang'],
      importance: 'critical',
      strictness: 'light',
      contradictionHint: 'Do not override established player-world facts.',
      sourceLabel: 'test-source',
    },
  ],
};

function buildRuntimeState(): RuntimeState {
  return {
    engineVersion: '0.1.0',
    worldBookId: 'three-kingdoms',
    worldBookVersion: '0.1.0',
    worldBookSource: 'official',
    worldlineSettings: {
      knowledgeMode: 'strict',
      knowledgeBaseId: 'kb_diag_test',
    },
    startDate: 'AD 189-09-01 08:00',
    currentDate: 'AD 189-09-01 08:30',
    player: {
      id: 'player',
      name: 'Liu Gou',
      roleType: 'test role',
      summary: 'test player',
    },
    currentLocationId: 'loc_luoyang',
    knownActors: [],
    knownFactions: [],
    relationships: [],
    knownRumors: [],
    activeQuests: [],
    playerResources: {},
    worldStateDelta: {},
    turnLog: [],
    localSituationNotes: [],
    locations: [
      {
        locationId: 'loc_luoyang',
        name: 'Luoyang',
        type: 'capital',
        summary: 'Capital city.',
        knownLevel: '亲历',
        recentEvents: [],
      },
    ],
  } as RuntimeState;
}

describe('narrative diagnostic worldline knowledge projection', () => {
  afterEach(() => {
    clearWorldlineKnowledgeRegistryForTest();
  });

  it('exports the active knowledge-base projection mode and projected cards', () => {
    registerWorldlineKnowledgeBase(knowledgeBase);

    const text = buildNarrativeDiagnosticExport({
      runtimeState: buildRuntimeState(),
      worldBook,
      renderedEntries: [],
      saveId: 'save-diagnostic',
      generatedAt: '2026-06-23T00:00:00.000Z',
      getLocationName: () => 'Luoyang',
    });

    expect(text).toContain('Worldline Knowledge Projection');
    expect(text).toContain('mode=strict');
    expect(text).toContain('knowledgeBaseId=kb_diag_test');
    expect(text).toContain('projected=1');
    expect(text).toContain('kb_luoyang_189');
    expect(text).toContain('Luoyang turmoil anchor');
    expect(text).toContain('source=knowledgeBase');
    expect(text).toContain('importance=critical');
    expect(text).toContain('strictness=light');
    expect(text).toContain('role=contextual');
    expect(text).toContain('relevance=place=loc_luoyang');
    expect(text).toContain('Dong Zhuo and Luoyang turmoil are reference anchors, not forced plot.');
  });
});
