/**
 * 组件注册表测试
 * 验证所有注册的组件能够正常导入
 *
 * 此测试确保：
 * 1. 所有组件文件存在
 * 2. 组件能够正常导入（无语法错误）
 * 3. 导出的模块不为空
 */

import { describe, it, expect } from 'vitest';
import {
  PAGE_COMPONENTS,
  MOBILE_COMPONENTS,
  SEARCH_COMPONENTS,
  NFC_COMPONENTS,
  UPDATE_COMPONENTS,
  STOCK_COMPONENTS,
  COMMON_COMPONENTS,
  MODAL_COMPONENTS,
  CHAT_COMPONENTS,
  MEETING_COMPONENTS,
  MEDIA_COMPONENTS,
  HOOKS,
  SERVICES,
  REGISTRY_STATS,
} from '../registry';

// ============== 静态导入所有组件 ==============
// 页面组件
import * as MainPage from '../../src/pages/Main';
import * as LoginPage from '../../src/pages/Login';
import * as RegisterPage from '../../src/pages/Register';
import * as AccountSelectorPage from '../../src/pages/AccountSelector';

// 移动端组件
import * as MobileHeader from '../../src/pages/mobile/MobileHeader';
import * as MobileMain from '../../src/pages/mobile/MobileMain';
import * as MobileThemePage from '../../src/pages/mobile/MobileThemePage';
import * as MobileMiniAppsPage from '../../src/pages/mobile/MobileMiniAppsPage';
import * as MobileBotsPage from '../../src/pages/mobile/MobileBotsPage';
import * as MobileProfilePage from '../../src/pages/mobile/MobileProfilePage';

// 全局搜索组件
import * as GlobalMessageSearchResults from '../../src/components/search/GlobalMessageSearchResults';
import * as globalSearchTabs from '../../src/components/search/globalSearchTabs';
import * as useGlobalMessageSearch from '../../src/hooks/useGlobalMessageSearch';
// 会话内消息查找
import * as ConversationMessageSearch from '../../src/components/search/ConversationMessageSearch';
import * as ConversationSearchHit from '../../src/components/search/ConversationSearchHit';
import * as ConversationSearchHitMenu from '../../src/components/search/ConversationSearchHitMenu';
import * as useConversationMessageSearch from '../../src/components/search/useConversationMessageSearch';
import * as messageCategory from '../../src/components/search/messageCategory';
import * as conversationSearchTarget from '../../src/components/search/conversationSearchTarget';
import * as highlightMatch from '../../src/components/search/highlightMatch';
// 股票研究窗口
import * as StockPage from '../../src/stocks/StockPage';
import * as stocksApi from '../../src/api/stocks';
import * as stocksFormat from '../../src/stocks/format';
import * as stocksWindow from '../../src/stocks/window';
import * as useStockNav from '../../src/stocks/store';
import * as useDebouncedValue from '../../src/stocks/hooks/useDebouncedValue';
import * as useAsyncData from '../../src/stocks/hooks/useAsyncData';
import * as useQuotePolling from '../../src/stocks/hooks/useQuotePolling';
import * as useEscapeKey from '../../src/stocks/hooks/useEscapeKey';
import * as stocksSearchNav from '../../src/stocks/components/searchNav';
import * as stocksClassify from '../../src/stocks/classify';
import * as OverviewView from '../../src/stocks/views/OverviewView';
import * as StockDetailView from '../../src/stocks/views/StockDetailView';
import * as EtfDetailView from '../../src/stocks/views/EtfDetailView';
import * as KLineChart from '../../src/stocks/components/KLineChart';
import * as PanelBody from '../../src/stocks/components/PanelBody';
import * as MarketWeatherPanel from '../../src/stocks/components/MarketWeatherPanel';
import * as RankingPanel from '../../src/stocks/components/RankingPanel';
import * as PolicyPanel from '../../src/stocks/components/PolicyPanel';
import * as NewsPanel from '../../src/stocks/components/NewsPanel';
import * as AccuracyPanel from '../../src/stocks/components/AccuracyPanel';
import * as EtfListPanel from '../../src/stocks/components/EtfListPanel';
import * as IntelPanel from '../../src/stocks/components/IntelPanel';
import * as FinancialsPanel from '../../src/stocks/components/FinancialsPanel';
import * as DepthPanel from '../../src/stocks/components/DepthPanel';
import * as PriceTicker from '../../src/stocks/components/PriceTicker';
import * as StockSearchBox from '../../src/stocks/components/StockSearchBox';

