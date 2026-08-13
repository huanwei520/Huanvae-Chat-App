/**
 * 聊天输入区域组件
 *
 * 包含：
 * - 文件附件按钮
 * - **预发送待发区**（输入框上方的缩略图条；粘贴 / 选择 / 拖入先落这里，回车才发）
 * - 文本输入框（支持多行）
 * - 发送按钮
 * - 禁言状态检测和提示
 * - 剪贴板粘贴（桌面端：图片数据 + 从访达复制的文件，两种都进待发区）
 *
 * ## 发送态不在这里（spec §三，2026-08-13 改）
 * 上传进度**已从输入框上方搬进消息气泡里的每个媒体自身**
 * （{@link import('./SendingMediaOverlay').SendingMediaOverlay}）。
 * 本组件不再渲染整条总进度条。
 *
 * ## 为什么发送编排也在这里
 * {@link useComposerTrayOutbox} 自取 chatTarget / session / 上传器，
 * 于是待发区这套东西**不需要给本组件加任何 props**，两个父容器
 * （桌面 ChatPanel、移动 MobileChatView）一行都不用改。
 */

import { useRef, useCallback, useEffect, useState, useMemo, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { FileAttachButton, type AttachmentType, type PickedFile, getMimeType } from './FileAttachButton';
import { ComposerTray } from './ComposerTray';
import { useComposerTrayOutbox } from './useComposerTrayOutbox';
import {
  useComposerTrayStore,
  selectTrayItems,
  TRAY_MAX_FILE_BYTES,
  TRAY_MAX_ITEMS,
  type TrayItemInput,
} from '../../stores/composerTrayStore';
import { formatFileSize } from '../../utils/format';
import { panelFadeTransition } from './animations';
import { SendIcon, MuteIcon } from '../../components/common/Icons';
import { useChatStore, selectCurrentMuteStatus } from '../../stores';
import { isMobile } from '../../utils/platform';
import { useApi } from '../../contexts/SessionContext';
import { useBotCommandsStore } from '../../stores/botCommandsStore';
import type { BotCommand } from '../../api/bots';
import { SlashCommandPanel } from './SlashCommandPanel';
import { ReplyComposeBar } from './ReplyComposeBar';
import { draftKeyOf } from './conversationKey';
import { parseSlashQuery, filterCommands } from './slashCommands';

/** 图片扩展名 */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
/** 视频扩展名 */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'];
/** 稳定空命令数组引用（避免面板依赖抖动） */
const EMPTY_COMMANDS: BotCommand[] = [];

/**
 * 根据文件名判断附件类型
 */
function getAttachmentType(filename: string): AttachmentType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTENSIONS.includes(ext)) { return 'image'; }
  if (VIDEO_EXTENSIONS.includes(ext)) { return 'video'; }
  return 'file';
}

/**
 * 浏览器给的 File → 待发区条目。
 *
 * `localPath` 恒为空串：webview 的 `DataTransfer` / `ClipboardData` 只给文件**内容**，
 * 不给磁盘路径（这是浏览器安全模型，不是本仓的疏漏）。空 localPath 意味着这一份
 * 不进本地文件缓存映射，只是正常上传 —— 见 TrayItem.localPath 的说明。
 *
 * MIME 不准（空 / `application/octet-stream`）时按扩展名重建 File，
 * 否则后端会把一张 png 当二进制文档存，缩略图与在线预览全废。
 */
function normalizeToTrayInput(file: File): TrayItemInput {
  const kind = getAttachmentType(file.name);
  if (!file.type || file.type === 'application/octet-stream') {
    const mimeType = getMimeType(file.name, kind);
    return {
      file: new File([file], file.name, { type: mimeType, lastModified: file.lastModified }),
      localPath: '',
      kind,
    };
  }
  return { file, localPath: '', kind };
}

interface ChatInputAreaProps {
  messageInput: string;
  onMessageChange: (value: string) => void;
  /** 只有文字、没有附件时走它（既有纯文本发送路径，行为不变） */
  onSendMessage: () => void;
}

/**
 * 格式化剩余时间
 * @param ms 毫秒
 * @returns 格式化的时间字符串
 */
