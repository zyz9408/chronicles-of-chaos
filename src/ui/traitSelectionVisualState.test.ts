import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CharacterTrait } from '../engine/types';
import { OpeningTraitButton } from './OpeningTraitButton';

const trait: CharacterTrait = {
  id: 'trait_test',
  label: '临机决断',
  description: '危急时更容易抓住转机。',
  source: 'opening',
  rarity: 'blue',
};

describe('opening trait selection visual state', () => {
  it('gives selected trait cards a semantic selected state and dedicated visible mark', () => {
    const selectedMarkup = renderToStaticMarkup(createElement(OpeningTraitButton, {
      trait,
      selected: true,
      onToggle: vi.fn(),
    }));
    const unselectedMarkup = renderToStaticMarkup(createElement(OpeningTraitButton, {
      trait,
      selected: false,
      onToggle: vi.fn(),
    }));

    expect(selectedMarkup).toContain('aria-pressed="true"');
    expect(selectedMarkup).toContain('trait-chip trait-rarity-blue selected');
    expect(selectedMarkup).toContain('class="trait-selected-mark"');
    expect(selectedMarkup).toContain('已选');
    expect(unselectedMarkup).toContain('aria-pressed="false"');
    expect(unselectedMarkup).not.toContain('trait-selected-mark');
  });
});
