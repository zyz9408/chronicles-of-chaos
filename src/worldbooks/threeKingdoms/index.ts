// Three Kingdoms WorldBook - Barrel Export
import type { WorldBook } from '../../engine/types';
import { threeKingdomsManifest } from './manifest';
import { threeKingdomsOntology } from './ontology';
import { threeKingdomsLore } from './lore';
import { threeKingdomsMapSeed } from './mapSeed';
import { threeKingdomsOpeningLocationSeed } from './openingLocationSeed';
import { threeKingdomsRouteSeed } from './routeSeed';
import { threeKingdomsFactionsSeed } from './factionsSeed';
import { threeKingdomsTimelineAnchors } from './timelineAnchors';
import { threeKingdomsStartBookmarks } from './startBookmarks';
import { threeKingdomsOpeningCrisisTemplates } from './openingCrisisTemplates';
import { threeKingdomsCharacterOptions } from './characterOptions';
import { threeKingdomsPrompts } from './prompts';
import { threeKingdomsValidationRules } from './validation';

export const worldBook_ThreeKingdoms: WorldBook = {
  manifest: threeKingdomsManifest,
  ontology: threeKingdomsOntology,
  lore: threeKingdomsLore,
  mapSeed: threeKingdomsMapSeed,
  openingLocationSeed: threeKingdomsOpeningLocationSeed,
  routeSeed: threeKingdomsRouteSeed,
  factionsSeed: threeKingdomsFactionsSeed,
  timelineAnchors: threeKingdomsTimelineAnchors,
  startBookmarks: threeKingdomsStartBookmarks,
  openingCrisisTemplates: threeKingdomsOpeningCrisisTemplates,
  characterOptions: threeKingdomsCharacterOptions,
  prompts: threeKingdomsPrompts,
  validationRules: threeKingdomsValidationRules,
};

export { threeKingdomsManifest } from './manifest';
export { threeKingdomsOntology } from './ontology';
export { threeKingdomsLore } from './lore';
export { threeKingdomsMapSeed } from './mapSeed';
export { threeKingdomsOpeningLocationSeed } from './openingLocationSeed';
export { threeKingdomsRouteSeed } from './routeSeed';
export { threeKingdomsFactionsSeed } from './factionsSeed';
export { threeKingdomsTimelineAnchors } from './timelineAnchors';
export { threeKingdomsStartBookmarks } from './startBookmarks';
export { threeKingdomsOpeningCrisisTemplates } from './openingCrisisTemplates';
export { threeKingdomsCharacterOptions } from './characterOptions';
export { threeKingdomsPrompts } from './prompts';
export { threeKingdomsValidationRules } from './validation';
export { threeKingdomsKnowledgeBase } from './knowledgeBase';
export {
  THREE_KINGDOMS_GENERIC_STORY_PACK_ID,
  threeKingdomsGenericStoryPack,
} from './storyPack';
export {
  THREE_KINGDOMS_STORY_PACK_BATCH_1_BLUEPRINTS,
  THREE_KINGDOMS_STORY_PACK_BATCH_1_THREADS,
} from './storyPackBatch1Content';
export {
  THREE_KINGDOMS_STORY_PACK_BATCH_2_BLUEPRINTS,
  THREE_KINGDOMS_STORY_PACK_BATCH_2_THREADS,
} from './storyPackBatch2Content';
export {
  THREE_KINGDOMS_STORY_PACK_BATCH_3_BLUEPRINTS,
  THREE_KINGDOMS_STORY_PACK_BATCH_3_DRAMA_FUNCTIONS,
  THREE_KINGDOMS_STORY_PACK_BATCH_3_THREADS,
} from './storyPackBatch3Content';
export {
  THREE_KINGDOMS_STORY_DOMAINS,
  THREE_KINGDOMS_STORY_ERA_BANDS,
  THREE_KINGDOMS_STORY_FACETS,
  THREE_KINGDOMS_STORY_PACK_CATALOG,
  THREE_KINGDOMS_STORY_REGIONS,
  THREE_KINGDOMS_STORY_ROLE_PERSPECTIVES,
} from './storyPackCatalog';
export {
  assertThreeKingdomsStoryPackValid,
  buildThreeKingdomsStoryPackCoverage,
  createThreeKingdomsStoryThread,
  validateThreeKingdomsStoryPack,
} from './storyPackBuilder';
export type { ThreeKingdomsStoryThreadDraft } from './storyPackBuilder';
