/**
 * 会话相关类型定义
 *
 * 用于管理登录后的会话状态
 */

/** 用户资料 */
export interface UserProfile {
  user_id: string;
  user_nickname: string;
  user_email: string | null;
  user_signature: string | null;
  user_avatar_url: string | null;
  admin: string;
  created_at: string;
  updated_at: string;
}

/** 会话信息 */
export interface Session {
  /** 登录的服务器 URL */
  serverUrl: string;
  /** 用户 ID */
  userId: string;
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 用户资料 */
  profile: UserProfile;
  /** 本地头像路径 */
  avatarPath: string | null;
}

/** 会话上下文类型 */
export interface SessionContextType {
  /** 当前会话（null 表示未登录） */
  session: Session | null;
  /** 设置会话（登录成功后调用） */
  setSession: (session: Session) => void;
  /** 清除会话（登出时调用，会同时移除会话锁） */
  clearSession: () => void | Promise<void>;
  /** 是否已登录 */
  isLoggedIn: boolean;
}
