export {
  addGameMinutes,
  advanceCorrespondenceState,
  buildCorrespondencePromptProjection,
  compareGameDate,
  createCorrespondenceDraft,
  estimateCorrespondenceTravelMinutes,
  findCorrespondenceNpc,
  isCorrespondenceCommitmentKnownToPlayer,
  markCorrespondenceRead,
  markCorrespondenceProcessed,
  markCorrespondenceDelivered,
  normalizeCorrespondenceCommitments,
  normalizeCorrespondenceEntries,
  queueCorrespondence,
  repairCorrespondenceVisibleMemoryArtifacts,
  repairRapidRepeatedNpcFollowups,
  findRapidRepeatedNpcFollowup,
  recordNpcSentCorrespondenceMemory,
  upsertCorrespondenceEntry,
} from './CorrespondenceRuntime';
export type {
  CorrespondenceAdvanceResult,
  CorrespondencePromptProjection,
  CreateCorrespondenceDraftInput,
  QueueCorrespondenceOptions,
} from './CorrespondenceRuntime';
export { applyCorrespondenceWriteback } from './CorrespondenceWriteback';
export type { CorrespondenceWritebackApplication } from './CorrespondenceWriteback';
export {
  buildLetterPolishMessages,
  getLetterPolishApiDisplay,
  polishLetterDraft,
} from './LetterPolishService';
export type {
  LetterPolishContext,
  LetterPolishInput,
  LetterPolishResult,
  LetterPolishServiceDependencies,
} from './LetterPolishService';
