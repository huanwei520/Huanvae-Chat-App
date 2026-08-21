/**
 * 移动端机器人管理页面（BotFather 式最小管理面板）
 *
 * 功能与桌面端 BotsModal 一致：
 * - 我的 bot 列表（昵称 / @username / 描述 / 启用状态）
 * - 创建 bot → SecretDisplay 一次性展示 token
 * - 按 username 添加 bot 好友
 * - 重置 token（确认 → SecretDisplay 展示新 token）、删除（确认）
 * - 隐私设置（消息策略 所有人/白名单/仅自己 + 可发现性）
 *
 * 与 MobileMiniAppsPage 同款整屏页范式：pageVariants 右滑入场 + 顶部返回栏；
 * 子弹窗为静态渲染（无新 motion 组件）。motion 根 .mobile-bots-page 与卡片
 * .mobile-bot-card 已登记 tests/animation-conflict.test.ts 注册表。
 *
 * token 只存于本组件展示态（SecretDisplay 关闭即清空），不落盘不打日志。
 */

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { SecretDisplay, type SecretField } from '../../components/common/SecretDisplay';
import { useBots } from '../../hooks/useBots';
import { isValidBotUsername } from '../../api/bots';
import type { BotInfo, CreateBotRequest, UpdateBotRequest } from '../../api/bots';
// 共享隐私类（bots-radio-group / bots-privacy-status 等）
import '../../styles/bots.css';

// 返回图标
const BackIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={2}
    stroke="currentColor"
    width="24"
    height="24"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15.75 19.5L8.25 12l7.5-7.5"
    />
  </svg>
);

const pageVariants = {
  initial: { x: '100%', opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
  exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
};

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, scale: 0.9 },
};

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

