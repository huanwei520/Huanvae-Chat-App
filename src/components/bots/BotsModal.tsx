/**
 * 机器人管理弹窗（桌面端，BotFather 式最小管理面板）
 *
 * 功能：
 * - 我的 bot 列表（昵称 / @username / 描述 / 启用状态）
 * - 创建 bot：表单提交成功后用 SecretDisplay 一次性展示 token
 * - 按 username 添加 bot 好友（恒 auto_accept，一次调用即成好友）
 * - 每个 bot：重置 token（确认 → SecretDisplay 展示新 token）、删除（确认）
 * - 每个 bot：隐私设置（消息策略 所有人/白名单/仅自己 + 可发现性）
 *
 * 复用：
 * - modal-overlay / modal-content / modal-header / close-btn / files-count CSS 类
 * - miniapp-* 弹窗与表单 CSS 类（miniapps.css，Main.tsx 已全局引入）
 * - SecretDisplay 公共凭据弹窗（token 只存于本组件展示态，关闭即清空，不落盘不打日志）
 * - useBots Hook 封装全部状态逻辑
 *
 * 与 MiniAppsModal 的差异：无 Tab / 搜索 / WebviewWindow；全部子弹窗为静态渲染
 * （不引入新的 framer-motion 组件，故无需登记 animation-conflict 注册表）。
 */

import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../common/Icons';
import { LoadingSpinner } from '../common/LoadingSpinner';
import { SecretDisplay, type SecretField } from '../common/SecretDisplay';
import { CreateBotDialog } from './CreateBotDialog';
import { useBots } from '../../hooks/useBots';
import type { BotInfo, CreateBotRequest, UpdateBotRequest } from '../../api/bots';
import '../../styles/bots.css';

// ============================================
// 类型定义
// ============================================

interface BotsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 加 bot 好友成功后回调（刷新好友列表用） */
  onBotAdded?: () => void;
}

/** token 一次性展示态（SecretDisplay 关闭即清空） */
interface TokenDisplayState {
  title: string;
  fields: SecretField[];
}

/** 危险操作确认态 */
interface ConfirmState {
  kind: 'reset' | 'delete';
  bot: BotInfo;
}

const TOKEN_WARNING = 'Token 仅此一次明文展示，请立即妥善保存；关闭后无法再次查看，只能重置。';

/** 消息策略：谁能给此 bot 发消息/加好友（everyone 所有人 / whitelist 白名单 / owner_only 仅自己） */
type MessagePolicy = NonNullable<UpdateBotRequest['message_policy']>;

/** 白名单上限（与后端一致，超出禁用提交） */
const WHITELIST_MAX = 200;

