/**
 * 移动端「添加」页（req-24：对齐桌面 AddMenu 语义）
 *
 * 顶部搜索框统一承接「查找并添加」（用户/群/bot 三段完全匹配发现搜索，在 MobileChatList 内，
 * 点结果进详情弹窗 OtherProfilePanel / GroupDetailView 完成加好友/加 bot/加群）。
 * 本页（"+"入口）只承接三件事，与桌面 AddMenu 一致：
 *   - 创建群聊（群名 + 简介）
 *   - 创建机器人（复用 CreateBotDialog + useBots；成功后 SecretDisplay 一次性展示 token）
 *   - 待通过申请（收到的 + 我发出的合并成单一时间倒序列表，复用 usePendingRequests）
 *
 * 旧流程（按 ID 加好友预览 / 一级分段好友·群聊 / 二级子标签 / 邀请码加群 / 旧待通过分区）已删除。
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../../contexts/SessionContext';
import { useWebSocket } from '../../contexts/WebSocketContext';
import { createGroup } from '../../api/groups';
import { CreateBotDialog } from '../../components/bots/CreateBotDialog';
import { SecretDisplay, type SecretField } from '../../components/common/SecretDisplay';
import { useBots } from '../../hooks/useBots';
import { usePendingRequests } from '../../hooks/usePendingRequests';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import type { PendingItem } from '../../components/unified/pendingRequests';
import type { PendingRequest } from '../../api/friends';
import type { GroupInvitation } from '../../api/groups';
import type { CreateBotRequest } from '../../api/bots';
import type { Group } from '../../types/chat';

const BackIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="24" height="24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
  </svg>
);

const ChevronIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
);

const GroupIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={24} height={24}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
  </svg>
);

const BotIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={24} height={24}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V3m0 3a3 3 0 00-3 3v.75m3-3.75a3 3 0 013 3v.75M6.75 9.75h10.5a1.5 1.5 0 011.5 1.5v6a1.5 1.5 0 01-1.5 1.5H6.75a1.5 1.5 0 01-1.5-1.5v-6a1.5 1.5 0 011.5-1.5zM9 13.5h.008v.008H9V13.5zm6 0h.008v.008H15V13.5z" />
  </svg>
);

const BellIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={24} height={24}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={18} height={18}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const TOKEN_WARNING = 'Token 仅此一次明文展示，请立即妥善保存；关闭后无法再次查看，只能重置。';

type View = 'menu' | 'create-group' | 'pending';

interface MobileAddPageProps {
  onClose: () => void;
  onFriendAdded?: () => void;
  addGroup?: (group: Group) => void;
  /** "+"红点：待处理申请/邀请总数（待通过菜单项右侧角标） */
  pendingNotificationCount?: number;
}

const pageVariants = {
  initial: { x: '100%', opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
  exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
};

const contentVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.2 } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

/** 创建机器人面板：useBots 仅在此挂载（避免开页即 GET /api/bots）；成功回传 token 展示态给父级 */
function CreateBotPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: { title: string; fields: SecretField[] }) => void;
}) {
  const { create, operatingId, error } = useBots();

  const handleCreate = useCallback(
    async (data: CreateBotRequest) => {
      const res = await create(data);
      if (res) {
        onCreated({
          title: '机器人创建成功',
          fields: [
            { label: 'Bot ID', value: res.bot_user_id },
            { label: '用户名', value: res.username },
            { label: 'Token', value: res.token },
          ],
        });
      }
    },
    [create, onCreated],
  );

  return (
    <CreateBotDialog
      onClose={onClose}
      onCreate={handleCreate}
      creating={operatingId === '__creating__'}
      error={error}
    />
  );
}

/**
 * 待通过合并列表视图（仅在 view==='pending' 时挂载 → usePendingRequests 此时才加载）。
 * 移动端原生行样式（.mobile-add-item），复用 usePendingRequests 的加载/合并/动作逻辑。
 */
