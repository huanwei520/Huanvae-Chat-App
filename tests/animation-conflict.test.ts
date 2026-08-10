/**
 * 动画冲突静态回归测试
 *
 * 检查项目中所有「同时由 JS 动画（framer-motion variants 或 GSAP tween）控制 +
 * 在 CSS 中也声明了 transition」的元素，确保它们的 CSS transition 字段
 * **不包含** JS 动画接管的属性（transform / opacity）。
 *
 * 背景：
 * framer-motion 的 motion.* 组件、GSAP 的 tween 都通过 inline style 逐帧更新
 * transform / opacity 等属性。如果同一元素的 CSS 也声明了 `transition: all`
 * 或 `transition: transform/opacity`，浏览器会对每一次帧更新启动一次 CSS 过渡，
 * 导致进入/退出动画抖动、拉慢、行为不可预期（具体取决于浏览器实现）。
 *
 * 项目规则（见 .claude/rules/frontend-test.md「动画相关变更必须补冲突回归测试」）：
 * 每新增一个 `motion.* + variants` 控制的 className，必须在
 * `MOTION_CONTROLLED_SELECTORS` 列表里登记其对应的 CSS 文件 + selector +
 * motion 控制的属性集合，让本测试能持续守门。
 *
 * 检测原理：
 * 1. 静态读取 CSS 文件
 * 2. 解析目标 selector 的规则块（仅取基础选择器，忽略 `:hover` / `:active` 等伪类）
 * 3. 提取 `transition` 字段
 * 4. 断言其字段不含 `all` 关键字 / 不显式列出 motion 控制的属性
 *
 * 限制：
 * - jsdom 不真正应用 CSS，运行时 getComputedStyle 不可靠 → 必须走静态文本解析
 * - 此测试只能保护"声明层"冲突，无法捕获浏览器运行时的实际渲染时序问题
 *   （后者只能在真实浏览器 + e2e 中验证；登录后页面的 e2e 受 plugin-http 限制不可达）
 */

/* eslint-disable no-undef */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 项目根目录（vitest 从 package.json 所在目录运行）
const PROJECT_ROOT = process.cwd();
/* eslint-enable no-undef */

/**
 * motion-controlled selectors 注册表
 *
 * 每条记录对应一个被 `motion.* + variants` 控制的 className。
 * 新增动画化组件时，必须把对应 className 登记到此处。
 */
interface MotionControlledEntry {
  /** CSS selector（基础形态，不含伪类）— 必须与组件 className 完全一致 */
  selector: string;
  /** 对应的 CSS 文件相对路径（项目根） */
  cssFile: string;
  /** JS 动画（framer-motion variants/animate 或 GSAP tween）控制的 CSS 属性集合 */
  controlledProps: ('transform' | 'opacity')[];
  /** 控制方组件位置（仅注释，便于追溯） */
  motionLocation: string;
}

