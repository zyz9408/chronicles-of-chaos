import type { WorldlineKnowledgeBase, WorldlineStoryPack } from '../types';

const knowledgeBases = new Map<string, WorldlineKnowledgeBase>();
const storyPacks = new Map<string, WorldlineStoryPack>();

export function registerWorldlineKnowledgeBase(base: WorldlineKnowledgeBase): void {
  knowledgeBases.set(base.id, base);
}

export function getWorldlineKnowledgeBase(id: string | undefined): WorldlineKnowledgeBase | undefined {
  return id ? knowledgeBases.get(id) : undefined;
}

export function listWorldlineKnowledgeBasesForWorldBook(worldBookId: string): WorldlineKnowledgeBase[] {
  return [...knowledgeBases.values()].filter((base) => base.worldBookId === worldBookId);
}

export function registerWorldlineStoryPack(pack: WorldlineStoryPack): void {
  storyPacks.set(pack.id, pack);
}

export function getWorldlineStoryPack(id: string | undefined): WorldlineStoryPack | undefined {
  return id ? storyPacks.get(id) : undefined;
}

export function listWorldlineStoryPacksForWorldBook(worldBookId: string): WorldlineStoryPack[] {
  return [...storyPacks.values()].filter((pack) => pack.worldBookId === worldBookId);
}

export function clearWorldlineKnowledgeRegistryForTest(): void {
  knowledgeBases.clear();
  storyPacks.clear();
}
