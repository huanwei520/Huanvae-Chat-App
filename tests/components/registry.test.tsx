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

// 通用组件
import * as Avatar from '../../src/components/common/Avatar';
import * as CircularProgress from '../../src/components/common/CircularProgress';
import * as ErrorToast from '../../src/components/common/ErrorToast';
import * as LoadingSpinner from '../../src/components/common/LoadingSpinner';
import * as LoadingOverlay from '../../src/components/common/LoadingOverlay';
import * as SearchBox from '../../src/components/common/SearchBox';
import * as ListStates from '../../src/components/common/ListStates';
import * as SyncStatusBanner from '../../src/components/common/SyncStatusBanner';
import * as Sidebar from '../../src/components/sidebar/Sidebar';
import * as UnifiedList from '../../src/components/unified/UnifiedList';
import * as CardStack from '../../src/components/account/CardStack';
import * as CardSlot from '../../src/components/account/CardSlot';
import * as ProfileModal from '../../src/components/ProfileModal';
import * as AvatarUploader from '../../src/components/profile/AvatarUploader';
import * as PasswordForm from '../../src/components/profile/PasswordForm';
import * as ProfileInfoForm from '../../src/components/profile/ProfileInfoForm';
import * as FilesModal from '../../src/components/files/FilesModal';
import * as GroupsModal from '../../src/components/GroupsModal';
import * as AddModal from '../../src/components/AddModal';
import * as SettingsPanel from '../../src/components/settings/SettingsPanel';
import * as SettingsSection from '../../src/components/settings/SettingsSection';
import * as SettingsGroup from '../../src/components/settings/SettingsGroup';
import * as SettingsRow from '../../src/components/settings/SettingsRow';
import * as SoundSelector from '../../src/components/settings/SoundSelector';
import * as DeviceListPanel from '../../src/components/settings/DeviceListPanel';

// 更新组件
import * as UpdateToast from '../../src/update/components/UpdateToast';

// 模态框组件
import * as AddFriendTab from '../../src/components/modals/add/AddFriendTab';
import * as CreateGroupTab from '../../src/components/modals/add/CreateGroupTab';
import * as FriendRequestsTab from '../../src/components/modals/add/FriendRequestsTab';
import * as GroupInvitesTab from '../../src/components/modals/add/GroupInvitesTab';
import * as JoinGroupTab from '../../src/components/modals/add/JoinGroupTab';
import * as TabNavigation from '../../src/components/modals/add/TabNavigation';
import * as CreateGroupForm from '../../src/components/modals/groups/CreateGroupForm';
import * as GroupListContent from '../../src/components/modals/groups/GroupListContent';
import * as GroupsTabNavigation from '../../src/components/modals/groups/GroupsTabNavigation';
import * as InvitationsListContent from '../../src/components/modals/groups/InvitationsListContent';
import * as JoinGroupForm from '../../src/components/modals/groups/JoinGroupForm';

// 聊天组件
import * as ChatPanel from '../../src/chat/shared/ChatPanel';
import * as ChatInputArea from '../../src/chat/shared/ChatInputArea';
import * as ChatMenu from '../../src/chat/shared/ChatMenu';
import * as FileAttachButton from '../../src/chat/shared/FileAttachButton';
import * as FileMessageContent from '../../src/chat/shared/FileMessageContent';
import * as FilePreviewModal from '../../src/chat/shared/FilePreviewModal';
import * as LocalFilePreview from '../../src/chat/shared/LocalFilePreview';
import * as MessageContextMenu from '../../src/chat/shared/MessageContextMenu';
import * as MultiSelectActionBar from '../../src/chat/shared/MultiSelectActionBar';
import * as UploadProgress from '../../src/chat/shared/UploadProgress';
import * as UserProfilePopup from '../../src/chat/shared/UserProfilePopup';
import * as ChatMessages from '../../src/chat/friend/ChatMessages';
import * as MessageBubble from '../../src/chat/friend/MessageBubble';
import * as GroupChatMessages from '../../src/chat/group/GroupChatMessages';
import * as GroupMessageBubble from '../../src/chat/group/GroupMessageBubble';
import * as ConfirmDialog from '../../src/chat/shared/menu/ConfirmDialog';
import * as EditNameForm from '../../src/chat/shared/menu/EditNameForm';
import * as EditNicknameForm from '../../src/chat/shared/menu/EditNicknameForm';
import * as InviteCodeManager from '../../src/chat/shared/menu/InviteCodeManager';
import * as InviteForm from '../../src/chat/shared/menu/InviteForm';
import * as MainMenu from '../../src/chat/shared/menu/MainMenu';
import * as MemberActions from '../../src/chat/shared/menu/MemberActions';
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
import * as useAuth from '../../src/hooks/useAuth';
import * as useFriends from '../../src/hooks/useFriends';
import * as useGroups from '../../src/hooks/useGroups';
import * as useFiles from '../../src/hooks/useFiles';
import * as useFileUpload from '../../src/hooks/useFileUpload';
import * as useFileCache from '../../src/hooks/useFileCache';
import * as useChatActions from '../../src/hooks/useChatActions';
import * as useChatMenu from '../../src/hooks/useChatMenu';
import * as useMultiSelect from '../../src/hooks/useMultiSelect';
import * as useMainPage from '../../src/hooks/useMainPage';
import * as useAccounts from '../../src/hooks/useAccounts';
import * as useInitialSync from '../../src/hooks/useInitialSync';
import * as useLocalConversations from '../../src/hooks/useLocalConversations';
import * as useResizablePanel from '../../src/hooks/useResizablePanel';
import * as useSearchPopup from '../../src/hooks/useSearchPopup';
import * as useRegisterForm from '../../src/hooks/useRegisterForm';
import * as useLocalFriendMessages from '../../src/chat/friend/useLocalFriendMessages';
import * as useLocalGroupMessages from '../../src/chat/group/useLocalGroupMessages';
import * as useWebRTC from '../../src/meeting/useWebRTC';
import * as useSilentUpdate from '../../src/update/useSilentUpdate';
import * as useUpdateToast from '../../src/update/components/UpdateToast';
import * as useNotificationSounds from '../../src/hooks/useNotificationSounds';

