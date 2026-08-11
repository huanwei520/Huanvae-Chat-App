/**
 * 移动端返回按钮处理 Hook
 *
 * 使用 tauri-plugin-mobile-onbackpressed-listener 插件处理 Android 手势返回
 *
 * ## 使用方式
 *
 * ```tsx
 * useMobileBackHandler(() => {
 *   if (modalOpen) {
 *     closeModal();
 *     return true; // 已处理
 *   }
 *   return false; // 未处理，执行默认行为（退出应用）
 * });
 * ```
 *
 * ## 处理优先级
 *
 * 1. 预览模态框打开 → 关闭模态框
 * 2. 聊天页面 → 返回消息列表
 * 3. 侧边抽屉打开 → 关闭抽屉
 * 4. 主页面 → 退出应用
 */

import { useEffect, useRef } from 'react';
import { isMobile } from '../utils/platform';

// 全局返回处理器栈
// 后注册的处理器优先执行（模态框 > 页面 > 主容器）
type BackHandler = () => boolean;
const backHandlerStack: BackHandler[] = [];

// 🔴 浮层处理器：**恒先于**上面那个栈被询问
//
// 为什么需要单独一层，而不是"让浮层后注册就行"：
// React 的 effect 是**自下而上**执行的（子先于父）。而浮层（他人资料页 / 群详情 / 群设置面板）
// 都是被父级页面渲染出来的**子组件** ⇒ 它们的注册 effect 恒**早于** MobileMain
// ⇒ 在「后注册者优先」的栈里恒排在**下面** ⇒ 父级页面反而先处理掉返回事件。
// 结果就是上面注释写的「模态框 > 页面」在实现上是**反的**。
//
// 这条不是理论问题：真机实测过，在他人资料页按系统返回键会**直接退出 App**
//（MobileMain 的链走到底 return false ⇒ 默认行为 = 退出），而不是关掉资料页。
// 手势导航（安卓默认）下从最左边缘起手的返回手势会被系统吃掉并转成同一个 Android back，
// 所以这条通路是那种形态下**唯一**的返回路径，必须正确。
const overlayHandlers: BackHandler[] = [];

// 是否已初始化插件
let pluginInitialized = false;
// 初始化 Promise（防止竞态条件）
let initPromise: Promise<void> | null = null;
// 保持监听器引用（防止被垃圾回收）
// 使用对象存储避免 TypeScript "never read" 错误
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listenerRef: { current: any } = { current: null };

/**
 * 初始化返回按钮监听
 *
 * 仅在移动端首次调用时初始化
 * 使用 Promise 防止竞态条件导致的重复初始化
 */
function initBackListener(): Promise<void> {
  if (pluginInitialized || !isMobile()) {
    return Promise.resolve();
  }

  // 如果已有初始化 Promise，返回它（防止重复初始化）
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // 动态导入插件（避免桌面端加载错误）
      const { registerBackEvent } = await import(
        '@kingsword/tauri-plugin-mobile-onbackpressed-listener'
      );

      // 注册全局返回事件处理（保存返回的 PluginListener 防止被 GC）
      listenerRef.current = await registerBackEvent(() => {
        // ① 先问浮层（模态框/整页浮层）—— 与 effect 注册顺序无关，见 overlayHandlers 注释
        for (let i = overlayHandlers.length - 1; i >= 0; i--) {
          if (overlayHandlers[i]()) {
            return;
          }
        }
        // ② 再走页面级栈，从栈顶开始遍历
        for (let i = backHandlerStack.length - 1; i >= 0; i--) {
          const handler = backHandlerStack[i];
          const result = handler();
          if (result) {
            // 已处理，不继续传递
            return;
          }
        }
        // 没有处理器处理，执行默认行为（退出应用）
      });

      pluginInitialized = true;
    } catch (error) {
      console.error('[MobileBackHandler] 初始化失败:', error);
      initPromise = null; // 失败时重置，允许重试
    }
  })();

  return initPromise;
}

/**
 * 移动端返回按钮处理 Hook
 *
 * @param handler 返回处理函数，返回 true 表示已处理，false 表示未处理
 */
export function useMobileBackHandler(handler: BackHandler): void {
  useBackHandlerIn(backHandlerStack, handler);
}

/**
 * 浮层专用的返回处理注册（**恒先于** {@link useMobileBackHandler} 被询问）
 *
 * 给「他人资料页 / 群详情弹窗 / 群设置面板」这类盖在页面之上的整页/模态浮层用。
 * 它们各自持有自己的开关状态（store 或组件内 useState），由自己决定要不要接管返回，
 * 不必把状态上提到 MobileMain —— 那样每加一个浮层就要改一次页面级的优先级链。
 *
 * 约定与 {@link useMobileBackHandler} 一致：返回 `true` = 我处理了（不再往下传），
 * `false` = 我现在没开着，交给下一个。
 */
export function useMobileBackOverlay(handler: BackHandler): void {
  useBackHandlerIn(overlayHandlers, handler);
}

/** 两个注册口的公共实现（只差往哪个列表里挂） */
function useBackHandlerIn(list: BackHandler[], handler: BackHandler): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!isMobile()) {
      return;
    }

    // 初始化插件（仅首次）
    initBackListener();

    // 创建包装函数以使用最新的 handler
    const wrappedHandler: BackHandler = () => handlerRef.current();

    list.push(wrappedHandler);

    // 清理时从列表中移除
    return () => {
      const index = list.indexOf(wrappedHandler);
      if (index !== -1) {
        list.splice(index, 1);
      }
    };
  }, [list]);
}
