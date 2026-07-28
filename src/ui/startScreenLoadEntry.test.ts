import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  StartScreenLoadEntryButton,
  shouldAdvanceSessionWhenClosingGameLoad,
} from './StartScreen';

describe('StartScreen load entry', () => {
  it('keeps the load-save entry enabled even when save availability is unknown or empty', () => {
    const markup = renderToStaticMarkup(createElement(StartScreenLoadEntryButton, {
      onOpen: vi.fn(),
    }));

    expect(markup).toContain('type="button"');
    expect(markup).toContain('data-index="02"');
    expect(markup).toContain('class="menu-btn secondary"');
    expect(markup).toContain('兵戈再起');
    expect(markup).not.toContain('disabled');
  });

  it('invalidates the game session only when closing a load modal with pending async work', () => {
    expect(shouldAdvanceSessionWhenClosingGameLoad(null)).toBe(false);
    expect(shouldAdvanceSessionWhenClosingGameLoad(0)).toBe(true);
    expect(shouldAdvanceSessionWhenClosingGameLoad(7)).toBe(true);
  });
});
