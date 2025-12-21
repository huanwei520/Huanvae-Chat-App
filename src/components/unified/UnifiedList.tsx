/**
 * 统一列表组件
 *
 * 合并 ConversationList、FriendList、GroupList 为单一组件
 * 通过 activeTab 切换显示不同的数据，实现单卡片级别的动画效果
 *
 * 优点：
 * - 只有一个 AnimatePresence，切换 tab 时旧卡片飞出、新卡片飞入
 * - 相同 key 的卡片在切换时保持不动（如好友卡片在"消息"和"好友"tab 间切换）
 * - 代码结构更简单，无嵌套 AnimatePresence 问题
 */

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FriendAvatar, GroupAvatar } from '../common/Avatar';
import { SearchBox } from '../common/SearchBox';
import { ListLoading, ListError, ListEmpty } from '../common/ListStates';
import { formatMessageTime } from '../../utils/time';
import { cardVariants } from '../../constants/listAnimations';
import type { NavTab } from '../sidebar/Sidebar';
import type { Friend, Group, ChatTarget } from '../../types/chat';
import type { UnreadSummary } from '../../types/websocket';

// ============================================
// 类型定义
// ============================================

/** 统一卡片数据结构 */
interface UnifiedCard {
  /** 唯一标识，格式：`${type}-${id}` */
  uniqueKey: string;
  /** 原始 ID */
  id: string;
  /** 类型：好友或群聊 */
  type: 'friend' | 'group';
  /** 显示名称 */
  name: string;
  /** 头像 URL */
  avatarUrl: string | null;
  /** 最后一条消息预览 */
  lastMessage: string | null;
  /** 最后消息时间 */
  lastMessageTime: string | null;
  /** 未读消息数 */
  unreadCount: number;
  /** 原始数据对象 */
  data: Friend | Group;
  /** 群聊角色（仅群聊有效） */
  role?: 'owner' | 'admin' | 'member';
}

interface UnifiedListProps {
  /** 当前激活的 tab */
  activeTab: NavTab;
  /** 好友列表 */
  friends: Friend[];
  /** 群聊列表 */
  groups: Group[];
  /** 好友加载中 */
  friendsLoading: boolean;
  /** 群聊加载中 */
  groupsLoading: boolean;
  /** 好友加载错误 */
  friendsError: string | null;
  /** 群聊加载错误 */
  groupsError: string | null;
  /** 搜索关键词 */
  searchQuery: string;
  /** 搜索关键词变化回调 */
  onSearchChange: (query: string) => void;
  /** 当前选中的聊天目标 */
  selectedTarget: ChatTarget | null;
  /** 选中目标回调 */
  onSelectTarget: (target: ChatTarget) => void;
  /** 未读消息摘要 */
  unreadSummary: UnreadSummary | null;
  /** 面板宽度 */
  panelWidth?: number;
}

// ============================================
// 辅助函数
// ============================================

/** 格式化未读数（避免嵌套三元表达式） */
function formatUnreadCount(count: number): string {
  if (count <= 0) { return ''; }
  if (count > 99) { return '99+'; }
  return String(count);
}

/** 角色标签配置 */
const ROLE_CONFIG = {
  owner: { text: '群主', bg: 'rgba(234, 179, 8, 0.2)', color: '#ca8a04' },
  admin: { text: '管理', bg: 'rgba(59, 130, 246, 0.2)', color: '#2563eb' },
} as const;

/** 角色标签动画变体 */
const roleBadgeVariants = {
  initial: { opacity: 0, scale: 0.6 },
  animate: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 400, damping: 20 },
  },
  exit: {
    opacity: 0,
    scale: 0.6,
    transition: { duration: 0.15 },
  },
};

/**
 * 角色标签组件
 * 带有淡入淡出+弹性缩放动画，当身份变化时平滑过渡
 * 使用 initial={false} 避免首次渲染时播放动画
 */
