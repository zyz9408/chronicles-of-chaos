export const PLAYER_RECOVERY_KINDS = ['none', 'rest', 'treatment'] as const;

export type PlayerRecoveryKind = (typeof PLAYER_RECOVERY_KINDS)[number];

export function parsePlayerRecoveryKind(value: unknown): PlayerRecoveryKind | undefined {
  return PLAYER_RECOVERY_KINDS.includes(value as PlayerRecoveryKind)
    ? value as PlayerRecoveryKind
    : undefined;
}
