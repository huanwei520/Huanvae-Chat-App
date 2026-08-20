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
  { name: 'MobileBotsPage', path: 'pages/mobile/MobileBotsPage', category: 'pages', description: '移动端机器人管理页（创建/加好友/重置token/删除 + SecretDisplay 一次性 token）' },
  { name: 'MobileProfilePage', path: 'pages/mobile/MobileProfilePage', category: 'pages', description: '移动端个人资料页（独立整屏页：顶部返回 + 右上保存 / 封面 banner + 身份 hero 卡 + 快览事实卡 + 分段 tab + 字段卡，编辑头像/昵称/邮箱/签名/密码/封面）' },
];

// ============== 全局搜索组件 ==============
export const SEARCH_COMPONENTS: ComponentEntry[] = [
  { name: 'GlobalMessageSearchResults', path: 'components/search/GlobalMessageSearchResults', category: 'components', description: '跨会话搜索结果浮层（六分类页签：消息/视频/图片/用户/群聊/机器人；移动+桌面共用）' },
  { name: 'globalSearchTabs', path: 'components/search/globalSearchTabs', category: 'services', description: '全局搜索六分类页签定义 + 页签→SQL 过滤映射（纯函数）' },
  { name: 'useGlobalMessageSearch', path: 'hooks/useGlobalMessageSearch', category: 'hooks', description: '全局消息搜索 Hook（500ms 防抖 + 可选 filter 下推 SQL + 按会话分组）' },
  { name: 'useDiscoverySearch', path: 'hooks/useDiscoverySearch', category: 'hooks', description: '服务端发现搜索 Hook（500ms 防抖；人/群/bot；头像边界解析）' },
  { name: 'ConversationMessageSearch', path: 'components/search/ConversationMessageSearch', category: 'components', description: '会话内消息查找视图（侧边面板内；点分类即按时间倒序列出，关键词再收窄）' },
  { name: 'ConversationSearchHit', path: 'components/search/ConversationSearchHit', category: 'components', description: '查找结果单条命中项（行/九宫格封面；左键打开预览、右键长按定位；媒体 src 经 useFileCache → 反代收口点）' },
  { name: 'ConversationSearchHitMenu', path: 'components/search/ConversationSearchHitMenu', category: 'components', description: '命中项右键/长按单项菜单「定位到聊天消息」+ 长按/键盘触发 Hook' },
  { name: 'useConversationMessageSearch', path: 'components/search/useConversationMessageSearch', category: 'hooks', description: '会话内查找 Hook（关键词可选 + SQL 层分类过滤 + limit/offset 分页）' },
  { name: 'messageCategory', path: 'components/search/messageCategory', category: 'services', description: '消息分类 ↔ content_type 映射（图片/视频/文件白名单，文字取补集）' },
  { name: 'conversationSearchTarget', path: 'components/search/conversationSearchTarget', category: 'services', description: 'ChatTarget → 会话内查找用 conversation_id（AI 会话返回 null）' },
  { name: 'highlightMatch', path: 'components/search/highlightMatch', category: 'services', description: '搜索关键词高亮切片（全局搜索 + 会话内查找共用）' },
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
  { name: 'downloadSpeed', path: 'update/downloadSpeed', category: 'services', description: '下载实时速率估算（EMA α=0.3，复用两端已有的 200ms 进度上报，不新增定时器）' },
];

