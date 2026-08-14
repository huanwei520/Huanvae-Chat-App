/**
 * 群消息气泡组件
 *
 * @module chat/group
 * @location src/chat/group/GroupMessageBubble.tsx
 *
 * 功能：
 * - 类似 Telegram 的入场动画（从侧边滑入 + 从下往上 + 淡入）
 * - 退出动画（反方向滑出）
 * - 右键菜单（桌面端右键/移动端长按触发：复制、撤回、删除、多选）
 * - 多选模式选中效果
 * - 点击头像显示用户信息弹出框
 * - 移动端双击全屏预览（仅文本消息）
 * - 文本消息使用 MarkdownRenderer 渲染（支持 GFM、代码高亮）
 *
 * 动画机制：
 * - 自己的消息：从右往左、从下往上滑入
 * - 对方的消息：从左往右、从下往上滑入
 * - 撤回/删除：反方向播放退出动画
 * - 使用 layout="position" 处理位置变化（发送完成后自动平滑移动）
 *
 * ## 连发合并（huanwei 2026-08-14 拍板；昵称一条当日按 telegram 参照图订正）
 *
 * 同一个人**连续**发的若干条算一「组」：
 * - 头像**只挂该组最新那条**（视觉最下面那条），组内其余各条渲染一个**同尺寸的占位孔**
 *   （`.bubble-avatar--hole`）保持气泡左缘对齐；
 * - 昵称**只显示在该组最旧那条**（视觉最上面那条），一人连发 3 条只出现 1 次昵称。
 *
 * 名字在组的顶、头像在组的底 —— 这正是参照图里 telegram 的形态。
 * 断组的唯一条件是中间出现了别人的消息 —— **没有时间窗**。
 * 两个锚点都由列表层各 O(n) 算一次后经 `showAvatar` / `showName` 下发，见
 * `chat/shared/senderRunGate.ts` 与 `chat/group/GroupChatMessages.tsx`。
 *
 * ⚠️ 本文件原先写的是「组内一个昵称都不显示」（内部编号里的方案 C）。总管 2026-08-14 裁决：
 * huanwei 亲手发来的 telegram 参照图里昵称是**显示**的，且「群聊保留头像」的理由链
 * （要能认人）对昵称同样成立 ⇒ 内部编号与他给的实图冲突时**以实图为准**，该句作废。
 *
 * 🔴 `showAvatar` / `showName` 默认值都必须是 `true`：单条消息自成一组，
 * 它既是组内最新（该挂头像）也是组内最旧（该显示昵称）；
 * 而既有测试（GroupMessageBubbleAvatarClick）只渲染单条并断言 `.bubble-avatar` 存在。
 *
 * 🔴 昵称只画在**别人**的消息上（`!isOwn`）：右侧那串蓝气泡就是自己发的，
 * 再标一遍自己的名字是纯噪音，参照图里的 telegram 也不标。
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatMessageTime } from '../../utils/time';
import { MessageContextMenu } from '../shared/MessageContextMenu';
import { FileMessageContent } from '../shared/FileMessageContent';
import { MeetingInviteCard } from '../shared/MeetingInviteCard';
import { CardRenderer } from '../shared/CardRenderer';
import { MarkdownRenderer } from '../../components/common/MarkdownRenderer';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { MobileMessageFullPreview } from '../shared/MobileMessageFullPreview';
import { useFileCache } from '../../hooks/useFileCache';
import { useKbdFocusRing } from '../../hooks/useKbdFocusRing';
import { useChatStore, useProfileViewStore } from '../../stores';
import { useApi } from '../../contexts/SessionContext';
import {
  addGroupMessageBlock,
  removeGroupMessageBlock,
  addGroupSpecialCare,
  removeGroupSpecialCare,
  setGroupMemberRemark as apiSetGroupMemberRemark,
  removeGroupMemberRemark as apiRemoveGroupMemberRemark,
} from '../../api/groups';
import { isMobile } from '../../utils/platform';
import { groupMemberDisplayName } from '../../utils/groupRemark';
import { friendChatTarget } from '../../utils/chatTarget';
import { GroupRemarkInputModal } from './GroupRemarkInputModal';
import { ReplyQuote } from '../shared/ReplyQuote';
import { senderNameColorIndex } from '../shared/senderNameColor';
import { AlbumMessage, type AlbumMediaItem } from '../shared/AlbumMessage';
import { MediaBubbleFrame, isCaptionableMediaType } from '../shared/MediaBubbleFrame';
import type { AlbumNode } from '../shared/mediaGroup';
import { saveToGallery } from '../../utils/saveToGallery';
import type { GroupMessage } from '../../api/groupMessages';
import type { ResolvedReplyQuote } from '../shared/replyPreview';
import type { GroupReader } from './useGroupReadReceipt';

interface GroupMessageBubbleProps {
  message: GroupMessage;
  isOwn: boolean;
  /** 是否处于多选模式 */
  isMultiSelectMode?: boolean;
  /** 是否被选中 */
  isSelected?: boolean;
  /** 选中/取消选中回调 */
  onToggleSelect?: () => void;
  /** 撤回消息回调 */
  onRecall?: () => void;
  /** 删除消息回调 */
  onDelete?: () => void;
  /** 进入多选模式回调 */
  onEnterMultiSelect?: () => void;
  /** 当前用户是否为管理员/群主（可撤回任意消息） */
  isAdmin?: boolean;
  /** 已读回执：仅**我发出的最新一条**已送达消息传入（文案 + 已读者名单）；更早的自己消息 /
   *  对方消息 / 发送中 / 失败 / 已撤回都不传（门控在 GroupChatMessages，见 shared/readReceiptGate）。
   *  不传或 text=null（无人已读 / 占位 seq / 单人群）⇒ 不渲染已读部分。 */
  readReceipt?: { text: string | null; readers: GroupReader[] };
  /** 点击已读回执展开已读名单 */
  onOpenReadList?: (readers: GroupReader[]) => void;
  /** 所在群 ID（D6 群内屏蔽：右键屏蔽/取消屏蔽该发送者时调用 API + 更新 store） */
  groupId?: string;
  /** 是否播放入场滑入动画：仅"挂载后新增"的实时新消息为 true（由列表用 shouldPlayEnter 判定）；
   *  切换/打开时已有的历史为 false → 不并拢，整体走面板渐变。 */
  playEnter?: boolean;
  /** 本条消息引用的原消息（reply_to 解析结果）；null = 不是回复，不渲染引用块 */
  replyQuote?: ResolvedReplyQuote | null;
  /** 点击引用块 → 定位到原消息（由列表接到 pendingScrollToMessageId 通路） */
  onQuoteClick?: (targetUuid: string) => void;
  /** 右键/长按菜单「回复」→ 把本条设为回复目标；不传则菜单不显示该项 */
  onReply?: (message: GroupMessage) => void;
  /** 定位命中后短暂高亮本条（CSS keyframes 脉冲） */
  isHighlighted?: boolean;
  /**
   * 相册（媒体组）：非空时气泡正文渲染整个相册网格，而不是本条自己的媒体。
   * 此时 `message` 是该组的**代表消息**（组内最小位次那条）。
   */
  album?: AlbumNode<AlbumMediaItem> | null;
  /**
   * 是否挂头像（方案 C）：`true` = 本条是「同一人连发那一组」里最新的一条；
   * `false` = 组内的更早一条 ⇒ 渲染同尺寸占位孔，保持气泡左缘对齐但不显示头像。
   *
   * 🔴 默认 `true`（不是必填、也不是默认 false）：单条自成一组本就该显示头像，
   * 只渲染单条的既有测试也依赖这条默认值。
   */
  showAvatar?: boolean;
  /**
   * 是否显示发送者昵称：`true` = 本条是「同一人连发那一组」里**最旧**的一条（视觉最上面）；
   * `false` = 组内更晚的一条 ⇒ 不重复显示昵称（一人连发 3 条只出现 1 次）。
   *
   * 只对**别人**的消息有效 —— 自己的消息无论本值如何都不显示昵称（见文件头注释）。
   *
   * 🔴 默认 `true`：单条自成一组，它就是该组最旧那条。
   */
  showName?: boolean;
  /**
   * 视觉上**紧挨在下面**的那条是否属于同一连发组（huanwei 2026-08-14 12:16：
   * 「相连的气泡中间间隙将其缩小」）。`true` ⇒ 行的下边距收窄，两条贴成一组。
   *
   * 由列表层用 `senderRunGate.runTightKeys` 一次算出（与头像锚点同源同序），
   * 气泡自己看不到邻居，不能也不该在这里推。
   *
   * 🔴 默认 `false`：单条自成一组，下面不是同伴 ⇒ 维持组间的常规间距。
   */
  tightBelow?: boolean;
}