/** 只传变化字段（对齐后端"未提供不改"契约）；白名单仅在 policy=whitelist 时传 */
function buildPrivacyChanges(
  bot: BotInfo,
  policy: MessagePolicy,
  whitelist: string[],
  discoverable: boolean,
): UpdateBotRequest {
  const changes: UpdateBotRequest = {};
  if (policy !== bot.message_policy) {
    changes.message_policy = policy;
  }
  const whitelistChanged =
    whitelist.length !== bot.message_whitelist.length ||
    whitelist.some((id, i) => id !== bot.message_whitelist[i]);
  if (policy === 'whitelist' && whitelistChanged) {
    changes.message_whitelist = whitelist;
  }
  if (discoverable !== bot.is_discoverable) {
    changes.is_discoverable = discoverable;
  }
  return changes;
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

interface MobileBotsPageProps {
  /** 关闭整个页面（返回主界面） */
  onClose: () => void;
  /** 加 bot 好友成功后回调（刷新好友列表用） */
  onBotAdded?: () => void;
}

/** token 一次性展示态 */
interface TokenDisplayState {
  title: string;
  fields: SecretField[];
}

/** 危险操作确认态 */
interface ConfirmState {
  kind: 'reset' | 'delete';
  bot: BotInfo;
}

/** bot 卡片（motion stagger 入场 + whileTap；transform/opacity 归 framer-motion） */
function BotCard({
  bot,
  index,
  operating,
  onPrivacy,
  onResetToken,
  onDelete,
}: {
  bot: BotInfo;
  index: number;
  operating: boolean;
  onPrivacy: () => void;
  onResetToken: () => void;
  onDelete: () => void;
}) {
  const privacyStatus = privacyStatusText(bot);
  return (
    <motion.div
      className="mobile-bot-card"
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ delay: index * 0.03 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="mobile-bot-card-info">
        <div className="mobile-bot-card-title-row">
          <span className="mobile-bot-card-name">{bot.nickname}</span>
          <span
            className={`mobile-bot-card-badge ${bot.is_active ? 'active' : 'inactive'}`}
          >
            {bot.is_active ? '启用中' : '已停用'}
          </span>
        </div>
        <div className="mobile-bot-card-username">@{bot.username}</div>
        {bot.description && (
          <div className="mobile-bot-card-desc">{bot.description}</div>
        )}
        {privacyStatus && <div className="bots-privacy-status">{privacyStatus}</div>}
      </div>
      <div className="mobile-bot-card-actions">
        <button className="mobile-bot-action-btn" onClick={onPrivacy} disabled={operating}>
          隐私
        </button>
        <button className="mobile-bot-action-btn" onClick={onResetToken} disabled={operating}>
          重置 Token
        </button>
        <button
          className="mobile-bot-action-btn danger"
          onClick={onDelete}
          disabled={operating}
        >
          删除
        </button>
      </div>
    </motion.div>
  );
}

/** 通用底部弹窗外壳（静态渲染，无 motion） */
function BotsDialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mobile-bots-dialog-overlay" onClick={onClose}>
      <div className="mobile-bots-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="mobile-bots-dialog-title">{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function MobileBotsPage({ onClose, onBotAdded }: MobileBotsPageProps) {
  const { bots, loading, error, create, update, remove, resetToken, addByUsername, operatingId } =
    useBots();
  const [showCreate, setShowCreate] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [tokenDisplay, setTokenDisplay] = useState<TokenDisplayState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // 创建表单字段
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [description, setDescription] = useState('');
  // 加好友表单字段
  const [addUsername, setAddUsername] = useState('');
  // 隐私设置表单字段（打开时由 openPrivacy 从 bot 当前值初始化）
  const [privacyBot, setPrivacyBot] = useState<BotInfo | null>(null);
  const [policy, setPolicy] = useState<MessagePolicy>('everyone');
  const [whitelistText, setWhitelistText] = useState('');
  const [discoverable, setDiscoverable] = useState(true);

  // 🔴 校验必须走 api/bots 导出的那一份：规则是「3-32 位 [A-Za-z0-9_] **且以 bot 结尾**」，
  // 本页原先自己抄了半条正则（漏掉 bot 后缀）⇒ 输 'weather' 也让创建按钮亮着，
  // 点下去必被后端 400。桌面 CreateBotDialog 用的就是这个函数，两端只能有一份真值源。
  const usernameValid = isValidBotUsername(username);
  const canCreate = usernameValid && nickname.trim() !== '' && operatingId !== '__creating__';
  const canAdd = addUsername.trim() !== '' && operatingId !== '__adding__';
  const confirmLabel = confirm?.kind === 'reset' ? '确认重置' : '确认删除';

  // 隐私设置派生值
  const privacySaving = privacyBot !== null && operatingId === privacyBot.bot_user_id;
  const parsedWhitelist = parseWhitelist(whitelistText);
  const whitelistTooLong = parsedWhitelist.length > WHITELIST_MAX;
  const privacyChanges: UpdateBotRequest = privacyBot
    ? buildPrivacyChanges(privacyBot, policy, parsedWhitelist, discoverable)
    : {};
  const canSavePrivacy =
    privacyBot !== null &&
    Object.keys(privacyChanges).length > 0 &&
    !(policy === 'whitelist' && whitelistTooLong) &&
    !privacySaving;

  const resetCreateForm = useCallback(() => {
    setUsername('');
    setNickname('');
    setDescription('');
  }, []);

  const handleCreate = useCallback(async () => {
    const data: CreateBotRequest = {
      username: username.trim(),
      nickname: nickname.trim(),
      description: description.trim() || undefined,
    };
    const result = await create(data);
    if (result) {
      setShowCreate(false);
      resetCreateForm();
      setTokenDisplay({
        title: '机器人创建成功',
        fields: [
          { label: 'Bot ID', value: result.bot_user_id },
          { label: '用户名', value: result.username },
          { label: 'Token', value: result.token },
        ],
      });
    }
  }, [create, username, nickname, description, resetCreateForm]);

  const handleAdd = useCallback(async () => {
    const result = await addByUsername(addUsername.trim());
    if (result) {
      setAddSuccess(`已添加 @${result.username} 为好友`);
      onBotAdded?.();
    }
  }, [addByUsername, addUsername, onBotAdded]);

  const openPrivacy = useCallback((bot: BotInfo) => {
    // 后端契约保证 message_policy 仅为三个枚举值之一（见 BotInfo 注释）
    setPolicy(bot.message_policy as MessagePolicy);
    setWhitelistText(bot.message_whitelist.join('\n'));
    setDiscoverable(bot.is_discoverable);
    setPrivacyBot(bot);
  }, []);

  const handleSavePrivacy = useCallback(async () => {
    if (!privacyBot) {
      return;
    }
    const data = buildPrivacyChanges(
      privacyBot,
      policy,
      parseWhitelist(whitelistText),
      discoverable,
    );
    const result = await update(privacyBot.bot_user_id, data);
    if (result) {
      setPrivacyBot(null);
    }
  }, [privacyBot, policy, whitelistText, discoverable, update]);

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

  return (
    <motion.div
      className="mobile-bots-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      {/* 顶部栏 */}
      <header className="mobile-bots-header">
        <button className="mobile-bots-back" onClick={onClose}>
          <BackIcon />
        </button>
        <h1 className="mobile-bots-title">机器人</h1>
        <div className="mobile-bots-placeholder" />
      </header>

      {/* 操作按钮行 */}
      <div className="mobile-bots-actions">
        <button
          className="mobile-bots-action-btn primary"
          onClick={() => setShowCreate(true)}
        >
          + 创建机器人
        </button>
        <button
          className="mobile-bots-action-btn"
          onClick={() => { setAddSuccess(null); setAddUsername(''); setShowAdd(true); }}
        >
          添加机器人
        </button>
      </div>

      {/* 内容区 */}
      <div className="mobile-bots-content">
        {loading && bots.length === 0 && (
          <div className="mobile-bots-loading">
            <LoadingSpinner />
            <span>加载中...</span>
          </div>
        )}

        {!loading && error && bots.length === 0 && (
          <div className="mobile-bots-error">
            <span className="mobile-bots-error-icon">&#x26A0;</span>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && bots.length === 0 && (
          <div className="mobile-bots-empty">
            <span className="mobile-bots-empty-icon">&#x1F916;</span>
            <span>暂无机器人，点击上方创建</span>
          </div>
        )}

        {bots.length > 0 && (
          <div className="mobile-bots-list">
            {bots.map((bot, index) => (
              <BotCard
                key={bot.bot_user_id}
                bot={bot}
                index={index}
                operating={operatingId === bot.bot_user_id}
                onPrivacy={() => openPrivacy(bot)}
                onResetToken={() => setConfirm({ kind: 'reset', bot })}
                onDelete={() => setConfirm({ kind: 'delete', bot })}
              />
            ))}
          </div>
        )}
      </div>

      {/* 创建弹窗 */}
      {showCreate && (
        <BotsDialogShell
          title="创建机器人"
          onClose={() => { setShowCreate(false); resetCreateForm(); }}
        >
          <label className="mobile-bots-field">
            <span>用户名 *</span>
            <input
              type="text"
              placeholder="3-32 位字母 / 数字 / 下划线，且以 bot 结尾"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
            />
          </label>
          <label className="mobile-bots-field">
            <span>昵称 *</span>
            <input
              type="text"
              placeholder="机器人显示昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={100}
            />
          </label>
          <label className="mobile-bots-field">
            <span>描述</span>
            <textarea
              placeholder="可选，简要描述机器人用途"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <p className="mobile-bots-hint">
            用户名需以 <code>bot</code> 结尾（如 <code>weatherbot</code>）。
            创建成功后 Token 仅明文展示一次；每人最多创建 10 个机器人。
          </p>
          {error && <p className="mobile-bots-dialog-error">{error}</p>}
          <div className="mobile-bots-dialog-footer">
            <button
              className="mobile-bots-action-btn"
              onClick={() => { setShowCreate(false); resetCreateForm(); }}
            >
              取消
            </button>
            <button
              className="mobile-bots-action-btn primary"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              {operatingId === '__creating__' ? '创建中...' : '创建'}
            </button>
          </div>
        </BotsDialogShell>
      )}

      {/* 添加 bot 好友弹窗 */}
      {showAdd && (
        <BotsDialogShell
          title="添加机器人"
          onClose={() => { setShowAdd(false); setAddSuccess(null); }}
        >
          <label className="mobile-bots-field">
            <span>机器人用户名 *</span>
            <input
              type="text"
              placeholder="输入 bot 的 username（不含 @）"
              value={addUsername}
              onChange={(e) => setAddUsername(e.target.value)}
              maxLength={32}
            />
          </label>
          <p className="mobile-bots-hint">机器人好友无需对方确认，添加成功即可开始对话。</p>
          {addSuccess && <p className="mobile-bots-add-success">{addSuccess}</p>}
          {error && <p className="mobile-bots-dialog-error">{error}</p>}
          <div className="mobile-bots-dialog-footer">
            <button
              className="mobile-bots-action-btn"
              onClick={() => { setShowAdd(false); setAddSuccess(null); }}
            >
              {addSuccess ? '关闭' : '取消'}
            </button>
            <button
              className="mobile-bots-action-btn primary"
              onClick={handleAdd}
              disabled={!canAdd}
            >
              {operatingId === '__adding__' ? '添加中...' : '添加'}
            </button>
          </div>
        </BotsDialogShell>
      )}

      {/* 隐私设置弹窗（照创建表单的底部弹窗模式，静态渲染） */}
      {privacyBot && (
        <BotsDialogShell title="隐私设置" onClose={() => setPrivacyBot(null)}>
          <div className="mobile-bots-field">
            <span>谁可以发消息</span>
            <div className="bots-radio-group">
              <label className="bots-radio-option">
                <input
                  type="radio"
                  name="mobile-bots-message-policy"
                  value="everyone"
                  checked={policy === 'everyone'}
                  onChange={() => setPolicy('everyone')}
                />
                所有人
              </label>
              <label className="bots-radio-option">
                <input
                  type="radio"
                  name="mobile-bots-message-policy"
                  value="whitelist"
                  checked={policy === 'whitelist'}
                  onChange={() => setPolicy('whitelist')}
                />
                白名单
              </label>
              <label className="bots-radio-option">
                <input
                  type="radio"
                  name="mobile-bots-message-policy"
                  value="owner_only"
                  checked={policy === 'owner_only'}
                  onChange={() => setPolicy('owner_only')}
                />
                仅自己
              </label>
            </div>
          </div>
          {policy === 'whitelist' && (
            <label className="mobile-bots-field">
              <span>白名单用户 ID（每行一个，最多 {WHITELIST_MAX} 条）</span>
              <textarea
                placeholder="每行一个用户 ID"
                value={whitelistText}
                onChange={(e) => setWhitelistText(e.target.value)}
                rows={5}
              />
            </label>
          )}
          {policy === 'whitelist' && whitelistTooLong && (
            <p className="mobile-bots-dialog-error">
              白名单最多 {WHITELIST_MAX} 条，当前 {parsedWhitelist.length} 条
            </p>
          )}
          <label className="bots-radio-option">
            <input
              type="checkbox"
              checked={discoverable}
              onChange={(e) => setDiscoverable(e.target.checked)}
            />
            允许被搜索添加
          </label>
          <p className="mobile-bots-hint">
            关闭后其他人按用户名搜索添加将返回不存在（你自己恒可添加）。
          </p>
          {error && <p className="mobile-bots-dialog-error">{error}</p>}
          <div className="mobile-bots-dialog-footer">
            <button className="mobile-bots-action-btn" onClick={() => setPrivacyBot(null)}>
              取消
            </button>
            <button
              className="mobile-bots-action-btn primary"
              onClick={handleSavePrivacy}
              disabled={!canSavePrivacy}
            >
              {privacySaving ? '保存中...' : '保存'}
            </button>
          </div>
        </BotsDialogShell>
      )}

      {/* 危险操作确认弹窗 */}
      {confirm && (
        <BotsDialogShell
          title={confirm.kind === 'reset' ? '重置 Token' : '删除机器人'}
          onClose={() => setConfirm(null)}
        >
          <p className="mobile-bots-hint">
            {confirm.kind === 'reset'
              ? `确定要重置 @${confirm.bot.username} 的 Token 吗？旧 Token 将即刻失效，新 Token 仅明文展示一次。`
              : `确定要删除 @${confirm.bot.username} 吗？机器人将被删除且 Token 即刻失效，此操作不可恢复。`}
          </p>
          <div className="mobile-bots-dialog-footer">
            <button className="mobile-bots-action-btn" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className={`mobile-bots-action-btn ${confirm.kind === 'reset' ? 'primary' : 'danger'}`}
              onClick={handleConfirmAction}
              disabled={operatingId === confirm.bot.bot_user_id}
            >
              {operatingId === confirm.bot.bot_user_id ? '处理中...' : confirmLabel}
            </button>
          </div>
        </BotsDialogShell>
      )}

      {/* token 一次性展示（关闭即清空）：portal 到 body + fixed z-10001，与桌面端一致，避免被页面/弹层遮挡 */}
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
    </motion.div>
  );
}