// ============== 股票研究窗口 ==============
export const STOCK_COMPONENTS: ComponentEntry[] = [
  { name: 'StockPage', path: 'stocks/StockPage', category: 'pages', isDefault: true, description: '股票研究页面（独立 WebviewWindow，三视图切换）' },
  { name: 'stocksApi', path: 'api/stocks', category: 'services', description: '股票研究域 API 封装（/api/stocks/*，薄封装）' },
  { name: 'stocksFormat', path: 'stocks/format', category: 'services', description: '股票格式化纯函数（涨跌方向/百分比/金额/时点）' },
  { name: 'stocksWindow', path: 'stocks/window', category: 'services', description: '股票窗口开窗器 + URL 编解码纯函数' },
  { name: 'useStockNav', path: 'stocks/store', category: 'hooks', description: '股票窗口视图导航 store（overview/stock/etf）' },
  { name: 'useDebouncedValue', path: 'stocks/hooks/useDebouncedValue', category: 'hooks', description: '通用防抖值 Hook（股票搜索用，默认 220ms）' },
  { name: 'useAsyncData', path: 'stocks/hooks/useAsyncData', category: 'hooks', description: '逐面板异步数据 Hook（loading/error/reload）' },
  { name: 'useQuotePolling', path: 'stocks/hooks/useQuotePolling', category: 'hooks', description: '盘口行情轮询 Hook（6s，离开即停）' },
  { name: 'useEscapeKey', path: 'stocks/hooks/useEscapeKey', category: 'hooks', description: 'Escape 全局监听 Hook（详情页 Esc=返回总览）' },
  { name: 'stocksSearchNav', path: 'stocks/components/searchNav', category: 'services', description: '搜索下拉键盘导航纯逻辑（moveActiveIndex + option id）' },
  { name: 'stocksClassify', path: 'stocks/classify', category: 'services', description: '标的/错误分类纯函数（指数判定 + 404快照缺失判定）' },
  { name: 'OverviewView', path: 'stocks/views/OverviewView', category: 'components', description: '总览视图（政策/排行榜/准确率/ETF/新闻）' },
  { name: 'StockDetailView', path: 'stocks/views/StockDetailView', category: 'components', description: '个股详情视图（K线/盘口/情报/财报）' },
  { name: 'EtfDetailView', path: 'stocks/views/EtfDetailView', category: 'components', description: 'ETF 详情视图（K线不复权/信息卡/盘口）' },
  { name: 'KLineChart', path: 'stocks/components/KLineChart', category: 'components', description: 'K 线图（klinecharts 封装）' },
  { name: 'PanelBody', path: 'stocks/components/PanelBody', category: 'components', description: '面板 loading/error/empty/内容 四态收口' },
  { name: 'MarketWeatherPanel', path: 'stocks/components/MarketWeatherPanel', category: 'components', description: '市场天气面板（regime 天气标签 + 置信度 + 情绪 + 广度 + flags + 30 日色带 + 免责，进场 stagger）' },
  { name: 'RankingPanel', path: 'stocks/components/RankingPanel', category: 'components', description: 'AI 选股排行榜面板（A2 动画）' },
  { name: 'PolicyPanel', path: 'stocks/components/PolicyPanel', category: 'components', description: '政策风向面板（A6 动画）' },
  { name: 'NewsPanel', path: 'stocks/components/NewsPanel', category: 'components', description: '新闻列表面板（A6 动画）' },
  { name: 'AccuracyPanel', path: 'stocks/components/AccuracyPanel', category: 'components', description: '准确率面板（窗口表+历史榜）' },
  { name: 'EtfListPanel', path: 'stocks/components/EtfListPanel', category: 'components', description: 'ETF 两品类列表面板' },
  { name: 'IntelPanel', path: 'stocks/components/IntelPanel', category: 'components', description: 'AI 情报面板' },
  { name: 'FinancialsPanel', path: 'stocks/components/FinancialsPanel', category: 'components', description: '财报摘要面板' },
  { name: 'DepthPanel', path: 'stocks/components/DepthPanel', category: 'components', description: '盘口五档面板（B4 动画）' },
  { name: 'PriceTicker', path: 'stocks/components/PriceTicker', category: 'components', description: '价格/涨跌显示（A3 动画）' },
  { name: 'StockSearchBox', path: 'stocks/components/StockSearchBox', category: 'components', description: '股票搜索框（SearchBox 外壳 + 防抖 + 结果）' },
];