// NFC 指令执行器
import * as NfcTrustConfirmModal from '../../src/nfc/NfcTrustConfirmModal';
import * as NfcFeedbackToast from '../../src/nfc/NfcFeedbackToast';
import * as MobileNfcTrustedCardsPage from '../../src/pages/mobile/MobileNfcTrustedCardsPage';
import * as useNfcGlobalScan from '../../src/hooks/useNfcGlobalScan';
import * as nfcParser from '../../src/nfc/parser';
import * as nfcExecutor from '../../src/nfc/executor';
import * as nfcTrustStore from '../../src/nfc/trustStore';

// 更新模块 Hooks
import * as useStartupUpdateCheck from '../../src/update/useStartupUpdateCheck';
import * as downloadSpeed from '../../src/update/downloadSpeed';

// 通用组件
import * as Avatar from '../../src/components/common/Avatar';
import * as AvatarPlaceholder from '../../src/components/common/AvatarPlaceholder';
import * as BotBadge from '../../src/components/common/BotBadge';
import * as AIAvatar from '../../src/components/common/AIAvatar';
import * as AvatarCropModal from '../../src/components/common/AvatarCropModal';
import * as MarkdownRenderer from '../../src/components/common/MarkdownRenderer';
import * as CircularProgress from '../../src/components/common/CircularProgress';
import * as ErrorToast from '../../src/components/common/ErrorToast';
import * as LoadingSpinner from '../../src/components/common/LoadingSpinner';
import * as LoadingOverlay from '../../src/components/common/LoadingOverlay';
import * as SearchBox from '../../src/components/common/SearchBox';
import * as ListStates from '../../src/components/common/ListStates';
import * as SyncStatusBanner from '../../src/components/common/SyncStatusBanner';
import * as Sidebar from '../../src/components/sidebar/Sidebar';
import * as SidebarMorePanel from '../../src/components/sidebar/SidebarMorePanel';
import * as UnifiedList from '../../src/components/unified/UnifiedList';
import * as ConversationContextMenu from '../../src/components/unified/ConversationContextMenu';
import * as CardStack from '../../src/components/account/CardStack';
import * as CardSlot from '../../src/components/account/CardSlot';
import * as ProfileModal from '../../src/components/ProfileModal';
import * as AvatarUploader from '../../src/components/profile/AvatarUploader';
import * as PasswordForm from '../../src/components/profile/PasswordForm';
import * as ProfileInfoForm from '../../src/components/profile/ProfileInfoForm';
import * as ProfileCoverActions from '../../src/components/profile/ProfileCoverActions';
import * as PrivacySettingsForm from '../../src/components/profile/PrivacySettingsForm';
import * as FilesModal from '../../src/components/files/FilesModal';
import * as FileContextMenu from '../../src/components/files/FileContextMenu';
import * as FileMenuController from '../../src/components/files/FileMenuController';
import * as BotsModal from '../../src/components/bots/BotsModal';
import * as SettingsPanel from '../../src/components/settings/SettingsPanel';
import * as SettingsSection from '../../src/components/settings/SettingsSection';
import * as SettingsGroup from '../../src/components/settings/SettingsGroup';
import * as SettingsRow from '../../src/components/settings/SettingsRow';
import * as SoundSelector from '../../src/components/settings/SoundSelector';
import * as DeviceListPanel from '../../src/components/settings/DeviceListPanel';

// 更新组件
import * as UpdateToast from '../../src/update/components/UpdateToast';

// req-23 新组件（取代旧 AddModal / modals/add tab 页）
import * as useDiscoverySearch from '../../src/hooks/useDiscoverySearch';
import * as GroupDetailPanel from '../../src/chat/shared/GroupDetailPanel';
import * as GroupDetailView from '../../src/chat/shared/GroupDetailView';
import * as AddMenu from '../../src/components/unified/AddMenu';
import * as PendingRequestsPanel from '../../src/components/unified/PendingRequestsPanel';
import * as CreateBotDialog from '../../src/components/bots/CreateBotDialog';
import * as ShareTargetPicker from '../../src/components/share/ShareTargetPicker';