// 使用统一的消息动画配置
import { getMessageVariants, messageTransition } from '../shared/animations';

// 重命名为 transition 以保持兼容
const transition = messageTransition;

/**
 * 检查消息是否可以撤回
 * - 自己发送的消息：2分钟内
 * - 管理员/群主：可撤回任意消息
 */
function canRecallMessage(message: GroupMessage, isOwn: boolean, isAdmin: boolean): boolean {
  if (message.is_recalled) { return false; }

  // 管理员可撤回任意消息
  if (isAdmin) { return true; }

  // 普通用户只能撤回自己的消息，且在2分钟内
  if (!isOwn) { return false; }

  const sendTime = new Date(message.send_time).getTime();
  const now = Date.now();
  const twoMinutes = 2 * 60 * 1000;

  return now - sendTime < twoMinutes;
}

// 群聊已读回执（仅自己消息，统一状态槽：时钟/红叹号/绿双勾+N人已读+头像堆叠）
import { GroupReadReceipt } from './GroupReadReceipt';

export function GroupMessageBubble({
  message,
  isOwn,
  isMultiSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onRecall,
  onDelete,
  onEnterMultiSelect,
  isAdmin = false,
  readReceipt,
  onOpenReadList,
  groupId,
  playEnter = false,
  replyQuote = null,
  onQuoteClick,
  onReply,
  isHighlighted = false,
  album,
  showAvatar = true,
  showName = true,
  tightBelow = false,
}: GroupMessageBubbleProps) {
  const api = useApi();
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    bubbleRect?: DOMRect | null;
  }>({
    isOpen: false,
    position: { x: 0, y: 0 },
    bubbleRect: null,
  });

  // 气泡元素 ref（用于移动端菜单定位）
  const bubbleRef = useRef<HTMLDivElement>(null);

  // 本地文件路径（用于"在文件夹中显示"功能）
  //
  // 通过 useFileCache 拿 localPath（订阅 store）而非自己 useState + 一次性 useEffect，
  // 是因为：右上角 LocalBadge 用 useFileCache 拿 isLocal 已经订阅了 store；如果这里
  // 用一次性 getCachedFilePath，下载完成后 store 更新但本地 state 不刷新 → 右键菜单
  // 的"在文件夹中显示"按钮取决于 localPath 是否非空 → 看不到（需切换会话才生效）。
  // 改用 useFileCache 后两者共用同一数据源，下载完成即时刷新。
  const isFileMessage =
    message.message_type !== 'text' &&
    message.message_type !== 'system' &&
    !!message.file_uuid;
  const fileCacheType = (() => {
    if (message.message_type === 'image') {
      return 'image';
    }
    if (message.message_type === 'video') {
      return 'video';
    }
    return 'document';
  })();
  const { localPath } = useFileCache({
    fileUuid: message.file_uuid ?? '',
    fileHash: message.file_hash,
    fileName: '',
    fileType: fileCacheType,
    urlType: 'group',
    autoCache: false,
    enabled: isFileMessage,
  });

  // 移动端全屏预览状态
  const [showFullPreview, setShowFullPreview] = useState(false);
  // 双击检测
  const lastTapTimeRef = useRef<number>(0);

  // 打开公开资料只读页（单击头像看资料）
  const openProfileView = useProfileViewStore((s) => s.open);
  // store 方法和好友列表（双击头像：好友进私聊）
  const setChatTarget = useChatStore((state) => state.setChatTarget);
  const friends = useChatStore((state) => state.friends);
  // 头像单击/双击区分计时器（单击=看资料，双击=进私聊）
  const avatarClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 头像键盘焦点环（单实例，常量 key；handlers 每 render 取一次）
  const avatarKbd = useKbdFocusRing();
  const avatarKbdHandlers = avatarKbd.handlersFor('avatar');

  useEffect(() => () => {
    if (avatarClickTimerRef.current) { clearTimeout(avatarClickTimerRef.current); }
  }, []);

  // 头像单击语义（鼠标单击计时器到期与键盘 Enter/Space 共用；键盘不走双击计时器）：
  // 多选切换选中，否则看资料
  const activateAvatar = useCallback(() => {
    if (isMultiSelectMode) {
      onToggleSelect?.();
      return;
    }
    openProfileView(message.sender_id);
  }, [isMultiSelectMode, onToggleSelect, openProfileView, message.sender_id]);

  // 单击成员头像 → 看公开资料；双击 → 进私聊（好友才有私聊，非好友/自己回退看资料）
  const handleAvatarClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 多选模式下，点击头像也触发选中（走共享单击语义，不进双击计时）
    if (isMultiSelectMode) {
      activateAvatar();
      return;
    }
    // 第二次点击落在计时窗口内 → 双击：进私聊
    if (avatarClickTimerRef.current) {
      clearTimeout(avatarClickTimerRef.current);
      avatarClickTimerRef.current = null;
      const friend = friends.find((f) => f.friend_id === message.sender_id);
      if (friend) {
        setChatTarget(friendChatTarget(friend));
      } else {
        openProfileView(message.sender_id);
      }
      return;
    }
    // 首次点击 → 延迟判定为单击：看资料（与键盘共用 activateAvatar）
    avatarClickTimerRef.current = setTimeout(() => {
      avatarClickTimerRef.current = null;
      activateAvatar();
    }, 250);
  }, [isMultiSelectMode, activateAvatar, message.sender_id, friends, setChatTarget, openProfileView]);

  // D6 群内屏蔽：该发送者是否已被我屏蔽（仅他人消息有意义）
  const isSenderBlocked = useChatStore((state) =>
    groupId && !isOwn ? (state.groupMessageBlocks[groupId] ?? []).includes(message.sender_id) : false,
  );
  const setGroupMemberBlocked = useChatStore((state) => state.setGroupMemberBlocked);

  // 好友拉黑：发送者是我拉黑的好友、且该消息发送时间晚于拉黑时间点 → 在所有群折叠
  // （只折叠拉黑之后发的；拉黑前的历史消息保留原文。取消拉黑后随 store 自动恢复）。
  // 与 D6 群屏蔽相互独立：群屏蔽走 groupMessageBlocks（右键取消），拉黑走好友黑名单（私聊/设置取消）。
  // friendBlacklistTimes 是单一真值源：拉黑时写入（服务器 created_at），取消拉黑时
  // setFriendBlacklisted(false) 一并删除该条 → 存在即「当前已拉黑」。无需再叠加
  // friends[].is_blacklisted 双源判定（两个异步源就绪时序不一致会让折叠静默失效）。
  const senderBlacklistTime = useChatStore((state) => state.friendBlacklistTimes[message.sender_id]);
  const isSenderBlacklisted = !isOwn
    && !!senderBlacklistTime
    && new Date(message.send_time).getTime() >= new Date(senderBlacklistTime).getTime();
  // 折叠占位的统一判定：群屏蔽 或 好友拉黑 任一命中
  const isSenderHidden = isSenderBlocked || isSenderBlacklisted;

  // 切换屏蔽/取消屏蔽该发送者：先 await API 成功再写 store（与好友关系操作 useChatMenu 一致，
  // 失败不写入），避免「乐观写 + 失败回滚」在并发/快速切换下落到旧值。右键菜单点击后即关闭，
  // 无法在 API 返回前重复点，next 始终基于已结算状态计算。被屏蔽者消息渲染成折叠占位，
  // 仍可右键此项取消屏蔽——这是取消屏蔽的唯一入口。
  const handleToggleBlockSender = useCallback(async () => {
    if (!groupId || isOwn) { return; }
    const senderId = message.sender_id;
    const next = !isSenderBlocked;
    try {
      if (next) {
        await addGroupMessageBlock(api, groupId, senderId);
      } else {
        await removeGroupMessageBlock(api, groupId, senderId);
      }
      setGroupMemberBlocked(groupId, senderId, next);
    } catch (err) {
      console.error('[GroupMessageBubble] 切换屏蔽失败:', err);
    }
  }, [api, groupId, isOwn, isSenderBlocked, message.sender_id, setGroupMemberBlocked]);

  // M3 群内特别关心：该发送者是否已被我特别关心（仅他人消息有意义）
  const isSenderSpecialCared = useChatStore((state) =>
    groupId && !isOwn ? (state.groupSpecialCares[groupId] ?? []).includes(message.sender_id) : false,
  );
  const setGroupMemberSpecialCare = useChatStore((state) => state.setGroupMemberSpecialCare);

  // 切换特别关心/取消：先 await API 成功再写 store（与好友关系操作一致，失败不写入）。
  // 效果仅作用于该成员发言时的通知强提醒（⭐）。
  const handleToggleSpecialCare = useCallback(async () => {
    if (!groupId || isOwn) { return; }
    const senderId = message.sender_id;
    const next = !isSenderSpecialCared;
    try {
      if (next) {
        await addGroupSpecialCare(api, groupId, senderId);
      } else {
        await removeGroupSpecialCare(api, groupId, senderId);
      }
      setGroupMemberSpecialCare(groupId, senderId, next);
    } catch (err) {
      console.error('[GroupMessageBubble] 切换特别关心失败:', err);
    }
  }, [api, groupId, isOwn, isSenderSpecialCared, message.sender_id, setGroupMemberSpecialCare]);

  // D7 群内私有备注：我给该发送者设的备注（仅他人消息有意义），用于替换显示名
  const senderRemark = useChatStore((state) =>
    groupId && !isOwn ? state.groupMemberRemarks[groupId]?.[message.sender_id] : undefined,
  );
  const setGroupMemberRemarkLocal = useChatStore((state) => state.setGroupMemberRemark);
  const [remarkModalOpen, setRemarkModalOpen] = useState(false);

  // 保存/清除备注：先 await API 成功再写 store（与好友关系操作一致，失败不写入）。空串 = 清除。
  const handleSaveRemark = useCallback(async (value: string) => {
    if (!groupId || isOwn) { return; }
    const senderId = message.sender_id;
    const trimmed = value.trim();
    try {
      if (trimmed) {
        await apiSetGroupMemberRemark(api, groupId, senderId, trimmed);
      } else {
        await apiRemoveGroupMemberRemark(api, groupId, senderId);
      }
      setGroupMemberRemarkLocal(groupId, senderId, trimmed || null);
    } catch (err) {
      console.error('[GroupMessageBubble] 保存备注失败:', err);
    }
  }, [api, groupId, isOwn, message.sender_id, setGroupMemberRemarkLocal]);

  // 发送者在本群对我显示的名字：备注优先，否则用消息携带的发送者名（群昵称/用户昵称）
  const senderDisplayName = groupMemberDisplayName(senderRemark, message.sender_nickname);

  // 气泡内顶部那行昵称的显示门控 —— 三条**与**关系，任一不成立就不画：
  //  ① showName：本条是「同一人连发那一组」里最旧的一条（锚点由列表层 O(n) 算，单条自成一组恒 true）
  //  ② !isOwn：自己的消息不标自己的名字（右侧蓝气泡本身就是身份，参照图里 telegram 也不标）
  //  ③ !isSenderHidden：被屏蔽/拉黑的消息整块只剩一句占位，此时把名字亮出来与「屏蔽此人消息」相悖
  const shouldShowSenderName = showName && !isOwn && !isSenderHidden;
  // 配色索引只由 sender_id 决定（改名/改备注不变色），真色值在 CSS 按 data-sender-hue 选
  const senderNameHue = senderNameColorIndex(message.sender_id);

  // 长按计时器（移动端用）
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // 右键打开菜单（桌面端）
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isMultiSelectMode) { return; }

    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
    });
  }, [isMultiSelectMode]);

  // 长按开始（移动端）
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile() || isMultiSelectMode) { return; }

    const touch = e.touches[0];
    touchStartPosRef.current = { x: touch.clientX, y: touch.clientY };

    // 500ms 长按触发菜单
    longPressTimerRef.current = setTimeout(() => {
      if (touchStartPosRef.current) {
        // 获取气泡元素的位置
        const rect = bubbleRef.current?.getBoundingClientRect() || null;

        setContextMenu({
          isOpen: true,
          position: { x: touchStartPosRef.current.x, y: touchStartPosRef.current.y },
          bubbleRect: rect,
        });
      }
    }, 500);
  }, [isMultiSelectMode]);

  // 长按取消（手指移动或抬起）
  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  }, []);

  const handleTouchMove = useCallback(() => {
    // 手指移动时取消长按
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  // 点击消息（多选模式下切换选中状态，移动端双击显示全屏预览）
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (isMultiSelectMode && onToggleSelect) {
      e.stopPropagation(); // 阻止冒泡到 message-row，避免重复触发
      onToggleSelect();
      return;
    }

    // 移动端双击检测（仅文本消息）
    if (isMobile() && message.message_type === 'text') {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        // 双击触发全屏预览
        setShowFullPreview(true);
        lastTapTimeRef.current = 0; // 重置，避免连续触发
      } else {
        lastTapTimeRef.current = now;
      }
    }
  }, [isMultiSelectMode, onToggleSelect, message.message_type]);

  // 关闭菜单
  const handleCloseMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  // 处理撤回
  const handleRecall = useCallback(() => {
    onRecall?.();
  }, [onRecall]);

  // 处理删除
  const handleDelete = useCallback(() => {
    onDelete?.();
  }, [onDelete]);

  // 进入多选模式
  const handleEnterMultiSelect = useCallback(() => {
    onEnterMultiSelect?.();
    onToggleSelect?.();
  }, [onEnterMultiSelect, onToggleSelect]);

  // 回复本条消息（右键/长按菜单触发）
  const handleReply = useCallback(() => {
    onReply?.(message);
  }, [onReply, message]);

  // 点击引用块 → 定位原消息
  const handleQuoteClick = useCallback(() => {
    if (message.reply_to) {
      onQuoteClick?.(message.reply_to);
    }
  }, [onQuoteClick, message.reply_to]);

  // 「回复」菜单项的显示条件：
  // - 需要列表层给了 onReply
  // - 系统消息不可回复
  // - 发送中/失败的消息还没有服务端 UUID，拿它当 reply_to 发出去后端会 400
  const canReply = !!onReply
    && message.message_type !== 'system'
    && message.sendStatus !== 'sending'
    && message.sendStatus !== 'failed';

  // 保存到相册（移动端）
  const handleSaveToGallery = useCallback(async () => {
    if (!localPath) { return; }
    const fileType = message.message_type === 'image' ? 'image' : 'video';
    const result = await saveToGallery(localPath, fileType);
    if (result.success) {
      console.warn('[GroupMessageBubble] 保存成功:', result.savedPath);
    } else {
      console.error('[GroupMessageBubble] 保存失败:', result.message);
    }
  }, [localPath, message.message_type]);

  // 获取文件类型（用于右键菜单）
  const getFileType = useCallback((): 'image' | 'video' | 'file' | null => {
    switch (message.message_type) {
      case 'image': return 'image';
      case 'video': return 'video';
      case 'file': return 'file';
      default: return null;
    }
  }, [message.message_type]);

  // 多选模式下的行点击处理
  const handleRowClick = useCallback((e: React.MouseEvent) => {
    // 只在多选模式下处理
    if (!isMultiSelectMode) { return; }
    // 阻止事件冒泡
    e.stopPropagation();
    onToggleSelect?.();
  }, [isMultiSelectMode, onToggleSelect]);

  // 元信息（时间戳 + 已读状态槽）—— 结构固定，只是**落点**按消息形态分三处，与私聊逐字同口径：
  //   ① 文本气泡（含被屏蔽占位）⇒ 内联在文末右下（`.bubble-metafoot`，类 Telegram）
  //   ② 媒体（单图 / 单视频 / 相册）⇒ 有配文落配文条内、无配文落媒体右下角药丸浮层
  //   ③ 文档 / 会议邀请 / 卡片 ⇒ 这三类是独立白底卡片、不是气泡，仍摆在卡片下方一行
  const metaNode = (
    <div className="bubble-meta">
      <span className="bubble-time">{formatMessageTime(message.send_time)}</span>
      {isOwn && (
        <GroupReadReceipt
          status={message.sendStatus}
          text={readReceipt?.text ?? null}
          readers={readReceipt?.readers ?? []}
          onOpenList={() => onOpenReadList?.(readReceipt?.readers ?? [])}
        />
      )}
    </div>
  );
  const metaBelowBubble = !isSenderHidden
    && !album
    && message.message_type !== 'text'
    && message.message_type !== 'system'
    && !isCaptionableMediaType(message.message_type);

  // 发送者昵称节点（huanwei 2026-08-14 12:16：「群聊的昵称让其放在气泡里」）。
  //
  // 落点规则与**时间戳逐字同一条**（17e1c5a 已拍板的那套，这里只是让名字跟着走），
  // 只有一处不对称：被屏蔽/拉黑的折叠占位**根本不产生昵称节点**（shouldShowSenderName
  // 已把 isSenderHidden 排除掉），而时间戳在那一路照常显示 —— 把名字亮出来与「屏蔽此人消息」相悖。
  //   ① 文本气泡 ⇒ 气泡内顶部（`.bubble-text` 的第一个孩子）
  //   ② 媒体（单图 / 单视频 / 相册）⇒ 有配文落大气泡内顶部；无配文落媒体左上角药丸浮层
  //   ③ 文档 / 会议邀请 / 卡片 ⇒ 这三类是独立白底卡片、**没有气泡可进**，名字仍在卡片上方一行
  //      （时间戳同样留在卡片下方一行 —— 两者对称，不是这里单独开的例外）
  const senderNameNode = shouldShowSenderName ? (
    <div
      className="bubble-sender-name"
      data-sender-hue={senderNameHue}
      title={senderDisplayName}
    >
      {senderDisplayName}
    </div>
  ) : null;
  // ② 那一路：名字交给 MediaBubbleFrame 摆进媒体气泡内；其余各路仍由本文件自己摆
  const nameInsideMedia = !!senderNameNode && (!!album || isCaptionableMediaType(message.message_type));
  const nameAboveCard = !!senderNameNode && !nameInsideMedia && metaBelowBubble;

  // 撤回切换动画：普通气泡 / 撤回胶囊作为 AnimatePresence 的两个 sibling motion.div
  // - 切换时（is_recalled false → true）：
  //     旧 motion.div(key="bubble") unmount → 触发 getMessageVariants(isOwn).exit
  //         （own 向右 / other 向左 + 下移 + 缩小 + 淡出）
  //     新 motion.div(key="recall") mount → initial { y: 16, opacity: 0 } → animate { y: 0, opacity: 1 }
  //         （从对应位置下方 16px 向上渐入）
  // - mode="popLayout" 让退场和入场可叠加，layout 平滑
  // - initial={false} 让 reload / 首次 mount 时不重播入场动画（与列表用 playEnter/shouldPlayEnter 仅给"挂载后新增"消息播入场的语义一致）
  return (
    <>
      <AnimatePresence mode="popLayout" initial={false}>
        {message.is_recalled ? (
          <motion.div
            key="recall"
            className="recall-system-row"
            layout="position"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <div className="recall-system-bubble recalled-message">
              <span className="recall-system-text">消息已撤回</span>
              <span className="recall-system-time">{formatMessageTime(message.send_time)}</span>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="bubble"
            className={`message-row ${isOwn ? 'own' : 'other'} ${isMultiSelectMode ? 'multi-select-mode' : ''} ${isSelected ? 'selected' : ''}${tightBelow ? ' message-row--tight' : ''}`}
            // 定位锚点（scrollMessageIntoView 唯一的寻址面）。相册态下**交给格子**：
            // 一个相册气泡代表 N 条消息，行上只能挂一个 uuid，挂了代表消息就等于
            // 「定位第一张图 = 居中整块 3×3 网格」，而其余 N-1 条依旧无处可寻。
            // AlbumMessage 给每个格子各挂一个，这里必须让位，否则代表消息会有两个同名锚点
            // 且 DOM 顺序在前的这一个胜出（scrollMessageIntoView 取 querySelectorAll 的首个命中）。
            data-message-uuid={album ? undefined : message.message_uuid}
            onClick={handleRowClick}
            // 只有发送中的消息才启用 layout 动画，避免切换会话时从顶部掉落
            layout={message.sendStatus === 'sending' ? 'position' : false}
            variants={getMessageVariants(isOwn)}
            // 仅"挂载后新增"的实时新消息才演入场（playEnter 由列表用 shouldPlayEnter 判定）；
            // 切换/打开会话时已有的历史 initial=false → 不并拢，整体走面板渐变。
            initial={playEnter ? 'initial' : false}
            animate="animate"
            exit="exit"
            transition={transition}
          >
            {/* 多选模式下的选择指示器 */}
            {isMultiSelectMode && (
              <motion.div
                className="select-indicator"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.2 }}
              >
                <div className={`select-checkbox ${isSelected ? 'checked' : ''}`}>
                  {isSelected && (
                    <motion.svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      width={14}
                      height={14}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.15 }}
                    >
                      <path fillRule="evenodd" d="M19.916 4.626a.75.75 0 01.208 1.04l-9 13.5a.75.75 0 01-1.154.114l-6-6a.75.75 0 011.06-1.06l5.353 5.353 8.493-12.739a.75.75 0 011.04-.208z" clipRule="evenodd" />
                    </motion.svg>
                  )}
                </div>
              </motion.div>
            )}

            <div
              ref={bubbleRef}
              className={`message-bubble ${isOwn ? 'own' : 'other'} ${message.sendStatus === 'sending' ? 'sending' : ''} ${message.sendStatus === 'failed' ? 'send-failed' : ''}${isHighlighted ? ' message-bubble--highlight' : ''}`}
              onContextMenu={handleContextMenu}
              onClick={handleClick}
              // 移动端长按触发菜单
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
            >
              {showAvatar ? (
                <div
                  className={`bubble-avatar bubble-avatar--bottom clickable${avatarKbd.isKbdFocused('avatar') ? ' a11y-kbd-focus' : ''}`}
                  onClick={handleAvatarClick}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') { return; }
                    // 键盘=单击语义（共用 activateAvatar），不走 250ms 双击计时器
                    e.preventDefault();
                    e.stopPropagation();
                    activateAvatar();
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看${senderDisplayName}资料`}
                  onPointerDown={avatarKbdHandlers.onPointerDown}
                  onFocus={avatarKbdHandlers.onFocus}
                  onBlur={avatarKbdHandlers.onBlur}
                >
                  {message.sender_avatar_url ? (
                    <img src={message.sender_avatar_url} alt={senderDisplayName} />
                  ) : (
                    <AvatarPlaceholder name={senderDisplayName} fontSize={14} />
                  )}
                </div>
              ) : (
                // 方案 C 的「留空位」：同尺寸占位孔，只占位不显示、不可点、不进 tab 序、
                // 对读屏隐藏。走 visibility:hidden 而不是 display:none —— 后者会把
                // .message-bubble 的 gap:10px 一起吃掉，同组气泡左缘就参差了。
                <div className="bubble-avatar bubble-avatar--bottom bubble-avatar--hole" aria-hidden="true" />
              )}
              <div className="bubble-content">
                {/* 文档 / 会议邀请 / 卡片：这三类是独立白底卡片、**没有气泡可进**，昵称留在卡片
                    上方一行（时间戳同样留在卡片下方一行，见 metaBelowBubble）。其余各形态的昵称
                    都已经进到气泡内部，由下面各自的渲染分支摆放。 */}
                {nameAboveCard && senderNameNode}
                {/* 被引用的原消息（Telegram 风格引用块，点击定位）。
                    放在折叠判定之外：引用块只暴露"被回复的那条"的摘要，与本条发送者是否被屏蔽无关；
                    但被屏蔽者自己发的引用块也一并折叠掉更符合"屏蔽此人消息"的预期 → 故仍受 isSenderHidden 门控。 */}
                {!isSenderHidden && replyQuote && (
                  <ReplyQuote
                    senderName={replyQuote.senderName}
                    text={replyQuote.text}
                    resolved={replyQuote.resolved}
                    onClick={handleQuoteClick}
                  />
                )}
                {/* 折叠占位（内容隐藏）：D6 群屏蔽右键可取消；好友拉黑在私聊/设置取消后自动恢复 */}
                {isSenderHidden ? (
                  <div className="bubble-text bubble-blocked-placeholder bubble-metafoot">
                    <div className="bubble-metafoot-body">
                      {isSenderBlocked ? '已屏蔽此人消息' : '已拉黑此人消息'}
                    </div>
                    {metaNode}
                  </div>
                ) : (
                  <>
                    {/* 相册：整组渲染成一个网格，本条自己的媒体不再单独出现。
                        仍在 isSenderHidden 之内 —— 被屏蔽者发的相册同样要折叠掉。 */}
                    {album && (
                      <AlbumMessage
                        album={album}
                        urlType="group"
                        meta={metaNode}
                        senderName={nameInsideMedia ? senderNameNode : undefined}
                      />
                    )}
                    {!album && (
                      <>
                        {/* 文本气泡：昵称是气泡本体的第一个孩子（在 padding 之内 = 视觉上在气泡里），
                            正文 + 时间戳那一行整体降一层裹进 .bubble-metafoot。
                            🔴 昵称**不能**直接当 .bubble-metafoot 的 flex 项 —— 那是一条
                            `flex-wrap + justify-content:flex-end` 的行，名字会被推到右边去跟时间戳挤。 */}
                        {(message.message_type === 'text' || message.message_type === 'system') && (
                          <div className="bubble-text">
                            {senderNameNode}
                            <div className="bubble-metafoot">
                              <div className="bubble-metafoot-body">
                                <MarkdownRenderer content={message.message_content} />
                              </div>
                              {metaNode}
                            </div>
                          </div>
                        )}
                        {message.message_type === 'meeting_invite' && (
                          <MeetingInviteCard messageContent={message.message_content} />
                        )}
                        {message.message_type === 'card' && (
                          <CardRenderer
                            messageContent={message.message_content}
                            messageUuid={message.message_uuid}
                            sourceType="group"
                          />
                        )}
                        {message.message_type !== 'text'
                      && message.message_type !== 'system'
                      && message.message_type !== 'meeting_invite'
                      && message.message_type !== 'card' && (
                        // 单图 / 单视频 + 配文 ⇒ 与相册同一个大气泡（Telegram 式 media + caption）。
                        // 这里只是**套样式**，绝不把单条塞进 media_group —— 折叠会抹掉 DOM 锚点。
                        // 文档类不进这层：它自带白底卡片，套进气泡是两层背景叠着。
                          <MediaBubbleFrame
                            content={isCaptionableMediaType(message.message_type) ? message.message_content : null}
                            media="single"
                            // 与私聊同口径：只有图片 / 视频把时间戳收进气泡内；
                            // 文档自带白底卡片、不是气泡，它的时间戳留在卡片下方一行
                            meta={isCaptionableMediaType(message.message_type) ? metaNode : undefined}
                            // 昵称同理：只有图片 / 视频这种「有气泡可进」的形态才交给它摆；
                            // 文档走 nameAboveCard 留在卡片上方（递进来会给白底卡片套一层浮层壳）
                            senderName={nameInsideMedia ? senderNameNode : undefined}
                          >
                            <FileMessageContent
                              messageType={message.message_type as 'image' | 'video' | 'file'}
                              messageContent={message.message_content}
                              fileUuid={message.file_uuid}
                              fileSize={message.file_size}
                              fileHash={message.file_hash}
                              urlType="group"
                              // 与私聊气泡同款：在途发送项的钥匙。真实历史消息没有 clientId
                              // ⇒ 这一路完全不生效，行为逐字节不变。
                              clientId={message.clientId}
                              imageWidth={message.image_width}
                              imageHeight={message.image_height}
                            />
                          </MediaBubbleFrame>
                        )}
                      </>
                    )}
                  </>
                )}
                {/* 文档 / 会议邀请 / 卡片：这三类本身是独立白底卡片、不是气泡，
                    时间戳仍摆在卡片下方一行（塞进卡片里会压在卡片自己的内容上）。 */}
                {metaBelowBubble && metaNode}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 右键菜单（桌面端右键/移动端长按触发） */}
      <MessageContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        bubbleRect={contextMenu.bubbleRect}
        canRecall={canRecallMessage(message, isOwn, isAdmin)}
        localPath={localPath}
        messageContent={message.message_type === 'text' ? message.message_content : null}
        fileType={getFileType()}
        canBlockSender={!isOwn && !!groupId && message.message_type !== 'system'}
        isSenderBlocked={isSenderBlocked}
        canSpecialCareSender={!isOwn && !!groupId && message.message_type !== 'system'}
        isSenderSpecialCared={isSenderSpecialCared}
        canRemarkSender={!isOwn && !!groupId && message.message_type !== 'system'}
        hasRemark={!!senderRemark}
        onSetRemark={() => setRemarkModalOpen(true)}
        canReply={canReply}
        onReply={handleReply}
        onRecall={handleRecall}
        onDelete={handleDelete}
        onMultiSelect={handleEnterMultiSelect}
        onSelectText={message.message_type === 'text' ? () => setShowFullPreview(true) : undefined}
        onSaveToGallery={handleSaveToGallery}
        onToggleBlockSender={handleToggleBlockSender}
        onToggleSpecialCareSender={handleToggleSpecialCare}
        onClose={handleCloseMenu}
      />

      {/* 移动端全屏消息预览（双击触发） */}
      {isMobile() && message.message_type === 'text' && (
        <MobileMessageFullPreview
          isOpen={showFullPreview}
          content={message.message_content}
          senderName={message.sender_nickname}
          sendTime={formatMessageTime(message.send_time)}
          onClose={() => setShowFullPreview(false)}
        />
      )}

      {/* D7 群内私有备注输入弹窗（右键「设置备注」触发） */}
      <GroupRemarkInputModal
        isOpen={remarkModalOpen}
        memberName={message.sender_nickname}
        currentRemark={senderRemark ?? ''}
        onSave={handleSaveRemark}
        onClose={() => setRemarkModalOpen(false)}
      />
    </>
  );
}