function PendingListView({
  onFriendAdded,
  addGroup,
}: {
  onFriendAdded?: () => void;
  addGroup?: (group: Group) => void;
}) {
  const { items, loading, error, approveFriend, rejectFriend, acceptInvite, declineInvite } =
    usePendingRequests({ onFriendAdded, addGroup });

  const renderActions = (item: PendingItem) => {
    switch (item.kind) {
      case 'received-friend': {
        const r = item.raw as PendingRequest;
        return (
          <div className="mobile-add-item-actions">
            <motion.button className="mobile-add-action-btn accept" onClick={() => approveFriend(r)} whileTap={{ scale: 0.9 }} aria-label="同意">
              <CheckIcon />
            </motion.button>
            <motion.button className="mobile-add-action-btn reject" onClick={() => rejectFriend(r)} whileTap={{ scale: 0.9 }} aria-label="拒绝">
              <XIcon />
            </motion.button>
          </div>
        );
      }
      case 'received-group': {
        const inv = item.raw as GroupInvitation;
        return (
          <div className="mobile-add-item-actions">
            <motion.button className="mobile-add-action-btn accept" onClick={() => acceptInvite(inv)} whileTap={{ scale: 0.9 }} aria-label="接受">
              <CheckIcon />
            </motion.button>
            <motion.button className="mobile-add-action-btn reject" onClick={() => declineInvite(inv)} whileTap={{ scale: 0.9 }} aria-label="拒绝">
              <XIcon />
            </motion.button>
          </div>
        );
      }
      default:
        return <span className="mobile-add-sent-tag">待通过</span>;
    }
  };

  if (loading) {
    return <div className="mobile-add-loading">加载中...</div>;
  }
  if (items.length === 0) {
    return (
      <div className="mobile-add-empty">
        <BellIcon />
        <p>没有待通过的申请</p>
      </div>
    );
  }
  return (
    <div className="mobile-add-list">
      {items.map((item) => {
        const avatar = resolveServerAvatarUrl(item.avatarPath);
        return (
          <div className="mobile-add-item" key={item.key}>
            <div className="mobile-add-item-avatar">
              {avatar ? <img src={avatar} alt={item.name} /> : <AvatarPlaceholder name={item.name} fontSize={18} />}
            </div>
            <div className="mobile-add-item-info">
              <div className="mobile-add-item-name">{item.name}</div>
              <div className="mobile-add-item-reason">{item.label}</div>
              {item.message && <div className="mobile-add-item-reason">{item.message}</div>}
            </div>
            {renderActions(item)}
          </div>
        );
      })}
      {error && <div className="mobile-add-toast error">{error}</div>}
    </div>
  );
}

