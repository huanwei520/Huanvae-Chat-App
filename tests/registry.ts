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

// ============== 移动端组件 ==============
export const MOBILE_COMPONENTS: ComponentEntry[] = [
  { name: 'MobileHeader', path: 'pages/mobile/MobileHeader', category: 'components', description: '移动端顶部栏（含 WebSocket 连接状态指示器）' },
  { name: 'MobileMain', path: 'pages/mobile/MobileMain', category: 'pages', description: '移动端主页面' },
  { name: 'MobileThemePage', path: 'pages/mobile/MobileThemePage', category: 'pages', description: '移动端主题设置页面' },
  { name: 'MobileMiniAppsPage', path: 'pages/mobile/MobileMiniAppsPage', category: 'pages', description: '移动端小程序页面（公开列表 + iframe 启动）' },
  { name: 'MobileProfilePage', path: 'pages/mobile/MobileProfilePage', category: 'pages', description: '移动端个人资料页（QQ 风格：通栏封面区 + 圆角卡 + 头像骑边，编辑头像/昵称/邮箱/签名/密码）' },
];

// ============== 全局搜索组件 ==============
export const SEARCH_COMPONENTS: ComponentEntry[] = [
  { name: 'GlobalMessageSearchResults', path: 'components/search/GlobalMessageSearchResults', category: 'components', description: '跨会话消息内容/文件名搜索结果（移动+桌面共用）' },
  { name: 'useGlobalMessageSearch', path: 'hooks/useGlobalMessageSearch', category: 'hooks', description: '全局消息搜索 Hook（500ms 防抖 + 按会话分组）' },
];

// ============== NFC 指令执行器 ==============
// v2 起 App 启动即全局监听贴卡（useNfcGlobalScan），不再有页面级扫卡 UI；
// NfcFeedbackToast 是单实例 success/error 双变体反馈浮层。
export const NFC_COMPONENTS: ComponentEntry[] = [
  { name: 'NfcTrustConfirmModal', path: 'nfc/NfcTrustConfirmModal', category: 'components', description: 'NFC 信任确认对话框（陌生 uid+payload_hash 弹一次）' },
  { name: 'NfcFeedbackToast', path: 'nfc/NfcFeedbackToast', category: 'components', description: 'NFC 操作反馈浮层（success/error 双变体，3s 自动消失）' },
  { name: 'MobileNfcTrustedCardsPage', path: 'pages/mobile/MobileNfcTrustedCardsPage', category: 'pages', description: '移动端"已信任 NFC 卡"列表页（按 created_at 倒序，可移除）' },
  { name: 'useNfcGlobalScan', path: 'hooks/useNfcGlobalScan', category: 'hooks', description: '全局 NFC 监听 hook（MobileMain 启动即 scan loop，仅 Android）' },
  { name: 'nfcParser', path: 'nfc/parser', category: 'services', description: 'NFC URI Record 解码 + 白名单 parseAction + payload hash' },
  { name: 'nfcExecutor', path: 'nfc/executor', category: 'services', description: 'NFC action dispatch（miniapp/open / http/request）' },
  { name: 'nfcTrustStore', path: 'nfc/trustStore', category: 'services', description: 'NFC 信任表 invoke 包装层' },
];

// ============== 更新模块 Hooks ==============
export const UPDATE_COMPONENTS: ComponentEntry[] = [
  { name: 'useStartupUpdateCheck', path: 'update/useStartupUpdateCheck', category: 'hooks', description: '启动时更新检查 Hook（App.tsx 顶层用，登录前 5s 后触发一次检测）' },
];

