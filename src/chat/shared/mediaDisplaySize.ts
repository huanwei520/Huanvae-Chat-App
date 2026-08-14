/**
 * 气泡内媒体的显示尺寸（纯函数模块，零依赖）
 *
 * @module chat/shared
 * @location src/chat/shared/mediaDisplaySize.ts
 *
 * 从 `FileMessageContent.tsx` 抽出来的两个纯函数。抽离的理由是可测性：
 * `FileMessageContent.tsx` 顶层拖着 useSession / fileCache / Tauri 一整条链，
 * 只为验一个「200x3000 该算成多大」要配一整套 mock
 * （见 .claude/rules/frontend-test.md「抽 pure function 的决策标准」）。
 *
 * 🔴 这两个函数是**同一条不变量的两半**，必须一起读：
 *   calculateDisplaySize 给的是**上限盒**（宽高都只是上限，不是定值）；
 *   mediaContainerStyle 负责把它翻译成「宽度上限 + max-width:100% + aspect-ratio」。
 * 谁单独用了前者的 height 去写内联绝对高度，缩窄时就会重新出现信箱空隙。
 */

import type { CSSProperties } from 'react';

/**
 * 比例窗口半径。窗口内（`1/R ≤ ar ≤ R`）容器比例 = **原图比例**，零黑边；
 * 窗口外容器比例钉在最近的那条边界，差额才由黑底信箱带补齐。
 *
 * ## 为什么是 2.5（三条依据，都可自行复算，不引用任何外部实现的常量）
 *
 * 1. **手机竖屏截图的真实比例全部落在窗口内**：16:9 = 1:1.78 · 19.5:9 = 1:2.17 ·
 *    20:9 = 1:2.22 · iPhone 15 的 1179×2556 = 1:2.168 —— 全部 ≤ 1:2.5；而**滚动长截图**
 *    （整页截屏）普遍 1:4 以上，落在窗口外。这条线正好把「随手拍的竖版截图」判进按原比例，
 *    把长截图判进可以 letterbox。
 * 2. **横版侧同理**：16:9 = 1.78、21:9 影院 = 2.33 在窗口内；全景 3:1、32:9 超宽 = 3.56 在窗口外。
 * 3. **边界处的短边仍在本仓已经在展示的图片尺度内**：窗口边界短边 = 128px（竖，`320 × 0.4`）
 *    / 112px（横，`280 ÷ 2.5`）。相册一行 3 格 ≈ `(280 − 2×3)/3 = 91.3px`、
 *    一行 2 格 ≈ `(280 − 3)/2 = 138.5px`（album.css 的 `max-width: 280px` + `gap: 3px`），
 *    chat-menu-sheet.css 也把「每格 ≥ 64px」当可接受下限 ⇒ 128 / 112 都看得清。
 */
const RATIO_WINDOW = 2.5;

/**
 * 计算显示**上限盒**（宽高都只是上限，不是定值）
 *
 * @param originalWidth - 原始宽度
 * @param originalHeight - 原始高度
 * @param maxWidth - 宽度上限（默认 280）
 * @param maxHeight - 高度上限（默认 320）
 * @returns 容器的目标宽高（真正落地的宽度还会被 `max-width: 100%` 按可用宽收缩）
 *
 * ## 🔴 一条规则（huanwei 2026-08-14：「在最大范围长宽比例以内的，就不要硬用黑背景将其
 * 撑大为一个统一的大小，只有比例极其不对的才这么做」）
 *
 * 记 `ar = W/H`：
 * - **窗口内**（`1/2.5 ≤ ar ≤ 2.5`）：容器比例 = **原图比例** ⇒ 零黑边；
 * - **窗口外**：容器比例钉在最近的边界（`ar > 2.5` → `2.5:1`；`ar < 0.4` → `1:2.5`），
 *   差额由 `object-fit: contain` + 黑底补齐 —— 正是他允许的那一档。
 *
 * 两支合成同一段算术：先求「以目标比例 `r` **恰好装下原图**的自然盒」，再等比缩进上限盒，
 * 且 `scale ≤ 1`（永不放大）。窗口内 `r === ar` ⇒ 自然盒就是原图本身，这段退化成
 * 「等比缩到同时满足 `宽 ≤ maxWidth` 且 `高 ≤ maxHeight`」。
 *
 * ### 🔴 为什么不能简单回退到「先卡宽再卡高」（那是这一版之前的两条规则之一）
 *
 * 上一版是「只截高、宽度不动」，它自己是为了修更早那版「先卡宽、再卡高」——
 * 后者会把 200×3000 算成 **20×300 的细条**（不是被裁，是被算小了）。
 * 本版必须**同时**满足两头：窗口内不再落进统一盒（`1080×2400` → 144×320 而不是 280×320），
 * 且窗口外也不回细条（`200×3000` → **128×320**，画面 21×320 居中，黑边比上一版的
 * 280×320 少一半）。两个方向在 tests/unit/mediaDisplaySize.test.ts 各有用例。
 *
 * ⚠️ 返回值**不再**内联成容器的绝对宽高，调用方一律用
 * `{ width, maxWidth: '100%', aspectRatio }` —— 绝对宽度在窄屏上会溢出气泡、
 * 被 `.bubble-content { overflow: hidden }` 裁掉角（这正是他那张真机图里的缺角）。
 * 用 `aspectRatio` 承担高度后，宽度收缩时高度自己跟着收，仍然「加载完不跳版」。
 */
export function calculateDisplaySize(
  originalWidth: number,
  originalHeight: number,
  maxWidth = 280,
  maxHeight = 320,
): { width: number; height: number } {
  if (originalWidth <= 0 || originalHeight <= 0) {
    return { width: maxWidth, height: maxHeight };
  }

  const aspectRatio = originalWidth / originalHeight;
  // 容器比例：窗口内取原图比例（零黑边），窗口外钉到最近的边界（letterbox 只留这一档）
  const boxRatio = Math.min(Math.max(aspectRatio, 1 / RATIO_WINDOW), RATIO_WINDOW);

  // 以 boxRatio 恰好装下原图的「自然盒」：图比盒窄就由高定宽，否则宽度就是原宽。
  // 窗口内 boxRatio === aspectRatio ⇒ 自然盒 === 原图，两支在此汇合。
  const naturalWidth = aspectRatio >= boxRatio ? originalWidth : originalHeight * boxRatio;
  const naturalHeight = naturalWidth / boxRatio;

  // 等比缩进上限盒；`1` 那一项保证永不放大（小图仍按原尺寸显示）
  const scale = Math.min(maxWidth / naturalWidth, maxHeight / naturalHeight, 1);

  return {
    width: Math.round(naturalWidth * scale),
    height: Math.round(naturalHeight * scale),
  };
}

/**
 * 气泡态媒体容器的样式：宽度给**上限**、高度交给 `aspect-ratio`。
 *
 * 三处调用点（图片 / 视频 / 在途占位）必须**共用这一个函数** —— 上一版三处各写一遍
 * `{ width: displaySize.width, height: displaySize.height }`，改的时候漏了一处
 * 症状是「只有那一种消息还缺角」，与没改完全同形。
 */
export function mediaContainerStyle(displaySize: { width: number; height: number }): CSSProperties {
  return {
    width: displaySize.width,
    // 窄屏（可用宽 < 280）上按可用宽收缩，而不是溢出后被气泡裁掉角
    maxWidth: '100%',
    // 高度由比例导出：宽度一收缩高度跟着收，四角始终完整可见
    aspectRatio: `${displaySize.width} / ${displaySize.height}`,
  };
}