export function MobileAddPage({
  onClose,
  onFriendAdded,
  addGroup,
  pendingNotificationCount = 0,
}: MobileAddPageProps) {
  const api = useApi();
  const { clearPendingNotification } = useWebSocket();

  const [view, setView] = useState<View>('menu');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 创建群聊
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  // 创建机器人（token 一次性展示态；useBots 仅在 CreateBotPanel 挂载时运行，避免开页即 GET /api/bots）
  const [showBotDialog, setShowBotDialog] = useState(false);
  const [tokenDisplay, setTokenDisplay] = useState<{ title: string; fields: SecretField[] } | null>(null);

  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null);
        setSuccess(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [error, success]);

  const openPending = useCallback(() => {
    setView('pending');
    // 打开待通过即清对应通知红点（保持既有移动端行为）
    clearPendingNotification('friendRequests');
    clearPendingNotification('groupInvites');
    clearPendingNotification('groupJoinRequests');
  }, [clearPendingNotification]);

  const handleBack = () => {
    if (view === 'menu') {
      onClose();
    } else {
      setView('menu');
    }
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      setError('请输入群名称');
      return;
    }
    setCreatingGroup(true);
    setError(null);
    try {
      const result = await createGroup(api, {
        group_name: groupName.trim(),
        group_description: groupDesc.trim() || undefined,
      });
      setSuccess('群聊创建成功');
      setGroupName('');
      setGroupDesc('');
      addGroup?.({
        group_id: result.group_id,
        group_name: result.group_name,
        group_avatar_url: '',
        role: 'owner',
        unread_count: 0,
        last_message_content: null,
        last_message_time: null,
      });
      setView('menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreatingGroup(false);
    }
  };

  const TITLES: Record<View, string> = {
    menu: '添加',
    'create-group': '创建群聊',
    pending: '待通过申请',
  };
  const title = TITLES[view];

  const badgeText = pendingNotificationCount > 99 ? '99+' : String(pendingNotificationCount);

  const renderMenu = () => (
    <motion.div key="menu" variants={contentVariants} initial="initial" animate="animate" exit="exit">
      <div className="mobile-add-menu">
        <button className="mobile-add-menu-item" onClick={() => setView('create-group')}>
          <span className="mobile-add-menu-icon"><GroupIcon /></span>
          <span className="mobile-add-menu-label">创建群聊</span>
          <span className="mobile-add-menu-chevron"><ChevronIcon /></span>
        </button>
        <button className="mobile-add-menu-item" onClick={() => setShowBotDialog(true)}>
          <span className="mobile-add-menu-icon"><BotIcon /></span>
          <span className="mobile-add-menu-label">创建机器人</span>
          <span className="mobile-add-menu-chevron"><ChevronIcon /></span>
        </button>
        <button className="mobile-add-menu-item" onClick={openPending}>
          <span className="mobile-add-menu-icon"><BellIcon /></span>
          <span className="mobile-add-menu-label">待通过申请</span>
          {pendingNotificationCount > 0 && <span className="mobile-add-menu-badge">{badgeText}</span>}
          <span className="mobile-add-menu-chevron"><ChevronIcon /></span>
        </button>
      </div>
    </motion.div>
  );

  const renderCreateGroup = () => (
    <motion.div key="create-group" variants={contentVariants} initial="initial" animate="animate" exit="exit" className="mobile-add-form-card">
      <div className="mobile-add-form-group">
        <label className="mobile-add-label">群名称</label>
        <input
          type="text"
          className="mobile-add-input"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="输入群名称"
          maxLength={50}
        />
      </div>
      <div className="mobile-add-form-group">
        <label className="mobile-add-label">群简介（可选）</label>
        <textarea
          className="mobile-add-input mobile-add-textarea"
          value={groupDesc}
          onChange={(e) => setGroupDesc(e.target.value)}
          placeholder="介绍一下这个群..."
          maxLength={200}
          rows={3}
        />
      </div>
      <button className="mobile-add-submit" onClick={handleCreateGroup} disabled={creatingGroup || !groupName.trim()}>
        {creatingGroup ? '创建中...' : '创建群聊'}
      </button>
    </motion.div>
  );

  const renderPending = () => (
    <motion.div key="pending" variants={contentVariants} initial="initial" animate="animate" exit="exit">
      <PendingListView onFriendAdded={onFriendAdded} addGroup={addGroup} />
    </motion.div>
  );

  const renderContent = () => {
    if (view === 'create-group') {
      return renderCreateGroup();
    }
    if (view === 'pending') {
      return renderPending();
    }
    return renderMenu();
  };

  return (
    <motion.div className="mobile-add-page" variants={pageVariants} initial="initial" animate="animate" exit="exit">
      {/* 顶部栏 */}
      <header className="mobile-add-header">
        <button className="mobile-add-back" onClick={handleBack}>
          <BackIcon />
        </button>
        <h1 className="mobile-add-title">{title}</h1>
        <div className="mobile-add-placeholder" />
      </header>

      {/* 内容区域 */}
      <div className="mobile-add-content">
        <AnimatePresence mode="wait">{renderContent()}</AnimatePresence>

        {/* 页级错误/成功提示（创建群聊等） */}
        <AnimatePresence>
          {error && view !== 'pending' && (
            <motion.div className="mobile-add-toast error" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              {error}
            </motion.div>
          )}
          {success && (
            <motion.div className="mobile-add-toast success" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              {success}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 创建机器人：CreateBotPanel 内挂 useBots（仅此时 GET /api/bots），成功回传 token 展示态 */}
      {showBotDialog && (
        <CreateBotPanel
          onClose={() => setShowBotDialog(false)}
          onCreated={(t) => {
            setShowBotDialog(false);
            setTokenDisplay(t);
          }}
        />
      )}

      {/* token 一次性展示（关闭即清空，不落盘） */}
      {tokenDisplay && (
        <SecretDisplay
          title={tokenDisplay.title}
          warningText={TOKEN_WARNING}
          fields={tokenDisplay.fields}
          onClose={() => setTokenDisplay(null)}
        />
      )}
    </motion.div>
  );
}