// ============== 通用组件 ==============
export const COMMON_COMPONENTS: ComponentEntry[] = [
  // 通用 UI 组件
  { name: 'Avatar', path: 'components/common/Avatar', category: 'components', description: '头像组件' },
  { name: 'AvatarPlaceholder', path: 'components/common/AvatarPlaceholder', category: 'components', description: '统一头像占位组件（首字母 + 确定性渐变，收敛全 App 占位）' },
  { name: 'BotBadge', path: 'components/common/BotBadge', category: 'components', description: '统一 Bot 徽章（列表/资料页/聊天顶栏 bot 身份标识，颜色引用 --bot-badge-* token）' },
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
  { name: 'SidebarMorePanel', path: 'components/sidebar/SidebarMorePanel', category: 'components', description: '侧边栏"更多"浮层面板(dnd-kit 双区拖放:面板内排序 + 拖到侧边栏钉住,布局持久化 localStorage)' },

  // 统一列表
  { name: 'UnifiedList', path: 'components/unified/UnifiedList', category: 'components', description: '统一列表组件' },
  { name: 'ConversationContextMenu', path: 'components/unified/ConversationContextMenu', category: 'components', description: '会话置顶右键/长按菜单（桌面右键 + 移动长按，单项置顶/取消置顶）' },

  // 账号相关
  { name: 'CardStack', path: 'components/account/CardStack', category: 'components', description: '卡片堆叠组件' },
  { name: 'CardSlot', path: 'components/account/CardSlot', category: 'components', description: '卡片槽组件' },

  // 个人资料相关
  { name: 'ProfileModal', path: 'components/ProfileModal', category: 'components', description: '个人资料模态框' },
  { name: 'AvatarUploader', path: 'components/profile/AvatarUploader', category: 'components', description: '头像上传组件' },
  { name: 'PasswordForm', path: 'components/profile/PasswordForm', category: 'components', description: '密码表单' },
  { name: 'ProfileInfoForm', path: 'components/profile/ProfileInfoForm', category: 'components', description: '个人信息表单（邮箱/签名/性别/生日/地区 + 注册时间）' },
  { name: 'ProfileCoverActions', path: 'components/profile/ProfileCoverActions', category: 'components', description: '资料封面换/重置入口（桌面+移动共用）' },
  { name: 'PrivacySettingsForm', path: 'components/profile/PrivacySettingsForm', category: 'components', description: '隐私/申请处理设置表单（搜索可见性 + 好友/群申请默认策略）' },

  // 文件相关
  { name: 'FilesModal', path: 'components/files/FilesModal', category: 'components', description: '文件管理模态框' },
  { name: 'FileContextMenu', path: 'components/files/FileContextMenu', category: 'components', description: '我的文件右键/长按菜单（纯展示组件）' },
  { name: 'FileMenuController', path: 'components/files/FileMenuController', category: 'components', description: '我的文件菜单状态解析器（订阅 useFileCache + selectDownloadTask 决定菜单项）' },

  // 机器人管理
  { name: 'BotsModal', path: 'components/bots/BotsModal', category: 'components', description: '机器人管理模态框（BotFather 式：创建/加好友/重置token/删除）' },

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
  { name: 'PromptDialog', path: 'components/common/ConfirmDialog', category: 'components', description: '通用输入对话框（替代 window.prompt）' },

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
  // 会话列表"+"轻量菜单 + 待通过申请 + 创建 bot（req-23，取代旧 AddModal/modals/add tab 页）
  { name: 'AddMenu', path: 'components/unified/AddMenu', category: 'components', description: '会话列表"+"轻量下拉（创建群/创建bot/待通过申请）' },
  { name: 'PendingRequestsPanel', path: 'components/unified/PendingRequestsPanel', category: 'components', description: '待通过申请面板（收到需处理 + 我发出的仅展示，无撤回）' },
  { name: 'CreateBotDialog', path: 'components/bots/CreateBotDialog', category: 'components', description: '创建机器人表单（共享；bot 后缀校验 + 推荐 chip）' },
  { name: 'ShareTargetPicker', path: 'components/share/ShareTargetPicker', category: 'components', description: '分享目标选择器（A 版快捷卡：最近/好友/群组合并成一条列表 + 已选 chip；内容预览为 slot、发送由调用方注入，转发消息/会议邀请/群名片共用）' },
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
  { name: 'ForwardMessageModal', path: 'chat/shared/ForwardMessageModal', category: 'chat', description: '转发消息面板（A 版快捷卡：顶部转发内容预览 + 通用 ShareTargetPicker；不提供附言、不区分合并/逐条）' },
  { name: 'forwardMessage', path: 'chat/shared/forwardMessage', category: 'chat', description: '转发语义边界纯函数（可转发判定 / 内容摘要 / 私聊与群请求体构造：复用 file_uuid、不带 reply_to、丢弃媒体组三件套）' },
  { name: 'groupCard', path: 'chat/shared/groupCard', category: 'chat', description: '群名片（group_card）内容编解码纯函数（封闭 schema：只许 group_id 一个键；发送三态错误文案）' },
  { name: 'messagePreviewText', path: 'chat/shared/messagePreviewText', category: 'chat', description: '会话预览文案映射纯函数（离线同步 + 撤回/删除后刷新共用一份表；未知类型绝不回落 content 原文，防 meeting_invite 的 password 印到会话列表上）' },
  { name: 'GroupCardMessage', path: 'chat/shared/GroupCardMessage', category: 'chat', description: '群名片消息气泡（凭 group_id 现拉 /public 渲染群名/头像/人数；404 与解析失败走失效态；点击进群详情面板）' },
  { name: 'ShareGroupCardModal', path: 'chat/shared/ShareGroupCardModal', category: 'chat', description: '分享群名片面板（复用 ShareTargetPicker 选人；好友走 sendMessage、群走 sendGroupMessage；400/403/404 三态文案）' },
  { name: 'ReadReceiptIcons', path: 'chat/shared/ReadReceiptIcons', category: 'chat', description: '已读回执 SVG 图标基元（时钟/双勾/失败）' },
  { name: 'PrivateReadReceipt', path: 'chat/shared/PrivateReadReceipt', category: 'chat', description: '私聊已读回执（仅自己消息：时钟/红叹号/绿双勾；未读不渲染）' },
  { name: 'readReceiptGate', path: 'chat/shared/readReceiptGate', category: 'chat', description: '已读标记门控纯函数（只挂我发出的最新一条，私聊+群聊共用锚点）' },
  { name: 'senderRunGate', path: 'chat/shared/senderRunGate', category: 'chat', description: '群聊连发合并的两个锚点纯函数（头像挂组内最新那条 / 昵称挂组内最旧那条，撤回行断组）' },
  { name: 'senderNameColor', path: 'chat/shared/senderNameColor', category: 'chat', description: '群聊气泡昵称的配色索引纯函数（按 sender_id 稳定散列，色值在 CSS 按 data-sender-hue 取）' },
  { name: 'mediaDisplaySize', path: 'chat/shared/mediaDisplaySize', category: 'chat', description: '气泡内媒体的显示上限盒 + 容器样式纯函数（限高只截高、宽度走 max-width:100% + aspect-ratio）' },
  { name: 'ChatTargetAvatar', path: 'chat/shared/ChatTargetAvatar', category: 'chat', description: '会话顶栏头像（1:1 给对方头像 / 群给群头像 / AI 无），桌面+移动两个顶栏共用同一条归属规则' },
  { name: 'videoPosterSrc', path: 'chat/shared/videoPosterSrc', category: 'chat', description: '视频缩略图 src 追加 #t=0.1 的纯函数（逼 WKWebView / Android WebView seek 出封面；只在元素层用，绝不进 resolver）' },
  { name: 'VideoThumbnail', path: 'chat/shared/VideoThumbnail', category: 'chat', description: '视频缩略图共享组件：全仓唯一一处把 <video> 当封面渲染（取源 / #t=0.1 / preload / muted / playsInline 全在里面），四个消费点只调它' },
  { name: 'ReaderAvatarStack', path: 'chat/shared/ReaderAvatarStack', category: 'chat', description: '已读者头像堆叠（16px 重叠，超出显示 +N）' },
  { name: 'GroupReadReceipt', path: 'chat/group/GroupReadReceipt', category: 'chat', description: '群聊已读回执（绿双勾 + N 人已读 + 头像堆叠，点击展开名单）' },
  { name: 'GroupReadListModal', path: 'chat/group/GroupReadListModal', category: 'chat', description: '群已读名单弹层（桌面居中 modal / 移动底部 sheet）' },
  { name: 'ReplyComposeBar', path: 'chat/shared/ReplyComposeBar', category: 'chat', description: '输入框上方「正在回复」条（群聊回复，桌面+移动共用 ChatInputArea 渲染）' },
  { name: 'MultiSelectActionBar', path: 'chat/shared/MultiSelectActionBar', category: 'chat', description: '多选操作栏' },
  { name: 'UploadProgress', path: 'chat/shared/UploadProgress', category: 'chat', description: '上传进度' },
  { name: 'OtherProfilePanel', path: 'chat/shared/OtherProfilePanel', category: 'chat', description: '他人公开资料面板（只读公开字段 + 关系状态；非好友可加好友）' },
  { name: 'OtherProfileView', path: 'chat/shared/OtherProfileView', category: 'chat', description: '他人资料页容器（桌面右抽屉 / 移动整页，订阅 profileViewStore）' },
  { name: 'GroupDetailPanel', path: 'chat/shared/GroupDetailPanel', category: 'chat', description: '群详情面板（未加入群公开信息 + 加入/申请多态按钮）' },
  { name: 'GroupDetailView', path: 'chat/shared/GroupDetailView', category: 'chat', description: '群详情弹窗容器（桌面右抽屉/移动整页，订阅 groupDetailStore）' },

  // 好友聊天组件
  { name: 'ChatMessages', path: 'chat/friend/ChatMessages', category: 'chat', description: '好友聊天消息列表' },
  { name: 'MessageBubble', path: 'chat/friend/MessageBubble', category: 'chat', description: '好友消息气泡' },

  // 群聊组件
  { name: 'GroupChatMessages', path: 'chat/group/GroupChatMessages', category: 'chat', description: '群聊消息列表' },
  { name: 'GroupMessageBubble', path: 'chat/group/GroupMessageBubble', category: 'chat', description: '群聊消息气泡' },
  { name: 'GroupRemarkInputModal', path: 'chat/group/GroupRemarkInputModal', category: 'chat', description: '群内私有备注输入弹窗（D7，右键「设置备注」触发）' },
  { name: 'ReplyQuote', path: 'chat/shared/ReplyQuote', category: 'chat', description: '消息气泡内的被引用消息块（Telegram 风格，点击定位原消息；群聊+私聊共用）' },
  { name: 'JumpToLatestButton', path: 'chat/shared/JumpToLatestButton', category: 'chat', description: '「回到最新」浮动按钮（离底才浮出，点击滚回 scrollTop=0；column-reverse 坐标，桌面+移动共用）' },

  // bot 斜杠命令 + 会话顶置架
  { name: 'SlashCommandPanel', path: 'chat/shared/SlashCommandPanel', category: 'chat', description: '斜杠命令面板（bot 会话输入 / 弹命令、填入不直发，portal 弹层）' },
  { name: 'ConversationShelf', path: 'chat/shared/ConversationShelf', category: 'chat', description: '顶置功能区常驻窄条（bot/群会话，权限入口显隐，点弹浮层卡）' },
  { name: 'ShelfCardOverlay', path: 'chat/shared/ShelfCardOverlay', category: 'chat', description: '顶置架浮层卡（复用 CardRenderer 渲染引用的卡片消息 + 群主管理）' },

  // 可交互卡片
  { name: 'CardRenderer', path: 'chat/shared/CardRenderer', category: 'chat', description: '可交互卡片渲染器(18 类声明式白名单 + live patch + 双受众)' },
  { name: 'ActionButton', path: 'chat/shared/ActionButton', category: 'chat', description: '动作按钮(执行中/成功/失败/二次确认本地状态机,卡片与运维面板共用)' },
  { name: 'CardChart', path: 'chat/shared/CardChart', category: 'chat', description: '卡片图表节点(klinecharts 封装,声明式 spec,canvas 自绘动画)' },

  // AI 聊天组件
  { name: 'AIChatMessages', path: 'chat/ai/AIChatMessages', category: 'chat', description: 'AI 聊天消息列表' },
  { name: 'AIMessageBubble', path: 'chat/ai/AIMessageBubble', category: 'chat', description: 'AI 消息气泡' },
  { name: 'AIHistoryPanel', path: 'chat/ai/AIHistoryPanel', category: 'chat', description: 'AI 历史记录抽屉面板' },

  // 聊天菜单子组件
  { name: 'ChatMenuPanel', path: 'chat/shared/ChatMenuPanel', category: 'chat', description: '聊天设置侧边滑出面板（右侧抽屉外壳）' },
  { name: 'ConfirmDialog', path: 'chat/shared/menu/ConfirmDialog', category: 'chat', description: '确认对话框' },
  { name: 'EditNameForm', path: 'chat/shared/menu/EditNameForm', category: 'chat', description: '编辑名称表单' },
  { name: 'EditNicknameForm', path: 'chat/shared/menu/EditNicknameForm', category: 'chat', description: '编辑昵称表单' },
  { name: 'EditRemarkForm', path: 'chat/shared/menu/EditRemarkForm', category: 'chat', description: '设置好友备注表单（仅自己可见）' },
  { name: 'InviteForm', path: 'chat/shared/menu/InviteForm', category: 'chat', description: '邀请成员表单（附言 + 复用 ShareTargetPicker 只选好友）' },
  { name: 'JoinPolicyForm', path: 'chat/shared/menu/JoinPolicyForm', category: 'chat', description: '入群与可见性设置（仅群主；两开关 + 三档 scope，只发被改的键、不做乐观更新）' },
  { name: 'MainMenu', path: 'chat/shared/menu/MainMenu', category: 'chat', description: '主菜单' },
  { name: 'MemberActions', path: 'chat/shared/menu/MemberActions', category: 'chat', description: '成员操作' },
  { name: 'MemberGrid', path: 'chat/shared/menu/MemberGrid', category: 'chat', description: '群成员头像网格（侧边面板第一组，微信式；折叠 10 个 + 查看更多）' },
  { name: 'MembersList', path: 'chat/shared/menu/MembersList', category: 'chat', description: '成员列表' },
  { name: 'MenuHeader', path: 'chat/shared/menu/MenuHeader', category: 'chat', description: '菜单头部' },
  { name: 'MuteSettings', path: 'chat/shared/menu/MuteSettings', category: 'chat', description: '静音设置' },
  { name: 'NoticesList', path: 'chat/shared/menu/NoticesList', category: 'chat', description: '公告列表' },
  { name: 'TransferOwner', path: 'chat/shared/menu/TransferOwner', category: 'chat', description: '转让群主' },
  { name: 'ComposerTray', path: 'chat/shared/ComposerTray', category: 'chat', description: '预发送待发区（Telegram 式）：粘贴/选择/拖入的附件先落输入框上方的缩略图条，可逐个删除、继续追加、混合类型；超体积/超数量当场明说不静默截断；桌面/移动共用' },
  { name: 'SendingMediaOverlay', path: 'chat/shared/SendingMediaOverlay', category: 'chat', description: '单项上传态覆盖层：进度从输入框上方搬进气泡里的每个媒体自身（pending 转圈 / uploading 环形百分比 + 取消 / failed 只重试这一项 / done 不渲染）' },
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
  { name: 'useProfileEditor', path: 'hooks/useProfileEditor', category: 'hooks', description: '个人资料编辑共享 Hook（头像/昵称/背景封面编辑，桌面+移动共用）' },
  { name: 'usePendingRequests', path: 'hooks/usePendingRequests', category: 'hooks', description: '待通过申请管理 Hook（四类合并单列表 + 同意/拒绝/接受/拒绝，桌面+移动共用）' },
  { name: 'useInitialSync', path: 'hooks/useInitialSync', category: 'hooks', description: '初始同步 Hook' },
  { name: 'useLocalConversations', path: 'hooks/useLocalConversations', category: 'hooks', description: '本地会话 Hook' },
  { name: 'useResizablePanel', path: 'hooks/useResizablePanel', category: 'hooks', description: '可调整面板 Hook' },
  { name: 'useSearchPopup', path: 'hooks/useSearchPopup', category: 'hooks', description: '搜索弹窗 Hook' },
  { name: 'useRegisterForm', path: 'hooks/useRegisterForm', category: 'hooks', description: '注册表单 Hook' },
  { name: 'useLocalFriendMessages', path: 'chat/friend/useLocalFriendMessages', category: 'hooks', description: '本地好友消息 Hook' },
  { name: 'useLocalGroupMessages', path: 'chat/group/useLocalGroupMessages', category: 'hooks', description: '本地群组消息 Hook' },
  { name: 'useScrollKeyboardControls', path: 'chat/shared/useScrollKeyboardControls', category: 'hooks', description: '消息容器键盘滚动控制 Hook（好友/群聊共用：End 到最新 / Home 到顶 / PageUp·PageDown 翻页 + 仅键盘聚焦判定）' },
  { name: 'useStickToBottom', path: 'chat/shared/useStickToBottom', category: 'hooks', description: '新消息到达是否贴回最新一条（好友/bot/群聊共用的唯一判据：自己发的无条件滚底；对方发的靠 IntersectionObserver 判「最新那条插入前是否可见」，被完全遮住则不打扰）' },
  { name: 'useKbdFocusRing', path: 'hooks/useKbdFocusRing', category: 'hooks', description: '键盘可见焦点环双轨 Hook（可点击头像/顶栏容器：pointerDown 区分键盘/鼠标聚焦，keyed 设计，键盘聚焦加 a11y-kbd-focus 类）' },
  { name: 'useFriendReadReceipt', path: 'chat/friend/useFriendReadReceipt', category: 'hooks', description: '私聊已读回执 Hook（仅自己消息：拉对方 last-read-seq 快照 + read_sync 实时推进，Telegram 风单向）' },
  { name: 'useGroupReadReceipt', path: 'chat/group/useGroupReadReceipt', category: 'hooks', description: '群聊已读回执 Hook（read-positions 快照含昵称/头像/已读时间 + read_sync 实时合并，N 人已读 + 已读名单）' },
  { name: 'useAIMessages', path: 'chat/ai/useAIMessages', category: 'hooks', description: 'AI 消息管理 Hook' },
  { name: 'useWebRTC', path: 'meeting/useWebRTC', category: 'hooks', description: 'WebRTC Hook' },
  { name: 'useNotificationSounds', path: 'hooks/useNotificationSounds', category: 'hooks', description: '提示音管理 Hook' },
  { name: 'useLanTransfer', path: 'hooks/useLanTransfer', category: 'hooks', description: '局域网传输 Hook' },
  { name: 'useBots', path: 'hooks/useBots', category: 'hooks', description: '机器人管理 Hook（列表/创建/删除/重置token/按 username 加好友）' },
  { name: 'useTopLayer', path: 'hooks/useTopLayer', category: 'hooks', description: '顶层浮层注册表（portal 兄弟浮层的层级判定：顶层开着时底层「点击外部关闭」短路）' },
  { name: 'useVideoPoster', path: 'chat/shared/useVideoPoster', category: 'hooks', description: '视频封面解析状态机（pending/poster/capture 三态；VideoThumbnail 的内部 Hook，本地已存封面就渲染 <img> 不建 <video>）' },
  { name: 'useComposerTrayOutbox', path: 'chat/shared/useComposerTrayOutbox', category: 'hooks', description: '待发区发送编排（四格矩阵定形 → 全量乐观插入 → 串行逐项上传 → 逐项落库；单项失败只重试那一项，形态发送前定死不再改）' },
  { name: 'useSendingOutboxMerge', path: 'chat/shared/useSendingOutboxMerge', category: 'hooks', description: '在途媒体并进消息列表（乐观条目排最前 + 真 uuid 到位后收口，同一 uuid 只渲染一条；私聊/群共用同一合并口径）' },
  { name: 'useBatchForward', path: 'chat/shared/useBatchForward', category: 'hooks', description: '多选批量转发的状态与取数（桌面 ChatPanel 与移动 MobileChatView 共用：谁是发送者 / 哪些能转 / 按发送时间升序）' },
];

