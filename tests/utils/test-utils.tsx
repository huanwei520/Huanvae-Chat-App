/**
 * 测试工具函数
 *
 * 提供常用的测试辅助功能：
 * - 自定义 render 函数（带 Provider）
 * - Mock 数据生成
 * - 常用断言辅助
 */

import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ============================================
// 自定义 Render
// ============================================

interface WrapperProps {
  children: ReactNode;
}

/**
 * 测试用的 Provider 包装器
 * 可以添加需要的 Context Provider
 */
function AllProviders({ children }: WrapperProps) {
  return <>{children}</>;
}

/**
 * 自定义 render 函数
 * 自动包装必要的 Provider
 */
function customRender(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) {
  return {
    user: userEvent.setup(),
    ...render(ui, { wrapper: AllProviders, ...options }),
  };
}

// ============================================
// Mock 数据生成器
// ============================================

export const mockData = {
  /** 生成 mock 用户 */
  user: (overrides = {}) => ({
    id: 'user-1',
    username: 'testuser',
    nickname: '测试用户',
    avatar_url: null,
    email: 'test@example.com',
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  /** 生成 mock 好友 */
  friend: (overrides = {}) => ({
    id: 'friend-1',
    user_id: 'user-2',
    nickname: '好友',
    avatar_url: null,
    remark: null,
    status: 'accepted',
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  /** 生成 mock 群组 */
  group: (overrides = {}) => ({
    id: 'group-1',
    name: '测试群组',
    avatar_url: null,
    owner_id: 'user-1',
    member_count: 5,
    created_at: new Date().toISOString(),
    ...overrides,
  }),

  /** 生成 mock 消息 */
  message: (overrides = {}) => ({
    id: 'msg-1',
    conversation_id: 'conv-1',
    sender_id: 'user-1',
    content: '测试消息',
    message_type: 'text' as const,
    created_at: new Date().toISOString(),
    is_read: false,
    ...overrides,
  }),

  /** 生成 mock Session */
  session: (overrides = {}) => ({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    user: mockData.user(),
    serverUrl: 'https://api.example.com',
    ...overrides,
  }),
};

// ============================================
// 异步测试辅助
// ============================================

/**
 * 等待指定毫秒数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 等待直到条件满足
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 100,
): Promise<void> {
  const startTime = Date.now();
  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('waitFor timeout');
    }
    await sleep(interval);
  }
}

// ============================================
// 导出
// ============================================

export * from '@testing-library/react';
export { customRender as render, userEvent };

