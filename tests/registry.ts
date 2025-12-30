/**
 * 组件注册表
 * 定义所有必需的 UI 组件，用于测试组件是否存在且能正常导入
 * 
 * 分类：
 * - pages: 页面级组件
 * - components: 通用组件
 * - chat: 聊天相关组件
 * - meeting: 会议相关组件
 * - media: 媒体相关组件
 */

export interface ComponentEntry {
  /** 组件名称 */
  name: string;
  /** 导入路径（相对于 src） */
  path: string;
  /** 组件类别 */
  category: 'pages' | 'components' | 'chat' | 'meeting' | 'media' | 'modals' | 'hooks' | 'services';
  /** 是否为默认导出 */
  isDefault?: boolean;
  /** 描述 */
  description?: string;
}

// ============== 页面组件 ==============
export const PAGE_COMPONENTS: ComponentEntry[] = [
  { name: 'Main', path: 'pages/Main', category: 'pages', description: '主页面' },
  { name: 'Login', path: 'pages/Login', category: 'pages', description: '登录页面' },
  { name: 'Register', path: 'pages/Register', category: 'pages', description: '注册页面' },
  { name: 'AccountSelector', path: 'pages/AccountSelector', category: 'pages', description: '账号选择页面' },
];

// ============== 通用组件 ==============
export const COMMON_COMPONENTS: ComponentEntry[] = [
  // 通用 UI 组件
  { name: 'Avatar', path: 'components/common/Avatar', category: 'components', description: '头像组件' },
  { name: 'CircularProgress', path: 'components/common/CircularProgress', category: 'components', description: '环形进度条' },
  { name: 'ErrorToast', path: 'components/common/ErrorToast', category: 'components', description: '错误提示' },
  { name: 'LoadingSpinner', path: 'components/common/LoadingSpinner', category: 'components', description: '加载动画' },
  { name: 'LoadingOverlay', path: 'components/common/LoadingOverlay', category: 'components', description: '加载遮罩' },
  { name: 'SearchBox', path: 'components/common/SearchBox', category: 'components', description: '搜索框' },
  { name: 'ListStates', path: 'components/common/ListStates', category: 'components', description: '列表状态组件' },
  
  // 侧边栏
  { name: 'Sidebar', path: 'components/sidebar/Sidebar', category: 'components', description: '侧边栏' },
  
  // 统一列表
  { name: 'UnifiedList', path: 'components/unified/UnifiedList', category: 'components', description: '统一列表组件' },
  
  // 账号相关
  { name: 'CardStack', path: 'components/account/CardStack', category: 'components', description: '卡片堆叠组件' },
  { name: 'CardSlot', path: 'components/account/CardSlot', category: 'components', description: '卡片槽组件' },
  
  // 个人资料相关
  { name: 'ProfileModal', path: 'components/ProfileModal', category: 'components', description: '个人资料模态框' },
  { name: 'AvatarUploader', path: 'components/profile/AvatarUploader', category: 'components', description: '头像上传组件' },
  { name: 'PasswordForm', path: 'components/profile/PasswordForm', category: 'components', description: '密码表单' },
  { name: 'ProfileInfoForm', path: 'components/profile/ProfileInfoForm', category: 'components', description: '个人信息表单' },
  
  // 文件相关
  { name: 'FilesModal', path: 'components/files/FilesModal', category: 'components', description: '文件管理模态框' },
  
  // 群组模态框
  { name: 'GroupsModal', path: 'components/GroupsModal', category: 'components', description: '群组管理模态框' },
  { name: 'AddModal', path: 'components/AddModal', category: 'components', description: '添加好友/群组模态框' },
  
  // 设置相关
  { name: 'SettingsPanel', path: 'components/settings/SettingsPanel', category: 'components', description: '设置面板' },
  { name: 'NotificationSoundCard', path: 'components/settings/NotificationSoundCard', category: 'components', description: '消息提示音设置卡片' },

  // 更新相关
  { name: 'UpdateToast', path: 'update/components/UpdateToast', category: 'components', description: '更新提示弹窗（灵动岛风格）' },
];

// ============== 模态框组件 ==============
export const MODAL_COMPONENTS: ComponentEntry[] = [
  // 添加相关模态框
  { name: 'AddFriendTab', path: 'components/modals/add/AddFriendTab', category: 'modals', description: '添加好友标签页' },
  { name: 'CreateGroupTab', path: 'components/modals/add/CreateGroupTab', category: 'modals', description: '创建群组标签页' },
  { name: 'FriendRequestsTab', path: 'components/modals/add/FriendRequestsTab', category: 'modals', description: '好友请求标签页' },
  { name: 'GroupInvitesTab', path: 'components/modals/add/GroupInvitesTab', category: 'modals', description: '群组邀请标签页' },
  { name: 'JoinGroupTab', path: 'components/modals/add/JoinGroupTab', category: 'modals', description: '加入群组标签页' },
  { name: 'TabNavigation', path: 'components/modals/add/TabNavigation', category: 'modals', description: '标签导航' },
  
  // 群组相关模态框
  { name: 'CreateGroupForm', path: 'components/modals/groups/CreateGroupForm', category: 'modals', description: '创建群组表单' },
  { name: 'GroupListContent', path: 'components/modals/groups/GroupListContent', category: 'modals', description: '群组列表内容' },
  { name: 'GroupsTabNavigation', path: 'components/modals/groups/GroupsTabNavigation', category: 'modals', description: '群组标签导航' },
  { name: 'InvitationsListContent', path: 'components/modals/groups/InvitationsListContent', category: 'modals', description: '邀请列表内容' },
  { name: 'JoinGroupForm', path: 'components/modals/groups/JoinGroupForm', category: 'modals', description: '加入群组表单' },
];

