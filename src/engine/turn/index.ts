// Engine Turn - Barrel Export
export { interpretAction, matchesIntent } from './ActionInterpreter';
export { composePrompt } from './PromptComposer';
export type { PromptContext } from './PromptComposer';
export { generateMockNarrative } from './MockNarrator';
export type { NarratorResponse } from './MockNarrator';
export { validatePatch } from './StatePatchValidator';
export { applyPatch } from './StatePatchApplier';
export { executeTurn } from './TurnOrchestrator';
export type { TurnResult } from './TurnOrchestrator';
