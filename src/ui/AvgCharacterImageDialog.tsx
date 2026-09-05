import React, { useMemo, useState } from 'react';
import type { AvgActorVisualContext } from '../engine/avg/AvgActorVisualContext';
import { IndexedDbAvgVisualOverrideRepository, createAvgActorTarget } from '../engine/avg/AvgVisualOverrideRepository';
import { AvgImageCandidateControl } from './AvgImageCandidateControl';

interface Props {
  actors: AvgActorVisualContext[];
  initialActorId?: string;
  visualPartitionId: string;
  worldBookId: string;
  onClose: () => void;
  onApplied: (actorId: string, reusable: boolean) => void;
  onOpenSettings?: () => void;
}

export function AvgCharacterImageDialog(props: Props): React.ReactElement {
  const { actors, visualPartitionId, worldBookId, onClose, onApplied, onOpenSettings } = props;
  const repository = useMemo(() => new IndexedDbAvgVisualOverrideRepository(), []);
  const [actorId, setActorId] = useState(props.initialActorId ?? actors[0]?.actorId ?? '');
  const [exclusive, setExclusive] = useState(false);
  const [busy, setBusy] = useState(false);
  const actor = actors.find((item) => item.actorId === actorId) ?? actors[0];
  const reusable = Boolean(actor && !actor.dedicated && !exclusive && actor.portraitProfile
    && actor.portraitProfile.ageBand !== 'unknown'
    && (actor.portraitProfile.roleFamily || actor.portraitProfile.professionTags.length));
  return <div className="avg-ai-modal" role="dialog" aria-modal="true" aria-label="生成人物图" onClick={(event) => event.stopPropagation()}>
    <header><strong>生成人物图 · AVG 人物图库</strong><button type="button" onClick={onClose} aria-label="关闭人物图生成">×</button></header>
    <p>选择本回合人物，确认图片后立即显示并保存；以后出场会使用已绑定的人物图。</p>
    <label className="avg-character-picker">当前人物
      <select aria-label="生成图片的人物" value={actor?.actorId ?? ''} disabled={busy || !actors.length} onChange={(event) => { setActorId(event.target.value); setExclusive(false); }}>
        {actors.map((item) => <option value={item.actorId} key={item.actorId}>{item.name} · {item.bindingReason}</option>)}
      </select>
    </label>
    {actor && <>
      <label className="avg-character-exclusive"><input type="checkbox" checked={actor.dedicated || exclusive} disabled={actor.dedicated || busy} onChange={(event) => setExclusive(event.target.checked)} />特殊人物专属绑定</label>
      <p className="avg-visual-modal-notice">{actor.dedicated || exclusive
        ? '图片只绑定这个人物，其他人物不会借用。'
        : reusable ? '图片绑定当前人物，并加入通用人物图库。同一存档中性别、年龄和职业相近的人物会自动匹配。'
          : '人物资料不足以进行相似匹配，图片将只绑定当前人物。'}</p>
      <AvgImageCandidateControl key={actor.actorId}
        targetSignature={`character:${visualPartitionId}:${worldBookId}:${actor.actorId}`}
        targetLabel={`${actor.name} · ${reusable ? '可复用人物图' : '专属人物图'}`}
        prompt={actor.prompt} onOpenSettings={onOpenSettings} onBusyChange={setBusy}
        applyLabel="应用并加入 AVG 图库"
        onApply={async (file) => {
          const target = createAvgActorTarget(visualPartitionId, worldBookId, actor.actorId);
          await repository.saveGeneratedActorPortrait(target, file, { portraitProfile: actor.portraitProfile, registerAdaptiveCandidate: reusable });
          onApplied(actor.actorId, reusable);
        }} />
    </>}
    {!actor && <p>本回合暂无可确认身份的人物。</p>}
  </div>;
}
