import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MapHistoricalBaseLayer } from './MapHistoricalBaseLayer';

describe('MapHistoricalBaseLayer', () => {
  it('uses source geographic data for waterways instead of hand-drawn river overrides', () => {
    const html = renderToStaticMarkup(<MapHistoricalBaseLayer />);

    expect(html).toContain('map-historical-real-river-layer');
    expect(html).not.toContain('map-historical-major-river-layer');
    expect(html).not.toContain('data-river-id=');
  });

  it('does not render legacy abstract geography masks over the real basemap', () => {
    const html = renderToStaticMarkup(<MapHistoricalBaseLayer />);

    expect(html).toContain('map-historical-real-land-layer');
    expect(html).toContain('map-historical-real-river-layer');
    expect(html).not.toContain('map-historical-mainland');
    expect(html).not.toContain('map-historical-domain');
    expect(html).not.toContain('map-historical-island-layer');
    expect(html).not.toContain('map-historical-region-layer');
  });

  it('uses line-based terrain decoration instead of large forest blobs', () => {
    const html = renderToStaticMarkup(<MapHistoricalBaseLayer />);

    expect(html).toContain('map-historical-terrain-layer');
    expect(html).toContain('map-historical-mountain-layer');
    expect(html).not.toContain('map-historical-forest-layer');
    expect(html).not.toContain('<ellipse');
  });
});
