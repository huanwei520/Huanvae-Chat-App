/**
 * 动画冲突静态回归测试
 *
 * 检查项目中所有「同时由 framer-motion variants 控制 + 在 CSS 中也声明了 transition」
 * 的元素，确保它们的 CSS transition 字段 **不包含** framer-motion 接管的属性。
 *
 * 背景：
 * framer-motion 的 motion.* 组件通过 inline style 逐帧更新 transform / opacity 等属性。
 * 如果同一元素的 CSS 也声明了 `transition: all` 或 `transition: transform/opacity`，
 * 浏览器会对 framer-motion 的每一次帧更新启动一次 CSS 过渡，
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
  /** framer-motion 通过 variants/animate 控制的 CSS 属性集合 */
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

describe('动画冲突静态检查（CSS transition vs framer-motion variants）', () => {
  it.each(MOTION_CONTROLLED_SELECTORS)(
    '$selector ($cssFile) 不能 transition $controlledProps（避免与 motion variants 冲突）',
    ({ selector, cssFile, controlledProps, motionLocation }) => {
      const cssPath = resolve(PROJECT_ROOT, cssFile);
      const css = readFileSync(cssPath, 'utf-8');
      const transition = extractBaseTransition(css, selector);

      // 未声明 transition = 不存在冲突
      if (transition === null) { return; }

      // 不允许 transition: all（覆盖所有属性，必含 transform/opacity）
      expect(
        transition,
        `${selector} 的 transition 含 \`all\`，会与 ${motionLocation} 的 framer-motion variants 冲突。`,
      ).not.toMatch(/\ball\b/);

      // 不允许显式 transition motion 控制的属性
      for (const prop of controlledProps) {
        expect(
          transition,
          `${selector} 的 transition 显式包含 \`${prop}\`，会与 ${motionLocation} 的 framer-motion variants 冲突。`,
        ).not.toMatch(new RegExp(`\\b${prop}\\b`));
      }
    },
  );

  it('注册表非空（避免被误删）', () => {
    expect(MOTION_CONTROLLED_SELECTORS.length).toBeGreaterThan(0);
  });
});
