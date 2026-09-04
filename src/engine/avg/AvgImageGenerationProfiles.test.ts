import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  IndexedDbAvgImageGenerationProfileRepository,
  createAvgImageGenerationProfile,
  normalizeAvgImageServiceBaseUrl,
} from './AvgImageGenerationProfiles';

describe('AVG image generation profiles', () => {
  it('normalizes safe service roots and rejects credentials, query strings, and remote HTTP', () => {
    expect(normalizeAvgImageServiceBaseUrl('https://images.example/v1/')).toBe('https://images.example/v1');
    expect(normalizeAvgImageServiceBaseUrl('http://localhost:8080/v1')).toBe('http://localhost:8080/v1');
    expect(() => normalizeAvgImageServiceBaseUrl('http://images.example/v1')).toThrow('HTTPS');
    expect(() => normalizeAvgImageServiceBaseUrl('https://user:secret@images.example/v1')).toThrow('不能包含凭据');
    expect(() => normalizeAvgImageServiceBaseUrl('https://images.example/v1?token=x')).toThrow('查询参数');
  });

  it('stores credentials separately and never returns them with profiles', async () => {
    const repository = new IndexedDbAvgImageGenerationProfileRepository(`avg-image-profile-${crypto.randomUUID()}`);
    const draft = { ...createAvgImageGenerationProfile(), name: '主图像服务', baseUrl: 'https://images.example/v1', model: 'image-model' };
    const saved = await repository.saveProfile(draft, 'sk-highly-secret');
    expect(JSON.stringify(saved)).not.toContain('sk-highly-secret');
    expect(JSON.stringify(await repository.listProfiles())).not.toContain('sk-highly-secret');
    expect(await repository.getCredential(saved.id)).toBe('sk-highly-secret');
    expect((await repository.getDefaultProfile())?.id).toBe(saved.id);

    await repository.saveProfile({ ...saved, name: '主图像服务修订' });
    expect(await repository.getCredential(saved.id)).toBe('sk-highly-secret');
    await repository.deleteProfile(saved.id);
    expect(await repository.getCredential(saved.id)).toBeUndefined();
  });
});