/** 白名单 textarea → 用户 ID 数组：按行 split、trim、去空、去重（保序） */
function parseWhitelist(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const line of text.split('\n')) {
    const id = line.trim();
    if (id !== '' && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/**
 * 卡片上的隐私状态小字（纯展示）。
 * message_policy=everyone 且 is_discoverable=true（默认全开）时返回 null 不展示。
 * is_discoverable=false 语义：其他人按 username 搜索添加一律 404（owner 恒可添加）。
 */
function privacyStatusText(bot: BotInfo): string | null {
  const parts: string[] = [];
  if (bot.message_policy === 'owner_only') {
    parts.push('仅自己可发消息');
  } else if (bot.message_policy === 'whitelist') {
    parts.push('仅白名单可发消息');
  }
  if (!bot.is_discoverable) {
    parts.push('不可被搜索');
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

// ============================================
// 子组件
// ============================================

/** 隐私设置弹窗（模式照 CreateBotDialog：createPortal + miniapp-create-dialog，静态渲染） */
function PrivacyDialog({
  bot,
  saving,
  error,
  onSave,
  onClose,
}: {
  bot: BotInfo;
  saving: boolean;
  error: string | null;
  onSave: (data: UpdateBotRequest) => void;
  onClose: () => void;
}) {
  // 后端契约保证 message_policy 仅为三个枚举值之一（见 BotInfo 注释）
  const [policy, setPolicy] = useState<MessagePolicy>(bot.message_policy as MessagePolicy);
  const [whitelistText, setWhitelistText] = useState(bot.message_whitelist.join('\n'));
  const [discoverable, setDiscoverable] = useState(bot.is_discoverable);

  const parsedWhitelist = parseWhitelist(whitelistText);
  const whitelistTooLong = parsedWhitelist.length > WHITELIST_MAX;
  const whitelistChanged =
    parsedWhitelist.length !== bot.message_whitelist.length ||
    parsedWhitelist.some((id, i) => id !== bot.message_whitelist[i]);

  // 只传变化字段（对齐后端"未提供不改"契约）；白名单仅在 policy=whitelist 时有意义
  const changes: UpdateBotRequest = {};
  if (policy !== bot.message_policy) {
    changes.message_policy = policy;
  }
  if (policy === 'whitelist' && whitelistChanged) {
    changes.message_whitelist = parsedWhitelist;
  }
  if (discoverable !== bot.is_discoverable) {
    changes.is_discoverable = discoverable;
  }
  const hasChanges = Object.keys(changes).length > 0;

  const canSubmit =
    hasChanges && !(policy === 'whitelist' && whitelistTooLong) && !saving;

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    onSave(changes);
  };

  return createPortal(
    <div className="modal-overlay miniapp-create-overlay" onClick={onClose}>
      <div className="miniapp-create-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="miniapp-create-header">
          <h3>隐私设置</h3>
          <button className="close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="miniapp-create-body">
          <div className="miniapp-field">
            <span className="miniapp-field-label">谁可以发消息</span>
            <div className="bots-radio-group">
              <label className="bots-radio-option">
                <input
                  type="radio"
                  name="bots-message-policy"
                  value="everyone"
                  checked={policy === 'everyone'}
                  onChange={() => setPolicy('everyone')}
                />
                所有人
              </label>
              <label className="bots-radio-option">
                <input
                  type="radio"
                  name="bots-message-policy"
                  value="whitelist"
                  checked={policy === 'whitelist'}
                  onChange={() => setPolicy('whitelist')}
                />
                白名单
              </label>
              <label className="bots-radio-option">
                <input
                  type="radio"
                  name="bots-message-policy"
                  value="owner_only"
                  checked={policy === 'owner_only'}
                  onChange={() => setPolicy('owner_only')}
                />
                仅自己
              </label>
            </div>
          </div>
          {policy === 'whitelist' && (
            <label className="miniapp-field">
              <span className="miniapp-field-label">
                白名单用户 ID（每行一个，最多 {WHITELIST_MAX} 条）
              </span>
              <textarea
                placeholder="每行一个用户 ID"
                value={whitelistText}
                onChange={(e) => setWhitelistText(e.target.value)}
                rows={5}
              />
            </label>
          )}
          {policy === 'whitelist' && whitelistTooLong && (
            <p className="miniapp-card-reject-reason">
              白名单最多 {WHITELIST_MAX} 条，当前 {parsedWhitelist.length} 条
            </p>
          )}
          <div className="miniapp-field">
            <label className="bots-radio-option">
              <input
                type="checkbox"
                checked={discoverable}
                onChange={(e) => setDiscoverable(e.target.checked)}
              />
              允许被搜索添加
            </label>
            <p className="miniapp-field-hint">
              关闭后其他人按用户名搜索添加将返回不存在（你自己恒可添加）。
            </p>
          </div>
          {error && <p className="miniapp-card-reject-reason">{error}</p>}
        </div>
        <div className="miniapp-create-footer">
          <button className="miniapp-btn secondary" onClick={onClose}>
            取消
          </button>
          <button className="miniapp-btn primary" onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 按 username 添加 bot 好友弹窗 */
function AddBotDialog({
  onClose,
  onAdd,
  adding,
  error,
  successText,
}: {
  onClose: () => void;
  onAdd: (username: string) => void;
  adding: boolean;
  error: string | null;
  successText: string | null;
}) {
  const [username, setUsername] = useState('');
  const canSubmit = username.trim() !== '' && !adding;

  return createPortal(
    <div className="modal-overlay miniapp-create-overlay" onClick={onClose}>
      <div className="miniapp-create-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="miniapp-create-header">
          <h3>添加机器人</h3>
          <button className="close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="miniapp-create-body">
          <label className="miniapp-field">
            <span className="miniapp-field-label">
              机器人用户名 <span className="miniapp-required">*</span>
            </span>
            <input
              type="text"
              placeholder="输入 bot 的 username（不含 @）"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
            />
          </label>
          <p className="miniapp-field-hint">
            机器人好友无需对方确认，添加成功即可开始对话。
          </p>
          {successText && <p className="miniapp-field-hint bots-add-success">{successText}</p>}
          {error && <p className="miniapp-card-reject-reason">{error}</p>}
        </div>
        <div className="miniapp-create-footer">
          <button className="miniapp-btn secondary" onClick={onClose}>
            {successText ? '关闭' : '取消'}
          </button>
          <button
            className="miniapp-btn primary"
            onClick={() => onAdd(username.trim())}
            disabled={!canSubmit}
          >
            {adding ? '添加中...' : '添加'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 危险操作确认弹窗（重置 token / 删除 bot 共用） */
function ConfirmActionDialog({
  confirm,
  operating,
  onConfirm,
  onCancel,
}: {
  confirm: ConfirmState;
  operating: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isReset = confirm.kind === 'reset';
  const confirmLabel = isReset ? '确认重置' : '确认删除';
  return createPortal(
    <div className="modal-overlay miniapp-create-overlay" onClick={onCancel}>
      <div className="miniapp-create-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="miniapp-create-header">
          <h3>{isReset ? '重置 Token' : '删除机器人'}</h3>
          <button className="close-btn" onClick={onCancel}>
            <CloseIcon />
          </button>
        </div>
        <div className="miniapp-create-body">
          <p className="miniapp-field-hint">
            {isReset
              ? `确定要重置 @${confirm.bot.username} 的 Token 吗？旧 Token 将即刻失效，新 Token 仅明文展示一次。`
              : `确定要删除 @${confirm.bot.username} 吗？机器人将被删除且 Token 即刻失效，此操作不可恢复。`}
          </p>
        </div>
        <div className="miniapp-create-footer">
          <button className="miniapp-btn secondary" onClick={onCancel}>
            取消
          </button>
          <button
            className={`miniapp-btn ${isReset ? 'primary' : 'danger'}`}
            onClick={onConfirm}
            disabled={operating}
          >
            {operating ? '处理中...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** bot 卡片（静态渲染，无 motion） */
function BotCard({
  bot,
  operating,
  onPrivacy,
  onResetToken,
  onDelete,
}: {
  bot: BotInfo;
  operating: boolean;
  onPrivacy: () => void;
  onResetToken: () => void;
  onDelete: () => void;
}) {
  const privacyStatus = privacyStatusText(bot);
  return (
    <div className="miniapp-card">
      <div className="miniapp-card-header">
        <div className="miniapp-card-meta">
          <h4 className="miniapp-card-name">{bot.nickname}</h4>
          <span
            className={`miniapp-status-badge ${bot.is_active ? 'status-running' : 'status-stopped'}`}
          >
            {bot.is_active ? '启用中' : '已停用'}
          </span>
        </div>
      </div>
      <p className="miniapp-card-desc">@{bot.username}</p>
      {bot.description && <p className="miniapp-card-desc">{bot.description}</p>}
      {privacyStatus && <p className="bots-privacy-status">{privacyStatus}</p>}
      <div className="miniapp-card-actions">
        <button className="miniapp-btn small" onClick={onPrivacy} disabled={operating}>
          隐私
        </button>
        <button className="miniapp-btn small" onClick={onResetToken} disabled={operating}>
          重置 Token
        </button>
        <button className="miniapp-btn small danger" onClick={onDelete} disabled={operating}>
          删除
        </button>
      </div>
    </div>
  );
}

// ============================================
// 主组件
// ============================================

export function BotsModal({ isOpen, onClose, onBotAdded }: BotsModalProps) {
  const { bots, loading, error, create, update, remove, resetToken, addByUsername, operatingId } =
    useBots();
  const [showCreate, setShowCreate] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [tokenDisplay, setTokenDisplay] = useState<TokenDisplayState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [privacyBot, setPrivacyBot] = useState<BotInfo | null>(null);

  // 关闭主弹窗即清空全部瞬态（含一次性 token 展示态），重开不得复现旧 token
  useEffect(() => {
    if (!isOpen) {
      setShowCreate(false);
      setShowAdd(false);
      setAddSuccess(null);
      setTokenDisplay(null);
      setConfirm(null);
      setPrivacyBot(null);
    }
  }, [isOpen]);

  const handleCreate = useCallback(
    async (data: CreateBotRequest) => {
      const result = await create(data);
      if (result) {
        setShowCreate(false);
        // token 仅存展示态，SecretDisplay 关闭即清空
        setTokenDisplay({
          title: '机器人创建成功',
          fields: [
            { label: 'Bot ID', value: result.bot_user_id },
            { label: '用户名', value: result.username },
            { label: 'Token', value: result.token },
          ],
        });
      }
    },
    [create],
  );

  const handleAdd = useCallback(
    async (username: string) => {
      const result = await addByUsername(username);
      if (result) {
        setAddSuccess(`已添加 @${result.username} 为好友`);
        onBotAdded?.();
      }
    },
    [addByUsername, onBotAdded],
  );

  const handleSavePrivacy = useCallback(
    async (data: UpdateBotRequest) => {
      if (!privacyBot) {
        return;
      }
      const result = await update(privacyBot.bot_user_id, data);
      if (result) {
        setPrivacyBot(null);
      }
    },
    [privacyBot, update],
  );

  const handleConfirmAction = useCallback(async () => {
    if (!confirm) {
      return;
    }
    if (confirm.kind === 'reset') {
      const token = await resetToken(confirm.bot.bot_user_id);
      setConfirm(null);
      if (token) {
        setTokenDisplay({
          title: 'Token 已重置',
          fields: [
            { label: '用户名', value: confirm.bot.username },
            { label: '新 Token', value: token },
          ],
        });
      }
    } else {
      await remove(confirm.bot.bot_user_id);
      setConfirm(null);
    }
  }, [confirm, resetToken, remove]);

  if (!isOpen) {
    return null;
  }

  const content = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content miniapps-modal" onClick={(e) => e.stopPropagation()}>
        {/* 头部 */}
        <div className="modal-header">
          <div className="miniapps-header-left">
            <h2>机器人</h2>
            <span className="files-count">{bots.length} 个</span>
          </div>
          <div className="miniapps-header-right">
            <button className="miniapp-btn" onClick={() => { setAddSuccess(null); setShowAdd(true); }}>
              添加机器人
            </button>
            <button className="miniapp-btn primary" onClick={() => setShowCreate(true)}>
              + 创建
            </button>
            <button className="close-btn" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="miniapps-body">
          {loading && bots.length === 0 && (
            <div className="miniapp-loading">
              <LoadingSpinner />
              <span>加载中...</span>
            </div>
          )}
          {!loading && error && bots.length === 0 && (
            <div className="miniapp-error">
              <span className="miniapp-error-icon">&#x26A0;</span>
              <span>{error}</span>
            </div>
          )}
          {!loading && !error && bots.length === 0 && (
            <div className="miniapp-empty">
              <span className="miniapp-empty-icon">&#x1F916;</span>
              <span>暂无机器人，点击右上角创建</span>
            </div>
          )}
          {bots.length > 0 && (
            <div className="miniapps-grid">
              {bots.map((bot) => (
                <BotCard
                  key={bot.bot_user_id}
                  bot={bot}
                  operating={operatingId === bot.bot_user_id}
                  onPrivacy={() => setPrivacyBot(bot)}
                  onResetToken={() => setConfirm({ kind: 'reset', bot })}
                  onDelete={() => setConfirm({ kind: 'delete', bot })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(content, document.body)}

      {showCreate && (
        <CreateBotDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
          creating={operatingId === '__creating__'}
          error={error}
        />
      )}

      {showAdd && (
        <AddBotDialog
          onClose={() => { setShowAdd(false); setAddSuccess(null); }}
          onAdd={handleAdd}
          adding={operatingId === '__adding__'}
          error={error}
          successText={addSuccess}
        />
      )}

      {privacyBot && (
        <PrivacyDialog
          bot={privacyBot}
          saving={operatingId === privacyBot.bot_user_id}
          error={error}
          onSave={handleSavePrivacy}
          onClose={() => setPrivacyBot(null)}
        />
      )}

      {confirm && (
        <ConfirmActionDialog
          confirm={confirm}
          operating={operatingId === confirm.bot.bot_user_id}
          onConfirm={handleConfirmAction}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* token 一次性展示：portal 到 body + fixed z-10001，避免被 z-index:1000 主弹窗遮挡 */}
      {tokenDisplay &&
        createPortal(
          <div style={{ position: 'fixed', inset: 0, zIndex: 10001 }}>
            <SecretDisplay
              title={tokenDisplay.title}
              warningText={TOKEN_WARNING}
              fields={tokenDisplay.fields}
              onClose={() => setTokenDisplay(null)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
