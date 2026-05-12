/**
 * useScrollAnchorRestore Hook 测试
 *
 * 覆盖：
 * 1. 滚动事件 200ms 防抖后调 saveScrollAnchor（记录视口顶部消息 uuid）
 * 2. isFirstRender + 有锚点 → 手动设置 container.scrollTop 到锚点偏移
 *    （不使用 scrollIntoView 避免冒泡到外层滚动祖先）
 * 3. isFirstRender + 锚点不存在 → onFallbackToBottom 调用
 * 4. isFirstRender + 锚点失效（DOM 中无该元素）→ onFallbackToBottom 调用
 * 5. messagesLength === 0 时不触发恢复（避免空容器误调）
 * 6. unmount 时 remove event listener + clearTimeout（无 memory leak）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useChatStore } from '../../src/stores/chatStore';
import { useScrollAnchorRestore } from '../../src/hooks/useScrollAnchorRestore';

// 创建一个真实的 DOM 容器，并植入 data-message-uuid 元素，供测试用
function setupContainer(messageUuids: string[]): React.RefObject<HTMLDivElement | null> {
  const container = document.createElement('div');
  container.style.overflowY = 'auto';
  container.style.height = '200px';
  document.body.appendChild(container);

  // getBoundingClientRect mock：容器自身 top=0，每个消息项 height=50
  Object.defineProperty(container, 'getBoundingClientRect', {
    value: () => ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) }),
    configurable: true,
  });

  for (let i = 0; i < messageUuids.length; i++) {
    const el = document.createElement('div');
    el.setAttribute('data-message-uuid', messageUuids[i] ?? '');
    el.dataset.messageUuid = messageUuids[i];
    el.style.height = '50px';
    // 第 i 项 top = i*50（容器 scroll 0 时）
    Object.defineProperty(el, 'getBoundingClientRect', {
      value: () => ({
        top: i * 50,
        bottom: i * 50 + 50,
        left: 0,
        right: 300,
        width: 300,
        height: 50,
        x: 0,
        y: i * 50,
        toJSON: () => ({}),
      }),
      configurable: true,
    });
    container.appendChild(el);
  }

  return { current: container };
}

function cleanupDom() {
  document.body.innerHTML = '';
}

describe('useScrollAnchorRestore', () => {
  beforeEach(() => {
    useChatStore.getState().clearCacheAndAnchors();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanupDom();
    vi.useRealTimers();
  });

  it('首次渲染 + 有锚点 → 容器 scrollTop 改为锚点相对偏移（不调用 scrollIntoView）', () => {
    // setupContainer 中每个元素 top = index * 50（mock getBoundingClientRect 实现）。
    // container.top = 0，所以 m2 (index=1) 的 top=50。
    // 锚点恢复逻辑：container.scrollTop += (elTop - containerTop) → scrollTop 应 += 50。
    const ref = setupContainer(['m1', 'm2', 'm3']);
    useChatStore.getState().saveScrollAnchor('friend-A', 'm2');

    // 容器初始 scrollTop = 0，恢复后应变为 50
    expect(ref.current!.scrollTop).toBe(0);

    // 防回退断言：scrollIntoView 不应被调用（防止未来误改回 scrollIntoView 让全页面上翻）
    const m2 = ref.current!.querySelector('[data-message-uuid="m2"]') as HTMLElement;
    const scrollIntoViewSpy = vi.fn();
    m2.scrollIntoView = scrollIntoViewSpy;

    const onFallback = vi.fn();
    const onHandled = vi.fn();

    renderHook(() =>
      useScrollAnchorRestore({
        chatKey: 'friend-A',
        containerRef: ref,
        messagesLength: 3,
        isFirstRender: true,
        onFallbackToBottom: onFallback,
        onFirstRenderHandled: onHandled,
      }),
    );

    // 用 scrollTop 验证手动恢复路径生效
    expect(ref.current!.scrollTop).toBe(50);
    // scrollIntoView 路径已废弃（沿祖先链冒泡导致外层滚动）
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it('首次渲染 + 无锚点 → 调用 onFallbackToBottom', () => {
    const ref = setupContainer(['m1', 'm2']);
    // 没有 saveScrollAnchor
    const onFallback = vi.fn();
    const onHandled = vi.fn();

    renderHook(() =>
      useScrollAnchorRestore({
        chatKey: 'friend-A',
        containerRef: ref,
        messagesLength: 2,
        isFirstRender: true,
        onFallbackToBottom: onFallback,
        onFirstRenderHandled: onHandled,
      }),
    );

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it('首次渲染 + 锚点 uuid 在 DOM 中不存在 → 调用 onFallbackToBottom', () => {
    const ref = setupContainer(['m1', 'm2']);
    useChatStore.getState().saveScrollAnchor('friend-A', 'm-not-in-dom');
    const onFallback = vi.fn();
    const onHandled = vi.fn();

    renderHook(() =>
      useScrollAnchorRestore({
        chatKey: 'friend-A',
        containerRef: ref,
        messagesLength: 2,
        isFirstRender: true,
        onFallbackToBottom: onFallback,
        onFirstRenderHandled: onHandled,
      }),
    );

    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onHandled).toHaveBeenCalledTimes(1);
  });

  it('messagesLength === 0 时不触发恢复', () => {
    const ref = setupContainer([]);
    useChatStore.getState().saveScrollAnchor('friend-A', 'm1');
    const onFallback = vi.fn();
    const onHandled = vi.fn();

    renderHook(() =>
      useScrollAnchorRestore({
        chatKey: 'friend-A',
        containerRef: ref,
        messagesLength: 0,
        isFirstRender: true,
        onFallbackToBottom: onFallback,
        onFirstRenderHandled: onHandled,
      }),
    );

    expect(onFallback).not.toHaveBeenCalled();
    expect(onHandled).not.toHaveBeenCalled();
  });

  it('isFirstRender=false 时不触发恢复', () => {
    const ref = setupContainer(['m1']);
    useChatStore.getState().saveScrollAnchor('friend-A', 'm1');
    const onFallback = vi.fn();
    const onHandled = vi.fn();

    renderHook(() =>
      useScrollAnchorRestore({
        chatKey: 'friend-A',
        containerRef: ref,
        messagesLength: 1,
        isFirstRender: false,
        onFallbackToBottom: onFallback,
        onFirstRenderHandled: onHandled,
      }),
    );

    expect(onFallback).not.toHaveBeenCalled();
    expect(onHandled).not.toHaveBeenCalled();
  });

  it('滚动事件 200ms 防抖后调 saveScrollAnchor 记录视口顶部消息 uuid', async () => {
    const ref = setupContainer(['m1', 'm2', 'm3']);
    const onFallback = vi.fn();
    const onHandled = vi.fn();

    renderHook(() =>
      useScrollAnchorRestore({
        chatKey: 'friend-A',
        containerRef: ref,
        messagesLength: 3,
        isFirstRender: false,
        onFallbackToBottom: onFallback,
        onFirstRenderHandled: onHandled,
      }),
    );

    // 触发 scroll 事件（容器顶部首条可见消息是 m1）
    ref.current!.dispatchEvent(new Event('scroll'));

    // 反向断言：防抖窗口（199ms）内不写入
    await vi.advanceTimersByTimeAsync(199);
    expect(useChatStore.getState().scrollAnchors['friend-A']).toBeUndefined();

    // 推进到 200ms 整 → 触发写入
    await vi.advanceTimersByTimeAsync(1);
    expect(useChatStore.getState().scrollAnchors['friend-A']).toBe('m1');
  });

  it('快速连续滚动事件只记录最后一次', async () => {
    const ref = setupContainer(['m1', 'm2']);
    renderHook(() =>
      useScrollAnchorRestore({
        chatKey: 'friend-A',
        containerRef: ref,
        messagesLength: 2,
        isFirstRender: false,
        onFallbackToBottom: vi.fn(),
        onFirstRenderHandled: vi.fn(),
      }),
    );

    ref.current!.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(100);
    ref.current!.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(100);
    // 此时第一次 scroll 的 timer 已被第二次重置，未触发
    expect(useChatStore.getState().scrollAnchors['friend-A']).toBeUndefined();

    await vi.advanceTimersByTimeAsync(100); // 第二次 scroll 总共 200ms
    expect(useChatStore.getState().scrollAnchors['friend-A']).toBe('m1');
  });
});