// ============== 服务 ==============
export const SERVICES: ComponentEntry[] = [
  { name: 'deviceInfo', path: 'services/deviceInfo', category: 'services', description: '设备信息服务' },
  { name: 'diagnosticService', path: 'services/diagnosticService', category: 'services', description: '诊断上报服务' },
  { name: 'fileCache', path: 'services/fileCache', category: 'services', description: '文件缓存服务' },
  { name: 'assetUrl', path: 'services/assetUrl', category: 'services', description: '本地文件路径 → webview 显示 src 的唯一转换点（convertFileSrc + Android 百分号编码修复；图片缓存与视频封面共用）' },
  { name: 'videoPoster', path: 'services/videoPoster', category: 'services', description: '视频封面本地持久化编排（读 video_posters 索引 / 未命中截一次落盘 / 同 hash 去重 + 并发上限 2 / 失败本会话不重试）' },
  { name: 'videoPosterCapture', path: 'services/videoPosterCapture', category: 'services', description: '视频首帧截取（离屏 crossOrigin video + canvas → JPEG 字节；离屏是为了不给可见缩略图引入 CORS 失败风险）' },
  { name: 'fileService', path: 'services/fileService', category: 'services', description: '文件服务' },
  { name: 'historyService', path: 'services/historyService', category: 'services', description: '历史服务' },
  { name: 'notificationService', path: 'services/notificationService', category: 'services', description: '通知服务' },
  { name: 'sessionLock', path: 'services/sessionLock', category: 'services', description: '会话锁服务（同账户单开）' },
  { name: 'syncService', path: 'services/syncService', category: 'services', description: '同步服务' },
  { name: 'updateService', path: 'update/service', category: 'services', description: '更新服务' },
  { name: 'settingsStore', path: 'stores/settingsStore', category: 'services', description: '设置状态管理' },
  { name: 'sandboxEscape', path: 'chat/shared/sandboxEscape', category: 'services', description: '沙箱逃逸阀(独立 WebviewWindow + 来源白名单 + initData HMAC,默认关闭)' },
  // bot 斜杠命令 + 会话顶置架数据面
  { name: 'shelfApi', path: 'api/shelf', category: 'services', description: '顶置架 API 封装（GET/POST/DELETE/PATCH order；/api/conversations/{scope}/{key}/shelf）' },
  { name: 'shelfStore', path: 'stores/shelfStore', category: 'services', description: '顶置架状态管理（按 scope|scopeKey 分桶，REST + WS shelf_updated 整组替换）' },
  { name: 'botCommandsStore', path: 'stores/botCommandsStore', category: 'services', description: 'Bot 指令缓存（按 bot_user_id 分桶，getBotCommands 拉取，失败存空）' },
  { name: 'slashCommands', path: 'chat/shared/slashCommands', category: 'services', description: '斜杠命令面板纯逻辑（parseSlashQuery + filterCommands）' },
  { name: 'replyPreview', path: 'chat/shared/replyPreview', category: 'services', description: '消息回复引用纯逻辑（摘要压行 + uuid→预览索引 + reply_to 解析，含未加载占位；群聊+私聊共用）' },
  { name: 'AlbumMessage', path: 'chat/shared/AlbumMessage', category: 'chat', description: '相册（媒体组）气泡内容：Telegram 风格网格 + 整组配文在网格下方；格高按 aspect-ratio 预留、缺口按 expectedCount 占位（跨分页不重排）；每格复用 FileMessageContent 以免新增显示点' },
  { name: 'MediaBubbleFrame', path: 'chat/shared/MediaBubbleFrame', category: 'chat', description: '媒体 + 配文的同一个大气泡（Telegram 式 media + caption）：相册 / 单图 / 单视频共用一层渲染包裹，媒体贴气泡上沿、配文在下方有内边距；无配文时一个节点都不产生；配文判定单一收口 resolveMediaCaption（带「[图片] 文件名」前缀 = 无配文）；形态由 media 声明——single 多出一层 .media-bubble-media 媒体带（撑满气泡宽、图居中、余下补黑），album 原样放网格' },
  { name: 'MediaGalleryProvider', path: 'chat/shared/MediaGalleryProvider', category: 'chat', description: '会话媒体序列上下文 + 全屏预览宿主：整条会话共用一个浮层（原先每条消息各挂一个，于是「切到上一张」在结构上不可达），序列在打开那一刻快照、不随新消息漂移' },
  { name: 'AlbumComposer', path: 'chat/shared/AlbumComposer', category: 'chat', description: '相册合成面板（Telegram 风格）：多选后缩略图横排 + 可逐张剔除 + 整组配文，确认后交给串行上传；超过上限显式提示不静默截断；桌面/移动共用同一组件' },
  { name: 'albumSend', path: 'chat/shared/albumSend', category: 'services', description: '相册发送编排纯逻辑（位次分配 + 配文只挂 index=0 + 串行上传 + 传一半失败即停并如实上报）' },
  { name: 'mediaGallery', path: 'chat/shared/mediaGallery', category: 'services', description: '会话媒体序列纯逻辑（把渲染节点摊平成图片+视频的升序序列，相册内按 media_group_index；撤回/无 file_uuid/非媒体不入列；边界到头即 null，不循环）—— 全屏预览左右切上一张/下一张的数据面' },
  { name: 'mediaSwipe', path: 'chat/shared/mediaSwipe', category: 'services', description: '横向切图手势判定纯逻辑（放大态与双指一律让给缩放层；方向/阈值/边界阻尼回弹）' },
  { name: 'mediaZoomState', path: 'chat/shared/mediaZoomState', category: 'services', description: '全屏预览放大态的单一真值源：缩放层写（useImageZoom）、横向切图层读，两层手势的唯一交界' },
  { name: 'mediaGroup', path: 'chat/shared/mediaGroup', category: 'services', description: '媒体组（相册）聚合纯逻辑（N 条独立消息按 media_group_id 折叠成一个渲染节点，index 升序、保留 expectedCount 供跨分页占位、caption 只认 index=0；群聊+私聊共用）' },
  { name: 'conversationKey', path: 'chat/shared/conversationKey', category: 'services', description: '会话身份 key 纯逻辑（草稿与回复草稿的归属校验共用同一口径，key 格式单一真值源）' },
  { name: 'scrollMessageIntoView', path: 'chat/shared/scrollMessageIntoView', category: 'services', description: '消息定位滚动（手算消息列表容器 scrollTop 居中，不用 scrollIntoView 以免沿祖先链冒泡把整个 App 顶上去；桌面+移动共用）' },
  // 工具模块
  { name: 'formatUtils', path: 'utils/format', category: 'services', description: '格式化工具函数' },
  { name: 'avatarColor', path: 'utils/avatarColor', category: 'services', description: '头像占位首字母 + emoji 判定 + 白底/描边/固定蓝渐变样式常量（引用 --avatar-placeholder-* 设计 token，固定蓝不随主题）纯函数' },
  // 聊天共享模块
  { name: 'chatAnimations', path: 'chat/shared/animations', category: 'services', description: '消息动画配置' },
  { name: 'aiApi', path: 'api/ai', category: 'services', description: 'AI 助手 API 封装' },
  // 会议 WebRTC 纯函数核心
  { name: 'webrtcCore', path: 'meeting/webrtcCore', category: 'services', description: 'WebRTC perfect-negotiation 纯函数（极性/忽略判定/媒体分类/退避/候选缓冲）' },
  // 预发送待发区（M-5）数据面
  { name: 'composerTrayPlan', path: 'chat/shared/composerTrayPlan', category: 'services', description: '待发区→发送计划纯逻辑（四格矩阵；单条绝不带 media_group 三件套；按后端类型分族切形态；caption 只挂整批第一项）' },
  { name: 'composerTrayStore', path: 'stores/composerTrayStore', category: 'services', description: '待发区状态（按会话分桶，逐个删除/继续追加，超体积与超数量当场挡下并回报文件名）' },
  { name: 'sendingMediaStore', path: 'stores/sendingMediaStore', category: 'services', description: '发送态状态机（pending/uploading/done/failed + 单项重试；形态发送前定死不再改；乐观条目并入消息列表的唯一去重口径）' },
  { name: 'uploadPersist', path: 'chat/shared/uploadPersist', category: 'services', description: '上传成功后的本地落库（UUID↔Hash 映射 + 文件缓存 + 消息入本地库，caption 生效时取代文件名派生正文）' },
  { name: 'sendingMediaActions', path: 'chat/shared/sendingMediaActions', category: 'services', description: '在途发送项的重试/取消收口（模块级函数直接操作 store；气泡里不许再起 useComposerTrayOutbox 实例——那会多出一个泵导致并发上传）' },
  { name: 'uploadAbortRegistry', path: 'chat/shared/uploadAbortRegistry', category: 'services', description: '在途上传的 AbortController 模块级注册表（原先是 useComposerTrayOutbox 的实例内 useRef，气泡侧的取消入口够不着它 ⇒ abort 恒为 no-op ⇒ 点了取消消息照样落库）' },
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
