import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { WorldBookManifest } from '../engine/types';
import { WorldBookSelect } from './WorldBookSelect';

const worldBook: WorldBookManifest = {
  id: 'threeKingdoms',
  name: '三国演义',
  version: '0.1.0',
  author: 'Chronicles of Chaos Team',
  language: 'zh-CN',
  genre: 'historical',
  source: 'official',
  compatibleEngineVersion: '0.1.0',
  description: '东汉末年至三国乱世。',
};

describe('WorldBookSelect', () => {
  it('renders worldline knowledge fidelity as a compact select beside the worldbook', () => {
    const markup = renderToStaticMarkup(
      <WorldBookSelect
        worldBooks={[worldBook]}
        selectedId="threeKingdoms"
        onSelect={() => undefined}
        selectedKnowledgeMode="strict"
        onKnowledgeModeChange={() => undefined}
      />,
    );

    expect(markup).toContain('资料贴合度');
    expect(markup).toContain('worldline-mode-select');
    expect(markup).toContain('关闭');
    expect(markup).toContain('轻微');
    expect(markup).toContain('默认');
    expect(markup).toContain('严谨');
    expect(markup).toContain('<option value="strict" selected="">严谨 - 更强纠偏参考</option>');
    expect(markup).not.toContain('worldline-mode-option');
  });
});
