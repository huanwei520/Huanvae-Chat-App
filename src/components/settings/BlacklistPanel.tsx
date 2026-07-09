/**
 * 黑名单管理子面板
 *
 * 展示当前用户拉黑的所有用户，支持取消拉黑。
 * 入口：SettingsPanel → "黑名单" row。沿用 AuthorizedAppsPanel 的滑入模式。
 */

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useBlacklist } from '../../hooks/useBlacklist';
import { AvatarPlaceholder } from '../common/AvatarPlaceholder';
import type { BlacklistedUser } from '../../api/friends';
import './blacklist.css';

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

interface BlacklistRowProps {
  user: BlacklistedUser;
  onRemove: () => void;
  removing: boolean;
}

const BlacklistRow: React.FC<BlacklistRowProps> = ({ user, onRemove, removing }) => {
  const [confirm, setConfirm] = useState(false);
  const name = user.user_nickname?.trim() || user.user_id;

  return (
    <div className="blacklist-row">
      <div className="blacklist-avatar">
        {user.user_avatar_url ? (
          <img src={user.user_avatar_url} alt={name} />
        ) : (
          <AvatarPlaceholder name={name} fontSize={16} />
        )}
      </div>
      <div className="blacklist-info">
        <div className="blacklist-name" title={name}>{name}</div>
        <div className="blacklist-id" title={`@${user.user_id}`}>@{user.user_id}</div>
      </div>
      {!confirm ? (
        <button className="blacklist-remove-btn" onClick={() => setConfirm(true)} disabled={removing}>
          {removing ? '...' : '取消拉黑'}
        </button>
      ) : (
        <div className="blacklist-confirm-actions">
          <button className="blacklist-remove-btn" onClick={() => { setConfirm(false); onRemove(); }} disabled={removing}>
            确认
          </button>
          <button className="blacklist-cancel-btn" onClick={() => setConfirm(false)} disabled={removing}>
            取消
          </button>
        </div>
      )}
    </div>
  );
};

interface BlacklistPanelProps {
  onBack: () => void;
}

export const BlacklistPanel: React.FC<BlacklistPanelProps> = ({ onBack }) => {
  const { list, loading, error, refresh, remove, removing } = useBlacklist();

  return (
    <motion.div
      className="blacklist-panel"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="blacklist-header">
        <button className="settings-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回</span>
        </button>
        <h2 className="blacklist-title">黑名单</h2>
        <button className="blacklist-refresh-btn" onClick={refresh} disabled={loading} title="刷新">
          <RefreshIcon />
        </button>
      </div>

      <div className="blacklist-content">
        {loading && (
          <div className="blacklist-empty"><span>加载中...</span></div>
        )}

        {error && !loading && (
          <div className="blacklist-empty">
            <span className="blacklist-error-text">{error}</span>
            <button className="blacklist-retry" onClick={refresh}>重试</button>
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="blacklist-hint">
              被拉黑的用户与你互相收不到对方发送的消息；好友关系仍保留。可随时取消拉黑。
            </div>
            {list.map((u) => (
              <BlacklistRow
                key={u.user_id}
                user={u}
                onRemove={() => remove(u.user_id)}
                removing={removing === u.user_id}
              />
            ))}
            {list.length === 0 && (
              <div className="blacklist-empty"><span>暂无拉黑用户</span></div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
};

export default BlacklistPanel;