const MOTION_CONTROLLED_SELECTORS: MotionControlledEntry[] = [
  {
    selector: '.file-card',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/files/FilesModal.tsx (DocumentFileCard + 图片/视频卡片，cardVariants)',
  },
  {
    selector: '.mobile-file-card',
    cssFile: 'src/styles/mobile/files-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileFilesPage.tsx (cardVariants)',
  },
  {
    selector: '.mobile-miniapp-card',
    cssFile: 'src/styles/mobile/miniapps-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileMiniAppsPage.tsx (cardVariants + whileTap)',
  },
  {
    selector: '.conversation-item',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/unified/UnifiedList.tsx (cardVariants + layout="position" guarded by isTabSwitching window)',
  },
  // .message-context-menu 当前无 CSS transition（门禁空转），登记防止将来有人加
  // transition:transform/opacity 与 motion 入出场（opacity+scale+y）抢帧
  {
    selector: '.message-context-menu',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/shared/MessageContextMenu.tsx + src/components/unified/ConversationContextMenu.tsx (motion.div 入出场 opacity+scale+y)',
  },
  // .avatar-wrapper 的基础规则在 main.css（base.css 里只有 .avatar-wrapper.a11y-kbd-focus
  // 复合焦点环选择器，不含基础规则），cssFile 必须指向 main.css 门禁才真正生效
  {
    selector: '.avatar-wrapper',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform'],
    motionLocation: 'src/components/sidebar/Sidebar.tsx (avatar-wrapper whileHover/whileTap scale)',
  },
  {
    selector: '.sidebar-more-panel',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/sidebar/SidebarMorePanel.tsx (panel variants: opacity/x/scale 入出场)',
  },
  {
    selector: '.more-panel-row',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform'],
    motionLocation: 'src/components/sidebar/SidebarMorePanel.tsx (dnd-kit useSortable 拖拽 transform)',
  },
  {
    selector: '.sidebar-pinned-btn',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform'],
    motionLocation: 'src/components/sidebar/Sidebar.tsx (dnd-kit useSortable 钉住项拖拽 transform)',
  },
  {
    selector: '.recall-system-row',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/chat/friend/MessageBubble.tsx + src/chat/group/GroupMessageBubble.tsx (撤回系统消息行：fade in/out + layout="position")',
  },
  {
    selector: '.message-row',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/friend/MessageBubble.tsx + src/chat/group/GroupMessageBubble.tsx (普通气泡行：getMessageVariants own/other 入场退场，x/y/scale/opacity)',
  },
  {
    selector: '.chat-messages-container--reverse',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/chat/friend/ChatMessages.tsx + src/chat/group/GroupChatMessages.tsx (消息区容器整块淡入：panelFadeTransition opacity 0→1，打开/切换会话时挂载播一次)',
  },
  {
    selector: '.chat-input-area',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/chat/shared/ChatInputArea.tsx (输入区入场/退场淡入：panelFadeTransition opacity，禁止 y 位移——translateY 扩展 .chat-content 可滚区 + textarea autofocus 滚动会造成头部/消息区假下滑)',
  },
  {
    selector: '.global-msg-search',
    cssFile: 'src/styles/search.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/search/GlobalMessageSearchResults.tsx (桌面 scale 缩放 / 移动 translateY 拉出 — desktopVariants/mobileVariants)',
  },
  {
    selector: '.mobile-media-preview-menu',
    cssFile: 'src/styles/mobile/chat-view.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/shared/MobileMediaPreview.tsx (Telegram 风格右对齐下拉菜单：opacity + y + scale variants)',
  },
  {
    selector: '.nfc-feedback-toast',
    cssFile: 'src/styles/mobile/nfc-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/nfc/NfcFeedbackToast.tsx (toastVariants: opacity + y 进出场)',
  },
  {
    selector: '.group-read-list-overlay',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/chat/group/GroupReadListModal.tsx (overlayVariants: opacity 进出场)',
  },
  {
    selector: '.group-read-list-panel',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/group/GroupReadListModal.tsx (桌面 scale/y + 移动 translateY，panelVariantsDesktop/Mobile)',
  },
  {
    selector: '.group-read-list-row',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/group/GroupReadListModal.tsx (列表项错峰滑入：GSAP gsap.from opacity + y，useGSAP)',
  },
  {
    selector: '.reader-avatar-stack-item',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/shared/ReaderAvatarStack.tsx (头像 stagger 淡入+微缩放 / 新头像滑入：GSAP gsap.from opacity+scale+x，useGSAP)',
  },
  {
    selector: '.other-profile-overlay',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/chat/shared/OtherProfileView.tsx (overlayVariants: opacity 进出场)',
  },
  {
    selector: '.other-profile-shell',
    cssFile: 'src/styles/pages/main.css',
    controlledProps: ['transform'],
    motionLocation: 'src/chat/shared/OtherProfileView.tsx (panelVariants: 从右滑入 translateX)',
  },
  {
    selector: '.blacklist-panel',
    cssFile: 'src/components/settings/blacklist.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/settings/BlacklistPanel.tsx (设置内黑名单页滑入：initial/animate/exit 的 x + opacity)',
  },
  // ===== 股票研究窗口（GSAP useGSAP，见 src/stocks/animations.ts） =====
  {
    selector: '.stocks-panel',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/views/*.tsx (A1：视图级 useStockIntro 面板 stagger 进场 fade+y)',
  },
  {
    selector: '.stocks-view',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/stocks/views/*.tsx (A5：视图淡入/切换 crossfade opacity)',
  },
  {
    selector: '.stock-rank-card',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/components/RankingPanel.tsx (A2：卡片进场 stagger fade+y)',
  },
  {
    selector: '.stock-score-bar',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform'],
    motionLocation: 'src/stocks/components/RankingPanel.tsx (A2：分数条 scaleX 展开)',
  },
  {
    selector: '.stock-price',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform'],
    motionLocation: 'src/stocks/components/PriceTicker.tsx (A3：价格 scale 脉冲；文本由 GSAP 写 textContent)',
  },
  {
    selector: '.stock-flash',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/stocks/components/PriceTicker.tsx (A3：涨跌底色闪烁覆盖层 opacity 脉冲)',
  },
  {
    selector: '.stock-depth-bar',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform'],
    motionLocation: 'src/stocks/components/DepthPanel.tsx (B4：盘口深度条 scaleX tween)',
  },
  {
    selector: '.stock-policy-item',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/components/PolicyPanel.tsx + NewsPanel.tsx (A6：条目/新闻行进场 stagger fade+y)',
  },
  // 市场天气进场 stagger：GSAP 对 `.market-weather-row` 逐帧写 opacity + y(transform)。
  // `.market-weather-row` 本身是纯 marker（无 CSS 规则）→ 登记它对门禁空转；真正承载
  // transform/opacity 的是各行同时挂的 styled 类（hero/情绪·广度 metric/flags/band-wrap/
  // disclaimer，均有 CSS 规则）。登记这些 styled 类，任何人给它们加 transition:transform/
  // opacity 会被静态门禁拦下（见 src/stocks/components/MarketWeatherPanel.tsx 各行 className）。
  {
    selector: '.market-weather-hero',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/components/MarketWeatherPanel.tsx (进场 stagger fade+y：天气标签行 .market-weather-row.market-weather-hero)',
  },
  {
    selector: '.market-weather-metric',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/components/MarketWeatherPanel.tsx (进场 stagger fade+y：情绪/广度行 .market-weather-row.market-weather-metric)',
  },
  {
    selector: '.market-weather-flags',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/components/MarketWeatherPanel.tsx (进场 stagger fade+y：提示标 chips 行 .market-weather-row.market-weather-flags)',
  },
  {
    selector: '.market-weather-band-wrap',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/components/MarketWeatherPanel.tsx (进场 stagger fade+y：regime 色带行 .market-weather-row.market-weather-band-wrap)',
  },
  {
    selector: '.market-weather-disclaimer',
    cssFile: 'src/styles/pages/stocks.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/stocks/components/MarketWeatherPanel.tsx (进场 stagger fade+y：免责声明行 .market-weather-row.market-weather-disclaimer)',
  },
  // ===== 移动端交互动效（2026-07-14 手机端动效优化批次） =====
  {
    selector: '.mobile-tab-item',
    cssFile: 'src/styles/mobile/tab-bar.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileTabBar.tsx (motion.button whileTap scale)',
  },
  {
    selector: '.mobile-tab-indicator',
    cssFile: 'src/styles/mobile/tab-bar.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileTabBar.tsx (layoutId="mobile-tab-indicator" 共享布局滑块)',
  },
  {
    selector: '.mobile-contact-card',
    cssFile: 'src/styles/mobile/contacts.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileChatList.tsx + MobileContacts.tsx (stagger 入场 opacity+y、exit + whileTap scale)',
  },
  {
    selector: '.mobile-contacts-list',
    cssFile: 'src/styles/mobile/contacts.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/pages/mobile/MobileContacts.tsx (listVariants: height/opacity 展开收起 + stagger 编排)',
  },
  {
    selector: '.mobile-header-avatar',
    cssFile: 'src/styles/mobile/header.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileHeader.tsx (头像 motion.div whileTap scale)',
  },
  {
    selector: '.mobile-contacts-add-btn',
    cssFile: 'src/styles/mobile/add-page.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileHeader.tsx (加号 motion.button whileTap scale)',
  },
  {
    selector: '.mobile-nfc-trusted-item',
    cssFile: 'src/styles/mobile/nfc-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileNfcTrustedCardsPage.tsx (rowVariants: stagger 入场 opacity+y + exit 左滑淡出)',
  },
  {
    selector: '.mobile-nfc-trusted-list',
    cssFile: 'src/styles/mobile/nfc-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileNfcTrustedCardsPage.tsx (motion.ul listVariants: 仅 stagger 编排，防御性登记)',
  },
  {
    selector: '.mobile-nfc-trust-modal-overlay',
    cssFile: 'src/styles/mobile/nfc-page.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/nfc/NfcTrustConfirmModal.tsx (overlayVariants: opacity 进出场)',
  },
  {
    selector: '.mobile-nfc-trust-modal',
    cssFile: 'src/styles/mobile/nfc-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/nfc/NfcTrustConfirmModal.tsx (panelVariants: 上滑 sheet y+opacity)',
  },
  // ===== 守门债补登记：既有整页 motion 容器（pageVariants / 整页滑入） =====
  {
    selector: '.mobile-profile-page',
    cssFile: 'src/styles/mobile/profile-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileProfilePage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-profile-swipe-layer',
    cssFile: 'src/styles/mobile/profile-page.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileProfilePage.tsx (边缘侧滑返回层 style={{ x }}：useEdgeSwipeBack 的 MotionValue 独占 transform；当前无 CSS transition，防御登记)',
  },
  {
    selector: '.mobile-settings-page',
    cssFile: 'src/styles/mobile/settings-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileSettingsPage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-chat-view',
    cssFile: 'src/styles/mobile/chat-view.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileChatView.tsx (整页 x 滑入滑出 tween)',
  },
  {
    selector: '.mobile-lan-transfer-page',
    cssFile: 'src/styles/mobile/lan-transfer-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileLanTransferPage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-theme-page',
    cssFile: 'src/styles/mobile/theme-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileThemePage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-add-page',
    cssFile: 'src/styles/mobile/add-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileAddPage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-add-action-btn',
    cssFile: 'src/styles/mobile/add-page.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileAddPage.tsx (待通过合并列表 同意/拒绝 按钮 whileTap scale)',
  },
  {
    selector: '.mobile-miniapps-page',
    cssFile: 'src/styles/mobile/miniapps-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileMiniAppsPage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-files-page',
    cssFile: 'src/styles/mobile/files-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileFilesPage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-bots-page',
    cssFile: 'src/styles/mobile/bots-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileBotsPage.tsx (pageVariants: x+opacity spring)',
  },
  {
    selector: '.mobile-bot-card',
    cssFile: 'src/styles/mobile/bots-page.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/pages/mobile/MobileBotsPage.tsx (cardVariants: opacity+y stagger + whileTap scale)',
  },
  {
    selector: '.mobile-meeting-entry-page',
    cssFile: 'src/styles/mobile/meeting-page.css',
    controlledProps: ['transform'],
    motionLocation: 'src/pages/mobile/MobileMeetingEntryPage.tsx (整页 x 滑入滑出 tween)',
  },
  // ===== bot 斜杠命令面板 + 会话顶置架浮层（framer-motion 入出场 opacity+y+scale） =====
  {
    selector: '.slash-command-panel',
    cssFile: 'src/chat/shared/SlashCommandPanel.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/shared/SlashCommandPanel.tsx (portal 命令面板 motion.div：opacity+y+scale 入出场；当前无 CSS transition，防御登记)',
  },
  {
    selector: '.shelf-card-overlay',
    cssFile: 'src/chat/shared/ConversationShelf.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/chat/shared/ShelfCardOverlay.tsx (顶置浮层 motion.div：opacity+y+scale 入出场；当前无 CSS transition，防御登记)',
  },
  {
    selector: '.add-menu-dropdown',
    cssFile: 'src/styles/components/add-menu.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/unified/AddMenu.tsx (dropdownVariants: opacity+y+scale 入出场；当前无 CSS transition，防御登记)',
  },
  // ===== 登录页账号选择器卡片堆（外层槽位位移 + 内层账号换人过渡） =====
  {
    selector: '.stack-card',
    cssFile: 'src/styles/components/wheel-selector.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/account/CardSlot.tsx (槽位位移 cardTransition：y+scale+opacity+filter；当前无 CSS transition，防御登记)',
  },
  {
    selector: '.stack-account-card',
    cssFile: 'src/styles/components/wheel-selector.css',
    controlledProps: ['transform', 'opacity'],
    motionLocation: 'src/components/account/CardSlot.tsx (cardSwapVariants：账号换人时 opacity+y 淡出淡入；CSS 只准过渡 border-color/box-shadow)',
  },
  // ===== 群聊回复（输入区「正在回复」条 + 定位失败提示条） =====
  // 两者的 opacity 与 height 都由 framer-motion 逐帧写 inline style，基础规则必须无 transition；
  // 需要过渡效果的 hover 反馈一律下沉到它们内部的普通子元素（motion 不碰那些节点）。
  {
    selector: '.reply-compose-bar',
    cssFile: 'src/styles/components/reply-quote.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/chat/shared/ReplyComposeBar.tsx (motion.div：opacity + height 展开收起)',
  },
  {
    selector: '.reply-jump-notice',
    cssFile: 'src/styles/components/reply-quote.css',
    controlledProps: ['opacity'],
    motionLocation: 'src/chat/shared/ChatInputArea.tsx (定位失败提示 motion.div：opacity + height 展开收起)',
  },
];

/**
 * 提取指定 selector 的基础规则块的 transition 字段
 *
 * - 仅匹配 `selector { ... }` 的基础规则，不匹配 `selector:hover` / `selector:active` 等伪类
 * - 返回 transition 字段的值（去除前后空白）；selector 不存在或无 transition 时返回 null
 */
function extractBaseTransition(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 基础规则：selector 后紧跟空白和 `{`，不允许伪类/伪元素
  const ruleRe = new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const match = ruleRe.exec(css);
  if (!match) { return null; }
  let block = match[1];
  // 移除 CSS 注释（/* ... */），避免注释内容被误当作属性值
  block = block.replace(/\/\*[\s\S]*?\*\//g, '');
  // 提取 transition 字段（仅基础 transition，不取 transition-property 等长写）
  // 改进：transition 可能是块的第一个属性，也可能前面有其他属性。用分号或行首作为分隔
  const transitionRe = /(?:^|;)\s*transition\s*:\s*([^;]+?)(?:;|$)/;
  const tMatch = block.match(transitionRe);
  return tMatch ? tMatch[1].trim() : null;
}

describe('动画冲突静态检查（CSS transition vs JS 动画 framer-motion/GSAP）', () => {
  it.each(MOTION_CONTROLLED_SELECTORS)(
    '$selector ($cssFile) 不能 transition $controlledProps（避免与 JS 动画 framer-motion/GSAP 冲突）',
    ({ selector, cssFile, controlledProps, motionLocation }) => {
      const cssPath = resolve(PROJECT_ROOT, cssFile);
      const css = readFileSync(cssPath, 'utf-8');
      const transition = extractBaseTransition(css, selector);

      // 未声明 transition = 不存在冲突
      if (transition === null) { return; }

      // 不允许 transition: all（覆盖所有属性，必含 transform/opacity）
      expect(
        transition,
        `${selector} 的 transition 含 \`all\`，会与 ${motionLocation} 的 JS 动画（framer-motion/GSAP）冲突。`,
      ).not.toMatch(/\ball\b/);

      // 不允许显式 transition motion 控制的属性
      for (const prop of controlledProps) {
        expect(
          transition,
          `${selector} 的 transition 显式包含 \`${prop}\`，会与 ${motionLocation} 的 JS 动画（framer-motion/GSAP）冲突。`,
        ).not.toMatch(new RegExp(`\\b${prop}\\b`));
      }
    },
  );

  it('注册表非空（避免被误删）', () => {
    expect(MOTION_CONTROLLED_SELECTORS.length).toBeGreaterThan(0);
  });
});