// ============== 聊天组件 ==============
export const CHAT_COMPONENTS: ComponentEntry[] = [
  // 共享聊天组件
  { name: 'ChatPanel', path: 'chat/shared/ChatPanel', category: 'chat', description: '聊天面板' },
  { name: 'ChatInputArea', path: 'chat/shared/ChatInputArea', category: 'chat', description: '聊天输入区域' },
  { name: 'ChatMenu', path: 'chat/shared/ChatMenu', category: 'chat', description: '聊天菜单' },
  { name: 'FileAttachButton', path: 'chat/shared/FileAttachButton', category: 'chat', description: '文件附件按钮' },
  { name: 'FileMessageContent', path: 'chat/shared/FileMessageContent', category: 'chat', description: '文件消息内容' },
  { name: 'FilePreviewModal', path: 'chat/shared/FilePreviewModal', category: 'chat', description: '文件预览模态框' },
  { name: 'LocalFilePreview', path: 'chat/shared/LocalFilePreview', category: 'chat', description: '本地文件预览' },
  { name: 'MessageContextMenu', path: 'chat/shared/MessageContextMenu', category: 'chat', description: '消息右键菜单' },
  { name: 'MultiSelectActionBar', path: 'chat/shared/MultiSelectActionBar', category: 'chat', description: '多选操作栏' },
  { name: 'UploadProgress', path: 'chat/shared/UploadProgress', category: 'chat', description: '上传进度' },
  { name: 'UserProfilePopup', path: 'chat/shared/UserProfilePopup', category: 'chat', description: '用户资料弹窗' },
  
  // 好友聊天组件
  { name: 'ChatMessages', path: 'chat/friend/ChatMessages', category: 'chat', description: '好友聊天消息列表' },
  { name: 'MessageBubble', path: 'chat/friend/MessageBubble', category: 'chat', description: '好友消息气泡' },
  
  // 群聊组件
  { name: 'GroupChatMessages', path: 'chat/group/GroupChatMessages', category: 'chat', description: '群聊消息列表' },
  { name: 'GroupMessageBubble', path: 'chat/group/GroupMessageBubble', category: 'chat', description: '群聊消息气泡' },
  
  // 聊天菜单子组件
  { name: 'ConfirmDialog', path: 'chat/shared/menu/ConfirmDialog', category: 'chat', description: '确认对话框' },
  { name: 'EditNameForm', path: 'chat/shared/menu/EditNameForm', category: 'chat', description: '编辑名称表单' },
  { name: 'EditNicknameForm', path: 'chat/shared/menu/EditNicknameForm', category: 'chat', description: '编辑昵称表单' },
  { name: 'InviteCodeManager', path: 'chat/shared/menu/InviteCodeManager', category: 'chat', description: '邀请码管理' },
  { name: 'InviteForm', path: 'chat/shared/menu/InviteForm', category: 'chat', description: '邀请表单' },
  { name: 'MainMenu', path: 'chat/shared/menu/MainMenu', category: 'chat', description: '主菜单' },
  { name: 'MemberActions', path: 'chat/shared/menu/MemberActions', category: 'chat', description: '成员操作' },
  { name: 'MembersList', path: 'chat/shared/menu/MembersList', category: 'chat', description: '成员列表' },
  { name: 'MenuHeader', path: 'chat/shared/menu/MenuHeader', category: 'chat', description: '菜单头部' },
  { name: 'MuteSettings', path: 'chat/shared/menu/MuteSettings', category: 'chat', description: '静音设置' },
  { name: 'NoticesList', path: 'chat/shared/menu/NoticesList', category: 'chat', description: '公告列表' },
  { name: 'TransferOwner', path: 'chat/shared/menu/TransferOwner', category: 'chat', description: '转让群主' },
];

// ============== 会议组件 ==============
export const MEETING_COMPONENTS: ComponentEntry[] = [
  { name: 'MeetingPage', path: 'meeting/MeetingPage', category: 'meeting', description: '会议页面' },
  { name: 'MeetingEntryModal', path: 'meeting/components/MeetingEntryModal', category: 'meeting', description: '会议入口模态框' },
];

