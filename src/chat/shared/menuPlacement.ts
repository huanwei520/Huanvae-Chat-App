/**
 * 长按菜单弹层三缘限位（左缘 / 右缘 / 底缘钳制 + 安全区避让）——纯函数模块
 *
 * 背景（2026-09-10「长按菜单边缘限位」任务）：
 * MessageContextMenu 移动端水平菜单位置计算原为「静态估算 + 上下翻转」，三处缺陷。
 * 诊断数字为 1080×2400@420dpi 模拟器实测（CSS 视口 412×915）：6 项菜单
 * 「回复/复制/转发/选取/删除/多选」真实渲染 291.52×62.02，每项 ≈44.25px
 * （min-width 44 border-box 主导；原估算按每项 52 + 16 计）——问题不在单项估值的
 * 偏差方向，而在钳制边界完全信任静态估算这件事本身：
 * 1) 真实宽随标签长度/项数/字号缩放漂移（群聊长标签「设置备注/特别关心此人/
 *    屏蔽此人消息」单项目宽 ≈68-92px），估算不再是可靠上界；估算宽一旦超过
 *    「视口−2×padding」（项多/窄屏/分屏，如 320dp 视口 6 项估算 328>300），
 *    原右缘钳制把 x 推成负值（320−328−10=−18）→ 菜单整体画出左缘被裁切；
 *    另原估算高 44 vs 实测 62.02：不翻转时菜单底边 = bubble.top−52+62.02 =
 *    bubble.top+10.02，压住气泡顶边 ≈10px（设备可见）。
 * 2) 「上方放不下 → 翻到气泡下方」后不再做底缘校验 → 高气泡/贴底气泡翻下后
 *    菜单底边直接溢出可视区。
 * 3) 全程不感知 env(safe-area-inset-*)（实测 inset.top=49）→ 菜单可画进
 *    状态栏/刘海下。
 *
 * 方案：
 * - 渲染前：clampMobileMenuPlacement 用估算尺寸算首帧位置（边界已含安全区）；
 * - 渲染后：MessageContextMenu 的 useLayoutEffect 用 offsetWidth/offsetHeight
 *   （CSS transform 不影响布局尺寸，framer-motion 入场动画不干扰测量）实测真实
 *   尺寸重跑同一钳制函数，paint 前校正，无闪跳。
 * 桌面端分支（点击位置四边钳制）保持原实现零改动。
 *
 * 安全区取值口径：probeSafeAreaInsets 读 env(safe-area-inset-*) 四向
 * （需 index.html viewport-fit=cover，见 tests/safe-area-viewport.test.ts 契约），
 * 并与 :root 上的 `--sai-top` / `--sai-bottom` 兜底变量取 max —— 与移动端 CSS
 * `max(env(...), var(--sai-*, 0px))` 约定一致（见 src/utils/safeAreaFallback.ts：
 * 老旧 WebView env 恒 0 时由它注入固定 inset，菜单钳制必须同样避开）。
 */

