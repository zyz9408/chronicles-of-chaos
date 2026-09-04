import type { RuntimeState, WorldBook } from '../engine/types';
import {
  createStateWritebackRecoveryVerification,
  type StateWritebackRecoveryPreparationResult,
} from '../engine/state/StateWritebackRecoveryService';
import { inspectStateWritebackRecovery } from '../engine/state/StateWritebackRecovery';

const domainLabels: Record<string, string> = {
  military: '部队与军务',
  'faction-recent-action': '势力近期行动',
  'npc-relationship': '人物关系',
  'resource-and-loadout': '资源与装备',
  holdings: '领地',
  'private-assets-and-projects': '私产与工程',
  'unique-art-progress': '绝艺进度',
  'npc-memory': '人物记忆',
  'npc-presence-and-background-activity': '人物在场与后台活动',
  'character-identity': '人物身份',
  other: '其他结构化状态',
};

export interface StateWritebackRecoveryPanelProps {
  runtimeState: RuntimeState;
  worldBook: WorldBook;
  preview: Extract<StateWritebackRecoveryPreparationResult, { status: 'ready' }> | null;
  isPreparing: boolean;
  isApplying: boolean;
  onPrepare: () => void;
  onCancelPreview: () => void;
  onApplyPreview: () => void;
}

export function StateWritebackRecoveryPanel({
  runtimeState,
  worldBook,
  preview,
  isPreparing,
  isApplying,
  onPrepare,
  onCancelPreview,
  onApplyPreview,
}: StateWritebackRecoveryPanelProps) {
  const preflight = inspectStateWritebackRecovery(
    runtimeState,
    createStateWritebackRecoveryVerification(worldBook),
  );
  const notice = preflight.status === 'legacy_unavailable'
    ? { kind: 'legacy-unavailable', title: '旧回合无法自动重整', message: preflight.message }
    : preflight.status === 'ready'
      ? { kind: 'recoverable', title: '本回合状态写回可重新整理', message: '正文、回合时间、地点与地图已经冻结；重整只处理被隔离的结构化状态。' }
      : preflight.status === 'corrupt_evidence'
        ? { kind: 'corrupt-evidence', title: '状态写回恢复证据不完整', message: preflight.message }
        : preflight.status === 'stale_lineage'
          ? { kind: 'stale-lineage', title: '状态写回重整已失效', message: preflight.message }
          : null;
  if (!notice && !preview) return null;

  return <>
    {notice && (
      <div
        className="memory-summary-pending-notice state-writeback-recovery-notice"
        data-testid="state-writeback-recovery-notice"
        data-recovery-status={notice.kind}
        role="status"
        aria-live="polite"
      >
        <div><strong>{notice.title}</strong><span> {notice.message}</span></div>
        {notice.kind === 'recoverable' && (
          <div className="memory-summary-pending-actions">
            <button
              type="button"
              className="primary-btn"
              data-testid="state-writeback-recovery-prepare"
              onClick={onPrepare}
              disabled={isPreparing || isApplying || Boolean(preview)}
            >
              {isPreparing ? '正在整理…' : '重新整理本回合写回'}
            </button>
          </div>
        )}
      </div>
    )}
    {preview && (
      <div
        className="system-modal-backdrop memory-summary-recovery-backdrop"
        role="presentation"
        onClick={() => { if (!isApplying) onCancelPreview(); }}
      >
        <section
          className="system-modal memory-summary-recovery-modal"
          data-testid="state-writeback-recovery-preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="state-writeback-recovery-preview-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="system-modal-header">
            <div>
              <h2 id="state-writeback-recovery-preview-title">状态写回重整预览</h2>
              <p>第 {runtimeState.stateWritebackRecovery?.sourceTurnNumber} 回合 · 尚未应用</p>
            </div>
          </header>
          <div className="memory-summary-recovery-body">
            <p>正文、回合数、时间、地点与地图均不会改变，只应用通过严格校验的隔离状态槽位。</p>
            <dl className="state-writeback-recovery-preview-grid">
              <div><dt>有界整理次数</dt><dd>{preview.repairAttemptCount}</dd></div>
              <div><dt>完整候选槽位</dt><dd>{preview.selectedSlotCount}</dd></div>
              <div><dt>本次应用槽位</dt><dd>{preview.applySlotCount}</dd></div>
            </dl>
            <div>
              <strong>待恢复状态域</strong>
              {preview.quarantinedDomains.length > 0
                ? <ul data-testid="state-writeback-recovery-preview-domains">
                    {preview.quarantinedDomains.map((domain) => <li key={domain}>{domainLabels[domain] ?? domain}</li>)}
                  </ul>
                : <p>按原隔离槽位恢复；未扩大到其他状态域。</p>}
            </div>
          </div>
          <div className="memory-summary-recovery-actions">
            <button
              type="button"
              className="ghost-btn"
              data-testid="state-writeback-recovery-cancel"
              onClick={onCancelPreview}
              disabled={isApplying}
            >取消</button>
            <button
              type="button"
              className="primary-btn"
              data-testid="state-writeback-recovery-apply"
              onClick={onApplyPreview}
              disabled={isApplying}
            >{isApplying ? '正在保存…' : '确认应用重整'}</button>
          </div>
        </section>
      </div>
    )}
  </>;
}