// ============== 媒体组件 ==============
export const MEDIA_COMPONENTS: ComponentEntry[] = [
  { name: 'MediaPreviewPage', path: 'media/MediaPreviewPage', category: 'media', description: '媒体预览页面' },
];

// ============== Hooks ==============
export const HOOKS: ComponentEntry[] = [
  { name: 'useAuth', path: 'hooks/useAuth', category: 'hooks', description: '认证 Hook' },
  { name: 'useFriends', path: 'hooks/useFriends', category: 'hooks', description: '好友列表 Hook' },
  { name: 'useGroups', path: 'hooks/useGroups', category: 'hooks', description: '群组列表 Hook' },
  { name: 'useFiles', path: 'hooks/useFiles', category: 'hooks', description: '文件管理 Hook' },
  { name: 'useFileUpload', path: 'hooks/useFileUpload', category: 'hooks', description: '文件上传 Hook' },
  { name: 'useFileCache', path: 'hooks/useFileCache', category: 'hooks', description: '文件缓存 Hook' },
  { name: 'useChatActions', path: 'hooks/useChatActions', category: 'hooks', description: '聊天操作 Hook' },
  { name: 'useChatMenu', path: 'hooks/useChatMenu', category: 'hooks', description: '聊天菜单 Hook' },
  { name: 'useMultiSelect', path: 'hooks/useMultiSelect', category: 'hooks', description: '多选 Hook' },
  { name: 'useMainPage', path: 'hooks/useMainPage', category: 'hooks', description: '主页面 Hook' },
  { name: 'useAccounts', path: 'hooks/useAccounts', category: 'hooks', description: '账号管理 Hook' },
  { name: 'useInitialSync', path: 'hooks/useInitialSync', category: 'hooks', description: '初始同步 Hook' },
  { name: 'useLocalConversations', path: 'hooks/useLocalConversations', category: 'hooks', description: '本地会话 Hook' },
  { name: 'useResizablePanel', path: 'hooks/useResizablePanel', category: 'hooks', description: '可调整面板 Hook' },
  { name: 'useSearchPopup', path: 'hooks/useSearchPopup', category: 'hooks', description: '搜索弹窗 Hook' },
  { name: 'useRegisterForm', path: 'hooks/useRegisterForm', category: 'hooks', description: '注册表单 Hook' },
  { name: 'useLocalFriendMessages', path: 'chat/friend/useLocalFriendMessages', category: 'hooks', description: '本地好友消息 Hook' },
  { name: 'useLocalGroupMessages', path: 'chat/group/useLocalGroupMessages', category: 'hooks', description: '本地群组消息 Hook' },
  { name: 'useWebRTC', path: 'meeting/useWebRTC', category: 'hooks', description: 'WebRTC Hook' },
  { name: 'useSilentUpdate', path: 'update/useSilentUpdate', category: 'hooks', description: '静默更新 Hook' },
  { name: 'useUpdateToast', path: 'update/components/UpdateToast', category: 'hooks', description: '更新弹窗状态管理 Hook' },
  { name: 'useNotificationSounds', path: 'hooks/useNotificationSounds', category: 'hooks', description: '提示音管理 Hook' },
];

// ============== 服务 ==============
export const SERVICES: ComponentEntry[] = [
  { name: 'diagnosticService', path: 'services/diagnosticService', category: 'services', description: '诊断上报服务' },
  { name: 'fileCache', path: 'services/fileCache', category: 'services', description: '文件缓存服务' },
  { name: 'fileService', path: 'services/fileService', category: 'services', description: '文件服务' },
  { name: 'historyService', path: 'services/historyService', category: 'services', description: '历史服务' },
  { name: 'notificationService', path: 'services/notificationService', category: 'services', description: '通知服务' },
  { name: 'syncService', path: 'services/syncService', category: 'services', description: '同步服务' },
  { name: 'updateService', path: 'update/service', category: 'services', description: '更新服务' },
  { name: 'settingsStore', path: 'stores/settingsStore', category: 'services', description: '设置状态管理' },
];

// ============== 所有组件汇总 ==============
export const ALL_COMPONENTS: ComponentEntry[] = [
  ...PAGE_COMPONENTS,
  ...COMMON_COMPONENTS,
  ...MODAL_COMPONENTS,
  ...CHAT_COMPONENTS,
  ...MEETING_COMPONENTS,
  ...MEDIA_COMPONENTS,
];

export const ALL_HOOKS = HOOKS;
export const ALL_SERVICES = SERVICES;

// ============== 统计信息 ==============
export const REGISTRY_STATS = {
  pages: PAGE_COMPONENTS.length,
  common: COMMON_COMPONENTS.length,
  modals: MODAL_COMPONENTS.length,
  chat: CHAT_COMPONENTS.length,
  meeting: MEETING_COMPONENTS.length,
  media: MEDIA_COMPONENTS.length,
  hooks: HOOKS.length,
  services: SERVICES.length,
  total: ALL_COMPONENTS.length + HOOKS.length + SERVICES.length,
};

