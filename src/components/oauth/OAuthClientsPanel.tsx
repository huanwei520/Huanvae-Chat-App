/**
 * OAuth client management panel
 *
 * Developer-facing panel for creating, viewing, and managing external OAuth clients.
 * Entry: MiniAppsModal → "我的" tab → "OAuth 客户端" button.
 * Rendered via createPortal to document.body with fixed positioning.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOAuthClients } from '../../hooks/useOAuthClients';
import type { OAuthClient, CreateClientRequest, CreateClientResponse } from '../../api/oauth';
import '../../styles/oauth.css';

const AVAILABLE_SCOPES = [
  { value: 'profile', label: '个人资料' },
  { value: 'email', label: '邮箱' },
  { value: 'friends', label: '好友' },
  { value: 'groups', label: '群组' },
];

const BackIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const RefreshIcon: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

// ============================================
// Secret Display Dialog
// ============================================

interface SecretDisplayProps {
  clientId: string;
  clientSecret: string;
  appName: string;
  onClose: () => void;
}

const SecretDisplay: React.FC<SecretDisplayProps> = ({ clientId, clientSecret, appName, onClose }) => (
  <motion.div
    className="oauth-create-overlay"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    onClick={onClose}
  >
    <motion.div
      className="oauth-secret-dialog"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="oauth-create-title">{appName} - 客户端凭据</h3>

      <div className="oauth-secret-warning">
        <span>&#9888;</span>
        <span>客户端密钥仅显示一次，请妥善保存</span>
      </div>

      <div className="oauth-secret-field">
        <div className="oauth-secret-label">Client ID</div>
        <div className="oauth-secret-value">
          <span style={{ flex: 1, wordBreak: 'break-all' }}>{clientId}</span>
          <button className="copy-btn" onClick={() => copyToClipboard(clientId)}>复制</button>
        </div>
      </div>

      <div className="oauth-secret-field">
        <div className="oauth-secret-label">Client Secret</div>
        <div className="oauth-secret-value">
          <span style={{ flex: 1, wordBreak: 'break-all' }}>{clientSecret}</span>
          <button className="copy-btn" onClick={() => copyToClipboard(clientSecret)}>复制</button>
        </div>
      </div>

      <button className="oauth-secret-close-btn" onClick={onClose}>
        已保存，关闭
      </button>
    </motion.div>
  </motion.div>
);

// ============================================
// Create Client Dialog
// ============================================

interface CreateClientDialogProps {
  onSubmit: (data: CreateClientRequest) => Promise<CreateClientResponse | null>;
  onCancel: () => void;
  creating: boolean;
}

const CreateClientDialog: React.FC<CreateClientDialogProps> = ({ onSubmit, onCancel, creating }) => {
  const [appName, setAppName] = useState('');
  const [appDescription, setAppDescription] = useState('');
  const [appHomepageUrl, setAppHomepageUrl] = useState('');
  const [redirectUris, setRedirectUris] = useState(['']);
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['profile']);

  const addUri = () => setRedirectUris([...redirectUris, '']);
  const removeUri = (idx: number) => setRedirectUris(redirectUris.filter((_, i) => i !== idx));
  const updateUri = (idx: number, val: string) => {
    const next = [...redirectUris];
    next[idx] = val;
    setRedirectUris(next);
  };

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  const validUris = redirectUris.filter((u) => u.trim().length > 0);
  const canSubmit = appName.trim().length > 0 && validUris.length > 0 && !creating;

  const handleSubmit = async () => {
    const data: CreateClientRequest = {
      app_name: appName.trim(),
      redirect_uris: validUris,
    };
    if (appDescription.trim()) {
      data.app_description = appDescription.trim();
    }
    if (appHomepageUrl.trim()) {
      data.app_homepage_url = appHomepageUrl.trim();
    }
    if (selectedScopes.length > 0) {
      data.scopes = selectedScopes;
    }
    await onSubmit(data);
  };

  return (
    <motion.div
      className="oauth-create-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="oauth-create-dialog"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="oauth-create-title">创建 OAuth 客户端</h3>

        <div className="oauth-form-group">
          <label className="oauth-form-label">
            应用名称 <span className="required">*</span>
          </label>
          <input
            className="oauth-form-input"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="My App"
            maxLength={100}
          />
        </div>

        <div className="oauth-form-group">
          <label className="oauth-form-label">应用描述</label>
          <input
            className="oauth-form-input"
            value={appDescription}
            onChange={(e) => setAppDescription(e.target.value)}
            placeholder="简要描述"
          />
        </div>

        <div className="oauth-form-group">
          <label className="oauth-form-label">首页 URL</label>
          <input
            className="oauth-form-input"
            value={appHomepageUrl}
            onChange={(e) => setAppHomepageUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>

        <div className="oauth-form-group">
          <label className="oauth-form-label">
            回调 URI <span className="required">*</span>
          </label>
          <div className="oauth-uri-list">
            {redirectUris.map((uri, idx) => (
              <div key={idx} className="oauth-uri-row">
                <input
                  className="oauth-form-input"
                  value={uri}
                  onChange={(e) => updateUri(idx, e.target.value)}
                  placeholder="https://example.com/callback"
                />
                {redirectUris.length > 1 && (
                  <button className="oauth-uri-remove-btn" onClick={() => removeUri(idx)}>
                    &times;
                  </button>
                )}
              </div>
            ))}
            <button className="oauth-uri-add-btn" onClick={addUri}>
              + 添加回调 URI
            </button>
          </div>
        </div>

        <div className="oauth-form-group">
          <label className="oauth-form-label">权限范围</label>
          <div className="oauth-scope-checkboxes">
            {AVAILABLE_SCOPES.map((s) => (
              <button
                key={s.value}
                className={`oauth-scope-checkbox ${selectedScopes.includes(s.value) ? 'checked' : ''}`}
                onClick={() => toggleScope(s.value)}
                type="button"
              >
                {selectedScopes.includes(s.value) ? '✓' : '○'} {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="oauth-create-actions">
          <button className="oauth-consent-btn secondary" onClick={onCancel} disabled={creating}>
            取消
          </button>
          <button
            className="oauth-consent-btn primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {creating ? '创建中...' : '创建'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ============================================
// Client Card
// ============================================

interface ClientCardProps {
  client: OAuthClient;
  onDelete: () => void;
  onResetSecret: () => void;
  operating: boolean;
}

const ClientCard: React.FC<ClientCardProps> = ({ client, onDelete, onResetSecret, operating }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  return (
    <motion.div
      className="oauth-client-card"
      layout="position"
      layoutId={client.client_id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
    >
      <div className="oauth-client-header">
        <span className="oauth-client-name">{client.app_name}</span>
        <span className={`oauth-client-type-badge ${client.client_type}`}>
          {client.client_type === 'internal' ? '内部' : '外部'}
        </span>
        {!client.is_active && (
          <span className="oauth-client-type-badge" style={{ background: 'var(--status-error-subtle)', color: 'var(--status-error)' }}>
            已停用
          </span>
        )}
      </div>

      <div className="oauth-client-id">
        <span>{client.client_id}</span>
        <button className="copy-btn" onClick={() => copyToClipboard(client.client_id)}>复制</button>
      </div>

      <div className="oauth-client-meta">
        {client.allowed_scopes.length > 0 && (
          <div>权限: {client.allowed_scopes.join(', ')}</div>
        )}
        {client.redirect_uris.length > 0 && (
          <div>回调: {client.redirect_uris.join(', ')}</div>
        )}
      </div>

      {client.client_type === 'external' && (
        <div className="oauth-client-actions">
          <button
            className="oauth-client-action-btn"
            onClick={onResetSecret}
            disabled={operating}
          >
            {operating ? '...' : '重置密钥'}
          </button>
          {!showDeleteConfirm ? (
            <button
              className="oauth-client-action-btn danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={operating}
            >
              删除
            </button>
          ) : (
            <>
              <button
                className="oauth-client-action-btn danger"
                onClick={() => { setShowDeleteConfirm(false); onDelete(); }}
                disabled={operating}
              >
                确认删除
              </button>
              <button
                className="oauth-client-action-btn"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={operating}
              >
                取消
              </button>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ============================================
// Main Panel
// ============================================

interface OAuthClientsPanelProps {
  onBack: () => void;
}

export const OAuthClientsPanel: React.FC<OAuthClientsPanelProps> = ({ onBack }) => {
  const { clients, loading, error, refresh, create, remove, resetSecret, operatingId } =
    useOAuthClients();
  const [showCreate, setShowCreate] = useState(false);
  const [secretInfo, setSecretInfo] = useState<CreateClientResponse | null>(null);
  const [resetSecretValue, setResetSecretValue] = useState<{ clientId: string; secret: string } | null>(null);

  const handleCreate = async (data: CreateClientRequest) => {
    const result = await create(data);
    if (result) {
      setShowCreate(false);
      setSecretInfo(result);
    }
    return result;
  };

  const handleResetSecret = async (clientId: string) => {
    const secret = await resetSecret(clientId);
    if (secret) {
      setResetSecretValue({ clientId, secret });
    }
  };

  return (
    <motion.div
      className="oauth-clients-panel"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="oauth-clients-header">
        <button className="oauth-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回</span>
        </button>
        <h2 className="oauth-clients-title">OAuth 客户端</h2>
        <button className="oauth-refresh-btn" onClick={refresh} disabled={loading} title="刷新">
          <RefreshIcon />
        </button>
        <button
          className="oauth-clients-create-btn"
          onClick={() => setShowCreate(true)}
          disabled={loading}
        >
          + 创建
        </button>
      </div>

      <div className="oauth-clients-content">
        {loading && (
          <div className="oauth-clients-empty">
            <div className="oauth-loading-spinner" />
            <span>加载中...</span>
          </div>
        )}

        {error && !loading && (
          <div className="oauth-clients-empty">
            <span style={{ color: 'var(--status-error)' }}>{error}</span>
            <button onClick={refresh} style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}>重试</button>
          </div>
        )}

        {!loading && !error && (
          <>
            <AnimatePresence initial={false}>
              {clients.map((client) => (
                <ClientCard
                  key={client.client_id}
                  client={client}
                  onDelete={() => remove(client.client_id)}
                  onResetSecret={() => handleResetSecret(client.client_id)}
                  operating={operatingId === client.client_id}
                />
              ))}
            </AnimatePresence>
            {clients.length === 0 && (
              <div className="oauth-clients-empty">
                <span>暂无 OAuth 客户端</span>
                <span style={{ fontSize: 12, color: 'var(--text-disabled)' }}>
                  点击右上角「+ 创建」添加
                </span>
              </div>
            )}
          </>
        )}
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateClientDialog
            onSubmit={handleCreate}
            onCancel={() => setShowCreate(false)}
            creating={operatingId === '__creating__'}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {secretInfo && (
          <SecretDisplay
            clientId={secretInfo.client_id}
            clientSecret={secretInfo.client_secret}
            appName={secretInfo.app_name}
            onClose={() => setSecretInfo(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resetSecretValue && (
          <SecretDisplay
            clientId={resetSecretValue.clientId}
            clientSecret={resetSecretValue.secret}
            appName={clients.find((c) => c.client_id === resetSecretValue.clientId)?.app_name || 'OAuth Client'}
            onClose={() => setResetSecretValue(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default OAuthClientsPanel;
