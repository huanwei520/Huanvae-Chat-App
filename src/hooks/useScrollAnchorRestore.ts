/**
 * 聊天滚动位置恢复 Hook
 *
 * 让用户在聊天 A 中翻阅历史 → 切换到 B → 切回 A 时，恢复到上次阅读位置。
 *
 * 工作原理：
 * 1. **记录锚点**：containerRef 的滚动事件 200ms 防抖后，扫描视口顶部第一条
 *    完全可见消息的 `data-message-uuid` 属性，保存到 chatStore.scrollAnchors[chatKey]。
 *
 * 2. **恢复定位**：上层在"首次渲染"那一刻调用 `restoreOrFallback()`。Hook 内部用
 *    `useLayoutEffect` 同步在 paint 前定位：
 *    - 查 chatStore.scrollAnchors[chatKey] 得到锚点 uuid
 *    - querySelector `[data-message-uuid="..."]` 找到 DOM 元素
 *    - 手动设置 `container.scrollTop += elRect.top - containerRect.top`
 *      （**不用** scrollIntoView，避免它沿祖先链冒泡导致外层 ChatPanel 等
 *      也被滚动，把整个页面推上、底部出现空白）
 *    - 找不到 → onFallbackToBottom（降级到现行"滚到底"逻辑）
 *
 *    使用 useLayoutEffect 而非 useEffect 是关键：DOM commit 后、浏览器 paint 前
 *    同步运行 → 用户看到消息时已在锚点位置，无两步跳跃。
 *
 * 3. **失效场景**：锚点消息被本地删除 / 不在当前已加载消息范围内 → 降级。
 *    （chatStore 缓存的是会话全量 messages 含 loadMore 历史，理论上锚点应该
 *    总能命中；只在用户重启应用 / 退出登录清缓存后才走降级路径。）
 *
 * 调用方约定（上层 ChatMessages 系列）：
 * - 提供 chatKey（如 "friend-uid123" / "group-gid456"）
 * - 提供 containerRef（滚动容器）
 * - 提供 messages 数组（用于检测"首次渲染"边界）
 * - 提供 isFirstRender（true 时触发恢复）
 * - 提供 onFallbackToBottom（锚点失效时降级）
 * - 提供 onFirstRenderHandled（恢复完成通知，让上层标记"非首次"）
 */

import { useEffect, useLayoutEffect } from 'react';
import { useChatStore } from '../stores/chatStore';

export interface UseScrollAnchorRestoreParams {
  /** 会话 key：`friend-${id}` / `group-${id}` */
  chatKey: string;
  /** 滚动容器 ref */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** 消息数组（仅用于触发 useLayoutEffect 依赖更新；Hook 内不读取内容） */
  messagesLength: number;
  /** 是否为首次渲染（上层用 prevMessagesLengthRef === -1 等机制判断） */
  isFirstRender: boolean;
  /** 锚点不可用时的降级回调（通常是上层的 scrollToBottom） */
  onFallbackToBottom: () => void;
  /** 恢复（或降级）完成后的回调，让上层标记首次渲染已处理 */
  onFirstRenderHandled: () => void;
  /** 滚动事件防抖时长（ms），默认 200 */
  debounceMs?: number;
}

export function useScrollAnchorRestore({
  chatKey,
  containerRef,
  messagesLength,
  isFirstRender,
  onFallbackToBottom,
  onFirstRenderHandled,
  debounceMs = 200,
}: UseScrollAnchorRestoreParams): void {
  // 直接拿稳定的 action 引用（zustand action 引用不变）
  const saveScrollAnchor = useChatStore((s) => s.saveScrollAnchor);

  // ============================================
  // 滚动监听：防抖后记录锚点
  // ============================================
  useEffect(() => {
    const container = containerRef.current;
    if (!container) { return; }

    let timer: ReturnType<typeof setTimeout> | null = null;

    const handleScroll = () => {
      if (timer) { clearTimeout(timer); }
      timer = setTimeout(() => {
        if (!container.isConnected) { return; }
        const containerRect = container.getBoundingClientRect();
        const items = container.querySelectorAll<HTMLElement>('[data-message-uuid]');
        for (const item of items) {
          const rect = item.getBoundingClientRect();
          // 找视口顶部第一条 top >= containerRect.top 的消息（完全或部分可见，顶部对齐或下方）
          if (rect.top >= containerRect.top) {
            const uuid = item.dataset.messageUuid;
            if (uuid) {
              saveScrollAnchor(chatKey, uuid);
            }
            break;
          }
        }
      }, debounceMs);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      if (timer) { clearTimeout(timer); }
    };
  }, [chatKey, containerRef, saveScrollAnchor, debounceMs]);

  // ============================================
  // 首次渲染同步恢复（useLayoutEffect 在 paint 前同步运行）
  // ============================================
  useLayoutEffect(() => {
    if (!isFirstRender || messagesLength === 0) { return; }

    const container = containerRef.current;
    if (!container) {
      onFallbackToBottom();
      onFirstRenderHandled();
      return;
    }

    // 直接从 store 拿当前快照（避免把 anchors 加入依赖导致每次锚点更新都重跑）
    const anchor = useChatStore.getState().scrollAnchors[chatKey];
    if (anchor) {
      const el = container.querySelector<HTMLElement>(
        `[data-message-uuid="${CSS.escape(anchor)}"]`,
      );
      if (el) {
        // 手动算容器内的 scrollTop 差值并赋值，**只动 container 自身**。
        //
        // 不用 element.scrollIntoView({ block: 'start' })：scrollIntoView 会沿
        // 祖先链冒泡，让所有可滚动祖先（ChatPanel / chat-window 等外层）都尝试
        // 把目标元素对齐到视口顶部 → 整个页面被推上 → 底部出现空白。
        // 直接改 container.scrollTop 严格只动这一个容器，不影响外层布局。
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        container.scrollTop += elRect.top - containerRect.top;
        onFirstRenderHandled();
        return;
      }
    }
    // 无锚点或锚点失效 → 走上层降级（通常是滚到底）
    onFallbackToBottom();
    onFirstRenderHandled();
  }, [
    isFirstRender,
    messagesLength,
    chatKey,
    containerRef,
    onFallbackToBottom,
    onFirstRenderHandled,
  ]);
}