// ============== 通用组件 ==============
export const COMMON_COMPONENTS: ComponentEntry[] = [
  // 通用 UI 组件
  { name: 'Avatar', path: 'components/common/Avatar', category: 'components', description: '头像组件' },
  { name: 'AIAvatar', path: 'components/common/AIAvatar', category: 'components', description: 'AI 助手头像组件' },
  { name: 'AvatarCropModal', path: 'components/common/AvatarCropModal', category: 'components', description: '头像裁剪弹窗（1:1，个人/群头像共用，含 useAvatarCrop Hook）' },
  { name: 'MarkdownRenderer', path: 'components/common/MarkdownRenderer', category: 'components', description: 'Markdown 渲染组件（聊天气泡内容）' },
  { name: 'CircularProgress', path: 'components/common/CircularProgress', category: 'components', description: '环形进度条' },
  { name: 'ErrorToast', path: 'components/common/ErrorToast', category: 'components', description: '错误提示' },
  { name: 'LoadingSpinner', path: 'components/common/LoadingSpinner', category: 'components', description: '加载动画' },
  { name: 'LoadingOverlay', path: 'components/common/LoadingOverlay', category: 'components', description: '加载遮罩' },
  { name: 'SearchBox', path: 'components/common/SearchBox', category: 'components', description: '搜索框' },
  { name: 'ListStates', path: 'components/common/ListStates', category: 'components', description: '列表状态组件' },
  { name: 'SyncStatusBanner', path: 'components/common/SyncStatusBanner', category: 'components', description: '消息同步状态横幅' },

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
  { name: 'PrivacySettingsForm', path: 'components/profile/PrivacySettingsForm', category: 'components', description: '隐私/申请处理设置表单（搜索可见性 + 好友/群申请默认策略）' },

  // 文件相关
  { name: 'FilesModal', path: 'components/files/FilesModal', category: 'components', description: '文件管理模态框' },
  { name: 'FileContextMenu', path: 'components/files/FileContextMenu', category: 'components', description: '我的文件右键/长按菜单（纯展示组件）' },
  { name: 'FileMenuController', path: 'components/files/FileMenuController', category: 'components', description: '我的文件菜单状态解析器（订阅 useFileCache + selectDownloadTask 决定菜单项）' },

  // 群组模态框
  { name: 'GroupsModal', path: 'components/GroupsModal', category: 'components', description: '群组管理模态框' },
  { name: 'AddModal', path: 'components/AddModal', category: 'components', description: '添加好友/群组模态框' },

  // 设置相关
  { name: 'SettingsPanel', path: 'components/settings/SettingsPanel', category: 'components', description: '设置面板' },
  { name: 'SettingsSection', path: 'components/settings/SettingsSection', category: 'components', description: '设置分组组件' },
  { name: 'SettingsGroup', path: 'components/settings/SettingsGroup', category: 'components', description: '设置卡片容器' },
  { name: 'SettingsRow', path: 'components/settings/SettingsRow', category: 'components', description: '设置行组件' },
  { name: 'SoundSelector', path: 'components/settings/SoundSelector', category: 'components', description: '提示音选择器' },
  { name: 'DeviceListPanel', path: 'components/settings/DeviceListPanel', category: 'components', description: '设备管理面板' },

  // 更新相关
  { name: 'UpdateToast', path: 'update/components/UpdateToast', category: 'components', description: '更新提示弹窗（灵动岛风格）' },

  // 局域网传输
  { name: 'LanTransferPage', path: 'lanTransfer/LanTransferPage', category: 'components', description: '局域网传输页面' },
  { name: 'lanTransferApi', path: 'lanTransfer/api', category: 'services', description: '局域网传输 API' },

  // HuanvaeGuard VPN
  { name: 'HuanvaeGuardPage', path: 'huanvaeGuard/HuanvaeGuardPage', category: 'components', isDefault: true, description: 'HuanvaeGuard VPN 管理页面（独立 Tauri 窗口）' },
  { name: 'huanvaeGuardServerApi', path: 'huanvaeGuard/serverApi', category: 'services', description: 'HuanvaeGuard 远端 API 客户端' },
  { name: 'huanvaeGuardLocalApi', path: 'huanvaeGuard/localApi', category: 'services', description: 'HuanvaeGuard 本地 svc API 客户端' },
  { name: 'PromptDialog', path: 'lowcode/components/ConfirmDialog', category: 'components', description: '通用输入对话框（替代 window.prompt）' },

  // 低代码编辑器
  { name: 'LowcodePage', path: 'lowcode/LowcodePage', category: 'components', isDefault: true, description: '低代码编辑器页面（仅桌面端）' },
  { name: 'lowcodeApi', path: 'lowcode/api', category: 'services', description: '低代码编辑器窗口 API' },
  { name: 'FlowCanvas', path: 'lowcode/components/FlowCanvas', category: 'components', description: 'React Flow 画布组件' },
  { name: 'OperatorPanel', path: 'lowcode/components/OperatorPanel', category: 'components', description: '算子面板组件' },
  { name: 'PropertyPanel', path: 'lowcode/components/PropertyPanel', category: 'components', description: '属性面板组件' },
  { name: 'Toolbar', path: 'lowcode/components/Toolbar', category: 'components', description: '低代码编辑器工具栏' },
  { name: 'ExecuteDialog', path: 'lowcode/components/ExecuteDialog', category: 'components', description: '流程执行对话框' },
  { name: 'WorkflowListDialog', path: 'lowcode/components/WorkflowListDialog', category: 'components', description: '流程列表对话框' },
  { name: 'CategoryConfigDialog', path: 'lowcode/components/CategoryConfigDialog', category: 'components', description: '分类配置对话框' },
  { name: 'TemplateDialog', path: 'lowcode/components/TemplateDialog', category: 'components', description: '模板选择对话框' },
  { name: 'VersionHistoryPanel', path: 'lowcode/components/VersionHistoryPanel', category: 'components', description: '版本历史面板' },
  { name: 'BatchExecuteDialog', path: 'lowcode/components/BatchExecuteDialog', category: 'components', description: '批量执行对话框' },
  { name: 'flowStore', path: 'lowcode/stores/flowStore', category: 'services', description: '低代码画布状态管理' },
  { name: 'operatorService', path: 'lowcode/services/operatorService', category: 'services', description: '算子服务 API' },
  { name: 'workflowService', path: 'lowcode/services/workflowService', category: 'services', description: '流程服务 API' },
  { name: 'apiClient', path: 'lowcode/services/apiClient', category: 'services', description: '低代码 API 客户端（带 Token 刷新）' },
  { name: 'categoryService', path: 'lowcode/services/categoryService', category: 'services', description: '分类配置服务 API' },
  { name: 'templateService', path: 'lowcode/services/templateService', category: 'services', description: '模板服务 API' },
  { name: 'versionService', path: 'lowcode/services/versionService', category: 'services', description: '版本管理服务 API' },
  { name: 'workflowSerializer', path: 'lowcode/utils/workflowSerializer', category: 'services', description: '流程序列化工具' },

  // 主题系统
  { name: 'themeIndex', path: 'theme/index', category: 'services', description: '主题系统入口' },
  { name: 'themeStore', path: 'theme/store', category: 'services', description: '主题状态管理' },
  { name: 'themeUtils', path: 'theme/utils', category: 'services', description: '主题颜色工具' },
  { name: 'themePresets', path: 'theme/presets', category: 'services', description: '主题预设配置（默认+自定义）' },
  { name: 'themeGenerator', path: 'theme/generator', category: 'services', description: '主题数据生成器' },
  { name: 'themeApi', path: 'theme/api', category: 'services', description: '主题编辑窗口 API' },
  { name: 'ThemeProvider', path: 'theme/ThemeProvider', category: 'components', description: '主题提供者组件' },
  { name: 'ThemeEditor', path: 'theme/ThemeEditor', category: 'components', description: '主题编辑器组件（内嵌式）' },
  { name: 'ThemeEditorPage', path: 'theme/ThemeEditorPage', category: 'components', isDefault: true, description: '主题编辑器独立窗口页面' },
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
  { name: 'DocumentDownloadAction', path: 'chat/shared/DocumentDownloadAction', category: 'chat', description: '文档下载/打开操作共享组件（聊天 + 我的文件复用）' },
  { name: 'MessageContextMenu', path: 'chat/shared/MessageContextMenu', category: 'chat', description: '消息右键菜单' },
  { name: 'ReadReceiptIcons', path: 'chat/shared/ReadReceiptIcons', category: 'chat', description: '已读回执 SVG 图标基元（时钟/双勾/失败）' },
  { name: 'PrivateReadReceipt', path: 'chat/shared/PrivateReadReceipt', category: 'chat', description: '私聊已读回执（仅自己消息：时钟/灰双勾/绿双勾/红叹号）' },
  { name: 'ReaderAvatarStack', path: 'chat/shared/ReaderAvatarStack', category: 'chat', description: '已读者头像堆叠（16px 重叠，超出显示 +N）' },
  { name: 'GroupReadReceipt', path: 'chat/group/GroupReadReceipt', category: 'chat', description: '群聊已读回执（绿双勾 + N 人已读 + 头像堆叠，点击展开名单）' },
  { name: 'GroupReadListModal', path: 'chat/group/GroupReadListModal', category: 'chat', description: '群已读名单弹层（桌面居中 modal / 移动底部 sheet）' },
  { name: 'MultiSelectActionBar', path: 'chat/shared/MultiSelectActionBar', category: 'chat', description: '多选操作栏' },
  { name: 'UploadProgress', path: 'chat/shared/UploadProgress', category: 'chat', description: '上传进度' },
  { name: 'OtherProfilePanel', path: 'chat/shared/OtherProfilePanel', category: 'chat', description: '他人公开资料面板（只读公开字段 + 关系状态；非好友可加好友）' },
  { name: 'OtherProfileView', path: 'chat/shared/OtherProfileView', category: 'chat', description: '他人资料页容器（桌面右抽屉 / 移动整页，订阅 profileViewStore）' },

  // 好友聊天组件
  { name: 'ChatMessages', path: 'chat/friend/ChatMessages', category: 'chat', description: '好友聊天消息列表' },
  { name: 'MessageBubble', path: 'chat/friend/MessageBubble', category: 'chat', description: '好友消息气泡' },

  // 群聊组件
  { name: 'GroupChatMessages', path: 'chat/group/GroupChatMessages', category: 'chat', description: '群聊消息列表' },
  { name: 'GroupMessageBubble', path: 'chat/group/GroupMessageBubble', category: 'chat', description: '群聊消息气泡' },
  { name: 'GroupRemarkInputModal', path: 'chat/group/GroupRemarkInputModal', category: 'chat', description: '群内私有备注输入弹窗（D7，右键「设置备注」触发）' },

  // AI 聊天组件
  { name: 'AIChatMessages', path: 'chat/ai/AIChatMessages', category: 'chat', description: 'AI 聊天消息列表' },
  { name: 'AIMessageBubble', path: 'chat/ai/AIMessageBubble', category: 'chat', description: 'AI 消息气泡' },
  { name: 'AIHistoryPanel', path: 'chat/ai/AIHistoryPanel', category: 'chat', description: 'AI 历史记录抽屉面板' },

  // 聊天菜单子组件
  { name: 'ConfirmDialog', path: 'chat/shared/menu/ConfirmDialog', category: 'chat', description: '确认对话框' },
  { name: 'EditNameForm', path: 'chat/shared/menu/EditNameForm', category: 'chat', description: '编辑名称表单' },
  { name: 'EditNicknameForm', path: 'chat/shared/menu/EditNicknameForm', category: 'chat', description: '编辑昵称表单' },
  { name: 'EditRemarkForm', path: 'chat/shared/menu/EditRemarkForm', category: 'chat', description: '设置好友备注表单（仅自己可见）' },
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
  { name: 'useFriends', path: 'hooks/useFriends', category: 'hooks', description: '好友列表 Hook' },
  { name: 'useGroups', path: 'hooks/useGroups', category: 'hooks', description: '群组列表 Hook' },
  { name: 'useFiles', path: 'hooks/useFiles', category: 'hooks', description: '文件管理 Hook' },
  { name: 'useFileUpload', path: 'hooks/useFileUpload', category: 'hooks', description: '文件上传 Hook' },
  { name: 'useFileCache', path: 'hooks/useFileCache', category: 'hooks', description: '文件缓存 Hook' },
  { name: 'useChatActions', path: 'hooks/useChatActions', category: 'hooks', description: '聊天操作 Hook' },
  { name: 'useChatMenu', path: 'chat/group/useChatMenu', category: 'hooks', description: '聊天菜单 Hook' },
  { name: 'useMultiSelect', path: 'hooks/useMultiSelect', category: 'hooks', description: '多选 Hook' },
  { name: 'useMainPage', path: 'hooks/useMainPage', category: 'hooks', description: '主页面 Hook' },
  { name: 'useAccounts', path: 'hooks/useAccounts', category: 'hooks', description: '账号管理 Hook' },
  { name: 'useProfileEditor', path: 'hooks/useProfileEditor', category: 'hooks', description: '个人资料编辑共享 Hook（桌面 ProfileModal + 移动 MobileProfilePage 共用：头像/昵称编辑）' },
  { name: 'useInitialSync', path: 'hooks/useInitialSync', category: 'hooks', description: '初始同步 Hook' },
  { name: 'useLocalConversations', path: 'hooks/useLocalConversations', category: 'hooks', description: '本地会话 Hook' },
  { name: 'useResizablePanel', path: 'hooks/useResizablePanel', category: 'hooks', description: '可调整面板 Hook' },
  { name: 'useSearchPopup', path: 'hooks/useSearchPopup', category: 'hooks', description: '搜索弹窗 Hook' },
  { name: 'useRegisterForm', path: 'hooks/useRegisterForm', category: 'hooks', description: '注册表单 Hook' },
  { name: 'useLocalFriendMessages', path: 'chat/friend/useLocalFriendMessages', category: 'hooks', description: '本地好友消息 Hook' },
  { name: 'useLocalGroupMessages', path: 'chat/group/useLocalGroupMessages', category: 'hooks', description: '本地群组消息 Hook' },
  { name: 'useScrollKeyboardControls', path: 'chat/shared/useScrollKeyboardControls', category: 'hooks', description: '消息容器键盘滚动控制 Hook（好友/群聊共用：End 到最新 / Home 到顶 / PageUp·PageDown 翻页 + 仅键盘聚焦判定）' },
  { name: 'useFriendReadReceipt', path: 'chat/friend/useFriendReadReceipt', category: 'hooks', description: '私聊已读回执 Hook（仅自己消息：拉对方 last-read-seq 快照 + read_sync 实时推进，Telegram 风单向）' },
  { name: 'useGroupReadReceipt', path: 'chat/group/useGroupReadReceipt', category: 'hooks', description: '群聊已读回执 Hook（read-positions 快照含昵称/头像/已读时间 + read_sync 实时合并，N 人已读 + 已读名单）' },
  { name: 'useAIMessages', path: 'chat/ai/useAIMessages', category: 'hooks', description: 'AI 消息管理 Hook' },
  { name: 'useWebRTC', path: 'meeting/useWebRTC', category: 'hooks', description: 'WebRTC Hook' },
  { name: 'useUpdateToast', path: 'update/components/UpdateToast', category: 'hooks', description: '更新弹窗状态管理 Hook' },
  { name: 'useNotificationSounds', path: 'hooks/useNotificationSounds', category: 'hooks', description: '提示音管理 Hook' },
  { name: 'useLanTransfer', path: 'hooks/useLanTransfer', category: 'hooks', description: '局域网传输 Hook' },
];

