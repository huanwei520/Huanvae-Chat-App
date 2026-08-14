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
 * 计算显示**上限盒**（宽高都只是上限，不是定值）
 *
 * @param originalWidth - 原始宽度
 * @param originalHeight - 原始高度
 * @param maxWidth - 宽度上限（默认 280）
 * @param maxHeight - 高度上限（默认 320）
 * @returns 容器的目标宽高（真正落地的宽度还会被 `max-width: 100%` 按可用宽收缩）
 *
 * ## 🔴 「限高不再倒着缩宽度」（huanwei 2026-08-14 手机端媒体缩放）
 *
 * 旧实现是「先卡宽、再卡高」，而卡高那一步会把**宽度按比例缩回去**：
 * 一张 200×3000 的超高竖图，卡宽这一步不动它（200 < 280），卡高那一步把高截到 300 后
 * 又按比例把宽算成 **20px** ⇒ 屏幕上是一条 20×300 的细条 —— 不是被裁，是被算小了。
 * 素材再宽一点更刺眼：600×9000 会从 280×4200 一路被算成 21×300。
 * 修法是卡高时**只截高**，宽度留在（不超过上限的）原宽上，
 * 画面靠 `object-fit: contain` + 黑底信箱带补齐（`.image-message` / `.video-message`
 * 早就是 contain，黑底见 chat-bubble-meta.css）。
 *
 * 高度上限同批 300 → 320（方案文档 §6.3 H1）。
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

  // 限制最大宽度
  const displayWidth = Math.min(originalWidth, maxWidth);
  // 限制最大高度：**只截高**，不再把宽度倒着缩小
  const displayHeight = Math.min(displayWidth / aspectRatio, maxHeight);

  return {
    width: Math.round(displayWidth),
    height: Math.round(displayHeight),
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
