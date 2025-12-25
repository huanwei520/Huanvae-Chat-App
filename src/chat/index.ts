/**
 * 聊天模块入口
 *
 * 分类整理后的聊天模块结构：
 *
 * ## 目录结构
 *
 * ```
 * src/chat/
 * ├── friend/          # 好友聊天专用
 * │   ├── ChatMessages.tsx      - 私聊消息列表
 * │   ├── MessageBubble.tsx     - 私聊消息气泡
 * │   └── useLocalFriendMessages.ts - 私聊消息 Hook
 * ├── group/           # 群聊专用
 * │   ├── GroupChatMessages.tsx - 群消息列表
 * │   ├── GroupMessageBubble.tsx - 群消息气泡
 * │   ├── useLocalGroupMessages.ts - 群消息 Hook
 * │   └── useChatMenu.ts        - 群菜单 Hook
 * ├── shared/          # 共用组件
 * │   ├── ChatPanel.tsx         - 聊天面板
 * │   ├── ChatInputArea.tsx     - 输入区域
 * │   ├── ChatMenu.tsx          - 菜单按钮
 * │   ├── FileAttachButton.tsx  - 文件附件按钮
 * │   ├── FileMessageContent.tsx - 文件消息内容
 * │   ├── FilePreviewModal.tsx  - 文件预览弹窗
 * │   ├── MessageContextMenu.tsx - 右键菜单
 * │   ├── MultiSelectActionBar.tsx - 多选操作栏
 * │   ├── UploadProgress.tsx    - 上传进度
 * │   ├── UserProfilePopup.tsx  - 用户信息弹窗
 * │   └── menu/                 - 群聊菜单组件
 * └── index.ts         # 统一导出
 * ```
 *
 * ## 架构原则
 *
 * 1. **分离关注点**: 好友聊天和群聊各自独立维护
 * 2. **共享复用**: 通用组件放在 shared 目录
 * 3. **统一导出**: 通过 index.ts 提供清晰的 API
 */

// ============================================
// 好友聊天专用
// ============================================
export { ChatMessages } from './friend/ChatMessages';
export { MessageBubble } from './friend/MessageBubble';
export { useLocalFriendMessages } from './friend/useLocalFriendMessages';

// ============================================
// 群聊专用
// ============================================
export { GroupChatMessages } from './group/GroupChatMessages';
export { GroupMessageBubble } from './group/GroupMessageBubble';
export { useLocalGroupMessages } from './group/useLocalGroupMessages';
export { useChatMenu } from './group/useChatMenu';

// ============================================
// 共用组件
// ============================================
export { ChatPanel, EmptyChat } from './shared/ChatPanel';
export { ChatInputArea } from './shared/ChatInputArea';
export { ChatMenuButton } from './shared/ChatMenu';
export { FileAttachButton, type AttachmentType } from './shared/FileAttachButton';
export { FileMessageContent } from './shared/FileMessageContent';
export { FilePreviewModal } from './shared/FilePreviewModal';
export { MessageContextMenu } from './shared/MessageContextMenu';
export { MultiSelectActionBar } from './shared/MultiSelectActionBar';
export { UploadProgress } from './shared/UploadProgress';
export { UserProfilePopup, type UserInfo } from './shared/UserProfilePopup';
export { LocalFilePreview } from './shared/LocalFilePreview';

// 菜单组件
export * from './shared/menu';
