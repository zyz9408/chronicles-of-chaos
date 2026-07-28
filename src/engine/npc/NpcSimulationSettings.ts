export interface NpcSimulationSettings {
  enabled: boolean;
  maxNpcCount: number;
}

export const DEFAULT_NPC_SIMULATION_SETTINGS: NpcSimulationSettings = {
  enabled: true,
  maxNpcCount: 5,
};

const NPC_SIMULATION_SETTINGS_KEY = 'coc_v2_npc_simulation_settings';

export function loadNpcSimulationSettings(storage?: Storage): NpcSimulationSettings {
  const target = getStorage(storage);
  if (!target) return { ...DEFAULT_NPC_SIMULATION_SETTINGS };

  try {
    return normalizeNpcSimulationSettings(JSON.parse(target.getItem(NPC_SIMULATION_SETTINGS_KEY) ?? '{}'));
  } catch {
    return { ...DEFAULT_NPC_SIMULATION_SETTINGS };
  }
}

export function saveNpcSimulationSettings(
  patch: Partial<NpcSimulationSettings>,
  storage?: Storage,
): NpcSimulationSettings {
  const target = getStorage(storage);
  const next = normalizeNpcSimulationSettings({
    ...loadNpcSimulationSettings(target ?? undefined),
    ...patch,
  });
  target?.setItem(NPC_SIMULATION_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function normalizeNpcSimulationSettings(value: unknown): NpcSimulationSettings {
  const record = isRecord(value) ? value : {};
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : DEFAULT_NPC_SIMULATION_SETTINGS.enabled,
    maxNpcCount: clampInteger(record.maxNpcCount, 1, 12, DEFAULT_NPC_SIMULATION_SETTINGS.maxNpcCount),
  };
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
