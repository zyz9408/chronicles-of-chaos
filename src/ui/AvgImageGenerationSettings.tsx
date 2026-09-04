import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AVG_IMAGE_PROFILE_CHANGED_EVENT,
  AVG_IMAGE_SIZE_PRESETS,
  IndexedDbAvgImageGenerationProfileRepository,
  createAvgImageGenerationProfile,
  describeAvgImageCredential,
  type AvgImageGenerationProfile,
} from '../engine/avg/AvgImageGenerationProfiles';

export function AvgImageGenerationSettings({ repository }: { repository?: IndexedDbAvgImageGenerationProfileRepository }): React.ReactElement {
  const store = useMemo(() => repository ?? new IndexedDbAvgImageGenerationProfileRepository(), [repository]);
  const [profiles, setProfiles] = useState<AvgImageGenerationProfile[]>([]);
  const [defaultId, setDefaultId] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState(createAvgImageGenerationProfile);
  const [credential, setCredential] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const rows = await store.listProfiles(); const preferred = await store.getDefaultProfile(); const next: Record<string, string> = {};
    await Promise.all(rows.map(async (profile) => { next[profile.id] = describeAvgImageCredential(await store.getCredential(profile.id)); }));
    setProfiles(rows); setDefaultId(preferred?.id ?? ''); setCredentials(next);
  }, [store]);
  useEffect(() => {
    void refresh().catch(() => setStatus('图片生成档案暂时无法读取。'));
    const changed = () => void refresh(); window.addEventListener(AVG_IMAGE_PROFILE_CHANGED_EVENT, changed);
    return () => window.removeEventListener(AVG_IMAGE_PROFILE_CHANGED_EVENT, changed);
  }, [refresh]);

  const reset = () => { setDraft(createAvgImageGenerationProfile()); setCredential(''); setStatus(''); };
  const edit = (profile: AvgImageGenerationProfile) => { setDraft({ ...profile }); setCredential(''); setStatus('已载入档案；密钥留空会保留原值。'); };
  const save = async () => {
    if (busy) return; setBusy(true); setStatus('正在保存图片生成档案…');
    try {
      const existed = profiles.some((profile) => profile.id === draft.id);
      const saved = await store.saveProfile(draft, credential || (existed ? undefined : ''));
      setDraft(saved); setCredential(''); await refresh(); setStatus('图片生成档案已保存在本机；未发送网络请求。');
    } catch (error) { setStatus(error instanceof Error ? error.message : '图片生成档案保存失败。'); } finally { setBusy(false); }
  };
  const remove = async (profile: AvgImageGenerationProfile) => {
    if (busy || (typeof window !== 'undefined' && !window.confirm(`删除图片生成档案“${profile.name}”？`))) return;
    setBusy(true); try { await store.deleteProfile(profile.id); if (draft.id === profile.id) reset(); await refresh(); setStatus('图片生成档案及其本机凭据已删除。'); }
    catch (error) { setStatus(error instanceof Error ? error.message : '图片生成档案删除失败。'); } finally { setBusy(false); }
  };

  const credentialStatus = credentials[draft.id] ?? '未保存';
  return <section aria-label="AI 候选图设置" data-testid="avg-image-generation-settings">
    <div className="settings-heading compact"><div><h3>AI 候选图</h3><p>可能产生第三方费用，只有点击“生成候选图”才会请求；图片不会自动替换，必须预览后明确应用。</p></div>
      <div className="settings-heading-actions"><button type="button" className="nav-btn" disabled={busy} onClick={reset}>新建档案</button></div></div>
    {!profiles.length ? <p className="gs-setting-desc" data-testid="avg-image-profile-empty">尚未配置图片生成档案。可填写一个 openai-images-compatible 服务；模型与地址由你决定。</p>
      : <div className="api-archive-list" aria-label="图片生成档案列表">{profiles.map((profile) => <div key={profile.id} className="gs-setting-row" data-testid="avg-image-profile-row">
        <div className="gs-setting-left"><strong>{profile.name}{defaultId === profile.id ? ' · 默认' : ''}</strong><span>{profile.model} · {profile.size} · {credentials[profile.id] ?? '未保存'}</span></div>
        <div className="settings-heading-actions"><button type="button" className="nav-btn" disabled={busy} onClick={() => edit(profile)}>编辑</button><button type="button" className="nav-btn" disabled={busy || defaultId === profile.id} onClick={() => void store.setDefaultProfile(profile.id).then(refresh).then(() => setStatus('默认图片生成档案已更新。')).catch((error) => setStatus(error instanceof Error ? error.message : '默认档案设置失败。'))}>设为默认</button><button type="button" className="nav-btn" disabled={busy} onClick={() => void remove(profile)}>删除</button></div>
      </div>)}</div>}
    <div className="api-editor" data-testid="avg-image-profile-editor">
      <div className="form-grid two"><label>档案名称<input aria-label="图片生成档案名称" maxLength={40} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label>Provider<select aria-label="图片生成 Provider" value={draft.provider} disabled><option value="openai-images-compatible">openai-images-compatible</option></select></label></div>
      <label>图片服务 Base URL<input aria-label="图片服务 Base URL" value={draft.baseUrl} placeholder="https://images.example/v1" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} /></label>
      <div className="form-grid two"><label>模型<input aria-label="图片生成模型" maxLength={120} value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label><label>尺寸<select aria-label="图片生成尺寸" value={draft.size} onChange={(event) => setDraft({ ...draft, size: event.target.value as typeof draft.size })}>{AVG_IMAGE_SIZE_PRESETS.map((size) => <option key={size}>{size}</option>)}</select></label></div>
      <div className="form-grid two"><label>超时（秒）<input aria-label="图片生成超时秒数" type="number" min={10} max={300} value={Math.round(draft.timeoutMs / 1000)} onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) * 1000 })} /></label><label>API Key<input aria-label="图片生成 API Key" type="password" autoComplete="new-password" value={credential} onChange={(event) => setCredential(event.target.value)} placeholder={credentialStatus === '未保存' ? '尚未保存' : '已保存；留空不修改'} /></label></div>
      <p className="gs-setting-desc">凭据状态：{credentialStatus}。完整密钥不会回显，也不会进入存档或视觉 ZIP。</p>
      <div className="settings-heading-actions"><button type="button" className="nav-btn primary" disabled={busy} onClick={() => void save()}>保存图片档案</button></div>
    </div>{status && <p className="settings-status" role="status">{status}</p>}
  </section>;
}