function formatRemainingTime(ms: number): string {
  if (ms <= 0) { return ''; }

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}天${hours % 24}小时`;
  }
  if (hours > 0) {
    return `${hours}小时${minutes % 60}分钟`;
  }
  if (minutes > 0) {
    return `${minutes}分钟`;
  }
  return `${seconds}秒`;
}

export function ChatInputArea({
  messageInput,
  onMessageChange,
  onSendMessage,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // IME 组字标志：compositionstart 置真、compositionend 置假。
  // 兜住个别 WebView 内核在组字确认的 keydown 上未置 isComposing 的时序差（见 handleKeyDown）。
  const isComposingRef = useRef(false);

  // 从 store 获取当前群的禁言状态
  const muteInfo = useChatStore(selectCurrentMuteStatus);
  const chatTarget = useChatStore((state) => state.chatTarget);
  const getMuteRemaining = useChatStore((state) => state.getMuteRemaining);

  // 计算禁言剩余时间
  const [muteRemaining, setMuteRemaining] = useState(0);

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const api = useApi();
  const inputWrapperRef = useRef<HTMLDivElement>(null);

  // 斜杠命令面板：仅 bot 会话有命令集（进会话拉取，切会话失效）
  const botUserId = chatTarget?.type === 'bot' ? chatTarget.data.friend_id : null;
  const rawCommands = useBotCommandsStore((s) => (botUserId ? s.commandsByBot[botUserId] : undefined));
  const commands = rawCommands ?? EMPTY_COMMANDS;

  useEffect(() => {
    if (botUserId) {
      void useBotCommandsStore.getState().fetch(api, botUserId);
    }
  }, [api, botUserId]);

  const slashQuery = useMemo(() => parseSlashQuery(messageInput), [messageInput]);
  const filteredCommands = useMemo(
    () => (slashQuery === null ? EMPTY_COMMANDS : filterCommands(commands, slashQuery)),
    [slashQuery, commands],
  );
  const [slashDismissed, setSlashDismissed] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashPos, setSlashPos] = useState({ left: 0, bottom: 0 });

  // 用户继续打字（query 变化）→ 重置 dismissed 与选中项
  useEffect(() => { setSlashDismissed(false); setSlashActiveIndex(0); }, [slashQuery]);

  // 上传不再阻塞输入（进度已搬进气泡），故命令面板的开合不再看上传状态
  const slashPanelOpen = slashQuery !== null && filteredCommands.length > 0 && !slashDismissed;

  useLayoutEffect(() => {
    if (slashPanelOpen && inputWrapperRef.current) {
      const r = inputWrapperRef.current.getBoundingClientRect();
      setSlashPos({ left: r.left, bottom: window.innerHeight - r.top + 8 });
    }
  }, [slashPanelOpen, messageInput]);

  // 选中命令 = 填入输入框（可编辑，绝不直发）
  const selectSlashCommand = useCallback((cmd: BotCommand) => {
    onMessageChange(`/${cmd.command} `);
    setSlashDismissed(true);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [onMessageChange]);

  // 判断是否在群聊中
  const isGroup = chatTarget?.type === 'group';
  const groupId = isGroup ? chatTarget.data.group_id : null;

  // ==================== 群聊回复 ====================
  // 「正在回复」条与「定位失败」提示都挂在输入区，因此桌面 ChatPanel 与移动 MobileChatView
  // 复用同一个 ChatInputArea = 两端天然一致，不需要在两个容器里各接一遍。
  //
  // 提示条刻意不放进消息列表容器：那是 overflow:auto 的滚动容器，绝对定位浮层会锚到
  // 内容顶而非视口顶，用户滚到下面就完全看不见（见 .claude/rules/common.md 同名条目）。
  const replyDraft = useChatStore((state) => state.replyDraft);
  const setReplyDraft = useChatStore((state) => state.setReplyDraft);
  const messageJumpNotice = useChatStore((state) => state.messageJumpNotice);
  const setMessageJumpNotice = useChatStore((state) => state.setMessageJumpNotice);
  // 草稿必须属于当前这个会话才显示：切会话时 store 已清，这里是第二道闸。
  // 用 conversationKey 而非 groupId —— 私聊回复自 migration 036 起也走这条通路。
  const conversationKey = draftKeyOf(chatTarget);
  const activeReplyDraft = replyDraft && conversationKey && replyDraft.conversationKey === conversationKey
    ? replyDraft
    : null;

  // ==================== 预发送待发区 ====================
  // 粘贴 / 附件选择 / 拖入统一进这里，回车才连同文字一起发。
  const trayItems = useComposerTrayStore(selectTrayItems(conversationKey));
  const addToTrayAction = useComposerTrayStore((s) => s.add);
  const removeFromTray = useComposerTrayStore((s) => s.remove);
  const clearTray = useComposerTrayStore((s) => s.clear);
  const [trayNotice, setTrayNotice] = useState<string | null>(null);
  const outbox = useComposerTrayOutbox(conversationKey);

  /**
   * 把一批文件塞进待发区，并把**被挡下的**如实回报（不静默截断）。
   *
   * 两类挡：单个超 {@link TRAY_MAX_FILE_BYTES}（spec §四「超限当场提示，不进待发区」），
   * 以及总数超 {@link TRAY_MAX_ITEMS}。
   */
  const addToTray = useCallback((inputs: readonly TrayItemInput[]) => {
    if (!conversationKey || inputs.length === 0) { return; }
    const result = addToTrayAction(conversationKey, inputs);
    const parts: string[] = [];
    if (result.rejectedOversize.length > 0) {
      parts.push(
        `${result.rejectedOversize.join('、')} 超过单个 ${formatFileSize(TRAY_MAX_FILE_BYTES)} 上限，未加入`,
      );
    }
    if (result.rejectedOverflow.length > 0) {
      parts.push(`一次最多 ${TRAY_MAX_ITEMS} 个，${result.rejectedOverflow.join('、')} 未加入`);
    }
    setTrayNotice(parts.length > 0 ? parts.join('；') : null);
  }, [conversationKey, addToTrayAction]);

  const handleRemoveTrayItem = useCallback((itemId: string) => {
    if (!conversationKey) { return; }
    removeFromTray(conversationKey, itemId);
  }, [conversationKey, removeFromTray]);

  /**
   * 附件按钮选完文件 ⇒ 进待发区（**不再选完即发**，spec §三 移动端要点）。
   * 这一批**有**真实本地路径（系统文件选择器给的），可进本地缓存映射。
   */
  const handleAttachPicked = useCallback((picked: PickedFile[], type: AttachmentType) => {
    addToTray(picked.map((p) => ({ file: p.file, localPath: p.localPath, kind: type })));
  }, [addToTray]);

  const jumpNoticeNode = (
    <AnimatePresence>
      {messageJumpNotice && (
        <motion.div
          className="reply-jump-notice"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          role="status"
        >
          <div className="reply-jump-notice-inner">
            <span>{messageJumpNotice}</span>
            <button
              type="button"
              className="reply-jump-notice-close"
              onClick={() => setMessageJumpNotice(null)}
              aria-label="关闭提示"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={14} height={14}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // 定时更新禁言剩余时间
  useEffect(() => {
    if (!groupId || !muteInfo) {
      setMuteRemaining(0);
      return;
    }

    // 立即计算一次
    setMuteRemaining(getMuteRemaining(groupId));

    // 每秒更新一次
    const timer = setInterval(() => {
      const remaining = getMuteRemaining(groupId);
      setMuteRemaining(remaining);

      // 禁言结束后自动清除
      if (remaining <= 0) {
        clearInterval(timer);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [groupId, muteInfo, getMuteRemaining]);

  // 是否被禁言
  const isMuted = muteRemaining > 0;

  // 禁言提示文本
  const muteMessage = useMemo(() => {
    if (!isMuted) { return ''; }
    const timeStr = formatRemainingTime(muteRemaining);
    return `您已被禁言，剩余 ${timeStr}`;
  }, [isMuted, muteRemaining]);

  /**
   * 回车 / 点发送：有附件 ⇒ 走待发区（附件 + 文字一起）；没有 ⇒ 既有纯文本路径不变。
   *
   * 形态（相册 / 单条）在 `outbox.send` 里一次性定死，之后取消或失败都不再改变它 ——
   * 否则一条 count=3 的相册会在中途退化成 count=2，对端排版直接算错（spec §五 第 5 问）。
   */
  const handleSend = useCallback(() => {
    if (isMuted) { return; }
    if (trayItems.length > 0 && conversationKey) {
      const outcome = outbox.send(trayItems, messageInput);
      if (outcome.enqueued > 0) {
        clearTray(conversationKey);
        setTrayNotice(null);
        onMessageChange('');
      }
      return;
    }
    onSendMessage();
  }, [isMuted, trayItems, conversationKey, outbox, messageInput, clearTray, onMessageChange, onSendMessage]);

  // 自动调整输入框高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) { return; }

    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight / 5;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // 输入内容变化后重算高度。
  //
  // 🔴 这里原来只处理「清空 → 收回一行」，**不处理「内容从外部变成非空」**：
  // 切走会话再切回来时，草稿被恢复进 value，但高度还停在 rows={1} 的默认值，
  // 于是多行草稿被压成一行（用户报的「输入框大小不对」）。
  // adjustTextareaHeight 先置 auto 再按 scrollHeight 收敛，两种方向都覆盖：
  // 空内容 → 塌回一行（等价于原来的行为）；多行草稿 → 撑到应有高度。
  useEffect(() => {
    adjustTextareaHeight();
  }, [messageInput, adjustTextareaHeight]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 组字进行中：Enter 只用于「确认候选词」，绝不触发发送 / 命令选择。
    // 三重判据（任一为真即视为组字中）：
    // - e.nativeEvent.isComposing：组字期 keydown 的根因信号（Blink/Gecko/现代 WebKit 均置 true，含确认候选词那一下）
    // - e.keyCode === 229：旧内核在组字期 keydown 上报的 "process" 键码
    // - isComposingRef：compositionstart→compositionend 间的手动标志，兜住个别内核 isComposing 未置位
    const composing = e.nativeEvent.isComposing || e.keyCode === 229 || isComposingRef.current;

    // 命令面板打开时：方向键/Enter/Tab/ESC 归面板，Enter 绝不发送
    if (slashPanelOpen) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashActiveIndex((i) => (i + 1) % filteredCommands.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashActiveIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length); return; }
      if (e.key === 'Enter' && !e.shiftKey) { if (composing) { return; } e.preventDefault(); const c = filteredCommands[slashActiveIndex]; if (c) { selectSlashCommand(c); } return; }
      if (e.key === 'Tab') { e.preventDefault(); const c = filteredCommands[slashActiveIndex]; if (c) { selectSlashCommand(c); } return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashDismissed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      if (composing) { return; }
      e.preventDefault();
      // 回车 = 发送「待发区附件 + 文字」；没有附件时 handleSend 退回原来的纯文本路径
      handleSend();
    }
  }, [handleSend, slashPanelOpen, filteredCommands, slashActiveIndex, selectSlashCommand]);

  // IME 组字事件：维护 isComposingRef，供 handleKeyDown 判断「Enter 是否为确认候选词」。
  const handleCompositionStart = useCallback(() => { isComposingRef.current = true; }, []);
  const handleCompositionEnd = useCallback(() => { isComposingRef.current = false; }, []);

  // ============================================
  // 拖拽文件处理
  // ============================================

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (isMuted) { return; }

    const files = e.dataTransfer.files;
    if (files.length === 0) { return; }

    // 拖入的**全部**文件都进待发区（原来只取第一个 —— 待发区支持多个，没有理由再丢）
    addToTray(Array.from(files).map((f) => normalizeToTrayInput(f)));
  }, [isMuted, addToTray]);

  // ============================================
  // 剪贴板粘贴（仅桌面端）—— 两条来源，都进待发区，都不直接发送
  // ============================================

  /**
   * 处理粘贴事件（spec §四「桌面端粘贴范围」：图片数据 + 从访达复制的文件，两种都支持）
   *
   * 顺序不能反：先看 `clipboardData.files`（访达复制文件 / 从别的应用拖来的图片文件都在这里，
   * **可能有多个**），没有再走 Tauri 剪贴板插件读位图（截图工具那条路，只可能有一张）。
   *
   * ⚠️ 已知限制：`clipboardData.files` 给的是内容不是路径 ⇒ 这一批的 `localPath` 为空，
   * 不进本地文件缓存映射。要拿到访达复制文件的真实路径需要 Tauri 侧新增命令
   * （`src-tauri/**` 本轮归 B 路，见交付「需要跨路改动的文件」）。
   */
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    if (isMuted || isMobile()) {
      return;
    }

    // ① 剪贴板里的文件（访达复制的文件、其它应用放进来的图片文件）—— 全部收下，不限类型、不限个数
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault(); // 阻止默认粘贴行为（否则文件名会被当文本插进输入框）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      addToTray(Array.from(files).map((file, i) => {
        // 截图类数据没有文件名，得自己造一个，否则后端按文件名派生的正文是空的
        if (file.name) {
          return normalizeToTrayInput(file);
        }
        const ext = file.type.split('/')[1] || 'png';
        const named = new File([file], `clipboard-${timestamp}-${i}.${ext}`, {
          type: file.type || 'image/png',
          lastModified: Date.now(),
        });
        return normalizeToTrayInput(named);
      }));
      return;
    }

    // ② Tauri 剪贴板插件里的位图（截图工具复制的图，不以文件形式出现在 clipboardData 里）
    try {
      // 动态导入，避免移动端加载失败
      const { readImage } = await import('@tauri-apps/plugin-clipboard-manager');

      const clipboardImage = await readImage();

      // 获取 RGBA 数据和尺寸（size() 是异步方法）
      const rgbaData = await clipboardImage.rgba();
      const imageSize = await clipboardImage.size();

      if (!rgbaData || rgbaData.length === 0) {
        return;
      }

      e.preventDefault(); // 阻止默认粘贴行为

      // 调用 Rust 后端保存为 PNG 文件，获取本地路径
      const localPath = await invoke<string>('save_clipboard_image', {
        rgbaData: Array.from(rgbaData),
        width: imageSize.width,
        height: imageSize.height,
      });

      // 读取保存的文件，创建 File 对象
      const fileBytes = await readFile(localPath);
      const filename = localPath.split(/[/\\]/).pop() || 'clipboard.png';

      const file = new File([fileBytes], filename, {
        type: 'image/png',
        lastModified: Date.now(),
      });

      // 这一条**有**真实本地路径（Rust 刚落的盘），可以进本地缓存映射
      addToTray([{ file, localPath, kind: 'image' }]);
    } catch {
      // 剪贴板没有图片或读取失败，继续默认粘贴行为（粘贴文本）
      // 这是正常情况，不需要记录错误
    }
  }, [isMuted, addToTray]);

  // 禁言状态变化后重新聚焦（移动端禁用自动聚焦以避免键盘弹出）
  useEffect(() => {
    if (!isMuted && !isMobile()) {
      textareaRef.current?.focus();
    }
  }, [isMuted]);

  // 禁言状态下的输入区域
  // ⚠️ 入场/退场禁止 y 位移（与下方正常态相同，原因见正常态注释）。
  if (isMuted) {
    return (
      <motion.div
        key="input-area-muted"
        className="chat-input-area muted"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={panelFadeTransition}
      >
        {/* 禁言态也要能看到定位失败提示：被禁言不影响点引用块去定位原消息 */}
        {jumpNoticeNode}
        <div className="mute-notice">
          <MuteIcon />
          <span>{muteMessage}</span>
        </div>
      </motion.div>
    );
  }

  // ⚠️ 入场/退场禁止 y 位移，只允许 opacity：
  // 首帧 translateY 会把本元素的边界伸出 .chat-content（overflow:hidden 也是 scroll container），
  // 扩出一段可滚动区；叠加 textarea 挂载 autofocus 的 focus 滚动 → .chat-content 被滚下露出
  // 输入框（头部+消息区整体被顶上去），随动画回位时可滚区缩回、scrollTop 逐帧钳回 0 →
  // 头部栏和整个消息框出现「从上向下滑入」的假入场。纯 opacity 无几何变化，与面板/消息区淡入一致。
  return (
    <motion.div
      key="input-area"
      className={`chat-input-area${isDragging ? ' dragging' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={panelFadeTransition}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* 消息定位失败的降级提示（点击引用块但原消息不在本地记录中） */}
      {jumpNoticeNode}

      {/* 「正在回复」条（群聊回复，Telegram 风格：被回复者 + 摘要 + 取消） */}
      <AnimatePresence>
        {activeReplyDraft && (
          <ReplyComposeBar
            key="reply-compose-bar"
            senderName={activeReplyDraft.senderName}
            preview={activeReplyDraft.preview}
            onCancel={() => setReplyDraft(null)}
          />
        )}
      </AnimatePresence>

      {/*
        预发送待发区。输入框上方的缩略图条 —— 附件先落这里，回车才发。
        原来这个位置是整条上传总进度条，spec §三 已把进度搬进消息气泡里的每个媒体自身
        （SendingMediaOverlay），故这里不再有进度条。
      */}
      <ComposerTray
        items={trayItems}
        onRemove={handleRemoveTrayItem}
        notice={trayNotice}
        onDismissNotice={() => setTrayNotice(null)}
      />

      <div className="input-wrapper multiline" ref={inputWrapperRef}>
        {/* 文件附件按钮 —— 选完进待发区（不再选完即发），故只给 onFilesSelect */}
        <FileAttachButton onFilesSelect={handleAttachPicked} />

        <textarea
          ref={textareaRef}
          placeholder="输入消息... (Shift+Enter 换行)"
          value={messageInput}
          onChange={(e) => {
            onMessageChange(e.target.value);
            adjustTextareaHeight();
          }}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={handlePaste}
          rows={1}
        />
        <motion.button
          className="send-btn"
          onClick={() => {
            handleSend();
            // 点击按钮发送后，将焦点返回输入框以便继续输入
            textareaRef.current?.focus();
          }}
          // 待发区有东西时即便没打字也能发（纯媒体，四格矩阵的「无文字」两格）
          disabled={!messageInput.trim() && trayItems.length === 0}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <SendIcon />
        </motion.button>
      </div>

      <SlashCommandPanel
        open={slashPanelOpen}
        commands={filteredCommands}
        activeIndex={slashActiveIndex}
        position={slashPos}
        onSelect={selectSlashCommand}
        onHoverIndex={setSlashActiveIndex}
      />
    </motion.div>
  );
}
