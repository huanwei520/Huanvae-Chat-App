/**
 * 顶层浮层注册表（top layer registry）
 *
 * @location src/hooks/useTopLayer.ts
 *
 * ## 它解决的是什么
 *
 * 项目里多个浮层各自 `createPortal(…, document.body)`：侧边设置面板（ChatMenuPanel）、
 * 全屏媒体预览（MobileMediaPreview）、各种右键菜单……它们在 DOM 里是**兄弟节点**，
 * 谁也不包含谁。于是任何靠 `ref.contains(e.target)` 判「点击是否发生在我外部」的逻辑，
 * 都会把**盖在自己之上**的更高层浮层判成「外部」——
 * 用户在全屏预览里点 ✕，底下的侧边面板收到 document mousedown、判定为点了外部、把自己关掉；
 * 关掉预览后用户发现整个面板也没了，落回了聊天页。
 *
 * ## 这不是兜底，是层级判定
 *
 * 判据不是「我要不要防一手」，而是「这一次指针事件**归谁所有**」：
 * 当一个更高层浮层正开着，那次点击在语义上属于它，底下的层根本不该看见这次事件，
 * 更不该据此推断「用户点到我外面去了」。
 *
 * 与 {@link import('./useMobileBackHandler').useMobileBackOverlay} 的
 *「浮层车道恒先于页面栈」是**同一套层级观**的两个投影：
 * 一个管系统返回键的归属，一个管指针事件的归属。两者都不做「关闭动作的兜底」，
 * 只回答「这个事件是谁的」。
 *
 * ## 为什么是计数器而不是 `closest('.某个类名')`
 *
 * 类名判定要求「每个想被当成顶层的浮层都记得挂上那个类名」——一个新浮层忘了挂，
 * 就悄悄退回旧行为，且没有任何东西会报错。计数器把注册动作绑在浮层自己的生命周期上
 * （`useTopLayer(isOpen)`），开着就在册、卸载就出册，漏挂只会是**没调用 hook**，
 * 而那是在浮层自己的代码里一眼可见的缺失。
 *
 * ## 用法
 *
 * ```tsx
 * function FullscreenPreview({ isOpen }: { isOpen: boolean }) {
 *   useTopLayer(isOpen);            // isOpen 期间登记自己是顶层
 *   // …
 * }
 *
 * // 底下那层的「点击外部关闭」：
 * const handleClickOutside = (e: MouseEvent) => {
 *   if (isTopLayerActive()) { return; }   // 这次点击归更高层所有
 *   // …原有 contains 判定
 * };
 * ```
 */

import { useEffect } from 'react';

/**
 * 当前处于激活状态的顶层浮层数量。
 *
 * 用计数而不是布尔：浮层可能叠浮层（预览之上再开一个确认框），
 * 布尔会被先卸载的那个错误地清零。
 */
let activeTopLayerCount = 0;

/**
 * 在 `active` 为真的期间，把当前组件登记为「顶层浮层」。
 *
 * @param active 浮层是否正显示（通常直接传组件的 `isOpen`）
 */
export function useTopLayer(active: boolean): void {
  useEffect(() => {
    if (active) {
      activeTopLayerCount += 1;
      return () => {
        activeTopLayerCount -= 1;
      };
    }
  }, [active]);
}

/**
 * 当前是否有顶层浮层开着。
 *
 * 供底层浮层的「点击外部关闭」在**首行**短路用：为真时这次指针事件归更高层所有，
 * 底层不该把它解释成「用户点到我外面了」。
 */
export function isTopLayerActive(): boolean {
  return activeTopLayerCount > 0;
}
