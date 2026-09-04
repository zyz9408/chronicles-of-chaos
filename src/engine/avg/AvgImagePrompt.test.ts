import { describe, expect, it } from 'vitest';
import { buildAvgActorImagePrompt, buildAvgSceneImagePrompt, finalizeAvgImagePrompt } from './AvgImagePrompt';

describe('AVG image prompt safety', () => {
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
