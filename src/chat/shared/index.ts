/**
 * 共用聊天组件
 *
 * 好友聊天和群聊共同使用的组件
 *
 * @updated 2026-01-24 添加 animations.ts 和 SendStatusIndicator 共享模块
 */

export { ChatPanel, EmptyChat } from './ChatPanel';
export { ChatInputArea } from './ChatInputArea';
export { ChatMenuButton } from './ChatMenu';
export { FileAttachButton, type AttachmentType } from './FileAttachButton';
export { FileMessageContent } from './FileMessageContent';
export { FilePreviewModal } from './FilePreviewModal';
export { MessageContextMenu } from './MessageContextMenu';
export { MultiSelectActionBar } from './MultiSelectActionBar';
export { UploadProgress } from './UploadProgress';
export { UserProfilePopup, type UserInfo } from './UserProfilePopup';
export { LocalFilePreview } from './LocalFilePreview';

// 动画配置（消息气泡入场/退出动画）
export { getMessageVariants, messageTransition } from './animations';

// 发送状态指示器
export { SendStatusIndicator, type SendStatus } from './SendStatusIndicator';

// 菜单组件
export * from './menu';
