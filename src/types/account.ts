/**
 * 账号相关类型定义
 *
 * 本地调用格式使用短横线 "-"
 * 调用服务器格式使用下划线 "_"
 */

/** 已保存的账号信息（不含密码） */
export interface SavedAccount {
  /** 用户 ID */
  user_id: string;
  /** 昵称（持久显示） */
  nickname: string;
  /** 服务器地址 */
  server_url: string;
  /** 本地头像路径 */
  avatar_path: string | null;
  /** 保存时间 */
  created_at: string;
}

/** 登录凭证 */
export interface LoginCredentials {
  server_url: string;
  user_id: string;
  password: string;
}

/** 注册数据 */
export interface RegisterData {
  server_url: string;
  user_id: string;
  nickname: string;
  password: string;
  email?: string; // 非必填
}

/** 登录响应 */
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
}

/**
 * 用户资料响应（登录前 raw fetch 层的原始信封）。
 *
 * auth.ts 的 getProfile 经 `api<T>` 直返 `response.json<T>()`（不解包 ApiResponse），
 * 故此处保留 `{ data: {...} }` 外层，App.tsx 登录路径消费 `.data`。
 * 注意：与 api/profile.ts 的扁平 `ProfileResponse`（登录后 ApiClient 已解包层）是两个类型，勿混。
 */
export interface RawProfileResponse {
  data: {
    user_id: string;
    user_nickname: string;
    user_email: string | null;
    user_signature: string | null;
    user_avatar_url: string | null;
    admin: string;
    created_at: string;
    updated_at: string;
  };
}

/** 应用页面状态 */
export type AppPage = 'loading' | 'account-selector' | 'login' | 'register';