// ============== 服务 ==============
export const SERVICES: ComponentEntry[] = [
  { name: 'deviceInfo', path: 'services/deviceInfo', category: 'services', description: '设备信息服务' },
  { name: 'diagnosticService', path: 'services/diagnosticService', category: 'services', description: '诊断上报服务' },
  { name: 'fileCache', path: 'services/fileCache', category: 'services', description: '文件缓存服务' },
  { name: 'fileService', path: 'services/fileService', category: 'services', description: '文件服务' },
  { name: 'historyService', path: 'services/historyService', category: 'services', description: '历史服务' },
  { name: 'notificationService', path: 'services/notificationService', category: 'services', description: '通知服务' },
  { name: 'sessionLock', path: 'services/sessionLock', category: 'services', description: '会话锁服务（同账户单开）' },
  { name: 'syncService', path: 'services/syncService', category: 'services', description: '同步服务' },
  { name: 'updateService', path: 'update/service', category: 'services', description: '更新服务' },
  { name: 'settingsStore', path: 'stores/settingsStore', category: 'services', description: '设置状态管理' },
  // 工具模块
  { name: 'formatUtils', path: 'utils/format', category: 'services', description: '格式化工具函数' },
  // 聊天共享模块
  { name: 'chatAnimations', path: 'chat/shared/animations', category: 'services', description: '消息动画配置' },
  { name: 'aiApi', path: 'api/ai', category: 'services', description: 'AI 助手 API 封装' },
];

// ============== 所有组件汇总 ==============
export const ALL_COMPONENTS: ComponentEntry[] = [
  ...PAGE_COMPONENTS,
  ...MOBILE_COMPONENTS,
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
  mobile: MOBILE_COMPONENTS.length,
  common: COMMON_COMPONENTS.length,
  modals: MODAL_COMPONENTS.length,
  chat: CHAT_COMPONENTS.length,
  meeting: MEETING_COMPONENTS.length,
  media: MEDIA_COMPONENTS.length,
  hooks: HOOKS.length,
  services: SERVICES.length,
  total: ALL_COMPONENTS.length + HOOKS.length + SERVICES.length,
};
