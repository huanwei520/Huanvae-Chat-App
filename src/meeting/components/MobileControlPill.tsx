/**
 * 移动端参会人 tile 的「申请控制」按钮（#7 · owner 2026-09-14 二次评审①）
 *
 * ## 为什么从桌面胶囊里拆出来单开一个组件
 *
 * owner 原话要点：「控制申请按钮两端一致显示极为不便、且紫色与整体产品设计风格不符」，
 * 并要求「两端视觉分别适配：移动端样式独立设计、不再复用桌面组件」。
 *
 * 旧实现是**同一个按钮**（`.tile-control-pill` + `--mobile` 修饰符）跨两端复用，两套交互
 * 挤在一条样式规则里：桌面靠 `:hover` 伸出、移动端靠 `--open` 类名 toggle，两边还共用
 * 同一个宽度/内边距/配色 ⇒ 桌面尺寸（7px 16px、13px 字）在触屏上偏小、配色也钉死在
 * 桌面那套 accent 上。拆开之后：
 * - 桌面组件（meeting/MeetingPage.tsx 内的 `.tile-control-pill`）只服务鼠标；
 * - 本组件只服务触屏，尺寸/颜色/圆角各自演进，互不牵连。
 *
 * ## 交互（安卓无 hover，与 owner 选定的 K2 修改版等价语义）
 * 点按该参会人 tile → 按钮伸出；再点该 tile 或点别处 → 收回。
 * 状态由外层 `open` 驱动，本组件不自持状态（与 tile 的 toggle 单一真相源）。
 *
 * ## 配色
 * 走系统 token：`--primary` 底 + `--text-on-color` 恒白字（不是 `--text-inverse`——
 * 后者在深色主题下会被注入成深色，压在品牌蓝底上不可读）。
 *
 * @module meeting/components
 */

export interface MobileControlPillProps {
  /** 是否处于「已伸出」态（由所属 tile 的点按 toggle 决定） */
  open: boolean;
  /** 点击按钮：向上发起控制申请 */
  onPress: () => void;
}

export function MobileControlPill({ open, onPress }: MobileControlPillProps) {
  return (
    <button
      type="button"
      className={`mob-control-pill${open ? ' mob-control-pill--open' : ''}`}
      // 触屏没有 hover，故这里必须是显式点击；stopPropagation 防父级 tile 的
      // 「点别处收回」在同一次冒泡里把刚伸出的按钮又收回（2026-09-14 真机病历二）。
      onClick={(e) => { e.stopPropagation(); onPress(); }}
      title="申请控制"
      aria-label="申请控制对方屏幕"
    >
      {/* 与桌面同一枚「指针 + 射线」图形，保证两端语义可认；尺寸在 CSS 里各调 */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 3l14 7-6.5 1.5L9 18z" fill="currentColor" strokeLinejoin="round" />
        <path d="M13 12l5 5" />
      </svg>
      申请控制
    </button>
  );
}

export default MobileControlPill;