function RoleBadge({ role }: { role?: 'owner' | 'admin' | 'member' }) {
  const config = role && role !== 'member' ? ROLE_CONFIG[role] : null;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {config && (
        <motion.span
          key={role}
          className="role-badge"
          variants={roleBadgeVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          style={{
            fontSize: '10px',
            padding: '1px 4px',
            borderRadius: '3px',
            background: config.bg,
            color: config.color,
            marginLeft: '4px',
            display: 'inline-block',
          }}
        >
          {config.text}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

// ============================================
// 主组件
// ============================================

export function UnifiedList({
  activeTab,
  friends,
  groups,
  friendsLoading,
  groupsLoading,
  friendsError,
  groupsError,
  searchQuery,
  onSearchChange,
  selectedTarget,
  onSelectTarget,
  unreadSummary,
  panelWidth = 280,
}: UnifiedListProps) {

  // 构建好友卡片列表
  const friendCards = useMemo((): UnifiedCard[] => {
    return (friends || []).map((friend) => {
      const unread = unreadSummary?.friend_unreads.find(
        u => u.friend_id === friend.friend_id,
      );
      return {
        uniqueKey: `friend-${friend.friend_id}`,
        id: friend.friend_id,
        type: 'friend',
        name: friend.friend_nickname,
        avatarUrl: friend.friend_avatar_url,
        lastMessage: unread?.last_message_preview || null,
        lastMessageTime: unread?.last_message_time || friend.add_time,
        unreadCount: unread?.unread_count || 0,
        data: friend,
      };
    });
  }, [friends, unreadSummary]);

  // 构建群聊卡片列表
  const groupCards = useMemo((): UnifiedCard[] => {
    return (groups || []).map((group) => {
      const unread = unreadSummary?.group_unreads.find(
        u => u.group_id === group.group_id,
      );
      return {
        uniqueKey: `group-${group.group_id}`,
        id: group.group_id,
        type: 'group',
        name: group.group_name,
        avatarUrl: group.group_avatar_url,
        lastMessage: unread?.last_message_preview ?? group.last_message_content,
        lastMessageTime: unread?.last_message_time ?? group.last_message_time,
        unreadCount: unread !== undefined ? unread.unread_count : (group.unread_count ?? 0),
        data: group,
        role: group.role,
      };
    });
  }, [groups, unreadSummary]);

  // 根据 activeTab 合并并排序卡片
  const cards = useMemo((): UnifiedCard[] => {
    let result: UnifiedCard[];

    switch (activeTab) {
      case 'chat':
        // 消息页：混合好友和群聊，按未读和时间排序
        result = [...friendCards, ...groupCards];
        result.sort((a, b) => {
          // 有未读的排前面
          if (a.unreadCount > 0 && b.unreadCount === 0) { return -1; }
          if (a.unreadCount === 0 && b.unreadCount > 0) { return 1; }
          // 按最后消息时间排序
          const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
          const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
          return timeB - timeA;
        });
        break;

      case 'friends':
        // 好友页：仅好友，按添加时间排序
        result = [...friendCards];
        result.sort((a, b) => {
          const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
          const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
          return timeB - timeA;
        });
        break;

      case 'group':
        // 群聊页：仅群聊，按最后消息时间排序
        result = [...groupCards];
        result.sort((a, b) => {
          const timeA = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0;
          const timeB = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0;
          return timeB - timeA;
        });
        break;

      default:
        result = [];
    }

    return result;
  }, [activeTab, friendCards, groupCards]);

  // 搜索过滤
  const filteredCards = useMemo(() => {
    if (!searchQuery) { return cards; }
    const query = searchQuery.toLowerCase();
    return cards.filter(
      card => card.name.toLowerCase().includes(query) ||
              card.id.toLowerCase().includes(query),
    );
  }, [cards, searchQuery]);

  // 状态计算
  const loading = friendsLoading || groupsLoading;
  const error = friendsError || groupsError;

  // 判断卡片是否被选中
  const isSelected = (card: UnifiedCard): boolean => {
    if (!selectedTarget) { return false; }
    if (selectedTarget.type === 'friend' && card.type === 'friend') {
      return selectedTarget.data.friend_id === card.id;
    }
    if (selectedTarget.type === 'group' && card.type === 'group') {
      return selectedTarget.data.group_id === card.id;
    }
    return false;
  };

  // 处理卡片点击
  const handleCardClick = (card: UnifiedCard) => {
    if (card.type === 'friend') {
      onSelectTarget({ type: 'friend', data: card.data as Friend });
    } else {
      onSelectTarget({ type: 'group', data: card.data as Group });
    }
  };

  // 获取搜索框占位符
  const getPlaceholder = (): string => {
    switch (activeTab) {
      case 'chat': return '搜索会话';
      case 'friends': return '搜索好友';
      case 'group': return '搜索群聊';
      default: return '搜索';
    }
  };

  // 获取空状态提示
  const getEmptyMessage = (): string => {
    if (searchQuery) {
      return '未找到匹配的结果';
    }
    switch (activeTab) {
      case 'chat': return '暂无会话';
      case 'friends': return '暂无好友';
      case 'group': return '暂无群聊';
      default: return '暂无数据';
    }
  };

  // 渲染卡片内容
  const renderCardContent = (card: UnifiedCard) => {
    const isChatTab = activeTab === 'chat';
    const isGroupTab = activeTab === 'group';

    return (
      <>
        <div className="conv-avatar">
          {card.type === 'friend' ? (
            <FriendAvatar friend={card.data as Friend} />
          ) : (
            <GroupAvatar group={card.data as Group} />
          )}
        </div>
        <div className="conv-info">
          <div className="conv-header">
            <span className="conv-name">
              {/* 消息页显示 [群聊] 标记 */}
              {isChatTab && card.type === 'group' && (
                <span className="conv-tag">[群聊]</span>
              )}
              {card.name}
              {/* 群聊页显示角色标签 */}
              {isGroupTab && card.type === 'group' && (
                <RoleBadge role={card.role} />
              )}
            </span>
            {card.lastMessageTime && (
              <span className="conv-time">
                {formatMessageTime(card.lastMessageTime)}
              </span>
            )}
          </div>
          <div className="conv-footer">
            <span className="conv-preview">
              {/* 好友页显示 ID，其他显示最后消息 */}
              {activeTab === 'friends' && card.type === 'friend'
                ? `@${card.id}`
                : card.lastMessage || '暂无消息'
              }
            </span>
            {/* 未读红点：始终渲染，通过 CSS 控制显示，避免 layout 动画抖动 */}
            <span className={`conv-unread ${card.unreadCount > 0 ? 'visible' : 'hidden'}`}>
              {formatUnreadCount(card.unreadCount)}
            </span>
          </div>
        </div>
      </>
    );
  };

  // 渲染卡片列表（不包含 loading/error/empty 状态）
  const renderCards = () => {
    if (loading || error || filteredCards.length === 0) {
      return null;
    }
    return filteredCards.map((card) => (
      <motion.div
        key={card.uniqueKey}
        className={`conversation-item ${isSelected(card) ? 'active' : ''}`}
        onClick={() => handleCardClick(card)}
        variants={cardVariants}
        initial="initial"
        animate="animate"
        exit="exit"
        layout
      >
        {renderCardContent(card)}
      </motion.div>
    ));
  };

  // 渲染状态覆盖层（loading/error/empty 使用绝对定位，不影响卡片布局）
  const renderOverlay = () => {
    if (loading) {
      return (
        <motion.div
          key="loading-overlay"
          className="list-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <ListLoading />
        </motion.div>
      );
    }
    if (error) {
      return (
        <motion.div
          key="error-overlay"
          className="list-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <ListError error={error} />
        </motion.div>
      );
    }
    if (filteredCards.length === 0) {
      return (
        <motion.div
          key="empty-overlay"
          className="list-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <ListEmpty message={getEmptyMessage()} />
        </motion.div>
      );
    }
    return null;
  };

  return (
    <section className="chat-list-panel">
      <div className="chat-list-header">
        <SearchBox
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          panelWidth={panelWidth}
          placeholder={getPlaceholder()}
        />
      </div>

      <div className="conversation-list">
        {/* 状态覆盖层：绝对定位，不影响卡片布局 */}
        <AnimatePresence>
          {renderOverlay()}
        </AnimatePresence>

        {/* 卡片列表：正常文档流 */}
        <AnimatePresence mode="popLayout">
          {renderCards()}
        </AnimatePresence>
      </div>
    </section>
  );
}
