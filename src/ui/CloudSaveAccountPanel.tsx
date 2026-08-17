import { useCallback, useEffect, useState } from 'react';
import {
  deleteCloudApiSettings,
  deleteAllCloudSaves,
  downloadCloudApiSettings,
  getCloudApiSettings,
  getCloudSession,
  loadCloudSyncPreferences,
  logoutCloudSession,
  saveCloudSyncPreferences,
  startDiscordCloudLogin,
  syncCurrentSave,
  uploadCloudApiSettings,
  type CloudApiSettingsItem,
  type CloudSessionState,
  type CloudSyncPreferences,
} from '../engine/save/CloudSaveService';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(bytes >= 10_000_000 ? 1 : 2)} MB`;
}

export function CloudSaveAccountPanel({ currentSaveId }: { currentSaveId?: string | null }) {
  const [session, setSession] = useState<CloudSessionState | null>(null);
  const [preferences, setPreferences] = useState<CloudSyncPreferences>(
    () => loadCloudSyncPreferences(),
  );
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [apiSettings, setApiSettings] = useState<CloudApiSettingsItem | null>(null);
  const [apiPassphrase, setApiPassphrase] = useState('');
  const [apiPassphraseConfirm, setApiPassphraseConfirm] = useState('');

  const refresh = useCallback(async () => {
    try {
      const nextSession = await getCloudSession();
      setSession(nextSession);
      setApiSettings(nextSession.authenticated ? await getCloudApiSettings() : null);
    } catch (error) {
      setStatus(`云存档状态读取失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updatePreferences = (next: CloudSyncPreferences) => {
    const saved = saveCloudSyncPreferences(next);
    setPreferences(saved);
    const apiMode = saved.apiSettingsSyncMode === 'none'
      ? 'API 配置不会上传。'
      : saved.apiSettingsSyncMode === 'routes_only'
        ? 'API 配置仅同步站点、模型与路由，不上传密钥。'
        : '完整 API 配置仅在手动上传时于本机加密。';
    setStatus(`${saved.autoSyncCurrentSave
      ? '已开启当前活动存档自动同步；本地保存永远优先完成。'
      : '已关闭存档自动同步，本地存档不受影响。'}${apiMode}`);
  };

  const handleUploadApiSettings = async () => {
    const mode = preferences.apiSettingsSyncMode;
    if (mode === 'none') {
      setStatus('请先选择 API 配置同步方式。');
      return;
    }
    if (mode === 'encrypted_full') {
      if (apiPassphrase.length < 8) {
        setStatus('完整配置的加密口令至少需要 8 个字符。');
        return;
      }
      if (apiPassphrase !== apiPassphraseConfirm) {
        setStatus('两次输入的加密口令不一致。');
        return;
      }
      if (!window.confirm('完整配置包含 API 密钥。确认使用当前口令在本机加密后上传吗？口令遗失将无法恢复。')) return;
    }
    setBusy(true);
    setStatus(mode === 'routes_only' ? '正在上传无密钥 API 配置……' : '正在本机加密并上传 API 配置……');
    try {
      const uploaded = await uploadCloudApiSettings(mode, apiPassphrase);
      setApiSettings(uploaded);
      setApiPassphrase('');
      setApiPassphraseConfirm('');
      setStatus(`API 配置快照上传完成：第 ${uploaded.revision} 版，${formatBytes(uploaded.sizeBytes)}。`);
      await refresh();
    } catch (error) {
      setStatus(`API 配置上传失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadApiSettings = async () => {
    if (!apiSettings) {
      setStatus('云端没有 API 配置快照。');
      return;
    }
    if (apiSettings.syncMode === 'encrypted_full' && apiPassphrase.length < 8) {
      setStatus('请输入上传时使用的加密口令。');
      return;
    }
    if (!window.confirm('将云端 API 配置合并到本机。相同 ID 的配置会更新，是否继续？')) return;
    setBusy(true);
    setStatus('正在下载并校验 API 配置……');
    try {
      await downloadCloudApiSettings(apiPassphrase);
      setApiPassphrase('');
      setApiPassphraseConfirm('');
      setStatus('API 配置已合并到本机；重新打开 API 设置即可查看。');
    } catch (error) {
      setStatus(`API 配置恢复失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteApiSettings = async () => {
    if (!apiSettings || !window.confirm('确定删除云端 API 配置快照吗？本机 API 配置不会删除。')) return;
    setBusy(true);
    try {
      await deleteCloudApiSettings();
      setApiSettings(null);
      await refresh();
      setStatus('云端 API 配置快照已删除；本机设置保持不变。');
    } catch (error) {
      setStatus(`云端 API 配置删除失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    if (!currentSaveId) {
      setStatus('当前没有可同步的活动存档。');
      return;
    }
    setBusy(true);
    setStatus('正在压缩并上传当前存档……');
    try {
      const save = await syncCurrentSave(currentSaveId);
      setStatus(`云端同步完成：第 ${save.revision} 版，${formatBytes(save.sizeBytes)}。`);
      await refresh();
    } catch (error) {
      setStatus(`同步未完成：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    try {
      await logoutCloudSession();
      await refresh();
      setStatus('已退出 Discord 云存档；本地存档仍可正常使用。');
    } catch (error) {
      setStatus(`退出失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm('确定删除此 Discord 账户下的全部云存档吗？本地存档不会删除。')) return;
    setBusy(true);
    try {
      await deleteAllCloudSaves();
      await refresh();
      setStatus('云端存档已全部删除；本地存档保持不变。');
    } catch (error) {
      setStatus(`云端删除失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  const usage = session?.usage;
  const usagePercent = usage && usage.limitBytes > 0
    ? Math.min(100, (usage.usedBytes / usage.limitBytes) * 100)
    : 0;

  return (
    <section className="cloud-save-account-panel" aria-label="Discord 云存档">
      <div className="cloud-save-account-head">
        <div>
          <h3>Discord 云存档</h3>
          <p>只上传存档正文和最多 3 个回溯快照；文生图资产不会上传。</p>
        </div>
        {session?.authenticated && session.account ? (
          <div className="cloud-save-account-identity">
            {session.account.avatarUrl && (
              <img src={session.account.avatarUrl} alt="" width={38} height={38} />
            )}
            <span>
              <strong>{session.account.displayName}</strong>
              <small>@{session.account.username}</small>
            </span>
          </div>
        ) : null}
      </div>

      {!session ? (
        <p className="gs-setting-desc">正在检查云存档服务……</p>
      ) : !session.configured ? (
        <p className="cloud-save-warning">云存档数据库尚未绑定，本地存档仍可正常使用。</p>
      ) : !session.authConfigured ? (
        <p className="cloud-save-warning">云存档已就绪，尚需维护者完成 Discord OAuth 配置。</p>
      ) : !session.authenticated ? (
        <div className="cloud-save-login-row">
          <p>登录仅请求 Discord 基础身份，不加入服务器，也不读取聊天内容。</p>
          <button type="button" className="nav-btn primary" onClick={() => startDiscordCloudLogin('/?cloud=1')}>
            登录 Discord
          </button>
        </div>
      ) : (
        <>
          <div className="cloud-save-usage">
            <div>
              <span>个人云空间</span>
              <strong>{formatBytes(usage?.usedBytes ?? 0)} / {formatBytes(usage?.limitBytes ?? 0)}</strong>
            </div>
            <div className="cloud-save-usage-track" aria-label={`云空间已使用 ${usagePercent.toFixed(1)}%`}>
              <span style={{ width: `${usagePercent}%` }} />
            </div>
            <small>{usage?.slotCount ?? 0} / {usage?.slotLimit ?? 5} 个云存档</small>
          </div>

          <label className="cloud-save-toggle">
            <input
              type="checkbox"
              checked={preferences.autoSyncCurrentSave}
              onChange={(event) => updatePreferences({
                ...preferences,
                autoSyncCurrentSave: event.target.checked,
              })}
            />
            <span>
              <strong>自动同步当前活动存档</strong>
              <small>本地提交成功后异步上传；失败只提示，不会回滚本回合。</small>
            </span>
          </label>

          <label className="cloud-save-api-mode">
            <span>
              <strong>API 配置云同步</strong>
              <small>默认不上传。完整配置必须先在浏览器端加密。</small>
            </span>
            <select
              value={preferences.apiSettingsSyncMode}
              onChange={(event) => updatePreferences({
                ...preferences,
                apiSettingsSyncMode: event.target.value as CloudSyncPreferences['apiSettingsSyncMode'],
              })}
            >
              <option value="none">不上传 API 配置</option>
              <option value="routes_only">仅站点、模型与路由（不含密钥）</option>
              <option value="encrypted_full">加密上传完整配置</option>
            </select>
          </label>

          <div className="cloud-save-api-backup">
            <div className="cloud-save-api-backup-head">
              <span>
                <strong>独立 API 配置快照</strong>
                <small>
                  {apiSettings
                    ? `云端第 ${apiSettings.revision} 版 · ${apiSettings.syncMode === 'encrypted_full' ? '完整加密' : '不含密钥'} · ${formatBytes(apiSettings.sizeBytes)}`
                    : '云端尚无 API 配置；不会随每个游戏存档重复上传。'}
                </small>
              </span>
              {apiSettings && <time dateTime={apiSettings.updatedAt}>{new Date(apiSettings.updatedAt).toLocaleString()}</time>}
            </div>
            {(preferences.apiSettingsSyncMode === 'encrypted_full' || apiSettings?.syncMode === 'encrypted_full') && (
              <div className="cloud-save-passphrase-row">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={apiPassphrase}
                  onChange={(event) => setApiPassphrase(event.target.value)}
                  placeholder="加密口令（至少 8 位，不会保存）"
                  aria-label="API 配置加密口令"
                />
                {preferences.apiSettingsSyncMode === 'encrypted_full' && (
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={apiPassphraseConfirm}
                    onChange={(event) => setApiPassphraseConfirm(event.target.value)}
                    placeholder="再次输入口令（上传时核对）"
                    aria-label="再次输入 API 配置加密口令"
                  />
                )}
              </div>
            )}
            <div className="cloud-save-api-backup-actions">
              <button
                type="button"
                className="nav-btn"
                disabled={busy || preferences.apiSettingsSyncMode === 'none'}
                onClick={() => void handleUploadApiSettings()}
              >
                {apiSettings ? '更新云端配置' : '上传配置快照'}
              </button>
              <button type="button" className="nav-btn" disabled={busy || !apiSettings} onClick={() => void handleDownloadApiSettings()}>
                恢复到本机
              </button>
              <button type="button" className="nav-btn danger" disabled={busy || !apiSettings} onClick={() => void handleDeleteApiSettings()}>
                删除配置快照
              </button>
            </div>
          </div>

          <div className="cloud-save-account-actions">
            <button type="button" className="nav-btn primary" disabled={busy || !currentSaveId} onClick={() => void handleSyncNow()}>
              {busy ? '处理中…' : '立即同步当前存档'}
            </button>
            <button type="button" className="nav-btn" disabled={busy} onClick={() => void refresh()}>刷新状态</button>
            <button type="button" className="nav-btn" disabled={busy} onClick={() => void handleLogout()}>退出 Discord</button>
            <button type="button" className="nav-btn danger" disabled={busy || (usage?.slotCount ?? 0) === 0} onClick={() => void handleDeleteAll()}>
              删除全部云存档
            </button>
          </div>
        </>
      )}

      <p className="cloud-save-cap-note">
        服务端硬限制：每账户 50 MB / 5 档、每日最多上传 100 次；全站最多使用 8 GB、每日最多接受 6000 次上传。达到保护线后只停止云端上传，不影响本地游戏。
      </p>
      {status && <p className="save-modal-status" role="status">{status}</p>}
    </section>
  );
}