// 服务
import * as deviceInfo from '../../src/services/deviceInfo';
import * as diagnosticService from '../../src/services/diagnosticService';
import * as fileCache from '../../src/services/fileCache';
import * as fileService from '../../src/services/fileService';
import * as sessionLock from '../../src/services/sessionLock';
import * as historyService from '../../src/services/historyService';
import * as notificationService from '../../src/services/notificationService';
import * as syncService from '../../src/services/syncService';
import * as updateService from '../../src/update/service';
import * as settingsStore from '../../src/stores/settingsStore';
import * as windowSize from '../../src/services/windowSize';
import * as LanTransferPage from '../../src/lanTransfer/LanTransferPage';
import * as lanTransferApi from '../../src/lanTransfer/api';
import * as lanTransferIndex from '../../src/lanTransfer/index';
import * as useLanTransfer from '../../src/hooks/useLanTransfer';

// 工具模块
import * as formatUtils from '../../src/utils/format';

// 聊天共享模块
import * as chatAnimations from '../../src/chat/shared/animations';
import * as SendStatusIndicator from '../../src/chat/shared/SendStatusIndicator';

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
  // 通用组件
  Avatar,
  CircularProgress,
  ErrorToast,
  LoadingSpinner,
  LoadingOverlay,
  SearchBox,
  ListStates,
  SyncStatusBanner,
  Sidebar,
  UnifiedList,
  CardStack,
  CardSlot,
  ProfileModal,
  AvatarUploader,
  PasswordForm,
  ProfileInfoForm,
  FilesModal,
  GroupsModal,
  AddModal,
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
  // 模态框组件
  AddFriendTab,
  CreateGroupTab,
  FriendRequestsTab,
  GroupInvitesTab,
  JoinGroupTab,
  TabNavigation,
  CreateGroupForm,
  GroupListContent,
  GroupsTabNavigation,
  InvitationsListContent,
  JoinGroupForm,
  // 聊天组件
  ChatPanel,
  ChatInputArea,
  ChatMenu,
  FileAttachButton,
  FileMessageContent,
  FilePreviewModal,
  LocalFilePreview,
  MessageContextMenu,
  MultiSelectActionBar,
  UploadProgress,
  UserProfilePopup,
  ChatMessages,
  MessageBubble,
  GroupChatMessages,
  GroupMessageBubble,
  ConfirmDialog,
  EditNameForm,
  EditNicknameForm,
  InviteCodeManager,
  InviteForm,
  MainMenu,
  MemberActions,
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
  useAuth,
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
  useInitialSync,
  useLocalConversations,
  useResizablePanel,
  useSearchPopup,
  useRegisterForm,
  useLocalFriendMessages,
  useLocalGroupMessages,
  useWebRTC,
  useSilentUpdate,
  useUpdateToast,
  useNotificationSounds,
  useLanTransfer,
  // 服务
  deviceInfo,
  diagnosticService,
  fileCache,
  fileService,
  sessionLock,
  historyService,
  notificationService,
  syncService,
  updateService,
  settingsStore,
  windowSize,
  // 工具模块
  formatUtils,
  // 聊天共享模块
  chatAnimations,
  SendStatusIndicator,
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

    expect(hookNames).toContain('useAuth');
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
