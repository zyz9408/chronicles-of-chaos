import type { TroopPanelVisualProfile } from './troopPanelModel';

type TroopVisualType =
  | 'archer'
  | 'cavalry'
  | 'garrison'
  | 'infantry'
  | 'logistics'
  | 'mixed'
  | 'naval'
  | 'siege';

type TroopVisualSize = 'small' | 'medium' | 'large';
type TroopVisualQuality = 'poor' | 'standard' | 'elite';

const TYPE_LABELS: Record<TroopVisualType, string> = {
  archer: '弓弩',
  cavalry: '骑兵',
  garrison: '守备',
  infantry: '步卒',
  logistics: '辎重',
  mixed: '混编',
  naval: '水军',
  siege: '攻城',
};

const SIZE_LABELS: Record<TroopVisualSize, string> = {
  small: '小队',
  medium: '中队',
  large: '大队',
};

const QUALITY_LABELS: Record<TroopVisualQuality, string> = {
  poor: '低',
  standard: '中',
  elite: '高',
};

const fallbackFileName = 'troop_force_infantry_medium_standard_v01.png';
const TROOP_FORCE_ASSET_KEYS = new Set<string>(
  (Object.keys(TYPE_LABELS) as TroopVisualType[]).flatMap((type) => (
    (Object.keys(SIZE_LABELS) as TroopVisualSize[]).flatMap((size) => (
      (Object.keys(QUALITY_LABELS) as TroopVisualQuality[]).map((quality) =>
        `troop_force_${type}_${size}_${quality}_v01.png`)
    ))
  )),
);

export interface TroopVisualAsset {
  assetKey: string;
  label: string;
}

export function resolveTroopVisualAsset(profile: TroopPanelVisualProfile): TroopVisualAsset {
  const troopType = resolveTroopType(profile.troopTypeText);
  const size = resolveTroopSize(profile.sizeText);
  const quality = resolveTroopQuality(profile.qualityText);
  const fileName = `troop_force_${troopType}_${size}_${quality}_v01.png`;

  return {
    assetKey: TROOP_FORCE_ASSET_KEYS.has(fileName) ? fileName : fallbackFileName,
    label: `${TYPE_LABELS[troopType]} · ${SIZE_LABELS[size]} · 精锐度 ${QUALITY_LABELS[quality]}`,
  };
}

export async function loadTroopVisualManifest() {
  const module = await import('../generated/panelVisuals/troopVisualManifest');
  return module.troopVisualManifest;
}

function resolveTroopType(source: string): TroopVisualType {
  if (hasAny(source, ['水军', '水师', '舟', '船'])) {
    return 'naval';
  }
  if (hasAny(source, ['辎重', '运输', '粮', '补给'])) {
    return 'logistics';
  }
  if (hasAny(source, ['攻城', '云梯', '冲车', '先登'])) {
    return 'siege';
  }
  if (hasAny(source, ['混编', '骑步', '合兵', '联军'])) {
    return 'mixed';
  }
  if (hasAny(source, ['骑兵', '骑队', '骑军'])) {
    return 'cavalry';
  }
  if (hasAny(source, ['弓', '弩', '射手'])) {
    return 'archer';
  }
  if (hasAny(source, ['守军', '守备', '卫队', '城防', '护卫'])) {
    return 'garrison';
  }
  return 'infantry';
}

function resolveTroopSize(source: string): TroopVisualSize {
  const normalized = source.replace(/[,，]/g, '');
  const match = normalized.match(/\d+/);
  if (match) {
    const size = Number(match[0]);
    if (Number.isFinite(size)) {
      if (size <= 300) return 'small';
      if (size >= 1200) return 'large';
      return 'medium';
    }
  }

  if (hasAny(source, ['小', '斥候', '百人'])) {
    return 'small';
  }
  if (hasAny(source, ['大', '千', '万', '大营'])) {
    return 'large';
  }
  return 'medium';
}

function resolveTroopQuality(source: string): TroopVisualQuality {
  if (hasAny(source, ['精锐', '精良', '高', '强', '锐', '甲等', '上'])) {
    return 'elite';
  }
  if (hasAny(source, ['粗劣', '低', '弱', '差', '杂', '破', '不足', '疲', '溃', '劣', '下'])) {
    return 'poor';
  }
  return 'standard';
}

function hasAny(source: string, needles: string[]): boolean {
  return needles.some((needle) => source.includes(needle));
}