// 聊天组件
import * as ChatPanel from '../../src/chat/shared/ChatPanel';
import * as ChatInputArea from '../../src/chat/shared/ChatInputArea';
import * as ChatMenu from '../../src/chat/shared/ChatMenu';
import * as FileAttachButton from '../../src/chat/shared/FileAttachButton';
import * as FileMessageContent from '../../src/chat/shared/FileMessageContent';
import * as FilePreviewModal from '../../src/chat/shared/FilePreviewModal';
import * as DocumentDownloadAction from '../../src/chat/shared/DocumentDownloadAction';
import * as MessageContextMenu from '../../src/chat/shared/MessageContextMenu';
import * as ForwardMessageModal from '../../src/chat/shared/ForwardMessageModal';
import * as forwardMessage from '../../src/chat/shared/forwardMessage';
import * as groupCard from '../../src/chat/shared/groupCard';
import * as messagePreviewText from '../../src/chat/shared/messagePreviewText';
import * as GroupCardMessage from '../../src/chat/shared/GroupCardMessage';
import * as ShareGroupCardModal from '../../src/chat/shared/ShareGroupCardModal';
import * as ReplyComposeBar from '../../src/chat/shared/ReplyComposeBar';
import * as MultiSelectActionBar from '../../src/chat/shared/MultiSelectActionBar';
import * as UploadProgress from '../../src/chat/shared/UploadProgress';
import * as OtherProfilePanel from '../../src/chat/shared/OtherProfilePanel';
import * as OtherProfileView from '../../src/chat/shared/OtherProfileView';
import * as ChatMessages from '../../src/chat/friend/ChatMessages';
import * as MessageBubble from '../../src/chat/friend/MessageBubble';
import * as GroupChatMessages from '../../src/chat/group/GroupChatMessages';
import * as GroupMessageBubble from '../../src/chat/group/GroupMessageBubble';
import * as GroupRemarkInputModal from '../../src/chat/group/GroupRemarkInputModal';
import * as ReplyQuote from '../../src/chat/shared/ReplyQuote';
import * as ReadReceiptIcons from '../../src/chat/shared/ReadReceiptIcons';
import * as PrivateReadReceipt from '../../src/chat/shared/PrivateReadReceipt';
import * as readReceiptGate from '../../src/chat/shared/readReceiptGate';
import * as senderRunGate from '../../src/chat/shared/senderRunGate';
import * as senderNameColor from '../../src/chat/shared/senderNameColor';
import * as mediaDisplaySize from '../../src/chat/shared/mediaDisplaySize';
import * as ChatTargetAvatar from '../../src/chat/shared/ChatTargetAvatar';
import * as videoPosterSrc from '../../src/chat/shared/videoPosterSrc';
import * as VideoThumbnail from '../../src/chat/shared/VideoThumbnail';
import * as ReaderAvatarStack from '../../src/chat/shared/ReaderAvatarStack';
import * as GroupReadReceipt from '../../src/chat/group/GroupReadReceipt';
import * as GroupReadListModal from '../../src/chat/group/GroupReadListModal';
import * as useFriendReadReceipt from '../../src/chat/friend/useFriendReadReceipt';
import * as useGroupReadReceipt from '../../src/chat/group/useGroupReadReceipt';
import * as SlashCommandPanel from '../../src/chat/shared/SlashCommandPanel';
import * as ConversationShelf from '../../src/chat/shared/ConversationShelf';
import * as ShelfCardOverlay from '../../src/chat/shared/ShelfCardOverlay';
import * as CardRenderer from '../../src/chat/shared/CardRenderer';
import * as ActionButton from '../../src/chat/shared/ActionButton';
import * as CardChart from '../../src/chat/shared/CardChart';
import * as AIChatMessages from '../../src/chat/ai/AIChatMessages';
import * as AIMessageBubble from '../../src/chat/ai/AIMessageBubble';
import * as AIHistoryPanel from '../../src/chat/ai/AIHistoryPanel';
import * as ChatMenuPanel from '../../src/chat/shared/ChatMenuPanel';
import * as ConfirmDialog from '../../src/chat/shared/menu/ConfirmDialog';
import * as EditNameForm from '../../src/chat/shared/menu/EditNameForm';
import * as EditNicknameForm from '../../src/chat/shared/menu/EditNicknameForm';
import * as EditRemarkForm from '../../src/chat/shared/menu/EditRemarkForm';
import * as InviteForm from '../../src/chat/shared/menu/InviteForm';
import * as JoinPolicyForm from '../../src/chat/shared/menu/JoinPolicyForm';
import * as MainMenu from '../../src/chat/shared/menu/MainMenu';
import * as MemberActions from '../../src/chat/shared/menu/MemberActions';
import * as MemberGrid from '../../src/chat/shared/menu/MemberGrid';
import * as MembersList from '../../src/chat/shared/menu/MembersList';
import * as MenuHeader from '../../src/chat/shared/menu/MenuHeader';
import * as MuteSettings from '../../src/chat/shared/menu/MuteSettings';
import * as NoticesList from '../../src/chat/shared/menu/NoticesList';
import * as TransferOwner from '../../src/chat/shared/menu/TransferOwner';

