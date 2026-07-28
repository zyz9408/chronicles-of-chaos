// ============================================================
// Engine Core Types - Save
// ============================================================

import type { RuntimeState } from './runtimeState';

/** 存档类型：自动存档用于当前进度，手动存档是玩家主动留档 */
export type SaveKind = 'auto' | 'manual';

export interface RuntimeStateMigrationDiagnosticData {
  code: string;
  message: string;
  locationIds?: string[];
}

/** 存档数据 */
export interface SaveData {
  id: string;
  label: string;
  saveKind?: SaveKind;
  createdAt: string;        // ISO datetime
  updatedAt: string;        // ISO datetime
  engineVersion: string;
  runtimeStateMigrationVersion?: number;
  runtimeStateMigrationDiagnostics?: RuntimeStateMigrationDiagnosticData[];
  worldBookId: string;
  worldBookVersion: string;
  worldBookSource: 'official' | 'custom';
  startBookmarkId?: string;
  startDate: string;
  currentDate: string;
  runtimeState: RuntimeState;
}

/** 存档列表项 */
export interface SaveListItem {
  id: string;
  label: string;
  saveKind?: SaveKind;
  createdAt: string;
  updatedAt: string;
  worldBookId: string;
  startBookmarkId?: string;
  currentDate: string;
  playerName: string;
  locationName: string;
  turnCount: number;
}
