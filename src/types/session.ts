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
  /** 资料背景图相对路径（需经 resolveServerAvatarUrl 收口；null=默认封面）。旧会话缓存可能缺省 */
  background_url?: string | null;
  /** 性别：male/female/other（null=未设置）。旧会话缓存可能缺省 */
  gender?: string | null;
  /** 生日 ISO 日期 YYYY-MM-DD（null=未设置）。旧会话缓存可能缺省 */
  birthday?: string | null;
  /** 地区，自由文本（null=未设置）。旧会话缓存可能缺省 */
  region?: string | null;
  admin: string;
  created_at: string;
  updated_at: string;
}

/** 会话信息 */
export interface Session {
  /**
   * 登录的**逻辑域名**（如 `https://api.huanvae.cn`，由发现服务确定）。
   * 作为稳定标识用于账号库 key、本地数据目录命名、UI 显示；
   * 物理直连 IP 不入此字段，由 secureHttp / WS 注入层经发现服务 resolve 处理。
   */
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
