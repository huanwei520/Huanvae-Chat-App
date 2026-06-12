/**
 * 会话上下文
 *
 * 管理登录后的会话状态，包括：
 * - 当前登录的服务器 URL
 * - 用户信息和令牌
 * - 绑定了 serverUrl 的 API 客户端
 * - 移动端会话持久化（后台被杀后可恢复）
 * - Token 主动刷新：解码 JWT 提取过期时间，在过期前 5 分钟自动刷新
 * - 跨 Tauri 窗口 token 同步：
 *     - updateTokens 时 emit `session:tokens-updated` 广播给其他窗口（如 HuanvaeGuard）
 *     - listen `session:request-tokens`，当其他窗口刚打开索要最新 token 时回发
 */

import { createContext, useContext, useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import type { Session, SessionContextType } from '../types/session';
import { createApiClient, type ApiClient } from '../api/client';
import { removeSessionLock } from '../services/sessionLock';
import { persistSession, clearPersistedSession } from '../services/sessionPersist';
import { destroySyncService } from '../services/syncService';
import { getTokenExpiresAt } from '../utils/jwt';
import { useChatStore } from '../stores/chatStore';

/** 扩展的会话上下文类型（包含 API 客户端） */
interface ExtendedSessionContextType extends SessionContextType {
  /** 已绑定 serverUrl 和 token 的 API 客户端 */
  api: ApiClient | null;
  /** 更新会话中的 tokens */
  updateTokens: (accessToken: string, refreshToken: string) => void;
  /** 恢复会话（不触发持久化，用于从存储恢复） */
  restoreSession: (session: Session) => void;
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

  // 恢复会话（不触发持久化，用于从存储恢复已有会话）
  const restoreSessionFromStorage = useCallback((restoredSession: Session) => {
    sessionRef.current = restoredSession;
    setSessionState(restoredSession);
    // 不调用 persistSession，因为数据已经在存储中
  }, []);

  // 清除会话（同时移除会话锁和持久化数据）
  const clearSession = useCallback(async () => {
    // 清空会话级内存缓存（消息缓存/群内屏蔽·特别关心·备注私有视图），避免切换账号后串数据。
    // 收敛到这里统一处理，覆盖所有登出路径：主动登出 / session 过期 / WS token 刷新失败。
    useChatStore.getState().clearMessageCache();

    // 销毁持有旧 API 引用的全局同步服务，防止重新登录后复用旧 token
    destroySyncService();

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

  // 更新 tokens（同时更新持久化数据 + 广播到其他 Tauri 窗口）
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

    // 广播给其他 Tauri 窗口（HuanvaeGuard 等），保证它们的 token 不过期
    // 失败只打日志，不影响主窗口会话状态
    emit('session:tokens-updated', { accessToken, refreshToken }).catch((error) => {
      console.warn('[Session] 跨窗口 token 广播失败:', error);
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

  // 响应其他 Tauri 窗口（HuanvaeGuard 等）对当前 token 的请求
  // 场景：HG 窗口刚打开时 URL 里的 token 可能已过期（例如笔记本睡眠后），
  //       HG emit `session:request-tokens`，这里回发最新 token
  useEffect(() => {
    const unlistenPromise = listen('session:request-tokens', () => {
      const current = sessionRef.current;
      if (!current) { return; }
      emit('session:tokens-updated', {
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
      }).catch((error) => {
        console.warn('[Session] 响应 tokens 请求失败:', error);
      });
    });
    return () => { void unlistenPromise.then(fn => fn()); };
  }, []);

  // Token 主动刷新：在过期前 5 分钟自动刷新，避免请求因 Token 失效而失败
  useEffect(() => {
    if (!session?.accessToken || !api) { return; }

    const BUFFER_MS = 5 * 60 * 1000;
    const expiresAt = getTokenExpiresAt(session.accessToken);
    if (expiresAt === null) { return; }

    const delay = expiresAt - BUFFER_MS - Date.now();

    if (delay <= 0) {
      console.warn('[Session] Token 即将过期，立即刷新');
      api.refreshAccessToken();
      return;
    }

    // eslint-disable-next-line no-console
    console.log('[Session] Token 主动刷新已调度，将在', Math.round(delay / 1000), '秒后执行');

    const timer = setTimeout(() => {
      console.warn('[Session] Token 主动刷新触发');
      api.refreshAccessToken();
    }, delay);

    return () => clearTimeout(timer);
  }, [session?.accessToken, api]);

  // 上下文值
  const value = useMemo<ExtendedSessionContextType>(() => ({
    session,
    setSession,
    clearSession,
    isLoggedIn: session !== null,
    api,
    updateTokens,
    restoreSession: restoreSessionFromStorage,
  }), [session, setSession, clearSession, api, updateTokens, restoreSessionFromStorage]);

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
