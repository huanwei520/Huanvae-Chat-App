/**
 * 聊天输入区域组件
 *
 * 包含：
 * - 文件附件按钮
 * - 文本输入框（支持多行）
 * - 发送按钮
 * - 上传进度条
 * - 禁言状态检测和提示
 * - 剪贴板图片粘贴（桌面端，类似 QQ/微信）
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import { FileAttachButton, type AttachmentType, getMimeType } from './FileAttachButton';
import { UploadProgress } from './UploadProgress';
import { panelFadeTransition } from './animations';
import { SendIcon, MuteIcon } from '../../components/common/Icons';
import { useChatStore, selectCurrentMuteStatus } from '../../stores';
import type { UploadProgress as UploadProgressType } from '../../hooks/useFileUpload';
import { isMobile } from '../../utils/platform';

/** 图片扩展名 */
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'];
/** 视频扩展名 */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv'];

/**
 * 根据文件名判断附件类型
 */
function getAttachmentType(filename: string): AttachmentType {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTENSIONS.includes(ext)) { return 'image'; }
  if (VIDEO_EXTENSIONS.includes(ext)) { return 'video'; }
  return 'file';
}

interface ChatInputAreaProps {
  messageInput: string;
  onMessageChange: (value: string) => void;
  onSendMessage: () => void;
  onFileSelect: (file: File, type: AttachmentType, localPath?: string) => void;
  /** @deprecated 不再使用发送锁定逻辑 */
  isSending?: boolean;
  uploading: boolean;
  uploadingFile: File | null;
  uploadProgress: UploadProgressType | null;
  onCancelUpload: () => void;
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
  onFileSelect,
  // isSending 已废弃，不再使用发送锁定逻辑
  uploading,
  uploadingFile,
  uploadProgress,
  onCancelUpload,
}: ChatInputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 从 store 获取当前群的禁言状态
  const muteInfo = useChatStore(selectCurrentMuteStatus);
  const chatTarget = useChatStore((state) => state.chatTarget);
  const getMuteRemaining = useChatStore((state) => state.getMuteRemaining);

  // 计算禁言剩余时间
  const [muteRemaining, setMuteRemaining] = useState(0);

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  // 判断是否在群聊中
  const isGroup = chatTarget?.type === 'group';
  const groupId = isGroup ? chatTarget.data.group_id : null;

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

  // 自动调整输入框高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) { return; }

    textarea.style.height = 'auto';
    const maxHeight = window.innerHeight / 5;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  // 消息清空后重置输入框高度
  useEffect(() => {
    if (!messageInput) {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
      }
    }
  }, [messageInput]);

  // 处理键盘事件
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isMuted) {
        onSendMessage();
      }
    }
  }, [onSendMessage, isMuted]);

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

    // 禁用状态下不处理
    if (uploading || isMuted) { return; }

    const files = e.dataTransfer.files;
    if (files.length === 0) { return; }

    // 只处理第一个文件
    const file = files[0];
    const attachmentType = getAttachmentType(file.name);

    // 如果浏览器提供的 MIME 类型不准确，使用扩展名推断
    let finalFile = file;
    if (!file.type || file.type === 'application/octet-stream') {
      const mimeType = getMimeType(file.name, attachmentType);
      finalFile = new File([file], file.name, {
        type: mimeType,
        lastModified: file.lastModified,
      });
    }

    // 调用文件选择回调（无本地路径，因为是从浏览器拖入）
    onFileSelect(finalFile, attachmentType);
  }, [uploading, isMuted, onFileSelect]);

  // ============================================
  // 剪贴板图片粘贴处理（仅桌面端）
  // ============================================

  /**
   * 处理粘贴事件
   * 如果剪贴板包含图片，则调用 Tauri 后端保存为 PNG 文件并上传
   * 类似 QQ/微信 的粘贴图片功能
   */
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    // 禁用状态或移动端不处理
    if (uploading || isMuted || isMobile()) {
      return;
    }

    // 检查剪贴板是否包含图片文件
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      const file = files[0];

      // 检查是否是图片
      if (file.type.startsWith('image/')) {
        e.preventDefault(); // 阻止默认粘贴行为

        // 生成文件名（截图默认没有名称）
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const ext = file.type.split('/')[1] || 'png';
        const filename = file.name || `clipboard-${timestamp}.${ext}`;

        // 创建带正确文件名的 File 对象
        const imageFile = new File([file], filename, {
          type: file.type,
          lastModified: Date.now(),
        });

        // 调用已有的 onFileSelect 回调（无本地路径）
        onFileSelect(imageFile, 'image');
        return;
      }
    }

    // 尝试使用 Tauri 剪贴板插件读取图片（桌面端专属）
    // 这可以处理通过截图工具复制到剪贴板的图片
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

      // 调用现有的文件选择回调，传入本地路径
      onFileSelect(file, 'image', localPath);
    } catch {
      // 剪贴板没有图片或读取失败，继续默认粘贴行为（粘贴文本）
      // 这是正常情况，不需要记录错误
    }
  }, [uploading, isMuted, onFileSelect]);

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
      {/* 上传进度条 */}
      <AnimatePresence>
        {uploading && uploadingFile && uploadProgress && (
          <UploadProgress
            filename={uploadingFile.name}
            fileSize={uploadingFile.size}
            progress={uploadProgress}
            onCancel={onCancelUpload}
          />
        )}
      </AnimatePresence>

      <div className="input-wrapper multiline">
        {/* 文件附件按钮 */}
        <FileAttachButton
          disabled={uploading}
          onFileSelect={onFileSelect}
        />

        <textarea
          ref={textareaRef}
          placeholder="输入消息... (Shift+Enter 换行)"
          value={messageInput}
          onChange={(e) => {
            onMessageChange(e.target.value);
            adjustTextareaHeight();
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={uploading}
          rows={1}
        />
        <motion.button
          className="send-btn"
          onClick={() => {
            onSendMessage();
            // 点击按钮发送后，将焦点返回输入框以便继续输入
            textareaRef.current?.focus();
          }}
          disabled={!messageInput.trim() || uploading}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <SendIcon />
        </motion.button>
      </div>
    </motion.div>
  );
}
