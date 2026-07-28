import type { WorldlineStoryPack, WorldlineStoryThread } from '../../engine/types';
import {
  buildStoryPackCoverageReport,
  createStructuredStoryThread,
  validateWorldlineStoryPack,
  type StoryPackCoverageReport,
  type StoryPackValidationIssue,
  type StructuredStoryThreadDraft,
  type ValidateStoryPackOptions,
} from '../../engine/worldline/StoryPackTooling';
import { THREE_KINGDOMS_GENERIC_STORY_PACK_ID } from './storyPackConstants';
import { THREE_KINGDOMS_STORY_PACK_CATALOG } from './storyPackCatalog';
import { THREE_KINGDOMS_MAJOR_EVENT_MANIFEST } from './knowledgeBaseMajorEventManifest';

export type ThreeKingdomsStoryThreadDraft = Omit<
  StructuredStoryThreadDraft,
  'packId' | 'worldBookId'
>;

export function createThreeKingdomsStoryThread(
  draft: ThreeKingdomsStoryThreadDraft,
): WorldlineStoryThread {
  return createStructuredStoryThread({
    ...draft,
    packId: THREE_KINGDOMS_GENERIC_STORY_PACK_ID,
    worldBookId: 'threeKingdoms',
  });
}

export function validateThreeKingdomsStoryPack(
  pack: WorldlineStoryPack,
  options?: ValidateStoryPackOptions,
): StoryPackValidationIssue[] {
  const forbiddenHistoricalTerms = THREE_KINGDOMS_MAJOR_EVENT_MANIFEST.flatMap((entry) => [
    entry.title,
    ...entry.aliases,
  ]);
  return validateWorldlineStoryPack(
    pack,
    THREE_KINGDOMS_STORY_PACK_CATALOG,
    {
      ...options,
      forbiddenHistoricalTerms: options?.forbiddenHistoricalTerms ?? forbiddenHistoricalTerms,
    },
  );
}

export function buildThreeKingdomsStoryPackCoverage(
  pack: WorldlineStoryPack,
): StoryPackCoverageReport {
  return buildStoryPackCoverageReport(pack, THREE_KINGDOMS_STORY_PACK_CATALOG);
}

export function assertThreeKingdomsStoryPackValid(pack: WorldlineStoryPack): void {
  const errors = validateThreeKingdomsStoryPack(pack)
    .filter((issue) => issue.severity === 'error');
  if (!errors.length) return;
  throw new Error([
    `Three Kingdoms StoryPack validation failed with ${errors.length} error(s):`,
    ...errors.map((issue) => `${issue.code} @ ${issue.path}: ${issue.message}`),
  ].join('\n'));
}
