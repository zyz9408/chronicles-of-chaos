
export type MapGeographyFeatureKind = 'land' | 'regionBoundary' | 'river' | 'mountain';

export interface MapGeographyFeature {
  id: string;
  kind: MapGeographyFeatureKind;
  path: string;
}

export const MAP_GEOGRAPHY_FEATURES: MapGeographyFeature[] = [
  {
    id: 'eastern-han-territory-outline',
    kind: 'land',
    path: [
      'M3 21',
      'C8 16 14 13 21 10',
      'L31 5',
      'L42 6',
      'C49 8 54 12 59 15',
      'L69 11',
      'L81 13',
      'L93 18',
      'L98 26',
      'L95 34',
      'L99 42',
      'L94 50',
      'L96 59',
      'L89 66',
      'L88 73',
      'L79 77',
      'L75 85',
      'L67 87',
      'L61 96',
      'L52 92',
      'L47 96',
      'L39 92',
      'L35 83',
      'L27 87',
      'L19 82',
      'L14 88',
      'L8 80',
      'L12 70',
      'L6 62',
      'L9 52',
      'L4 45',
      'L8 36',
      'L2 30',
      'Z',
    ].join(' '),
  },
  {
    id: 'liang-sili-boundary',
    kind: 'regionBoundary',
    path: 'M30 12 L27 22 L31 31 L28 40 L31 50 L28 61 L25 70 L20 82',
  },
  {
    id: 'bing-sili-boundary',
    kind: 'regionBoundary',
    path: 'M47 8 L44 20 L46 30 L45 39 L48 48 L45 58 L42 67',
  },
  {
    id: 'ji-you-boundary',
    kind: 'regionBoundary',
    path: 'M68 13 L64 22 L66 31 L72 38 L84 43 L95 42',
  },
  {
    id: 'yan-yu-boundary',
    kind: 'regionBoundary',
    path: 'M58 28 L55 38 L57 49 L62 58 L65 69 L62 82',
  },
  {
    id: 'yu-jing-boundary',
    kind: 'regionBoundary',
    path: 'M50 45 L46 55 L48 65 L53 75 L52 88',
  },
  {
    id: 'xu-yang-boundary',
    kind: 'regionBoundary',
    path: 'M75 39 L72 50 L75 61 L82 70 L85 82',
  },
  {
    id: 'jing-yizhou-boundary',
    kind: 'regionBoundary',
    path: 'M37 55 L33 64 L35 75 L41 83 L47 92',
  },
  {
    id: 'jing-yang-boundary',
    kind: 'regionBoundary',
    path: 'M55 63 L63 68 L70 73 L78 80 L86 90',
  },
  {
    id: 'jiaozhou-boundary',
    kind: 'regionBoundary',
    path: 'M44 79 L52 80 L59 84 L65 90 L70 96',
  },
  {
    id: 'yellow-river',
    kind: 'river',
    path: 'M9 39 C19 32 32 30 43 35 C51 39 58 44 67 43 C77 42 87 38 96 43',
  },
  {
    id: 'yangtze-river',
    kind: 'river',
    path: 'M14 72 C25 65 39 63 52 68 C63 73 74 72 84 69 C91 68 96 73 99 80',
  },
  {
    id: 'han-river',
    kind: 'river',
    path: 'M34 56 C41 56 47 59 52 64 C56 68 59 72 62 76',
  },
  {
    id: 'huai-river',
    kind: 'river',
    path: 'M56 54 C65 53 74 55 82 59 C89 62 94 66 97 70',
  },
  {
    id: 'wei-river',
    kind: 'river',
    path: 'M18 44 C27 41 37 41 45 43 C50 45 54 47 58 51',
  },
  {
    id: 'qinling-mountains',
    kind: 'mountain',
    path: 'M22 53 L27 48 L32 54 L37 49 L43 55 L49 50 L55 56',
  },
  {
    id: 'taihang-mountains',
    kind: 'mountain',
    path: 'M57 19 L61 26 L59 33 L63 41 L60 49',
  },
  {
    id: 'bashu-mountains',
    kind: 'mountain',
    path: 'M15 61 L21 56 L27 63 L33 57 L39 64 L45 59',
  },
  {
    id: 'nanling-mountains',
    kind: 'mountain',
    path: 'M42 79 L49 75 L56 81 L63 76 L71 82 L80 78',
  },
  {
    id: 'liangzhou-west-mountains',
    kind: 'mountain',
    path: 'M5 34 L12 29 L18 35 L25 31 L32 37',
  },
];

export function MapGeographyLayer() {
  const byKind = (kind: MapGeographyFeatureKind) => MAP_GEOGRAPHY_FEATURES.filter((feature) => feature.kind === kind);

  return (
    <svg
      className="map-v2-geography-layer"
      data-testid="map-geography-layer"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id="map-land-glow" cx="50%" cy="46%" r="58%">
          <stop offset="0%" stopColor="rgba(55, 69, 49, 0.76)" />
          <stop offset="66%" stopColor="rgba(34, 49, 42, 0.58)" />
          <stop offset="100%" stopColor="rgba(21, 28, 30, 0.3)" />
        </radialGradient>
      </defs>
      <g className="map-v2-land-layer">
        {byKind('land').map((feature) => (
          <path key={feature.id} d={feature.path} />
        ))}
      </g>
      <g className="map-v2-region-boundary-layer">
        {byKind('regionBoundary').map((feature) => (
          <path key={feature.id} d={feature.path} />
        ))}
      </g>
      <g className="map-v2-mountain-layer">
        {byKind('mountain').map((feature) => (
          <path key={feature.id} d={feature.path} />
        ))}
      </g>
      <g className="map-v2-river-layer">
        {byKind('river').map((feature) => (
          <path key={feature.id} d={feature.path} />
        ))}
      </g>
    </svg>
  );
}
