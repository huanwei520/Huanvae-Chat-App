/**
 * 中继 Token 列表面板
 */

import { useCallback, useEffect, useState } from 'react';
import type { RemoteDevApiClient } from '../../services/apiClient';
import { createRelayTokenService } from '../../services/relayTokenService';
import type { RelayToken } from '../../types/remoteDev';

function isTokenExpired(t: RelayToken): boolean {
  if (!t.is_active) {
    return true;
  }
  if (t.expires_at) {
    return new Date(t.expires_at).getTime() < Date.now();
  }
  return false;
}

export function TokenListPanel({ api }: { api: RemoteDevApiClient }) {
  const [tokens, setTokens] = useState<RelayToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createExpiresSecs, setCreateExpiresSecs] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newRawToken, setNewRawToken] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await createRelayTokenService(api).listTokens();
      setTokens(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const handleCreate = async () => {
    setCreating(true);
    setCreateError(null);
    setNewRawToken(null);
    try {
      const expiresRaw = createExpiresSecs.trim();
      let expires_in_secs: number | undefined;
      if (expiresRaw !== '') {
        const parsed = Number.parseInt(expiresRaw, 10);
        if (Number.isNaN(parsed) || parsed < 0) {
          setCreateError('有效期（秒）须为非负整数');
          setCreating(false);
          return;
        }
        expires_in_secs = parsed;
      }
      const name = createName.trim() || undefined;
      const res = await createRelayTokenService(api).createToken({
        ...(name ? { name } : {}),
        ...(expires_in_secs !== undefined ? { expires_in_secs } : {}),
      });
      setNewRawToken(res.raw_token);
      setCreateName('');
      setCreateExpiresSecs('');
      setShowCreate(false);
      void loadTokens();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (tokenId: string) => {
    // eslint-disable-next-line no-alert -- 简单确认，避免额外模态层
    if (!window.confirm('确定删除此 Token？')) {
      return;
    }
    setDeletingId(tokenId);
    try {
      await createRelayTokenService(api).deleteToken(tokenId);
      void loadTokens();
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rd-panel">
      <div className="rd-panel-header">
        <h2 className="rd-panel-title">中继 Token</h2>
        <button
          type="button"
          className="rd-btn rd-btn-primary"
          onClick={() => {
            setShowCreate(true);
            setCreateError(null);
            setNewRawToken(null);
          }}
        >
          创建 Token
        </button>
      </div>

      {newRawToken && (
        <div className="rd-token-reveal">
          <strong>请立即保存以下 Token（仅显示一次）</strong>
          <div className="rd-token-value">{newRawToken}</div>
          <button
            type="button"
            className="rd-btn rd-btn-ghost"
            onClick={() => setNewRawToken(null)}
          >
            我已保存
          </button>
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--status-error)', marginBottom: 12 }}>{error}</p>
      )}

      {loading && <div className="rd-loading">加载中…</div>}
      {!loading && tokens.length === 0 && (
        <div className="rd-empty">暂无 Token</div>
      )}
      {!loading && tokens.length > 0 && (
        <table className="rd-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>状态</th>
              <th>最后使用</th>
              <th>创建时间</th>
              <th>过期时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const expired = isTokenExpired(t);
              return (
                <tr key={t.token_id}>
                  <td>{t.name || '—'}</td>
                  <td>
                    <span
                      className={
                        expired
                          ? 'rd-badge rd-badge-danger'
                          : 'rd-badge rd-badge-success'
                      }
                    >
                      {expired ? '已过期' : '生效中'}
                    </span>
                  </td>
                  <td>
                    {t.last_used_at
                      ? new Date(t.last_used_at).toLocaleString()
                      : '从未'}
                  </td>
                  <td>{new Date(t.created_at).toLocaleString()}</td>
                  <td>
                    {t.expires_at
                      ? new Date(t.expires_at).toLocaleString()
                      : '永不过期'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="rd-btn rd-btn-danger"
                      disabled={deletingId === t.token_id}
                      onClick={() => void handleDelete(t.token_id)}
                    >
                      {deletingId === t.token_id ? '删除中…' : '删除'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showCreate && (
        <div
          className="rd-dialog-overlay"
          role="presentation"
          onClick={() => !creating && setShowCreate(false)}
        >
          <div
            className="rd-dialog"
            role="dialog"
            aria-labelledby="rd-create-token-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="rd-create-token-title" className="rd-dialog-title">
              创建 Token
            </h3>
            {createError && (
              <p style={{ color: 'var(--status-error)', marginBottom: 12 }}>{createError}</p>
            )}
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-token-name">
                名称（可选）
              </label>
              <input
                id="rd-token-name"
                className="rd-input"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="例如：开发机"
              />
            </div>
            <div className="rd-form-group">
              <label className="rd-form-label" htmlFor="rd-token-expires">
                有效期（秒，可选）
              </label>
              <input
                id="rd-token-expires"
                className="rd-input"
                type="number"
                min={0}
                value={createExpiresSecs}
                onChange={(e) => setCreateExpiresSecs(e.target.value)}
                placeholder="留空表示由服务端默认"
              />
            </div>
            <div className="rd-dialog-actions">
              <button
                type="button"
                className="rd-btn rd-btn-ghost"
                disabled={creating}
                onClick={() => setShowCreate(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rd-btn rd-btn-primary"
                disabled={creating}
                onClick={() => void handleCreate()}
              >
                {creating ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
