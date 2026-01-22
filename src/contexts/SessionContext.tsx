/**
 * 会话上下文
 *
 * 管理登录后的会话状态，包括：
 * - 当前登录的服务器 URL
 * - 用户信息和令牌
 * - 绑定了 serverUrl 的 API 客户端
 * - 移动端会话持久化（后台被杀后可恢复）
 */

import { createContext, useContext, useState, useMemo, useCallback, useRef, type ReactNode } from 'react';
import type { Session, SessionContextType } from '../types/session';
import { createApiClient, type ApiClient } from '../api/client';
import { removeSessionLock } from '../services/sessionLock';
import { persistSession, clearPersistedSession } from '../services/sessionPersist';

/** 扩展的会话上下文类型（包含 API 客户端） */
interface ExtendedSessionContextType extends SessionContextType {
  /** 已绑定 serverUrl 和 token 的 API 客户端 */
  api: ApiClient | null;
  /** 更新会话中的 tokens */
  updateTokens: (accessToken: string, refreshToken: string) => void;
}

// 创建上下文
const SessionContext = createContext<ExtendedSessionContextType | null>(null);

/** 会话提供者组件 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  // 用 ref 保存会话信息，以便在 clearSession 时能够访问
  const sessionRef = useRef<Session | null>(null);

  // 设置会话（同时持久化到本地，移动端）
  const setSession = useCallback((newSession: Session) => {
    sessionRef.current = newSession;
    setSessionState(newSession);

    // 异步持久化（不阻塞 UI）
    persistSession(newSession).catch((error) => {
      console.warn('[Session] 持久化失败:', error);
    });
  }, []);

  // 清除会话（同时移除会话锁和持久化数据）
  const clearSession = useCallback(async () => {
    // 移除会话锁
    if (sessionRef.current) {
      try {
        await removeSessionLock(sessionRef.current.serverUrl, sessionRef.current.userId);
      } catch (error) {
        console.warn('[SessionLock] 移除会话锁失败:', error);
      }
    }

    // 清除持久化的会话（移动端）
    try {
      await clearPersistedSession();
    } catch (error) {
      console.warn('[Session] 清除持久化失败:', error);
    }

    sessionRef.current = null;
    setSessionState(null);
  }, []);

  // 更新 tokens（同时更新持久化数据）
  const updateTokens = useCallback((accessToken: string, refreshToken: string) => {
    setSessionState((prev) => {
      if (!prev) {
        return null;
      }
      const updated = {
        ...prev,
        accessToken,
        refreshToken,
      };

      // 异步更新持久化数据（不阻塞 UI）
      persistSession(updated).catch((error) => {
        console.warn('[Session] 更新持久化失败:', error);
      });

      // 更新 ref
      sessionRef.current = updated;

      return updated;
    });
  }, []);

  // 创建 API 客户端（仅在有会话时）
  const api = useMemo(() => {
    if (!session) {
      return null;
    }

    return createApiClient({
      baseUrl: session.serverUrl,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      onTokenRefresh: (newAccessToken, newRefreshToken) => {
        updateTokens(newAccessToken, newRefreshToken);
      },
      onSessionExpired: () => {
        clearSession();
      },
    });
  }, [session, updateTokens, clearSession]);

  // 上下文值
  const value = useMemo<ExtendedSessionContextType>(() => ({
    session,
    setSession,
    clearSession,
    isLoggedIn: session !== null,
    api,
    updateTokens,
  }), [session, setSession, clearSession, api, updateTokens]);

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

/**
 * 使用会话 Hook
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { session, api, isLoggedIn } = useSession();
 *
 *   if (!isLoggedIn) {
 *     return <div>请先登录</div>;
 *   }
 *
 *   // 使用 api 发送请求（自动使用当前会话的 serverUrl 和 token）
 *   const handleClick = async () => {
 *     const data = await api.get('/api/messages');
 *   };
 * }
 * ```
 */
export function useSession(): ExtendedSessionContextType {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }

  return context;
}

/**
 * 使用 API 客户端 Hook（要求已登录）
 *
 * @throws 如果未登录则抛出错误
 *
 * @example
 * ```tsx
 * function AuthenticatedComponent() {
 *   const api = useApi();
 *
 *   // 直接使用，无需检查 null
 *   const data = await api.get('/api/profile');
 * }
 * ```
 */
export function useApi(): ApiClient {
  const { api, isLoggedIn } = useSession();

  if (!isLoggedIn || !api) {
    throw new Error('useApi requires an active session. Make sure user is logged in.');
  }

  return api;
}
