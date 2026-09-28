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
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import type { Session, SessionContextType } from '../types/session';
import { createApiClient, type ApiClient } from '../api/client';
import { removeSessionLock } from '../services/sessionLock';
import { persistSession, clearPersistedSession } from '../services/sessionPersist';
import { destroySyncService } from '../services/syncService';
import { clearVideoPosterSessionCache } from '../services/videoPoster';
import { clearPendingDeepLink } from '../services/deepLinkService';
import { shouldSyncToDaemon, syncToDaemon } from '../huanvaeGuard/daemonCredentialSync';
import { isMobile } from '../utils/platform';
import { getTokenExpiresAt } from '../utils/jwt';
import { useChatStore } from '../stores/chatStore';
import { useCardLiveStore } from '../stores/cardLiveStore';
import { useShelfStore } from '../stores/shelfStore';
import { useBotCommandsStore } from '../stores/botCommandsStore';

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

  // guard 守护进程凭据静默同步（401 自愈链的主窗口半边，gtcy072z 补强）。
  // 背景：推送链原先只挂在 VPN 页窗口 —— 页面没开时主窗口每次续期广播没有任何人
  // 消费，守护进程拿着死令牌撞 401 横幅（owner 2026-09-26 20:30 实拍复发根因之一）。
  // 这里在令牌生命周期的两个源头（setSession / updateTokens）直接过线，不依赖任何子窗口。
  // 门控与页面侧同构：安卓/iOS 不推（插件会话文件轨，无本地 HTTP 控制面）；空令牌不推；
  // 推送是本地回环 fire-and-forget，失败只落日志，绝不影响会话主流程。日志不得含令牌值。
  const pushGuardCredentials = useCallback((accessToken: string, refreshToken: string) => {
    if (!shouldSyncToDaemon(accessToken, isMobile())) { return; }
    void syncToDaemon(accessToken, refreshToken).then((r) => {
      if (r.ok) { return; }
      if (r.endpointMissing) {
        // 守护进程早于凭据推送端点发布（404）：自愈链最后一跳结构性断链，
        // 指向唯一出口 —— 升级守护进程，而不是笼统的「未生效」
        console.warn('[Session] guard 守护进程版本过旧（无凭据推送端点），令牌同步跳过：请在 VPN 页「修复服务」升级守护进程后重连隧道');
        return;
      }
      console.warn('[Session] guard 令牌推送未生效:', r.error ?? '未知原因');
    });
  }, []);

  // 设置会话（同时持久化到本地，移动端）
  const setSession = useCallback((newSession: Session) => {
    sessionRef.current = newSession;
    setSessionState(newSession);

    // 异步持久化（不阻塞 UI）
    persistSession(newSession).catch((error) => {
      console.warn('[Session] 持久化失败:', error);
    });

    // guard 守护进程凭据静默同步（见 pushGuardCredentials）：登录拿到的第一对令牌
    // 也要过线给守护进程 —— 重登撤销旧 refresh token 后，守护进程那对是第一批死令牌
    pushGuardCredentials(newSession.accessToken, newSession.refreshToken);
  }, [pushGuardCredentials]);

  // 恢复会话（不触发持久化，用于从存储恢复已有会话）
  const restoreSessionFromStorage = useCallback((restoredSession: Session) => {
    sessionRef.current = restoredSession;
    setSessionState(restoredSession);
    // 不调用 persistSession，因为数据已经在存储中
  }, []);

  // 清除会话（同时移除会话锁和持久化数据）
  const clearSession = useCallback(async () => {
    // 登出联动：关闭所有子窗口（小程序/HG/会议等），避免残留窗口带着旧会话
    void invoke('close_child_windows');

    // 清空会话级内存缓存（消息缓存/群内屏蔽·特别关心·备注私有视图），避免切换账号后串数据。
    // 收敛到这里统一处理，覆盖所有登出路径：主动登出 / session 过期 / WS token 刷新失败。
    useChatStore.getState().clearMessageCache();
    useCardLiveStore.getState().clear();
    useShelfStore.getState().clear();
    useBotCommandsStore.getState().clear();
    // 封面解析的进程内缓存同理：封面文件按 data/{user}_{server}/ 分账号分目录，
    // 跨账号复用就是把上一个账号的封面路径递给下一个账号的 <img>。
    // 挂在同一条收敛点上覆盖全部登出路径（见 services/videoPoster 的缓存注释）。
    clearVideoPosterSessionCache();

    // 通知会话深链暂存槽同理：A 账号收到的通知深链滞留在 MainActivity 静态槽，
    // 不清就会在 B 账号登录后跳进 A 账号的会话。桌面端无桥，no-op。
    clearPendingDeepLink();

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
  //
  // 🔴 ref 必须**同步**更新，且不能放在 setState 的 updater 里（2026-08-21）：
  //   ① `sessionRef.current` 现在是 api 客户端读 token 的**真值源**（见下方 useMemo），
  //      而 setState 的 updater 何时执行由 React 决定 —— 放在里面等于「刷完之后
  //      到 React 提交之前的那一段时间里，api 仍在用旧 token」，401 重试正好落在这一段。
  //   ② updater 必须是纯函数：StrictMode 会双调它，副作用（写 ref、写持久化）会被跑两次。
  const updateTokens = useCallback((accessToken: string, refreshToken: string) => {
    const prev = sessionRef.current;
    if (prev) {
      const updated = { ...prev, accessToken, refreshToken };
      sessionRef.current = updated;
      setSessionState(updated);
      persistSession(updated).catch((error) => {
        console.warn('[Session] 更新持久化失败:', error);
      });
    }

    // 广播给其他 Tauri 窗口（HuanvaeGuard 等），保证它们的 token 不过期
    // 失败只打日志，不影响主窗口会话状态
    emit('session:tokens-updated', { accessToken, refreshToken }).catch((error) => {
      console.warn('[Session] 跨窗口 token 广播失败:', error);
    });

    // guard 守护进程凭据静默同步：窗口事件不出进程（到不了独立服务进程），
    // 守护进程那份令牌只有本地 HTTP 这一条路（guard-token-resync skill §0 铁律）
    pushGuardCredentials(accessToken, refreshToken);
  }, [pushGuardCredentials]);

  // 创建 API 客户端（仅在有会话时）
  const autoReloginInFlightRef = useRef(false);
  //
  // 🔴 依赖**只有 serverUrl**，不是整个 session（2026-08-21，外部审计 idx=53）。
  //
  // 原先是 `[session, updateTokens, clearSession]`。`updateTokens` 与 `clearSession`
  // 都是 `useCallback([], …)`、引用稳定，真正在动的是 `session`：
  // token 主动刷新（JWT 15 分钟、提前 5 分钟刷 ⇒ 约每 10 分钟一次）与每次改昵称/头像
  // 都会 `setSessionState` 出一个新对象 ⇒ `api` 换新引用 ⇒ 全仓 101 个把 `api` 写进
  // 依赖数组的 effect/callback 全部重跑、重新发一轮请求（列表还闪一次 loading）。
  //
  // token 现在经 getter 从 `sessionRef` 现取（见 api/client.ts 的 `getAccessToken` 注释），
  // 客户端实例与 token 解耦 ⇒ 只有真正换服务器 / 登出登入才需要新客户端。
  const serverUrl = session?.serverUrl ?? null;
  const api = useMemo(() => {
    if (!serverUrl) {
      return null;
    }

    return createApiClient({
      baseUrl: serverUrl,
      // 从 ref 现取：ref 在 setSession / restoreSession / updateTokens 三处都是**同步**写的
      getAccessToken: () => sessionRef.current?.accessToken ?? '',
      getRefreshToken: () => sessionRef.current?.refreshToken ?? '',
      onTokenRefresh: (newAccessToken, newRefreshToken) => {
        updateTokens(newAccessToken, newRefreshToken);
      },
      onSessionExpired: () => {
        // 401→refresh→再401 的「自动重登腿」（块 1790430647659-tu14ytyn-1 验收②）：
        // 有已保存账号则静默重登（performAutoRelogin），成功即 setSession ——
        // pushGuardCredentials 随 setSession 把新令牌送达 guard 守护进程，拉取链自愈、
        // 横幅自清；失败才回退旧行为 clearSession（登出）。
        // 动态 import：避免把 tauri http 插件模块图拖进单测环境。
        const cur = sessionRef.current;
        if (!cur || autoReloginInFlightRef.current) {
          if (!cur) { clearSession(); }
          return;
        }
        autoReloginInFlightRef.current = true;
        void import('../services/autoRelogin')
          .then(async m => {
            const r = await m.performAutoRelogin(cur.serverUrl, cur.userId);
            console.warn('[Session] 会话过期自动重登成功（新令牌已随 setSession 静默同步 guard 守护进程）:', r.userId);
            setSession({
              serverUrl: r.serverUrl,
              userId: r.userId,
              accessToken: r.accessToken,
              refreshToken: r.refreshToken,
              profile: m.resolveAvatar(r.profile) as Session['profile'],
              avatarPath: r.avatarPath,
            });
          })
          .catch(err => {
            console.warn('[Session] 自动重登失败，回退登出:', err);
            clearSession();
          })
          .finally(() => { autoReloginInFlightRef.current = false; });
      },
    });
  }, [serverUrl, updateTokens, clearSession, setSession]);

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