// 会议组件
import * as MeetingPage from '../../src/meeting/MeetingPage';
import * as MeetingEntryModal from '../../src/meeting/components/MeetingEntryModal';

// 媒体组件
import * as MediaPreviewPage from '../../src/media/MediaPreviewPage';

// Hooks
import * as useFriends from '../../src/hooks/useFriends';
import * as useGroups from '../../src/hooks/useGroups';
import * as useFiles from '../../src/hooks/useFiles';
import * as useFileUpload from '../../src/hooks/useFileUpload';
import * as useFileCache from '../../src/hooks/useFileCache';
import * as useChatActions from '../../src/hooks/useChatActions';
import * as useChatMenu from '../../src/chat/group/useChatMenu';
import * as useMultiSelect from '../../src/hooks/useMultiSelect';
import * as useMainPage from '../../src/hooks/useMainPage';
import * as useAccounts from '../../src/hooks/useAccounts';
import * as useProfileEditor from '../../src/hooks/useProfileEditor';
import * as usePendingRequests from '../../src/hooks/usePendingRequests';
import * as useInitialSync from '../../src/hooks/useInitialSync';
import * as useLocalConversations from '../../src/hooks/useLocalConversations';
import * as useResizablePanel from '../../src/hooks/useResizablePanel';
import * as useSearchPopup from '../../src/hooks/useSearchPopup';
import * as useRegisterForm from '../../src/hooks/useRegisterForm';
import * as useLocalFriendMessages from '../../src/chat/friend/useLocalFriendMessages';
import * as useLocalGroupMessages from '../../src/chat/group/useLocalGroupMessages';
import * as useScrollKeyboardControls from '../../src/chat/shared/useScrollKeyboardControls';
import * as useStickToBottom from '../../src/chat/shared/useStickToBottom';
import * as useKbdFocusRing from '../../src/hooks/useKbdFocusRing';
import * as useAIMessages from '../../src/chat/ai/useAIMessages';
import * as useWebRTC from '../../src/meeting/useWebRTC';
import * as useNotificationSounds from '../../src/hooks/useNotificationSounds';
import * as useBots from '../../src/hooks/useBots';
import * as useTopLayer from '../../src/hooks/useTopLayer';
import * as useVideoPoster from '../../src/chat/shared/useVideoPoster';

