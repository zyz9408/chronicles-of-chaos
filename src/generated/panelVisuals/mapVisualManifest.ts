import type { ResponsiveVisualAssetManifest } from '../../ui/panelVisualAssetLoader';

export const mapVisualManifest = {
  'three-kingdoms-map-v2-full-domain-base.png': {
    sourceKey: 'three-kingdoms-map-v2-full-domain-base.png',
    mobile: { url: new URL('../../assets/generated/maps/mobile/three-kingdoms-map-v2-full-domain-base.webp', import.meta.url).href, width: 760, height: 476 },
    display: { url: new URL('../../assets/generated/maps/display/three-kingdoms-map-v2-full-domain-base.webp', import.meta.url).href, width: 1586, height: 992 },
  },
} satisfies ResponsiveVisualAssetManifest;
