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

// 是否已初始化插件
let pluginInitialized = false;
// 初始化 Promise（防止竞态条件）
let initPromise: Promise<void> | null = null;
// 保持监听器引用（防止被垃圾回收）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let listenerHandle: any = null;

/**
 * 初始化返回按钮监听
 *
 * 仅在移动端首次调用时初始化
 * 使用 Promise 防止竞态条件导致的重复初始化
 */
function initBackListener(): Promise<void> {
  console.log('[MobileBackHandler] initBackListener 调用, pluginInitialized:', pluginInitialized, 'isMobile:', isMobile());

  if (pluginInitialized || !isMobile()) {
    console.log('[MobileBackHandler] 跳过初始化（已完成或非移动端）');
    return Promise.resolve();
  }

  // 如果已有初始化 Promise，返回它（防止重复初始化）
  if (initPromise) {
    console.log('[MobileBackHandler] 返回现有初始化 Promise');
    return initPromise;
  }

  initPromise = (async () => {
    try {
      console.log('[MobileBackHandler] 开始导入插件...');
      // 动态导入插件（避免桌面端加载错误）
      const { registerBackEvent } = await import(
        '@kingsword/tauri-plugin-mobile-onbackpressed-listener'
      );
      console.log('[MobileBackHandler] 插件导入成功, registerBackEvent:', typeof registerBackEvent);

      // 注册全局返回事件处理（保存返回的 PluginListener 防止被 GC）
      listenerHandle = await registerBackEvent(() => {
        console.log('[MobileBackHandler] 收到返回事件, 栈大小:', backHandlerStack.length);

        // 从栈顶开始遍历，找到第一个能处理的处理器
        for (let i = backHandlerStack.length - 1; i >= 0; i--) {
          const handler = backHandlerStack[i];
          const result = handler();
          console.log('[MobileBackHandler] 处理器', i, '返回:', result);
          if (result) {
            // 已处理，不继续传递
            console.log('[MobileBackHandler] 事件已处理');
            return;
          }
        }
        // 没有处理器处理，执行默认行为（退出应用）
        console.log('[MobileBackHandler] 无处理器处理，将退出应用');
      });
      console.log('[MobileBackHandler] listenerHandle:', listenerHandle);

      pluginInitialized = true;
      // eslint-disable-next-line no-console
      console.log('[MobileBackHandler] 返回按钮监听已初始化');
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

    // 注册到栈中
    backHandlerStack.push(wrappedHandler);

    // 清理时从栈中移除
    return () => {
      const index = backHandlerStack.indexOf(wrappedHandler);
      if (index !== -1) {
        backHandlerStack.splice(index, 1);
      }
    };
  }, []);
}