// 服务
import * as deviceInfo from '../../src/services/deviceInfo';
import * as diagnosticService from '../../src/services/diagnosticService';
import * as fileCache from '../../src/services/fileCache';
import * as assetUrl from '../../src/services/assetUrl';
import * as videoPoster from '../../src/services/videoPoster';
import * as videoPosterCapture from '../../src/services/videoPosterCapture';
import * as fileService from '../../src/services/fileService';
import * as sessionLock from '../../src/services/sessionLock';
import * as historyService from '../../src/services/historyService';
import * as notificationService from '../../src/services/notificationService';
import * as syncService from '../../src/services/syncService';
import * as updateService from '../../src/update/service';
import * as settingsStore from '../../src/stores/settingsStore';
import * as sandboxEscape from '../../src/chat/shared/sandboxEscape';
import * as shelfApi from '../../src/api/shelf';
import * as shelfStore from '../../src/stores/shelfStore';
import * as botCommandsStore from '../../src/stores/botCommandsStore';
import * as slashCommands from '../../src/chat/shared/slashCommands';
import * as replyPreview from '../../src/chat/shared/replyPreview';
import * as AlbumMessage from '../../src/chat/shared/AlbumMessage';
import * as MediaBubbleFrame from '../../src/chat/shared/MediaBubbleFrame';
import * as AlbumComposer from '../../src/chat/shared/AlbumComposer';
import * as albumSend from '../../src/chat/shared/albumSend';
import * as mediaGroup from '../../src/chat/shared/mediaGroup';
import * as mediaGallery from '../../src/chat/shared/mediaGallery';
import * as mediaSwipe from '../../src/chat/shared/mediaSwipe';
import * as mediaZoomState from '../../src/chat/shared/mediaZoomState';
import * as MediaGalleryProvider from '../../src/chat/shared/MediaGalleryProvider';
import * as conversationKey from '../../src/chat/shared/conversationKey';
import * as scrollMessageIntoView from '../../src/chat/shared/scrollMessageIntoView';
import * as JumpToLatestButton from '../../src/chat/shared/JumpToLatestButton';
import * as LanTransferPage from '../../src/lanTransfer/LanTransferPage';
import * as lanTransferApi from '../../src/lanTransfer/api';
import * as lanTransferIndex from '../../src/lanTransfer/index';

// HuanvaeGuard VPN
import * as HuanvaeGuardPage from '../../src/huanvaeGuard/HuanvaeGuardPage';
import * as huanvaeGuardServerApi from '../../src/huanvaeGuard/serverApi';
import * as huanvaeGuardLocalApi from '../../src/huanvaeGuard/localApi';
import * as ConfirmDialogModule from '../../src/components/common/ConfirmDialog';

import * as useLanTransfer from '../../src/hooks/useLanTransfer';

// 工具模块
import * as formatUtils from '../../src/utils/format';
import * as avatarColor from '../../src/utils/avatarColor';

// 聊天共享模块
import * as chatAnimations from '../../src/chat/shared/animations';
import * as aiApi from '../../src/api/ai';
// 会议 WebRTC 纯函数核心
import * as webrtcCore from '../../src/meeting/webrtcCore';
// 预发送待发区（M-5）
import * as ComposerTray from '../../src/chat/shared/ComposerTray';
import * as SendingMediaOverlay from '../../src/chat/shared/SendingMediaOverlay';
import * as composerTrayPlan from '../../src/chat/shared/composerTrayPlan';
import * as composerTrayStore from '../../src/stores/composerTrayStore';
import * as sendingMediaStore from '../../src/stores/sendingMediaStore';
import * as uploadPersist from '../../src/chat/shared/uploadPersist';
import * as sendingMediaActions from '../../src/chat/shared/sendingMediaActions';
import * as uploadAbortRegistry from '../../src/chat/shared/uploadAbortRegistry';
import * as useComposerTrayOutbox from '../../src/chat/shared/useComposerTrayOutbox';
import * as useSendingOutboxMerge from '../../src/chat/shared/useSendingOutboxMerge';
import * as useBatchForward from '../../src/chat/shared/useBatchForward';

// 主题系统
import * as themeIndex from '../../src/theme/index';
import * as themeStore from '../../src/theme/store';
// themeTypes 只导出类型，没有运行时导出，不测试
import * as themeUtils from '../../src/theme/utils';
import * as themePresets from '../../src/theme/presets';
import * as themeGenerator from '../../src/theme/generator';
import * as themeApi from '../../src/theme/api';
import * as ThemeProvider from '../../src/theme/ThemeProvider';
import * as ThemeEditor from '../../src/theme/ThemeEditor';
import * as ThemeEditorPage from '../../src/theme/ThemeEditorPage';