/** 四向安全区 inset（CSS px）。 */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const ZERO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 只取用到的四个矩形边（DOMRect 天然满足）。 */
export interface RectLike {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MobileMenuPlacementInput {
  /** 长按消息气泡的矩形（视口坐标）。 */
  bubble: RectLike;
  /** 可视区尺寸（window.innerWidth/innerHeight）。 */
  viewportWidth: number;
  viewportHeight: number;
  /** 安全区 inset；缺省按 0 处理。 */
  insets?: SafeAreaInsets;
  /** 菜单宽度（估算或实测）。 */
  menuWidth: number;
  /** 菜单高度（估算或实测）。 */
  menuHeight: number;
  /** 菜单与气泡的垂直间距（默认 8，与原实现一致）。 */
  gap?: number;
  /** 菜单与「可视区 − 安全区」边界的最小边距（默认 10，与原实现一致）。 */
  padding?: number;
}

export interface MobileMenuPlacement {
  left: number;
  top: number;
  /** above = 气泡上方（默认）；below = 气泡下方（上方空间不足时翻转）。 */
  placement: 'above' | 'below';
}

/**
 * 读取 env(safe-area-inset-*) 四向像素（不支持 / 无 viewport-fit=cover 时为 0），
 * 并对上下两向并入 `--sai-top` / `--sai-bottom` 兜底变量的 max（老平板兜底口径）。
 * 探针元素用完即删，无残留。
 */
export function probeSafeAreaInsets(): SafeAreaInsets {
  if (typeof document === 'undefined') { return ZERO_INSETS; }
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;'
    + 'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);'
    + 'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const envTop = parseFloat(cs.paddingTop) || 0;
  const envRight = parseFloat(cs.paddingRight) || 0;
  const envBottom = parseFloat(cs.paddingBottom) || 0;
  const envLeft = parseFloat(cs.paddingLeft) || 0;
  probe.remove();

  // 老旧 WebView 兜底变量（safeAreaFallback 注入，可能带 px 单位字符串）
  const root = getComputedStyle(document.documentElement);
  const fb = (name: string): number => {
    const n = parseFloat(root.getPropertyValue(name));
    return Number.isFinite(n) ? n : 0;
  };

  return {
    top: Math.max(envTop, fb('--sai-top')),
    right: envRight,
    bottom: Math.max(envBottom, fb('--sai-bottom')),
    left: envLeft,
  };
}

/**
 * 移动端长按菜单位置钳制：
 * - 水平：居中对齐气泡，钳进 [左缘, 右缘]（边界 = 安全区 inset 与 padding 取大者）；
 * - 垂直：优先气泡上方（微信风格）；上方放不下 → 翻转到气泡下方；
 *   下方也放不下 → 选空间更大的一侧并回钳进可视区（菜单完整可见优先）。
 */
export function clampMobileMenuPlacement(input: MobileMenuPlacementInput): MobileMenuPlacement {
  const insets = input.insets ?? ZERO_INSETS;
  const gap = input.gap ?? 8;
  const padding = input.padding ?? 10;

  // 可视区四向边界：先避安全区（刘海/系统栏），再留 padding；两值取大者。
  const boundLeft = Math.max(padding, insets.left);
  const boundRight = input.viewportWidth - Math.max(padding, insets.right);
  const boundTop = Math.max(padding, insets.top);
  const boundBottom = input.viewportHeight - Math.max(padding, insets.bottom);

  // x/y 允许区间；可视区极端窄/矮（menuWidth > 可视区）时区间退化为单点且不倒挂。
  const minX = boundLeft;
  const maxX = Math.max(minX, boundRight - input.menuWidth);
  const minY = boundTop;
  const maxY = Math.max(minY, boundBottom - input.menuHeight);

  // —— 水平：居中对齐气泡，再钳进允许区间 ——
  const bubbleCenterX = (input.bubble.left + input.bubble.right) / 2;
  const left = Math.min(Math.max(bubbleCenterX - input.menuWidth / 2, minX), maxX);

  // —— 垂直：优先上方，放不下翻下方，翻下仍放不下回钳 ——
  const yAbove = input.bubble.top - gap - input.menuHeight;
  const yBelow = input.bubble.bottom + gap;
  const spaceAbove = yAbove - minY; // 贴上缘时上方仍有的空间（负 = 上方缺口）
  const spaceBelow = maxY - yBelow; // 贴下缘时下方仍有的空间（负 = 下方缺口）
  if (yAbove >= minY) {
    return { left, top: yAbove, placement: 'above' };
  }
  if (yBelow <= maxY) {
    return { left, top: yBelow, placement: 'below' };
  }
  return spaceBelow > spaceAbove
    ? { left, top: maxY, placement: 'below' }
    : { left, top: minY, placement: 'above' };
}
