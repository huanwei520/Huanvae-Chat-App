/**
 * Authorized apps settings sub-panel
 *
 * Displays third-party apps that have been granted access to the user's account.
 * Entry: SettingsPanel → "已授权应用" row.
 * Follows DeviceListPanel slide-in pattern.
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOAuthGrants } from '../../hooks/useOAuthGrants';
import type { OAuthGrant } from '../../api/oauth';
import { resolveDisplayUrl } from '../../services/secureProxy';
import '../../styles/oauth.css';

const SCOPE_LABELS: Record<string, string> = {
  profile: '个人资料',
  email: '邮箱地址',
  friends: '好友信息',
  groups: '群组信息',
};

function formatScopes(scope: string): string {
  return scope
    .split(/\s+/)
    .map((s) => SCOPE_LABELS[s] || s)
    .join('、');
}

function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60 * 60 * 1000) {
      const minutes = Math.floor(diff / (60 * 1000));
      return minutes <= 0 ? '刚刚' : `${minutes}分钟前`;
    }

    if (date.toDateString() === now.toDateString()) {
      return `今天 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }

    return `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  } catch {
    return isoString;
  }
}

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

interface AppCardProps {
  grant: OAuthGrant;
  onRevoke: () => void;
  revoking: boolean;
}

const AppCard: React.FC<AppCardProps> = ({ grant, onRevoke, revoking }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <motion.div
      className="oauth-app-card"
      layout="position"
      layoutId={grant.id}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{
        layout: { type: 'spring', stiffness: 500, damping: 35 },
        opacity: { duration: 0.2 },
        scale: { duration: 0.2 },
      }}
    >
      <div className="oauth-app-logo">
        {grant.app_logo_url ? (
          <img src={resolveDisplayUrl(grant.app_logo_url) || ''} alt={grant.app_name} />
        ) : (
          grant.app_name.charAt(0).toUpperCase()
        )}
      </div>
      <div className="oauth-app-info">
        <div className="oauth-app-name">{grant.app_name}</div>
        <div className="oauth-app-scopes">{formatScopes(grant.scope)}</div>
        <div className="oauth-app-time">授权于 {formatTime(grant.created_at)}</div>
      </div>
      {!showConfirm ? (
        <button
          className="oauth-app-revoke-btn"
          onClick={() => setShowConfirm(true)}
          disabled={revoking}
        >
          {revoking ? '...' : '撤销'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            className="oauth-app-revoke-btn"
            onClick={() => { setShowConfirm(false); onRevoke(); }}
            disabled={revoking}
          >
            确认
          </button>
          <button
            className="oauth-app-revoke-btn"
            onClick={() => setShowConfirm(false)}
            disabled={revoking}
            style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
          >
            取消
          </button>
        </div>
      )}
    </motion.div>
  );
};

interface AuthorizedAppsPanelProps {
  onBack: () => void;
}

export const AuthorizedAppsPanel: React.FC<AuthorizedAppsPanelProps> = ({ onBack }) => {
  const { grants, loading, error, refresh, revoke, revoking } = useOAuthGrants();

  return (
    <motion.div
      className="oauth-apps-panel"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="oauth-apps-header">
        <button className="settings-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回</span>
        </button>
        <h2 className="oauth-apps-title">已授权应用</h2>
        <button className="oauth-refresh-btn" onClick={refresh} disabled={loading} title="刷新">
          <RefreshIcon />
        </button>
      </div>

      <div className="oauth-apps-content">
        {loading && (
          <div className="oauth-apps-empty">
            <div className="oauth-loading-spinner" />
            <span>加载中...</span>
          </div>
        )}

        {error && !loading && (
          <div className="oauth-apps-empty">
            <span style={{ color: 'var(--status-error)' }}>{error}</span>
            <button onClick={refresh} style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}>重试</button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="oauth-apps-hint">
              以下应用已获得访问您账户数据的权限，您可以随时撤销。
            </div>
            <AnimatePresence initial={false}>
              {grants.map((grant) => (
                <AppCard
                  key={grant.id}
                  grant={grant}
                  onRevoke={() => revoke(grant.id)}
                  revoking={revoking === grant.id}
                />
              ))}
            </AnimatePresence>
            {grants.length === 0 && (
              <div className="oauth-apps-empty">
                <div className="oauth-apps-empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <span>暂无已授权的应用</span>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
};

export default AuthorizedAppsPanel;