// 组件映射表
const COMPONENT_MAP = {
  // 页面
  Main: MainPage,
  Login: LoginPage,
  Register: RegisterPage,
  AccountSelector: AccountSelectorPage,
  // 移动端组件
  MobileHeader,
  MobileMain,
  MobileThemePage,
  MobileMiniAppsPage,
  MobileBotsPage,
  MobileProfilePage,
  // 全局搜索
  GlobalMessageSearchResults,
  globalSearchTabs,
  useGlobalMessageSearch,
  // 会话内消息查找
  ConversationMessageSearch,
  ConversationSearchHit,
  ConversationSearchHitMenu,
  useConversationMessageSearch,
  messageCategory,
  conversationSearchTarget,
  highlightMatch,
  // 股票研究窗口
  StockPage,
  stocksApi,
  stocksFormat,
  stocksWindow,
  useStockNav,
  useDebouncedValue,
  useAsyncData,
  useQuotePolling,
  useEscapeKey,
  stocksSearchNav,
  stocksClassify,
  OverviewView,
  StockDetailView,
  EtfDetailView,
  KLineChart,
  PanelBody,
  MarketWeatherPanel,
  RankingPanel,
  PolicyPanel,
  NewsPanel,
  AccuracyPanel,
  EtfListPanel,
  IntelPanel,
  FinancialsPanel,
  DepthPanel,
  PriceTicker,
  StockSearchBox,
  // NFC
  NfcTrustConfirmModal,
  NfcFeedbackToast,
  MobileNfcTrustedCardsPage,
  useNfcGlobalScan,
  nfcParser,
  nfcExecutor,
  nfcTrustStore,
  // 更新模块 Hooks
  useStartupUpdateCheck,
  downloadSpeed,
  // 通用组件
  Avatar,
  AvatarPlaceholder,
  BotBadge,
  AIAvatar,
  AvatarCropModal,
  MarkdownRenderer,
  CircularProgress,
  ErrorToast,
  LoadingSpinner,
  LoadingOverlay,
  SearchBox,
  ListStates,
  SyncStatusBanner,
  Sidebar,
  SidebarMorePanel,
  UnifiedList,
  ConversationContextMenu,
  CardStack,
  CardSlot,
  ProfileModal,
  AvatarUploader,
  PasswordForm,
  ProfileInfoForm,
  ProfileCoverActions,
  PrivacySettingsForm,
  FilesModal,
  FileContextMenu,
  FileMenuController,
  BotsModal,
  SettingsPanel,
  SettingsSection,
  SettingsGroup,
  SettingsRow,
  SoundSelector,
  DeviceListPanel,
  UpdateToast,
  LanTransferPage,
  lanTransferApi,
  lanTransferIndex,
  // HuanvaeGuard
  HuanvaeGuardPage,
  huanvaeGuardServerApi,
  huanvaeGuardLocalApi,
  PromptDialog: ConfirmDialogModule,
  // 主题系统
  themeIndex,
  themeStore,
  themeUtils,
  themePresets,
  themeGenerator,
  themeApi,
  ThemeProvider,
  ThemeEditor,
  ThemeEditorPage,
  // req-23 新组件（AddMenu / 待通过申请 / 创建 bot / 群详情 / 发现搜索）
  useDiscoverySearch,
  GroupDetailPanel,
  GroupDetailView,
  AddMenu,
  PendingRequestsPanel,
  CreateBotDialog,
  ShareTargetPicker,
  // 聊天组件
  ChatPanel,
  ChatInputArea,
  ChatMenu,
  FileAttachButton,
  FileMessageContent,
  FilePreviewModal,
  DocumentDownloadAction,
  MessageContextMenu,
  ForwardMessageModal,
  forwardMessage,
  groupCard,
  messagePreviewText,
  GroupCardMessage,
  ShareGroupCardModal,
  ReplyComposeBar,
  MultiSelectActionBar,
  UploadProgress,
  OtherProfilePanel,
  OtherProfileView,
  ChatMessages,
  MessageBubble,
  GroupChatMessages,
  GroupMessageBubble,
  GroupRemarkInputModal,
  ReplyQuote,
  ReadReceiptIcons,
  PrivateReadReceipt,
  readReceiptGate,
  senderRunGate,
  senderNameColor,
  mediaDisplaySize,
  ChatTargetAvatar,
  videoPosterSrc,
  VideoThumbnail,
  ReaderAvatarStack,
  GroupReadReceipt,
  GroupReadListModal,
  SlashCommandPanel,
  ConversationShelf,
  ShelfCardOverlay,
  CardRenderer,
  ActionButton,
  CardChart,
  AIChatMessages,
  AIMessageBubble,
  AIHistoryPanel,
  ChatMenuPanel,
  ConfirmDialog,
  EditNameForm,
  EditNicknameForm,
  EditRemarkForm,
  InviteForm,
  JoinPolicyForm,
  MainMenu,
  MemberActions,
  MemberGrid,
  MembersList,
  MenuHeader,
  MuteSettings,
  NoticesList,
  TransferOwner,
  // 会议组件
  MeetingPage,
  MeetingEntryModal,
  // 媒体组件
  MediaPreviewPage,
  // Hooks
  useFriends,
  useGroups,
  useFiles,
  useFileUpload,
  useFileCache,
  useChatActions,
  useChatMenu,
  useMultiSelect,
  useMainPage,
  useAccounts,
  useProfileEditor,
  usePendingRequests,
  useInitialSync,
  useLocalConversations,
  useResizablePanel,
  useSearchPopup,
  useRegisterForm,
  useLocalFriendMessages,
  useLocalGroupMessages,
  useScrollKeyboardControls,
  useStickToBottom,
  useKbdFocusRing,
  useFriendReadReceipt,
  useGroupReadReceipt,
  useAIMessages,
  useWebRTC,
  useNotificationSounds,
  useLanTransfer,
  useBots,
  useTopLayer,
  useVideoPoster,
  // 服务
  deviceInfo,
  diagnosticService,
  fileCache,
  assetUrl,
  videoPoster,
  videoPosterCapture,
  fileService,
  sessionLock,
  historyService,
  notificationService,
  syncService,
  updateService,
  settingsStore,
  sandboxEscape,
  shelfApi,
  shelfStore,
  botCommandsStore,
  slashCommands,
  replyPreview,
  AlbumMessage,
  MediaBubbleFrame,
  AlbumComposer,
  albumSend,
  mediaGroup,
  mediaGallery,
  mediaSwipe,
  mediaZoomState,
  MediaGalleryProvider,
  conversationKey,
  scrollMessageIntoView,
  JumpToLatestButton,
  // 工具模块
  formatUtils,
  avatarColor,
  // 聊天共享模块
  chatAnimations,
  aiApi,
  // 会议 WebRTC 纯函数核心
  webrtcCore,
  // 预发送待发区（M-5）
  ComposerTray,
  SendingMediaOverlay,
  composerTrayPlan,
  composerTrayStore,
  sendingMediaStore,
  uploadPersist,
  sendingMediaActions,
  uploadAbortRegistry,
  useComposerTrayOutbox,
  useSendingOutboxMerge,
  useBatchForward,
};

