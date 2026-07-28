import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PressAndHoldButton } from './PressAndHoldButton';

describe('PressAndHoldButton', () => {
  it('exposes accessible hold guidance and a disabled state', () => {
    const markup = renderToStaticMarkup(
      <PressAndHoldButton label="武力加1" disabled onActivate={vi.fn()}>
        +
      </PressAndHoldButton>,
    );

    expect(markup).toContain('aria-label="武力加1"');
    expect(markup).toContain('按住可连续调整');
    expect(markup).toContain('data-press-and-hold="true"');
    expect(markup).toContain('disabled=""');
  });
});
