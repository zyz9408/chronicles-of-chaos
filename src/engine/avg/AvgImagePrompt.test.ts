import { describe, expect, it } from 'vitest';
import { buildAvgActorImagePrompt, buildAvgSceneImagePrompt, finalizeAvgImagePrompt } from './AvgImagePrompt';

describe('AVG image prompt safety', () => {
  it('enforces painted Three Kingdoms art for characters, outfits and scenes after edits', () => {
    for (const draft of [buildAvgActorImagePrompt({ name: '守卒', age: 30 }), buildAvgActorImagePrompt({ name: '少年' }), buildAvgSceneImagePrompt({ name: '城门' })]) {
      expect(draft.draft).toContain('三国志式');
      expect(finalizeAvgImagePrompt({ ...draft, editedDraft: draft.safetyMode === 'non-adult-actor' ? draft.draft : '摄影风格', supplement: '', boldNonExplicit: false })).toMatch(/三国志式[\s\S]*禁止真人摄影/);
    }
  });
  it('locks unknown/minor actor prompts and rejects supplements', () => {
    const draft = buildAvgActorImagePrompt({ name: '少年角色' });
    expect(draft.safetyMode).toBe('non-adult-actor');
    expect(() => finalizeAvgImagePrompt({ ...draft, editedDraft: draft.draft, supplement: '更性感', boldNonExplicit: false })).toThrow('已锁定');
    expect(finalizeAvgImagePrompt({ ...draft, editedDraft: draft.draft, supplement: '', boldNonExplicit: false })).toContain('非性化');
  });

  it('adds immutable actor and scene guards after editable text', () => {
    const adult = buildAvgActorImagePrompt({ name: '成年角色', age: 30 });
    expect(finalizeAvgImagePrompt({ ...adult, editedDraft: '候选风格', supplement: '黑金色', boldNonExplicit: true })).toContain('禁止裸体');
    const scene = buildAvgSceneImagePrompt({ name: '洛阳城' });
    expect(finalizeAvgImagePrompt({ ...scene, editedDraft: scene.draft, supplement: '', boldNonExplicit: false })).toContain('仅生成无人物场景');
  });
});