// ============== 页面组件测试 ==============
describe('页面组件 (Pages)', () => {
  it.each(PAGE_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 移动端组件测试 ==============
describe('移动端组件 (Mobile Components)', () => {
  it.each(MOBILE_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 全局搜索组件测试 ==============
describe('全局搜索组件 (Search Components)', () => {
  it.each(SEARCH_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 股票研究组件测试 ==============
describe('股票研究组件 (Stock Components)', () => {
  it.each(STOCK_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== NFC 指令执行器测试 ==============
describe('NFC 组件 (NFC Components)', () => {
  it.each(NFC_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 更新模块 Hooks 测试 ==============
describe('更新模块 Hooks (Update Components)', () => {
  it.each(UPDATE_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 通用组件测试 ==============
describe('通用组件 (Common Components)', () => {
  it.each(COMMON_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 模态框组件测试 ==============
describe('模态框组件 (Modal Components)', () => {
  it.each(MODAL_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 聊天组件测试 ==============
describe('聊天组件 (Chat Components)', () => {
  it.each(CHAT_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 会议组件测试 ==============
describe('会议组件 (Meeting Components)', () => {
  it.each(MEETING_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 媒体组件测试 ==============
describe('媒体组件 (Media Components)', () => {
  it.each(MEDIA_COMPONENTS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== Hooks 测试 ==============
describe('Hooks', () => {
  it.each(HOOKS)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 服务测试 ==============
describe('服务 (Services)', () => {
  it.each(SERVICES)('$name - $description', (entry) => {
    const module = COMPONENT_MAP[entry.name as keyof typeof COMPONENT_MAP];
    expect(module).toBeDefined();
    expect(Object.keys(module).length).toBeGreaterThan(0);
  });
});

// ============== 注册表完整性测试 ==============
describe('注册表完整性', () => {
  it('应包含所有必要的页面组件', () => {
    expect(PAGE_COMPONENTS.length).toBeGreaterThanOrEqual(4);

    const pageNames = PAGE_COMPONENTS.map((c) => c.name);
    expect(pageNames).toContain('Main');
    expect(pageNames).toContain('Login');
    expect(pageNames).toContain('Register');
    expect(pageNames).toContain('AccountSelector');
  });

  it('应包含核心 UI 组件', () => {
    const commonNames = COMMON_COMPONENTS.map((c) => c.name);

    // 必须有的核心组件
    expect(commonNames).toContain('Sidebar');
    expect(commonNames).toContain('Avatar');
    expect(commonNames).toContain('LoadingSpinner');
    expect(commonNames).toContain('SearchBox');
    expect(commonNames).toContain('ProfileModal');
  });

  it('应包含核心聊天组件', () => {
    const chatNames = CHAT_COMPONENTS.map((c) => c.name);

    expect(chatNames).toContain('ChatPanel');
    expect(chatNames).toContain('ChatInputArea');
    expect(chatNames).toContain('ChatMessages');
    expect(chatNames).toContain('MessageBubble');
    expect(chatNames).toContain('GroupChatMessages');
    expect(chatNames).toContain('GroupMessageBubble');
  });

  it('应包含核心 Hooks', () => {
    const hookNames = HOOKS.map((c) => c.name);

    expect(hookNames).toContain('useFriends');
    expect(hookNames).toContain('useGroups');
    expect(hookNames).toContain('useChatActions');
  });

  it('统计信息应正确', () => {
    expect(REGISTRY_STATS.pages).toBe(PAGE_COMPONENTS.length);
    expect(REGISTRY_STATS.mobile).toBe(MOBILE_COMPONENTS.length);
    expect(REGISTRY_STATS.common).toBe(COMMON_COMPONENTS.length);
    expect(REGISTRY_STATS.modals).toBe(MODAL_COMPONENTS.length);
    expect(REGISTRY_STATS.chat).toBe(CHAT_COMPONENTS.length);
    expect(REGISTRY_STATS.meeting).toBe(MEETING_COMPONENTS.length);
    expect(REGISTRY_STATS.media).toBe(MEDIA_COMPONENTS.length);
    expect(REGISTRY_STATS.hooks).toBe(HOOKS.length);
    expect(REGISTRY_STATS.services).toBe(SERVICES.length);
  });

  it('应包含移动端核心组件', () => {
    const mobileNames = MOBILE_COMPONENTS.map((c) => c.name);
    expect(mobileNames).toContain('MobileHeader');
    expect(mobileNames).toContain('MobileMain');
  });

  it('总组件数应大于 60', () => {
    // 确保我们没有遗漏组件
    expect(REGISTRY_STATS.total).toBeGreaterThanOrEqual(60);
    console.log(`📊 组件注册表统计: 共 ${REGISTRY_STATS.total} 个模块`);
    console.log(`   - 页面: ${REGISTRY_STATS.pages}`);
    console.log(`   - 移动端: ${REGISTRY_STATS.mobile}`);
    console.log(`   - 通用组件: ${REGISTRY_STATS.common}`);
    console.log(`   - 模态框: ${REGISTRY_STATS.modals}`);
    console.log(`   - 聊天组件: ${REGISTRY_STATS.chat}`);
    console.log(`   - 会议组件: ${REGISTRY_STATS.meeting}`);
    console.log(`   - 媒体组件: ${REGISTRY_STATS.media}`);
    console.log(`   - Hooks: ${REGISTRY_STATS.hooks}`);
    console.log(`   - 服务: ${REGISTRY_STATS.services}`);
  });
});
