import React, { useEffect, useMemo, useRef, useState } from 'react';
import { generateAvgImageCandidate, AvgImageGenerationError } from '../engine/avg/AvgImageGenerationClient';
import { AVG_IMAGE_PROFILE_CHANGED_EVENT, IndexedDbAvgImageGenerationProfileRepository, type AvgImageGenerationProfile } from '../engine/avg/AvgImageGenerationProfiles';
import { finalizeAvgImagePrompt, type AvgImagePromptDraft } from '../engine/avg/AvgImagePrompt';
import type { ValidatedAvgImage } from '../engine/avg/AvgVisualOverrideRepository';

export function AvgImageCandidateControl({ targetSignature, targetLabel, prompt, onApply, onOpenSettings }: { targetSignature: string; targetLabel: string; prompt: AvgImagePromptDraft; onApply: (file: ValidatedAvgImage) => Promise<void>; onOpenSettings?: () => void }): React.ReactElement {
  const repository = useMemo(() => new IndexedDbAvgImageGenerationProfileRepository(), []);
  const [profiles, setProfiles] = useState<AvgImageGenerationProfile[]>([]); const [profileId, setProfileId] = useState('');
  const [edited, setEdited] = useState(prompt.draft); const [supplement, setSupplement] = useState(''); const [bold, setBold] = useState(false);
  const [candidate, setCandidate] = useState<ValidatedAvgImage>(); const [candidateUrl, setCandidateUrl] = useState('');
  const [status, setStatus] = useState(''); const [generating, setGenerating] = useState(false); const [applying, setApplying] = useState(false); const controller = useRef<AbortController>(); const signature = useRef(targetSignature); signature.current = targetSignature;
  const refresh = async () => { const rows = await repository.listProfiles(); const preferred = await repository.getDefaultProfile(); setProfiles(rows); setProfileId((value) => rows.some((row) => row.id === value) ? value : preferred?.id ?? rows[0]?.id ?? ''); };
  useEffect(() => { void refresh().catch(() => setStatus('图片生成档案暂时无法读取。')); const changed = () => void refresh(); window.addEventListener(AVG_IMAGE_PROFILE_CHANGED_EVENT, changed); return () => window.removeEventListener(AVG_IMAGE_PROFILE_CHANGED_EVENT, changed); }, []);
  useEffect(() => { controller.current?.abort(); setGenerating(false); setCandidate(undefined); setEdited(prompt.draft); setSupplement(''); setBold(false); setStatus(prompt.safetyMode === 'non-adult-actor' ? '年龄未明确成年：仅使用锁定的结构化中性提示词，不发送玩家补充要求。' : '提示词由当前安全结构化信息生成，可在请求前编辑。'); }, [prompt, targetSignature]);
  useEffect(() => { if (!candidate) { setCandidateUrl(''); return; } const url = URL.createObjectURL(candidate.blob); setCandidateUrl(url); return () => URL.revokeObjectURL(url); }, [candidate]);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = profiles.find((profile) => profile.id === profileId); const locked = prompt.safetyMode === 'non-adult-actor';
  const generate = async () => {
    if (!selected || generating || applying) return; const startSignature = targetSignature; const abort = new AbortController(); controller.current?.abort(); controller.current = abort; setCandidate(undefined); setGenerating(true); setStatus('正在请求一张候选图；关闭、取消或切换目标会中止本次请求。');
    try {
      const credential = await repository.getCredential(selected.id); if (!credential) throw new AvgImageGenerationError('invalid-config');
      const finalPrompt = finalizeAvgImagePrompt({ ...prompt, editedDraft: edited, supplement, boldNonExplicit: bold });
      const result = await generateAvgImageCandidate({ profile: selected, credential, prompt: finalPrompt, signal: abort.signal });
      if (signature.current !== startSignature || abort.signal.aborted) return; setCandidate(result.file); setStatus('候选图已完成；预览不会自动写入，请明确选择应用或丢弃。');
    } catch (error) { if (!abort.signal.aborted) setStatus(error instanceof Error ? error.message : '候选图生成失败，请检查档案、网络或图片响应。'); }
    finally { if (controller.current === abort) setGenerating(false); }
  };
  const apply = async () => { if (!candidate || applying) return; setApplying(true); setStatus('正在应用候选图…'); try { await onApply(candidate); setCandidate(undefined); setStatus('已应用到当前目标。'); } catch (error) { setStatus(error instanceof Error ? error.message : '候选图应用失败；候选仍保留。'); } finally { setApplying(false); } };
  return <section className="avg-ai-generation" aria-label="AI 生成候选图" data-testid="avg-ai-generation-control">
    <div className="avg-ai-generation-heading"><strong>AI 生成候选图</strong><span>只有点击生成才会请求第三方服务；候选不会自动替换。</span></div>
    {!profiles.length && <div className="avg-ai-generation-empty"><p>请先到 AVG 设置配置图片生成档案。</p>{onOpenSettings && <button type="button" onClick={onOpenSettings}>打开 AVG 设置</button>}</div>}
    <p><strong>生成目标：</strong>{targetLabel}</p><label>图片生成档案<select aria-label="AI 候选图档案" value={profileId} disabled={generating || applying || !profiles.length} onChange={(event) => setProfileId(event.target.value)}>{profiles.length ? profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>) : <option value="">尚未配置</option>}</select></label>
    <label>{locked ? '结构化安全提示词（不可编辑）' : '可编辑提示词'}<textarea aria-label="AI 候选图提示词" maxLength={4000} value={edited} readOnly={locked} disabled={generating || applying} onChange={(event) => setEdited(event.target.value)} /></label>
    <label>补充要求（可选）<textarea aria-label="AI 候选图补充要求" maxLength={2000} value={supplement} disabled={locked || generating || applying} onChange={(event) => setSupplement(event.target.value)} /></label>
    {locked && <p className="avg-visual-modal-notice">未成年或年龄未知人物仅生成中性、非性化、合宜服装候选图；提示词和补充要求已锁定。</p>}
    {prompt.adultDirectionAvailable && <label className="avg-ai-bold-direction"><input type="checkbox" checked={bold} disabled={generating || applying} onChange={(event) => setBold(event.target.checked)} />大胆但不露骨（仅明确成年人物）</label>}
    <div className="avg-ai-generation-actions"><button type="button" disabled={!selected || generating || applying} onClick={() => void generate()}>生成候选图</button><button type="button" disabled={!generating} onClick={() => { controller.current?.abort(); setGenerating(false); setStatus('图片生成已取消。'); }}>取消生成</button></div>
    {status && <p className="avg-visual-modal-notice" role="status">{status}</p>}
    {candidate && candidateUrl && <figure className="avg-visual-pending-preview avg-ai-candidate-preview"><img src={candidateUrl} alt={`${targetLabel} AI 候选图预览`} /><figcaption>{candidate.width}×{candidate.height} · {candidate.mediaType} · {(candidate.byteSize / 1024 / 1024).toFixed(1)} MiB</figcaption><div className="avg-ai-generation-actions"><button type="button" disabled={applying} onClick={() => void apply()}>应用此图</button><button type="button" disabled={applying} onClick={() => { setCandidate(undefined); setStatus('候选图已丢弃；未写入本地视觉仓库。'); }}>丢弃候选</button><a href={candidateUrl} download={`avg-ai-candidate.${candidate.mediaType === 'image/jpeg' ? 'jpg' : candidate.mediaType.split('/')[1]}`}>下载候选图</a></div></figure>}
  </section>;
}
