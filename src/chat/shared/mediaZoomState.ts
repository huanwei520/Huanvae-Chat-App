/**
 * 全屏媒体预览「是否处于放大态」的单一真值源
 *
 * @module chat/shared
 * @location src/chat/shared/mediaZoomState.ts
 *
 * ## 这个文件存在的唯一理由：它是两层手势的交界
 *
 * - **写方 = 缩放 / 平移层**（chat/shared/useImageZoom.ts）：缩放比例一变就调
 *   `setMediaZoomed(scale > 1)`
 * - **读方 = 横向切图层**（chat/shared/mediaSwipe.ts + MobileMediaPreview 里的滑动手势）：
 *   读到 true 就把横向手势整个让出去，一律不切图
 *
 * 行为矩阵（两层都按这个做）：
 *
 * | 状态 | 横向拖动 |
 * |---|---|
 * | 未放大（`zoomed === false`） | 切上一张 / 下一张（切图层） |
 * | 已放大（`zoomed === true`）  | 平移图片，不切图（缩放层） |
 *
 * ## 为什么是一个模块级单例，而不是 props / context
 *
 * 全屏预览在任一时刻**只有一个**（移动端是 createPortal 到 body 的单个浮层，
 * 桌面端是独立的 media 窗口、各自一个 webview），所以"当前是否放大"是一个全局单值。
 * 用模块级 store 换来的是：缩放层无论把 scale 放在哪一层组件里，接入成本都是**一行**
 * `setMediaZoomed(next > 1)`，不需要为了把布尔量递到切图层而改一路 props。
 *
 * ⚠️ 同一时刻页面上可能挂着**多个** MobileMediaPreview 实例（例如「我的文件」页那个
 * `isOpen=false` 的常驻实例）。只有**被激活的那个**才有资格写这里 ——
 * 写方自己按 `enabled` 门控（见 useImageZoom 的激活/释放 effect），
 * 否则一个没打开的实例会把真正打开的那个的放大态覆盖掉。
 */

import { create } from 'zustand';

interface MediaZoomStore {
  /** 当前全屏预览是否处于放大态（scale > 1） */
  zoomed: boolean;
}

const useMediaZoomStore = create<MediaZoomStore>(() => ({ zoomed: false }));

/**
 * 缩放层调用：把当前是否放大写进真值源。
 *
 * 只在值真的变了时才 set —— 捏合过程中这个函数会被每帧调用，
 * 无条件 set 会让读方（切图层所在的浮层）跟着每帧重渲一次。
 */
export function setMediaZoomed(zoomed: boolean): void {
  if (useMediaZoomStore.getState().zoomed !== zoomed) {
    useMediaZoomStore.setState({ zoomed });
  }
}

/** 组件里读（会订阅、值变化时重渲） */
export function useMediaZoomed(): boolean {
  return useMediaZoomStore((s) => s.zoomed);
}

/**
 * 事件回调里同步读（不订阅、不触发重渲）。
 *
 * touchmove 每帧都要问一次"现在放大了没"，走 hook 拿到的是**上一次渲染**时的值 ——
 * 捏合刚把 zoomed 置 true 的那一帧还没提交，切图层就会用旧的 false 继续跟手。
 */
export function isMediaZoomedNow(): boolean {
  return useMediaZoomStore.getState().zoomed;
}
