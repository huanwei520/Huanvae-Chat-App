/**
 * 更新模块配置
 *
 * 集中管理更新相关的配置，包括：
 * - 自建更新源（store.huanvae.cn，R2 托管，优先级最高）
 * - 代理源列表（GitHub 代理备用）
 * - GitHub Release 地址
 * - 版本检测 JSON 文件路径
 *
 * 桌面端原生更新由 tauri.conf.json updater.endpoints 控制（首选 R2）
 * Android 更新由 service.android.ts 使用下方 PROXY_URLS 轮询
 */

// ============================================
// 自建更新源（Cloudflare R2）
// ============================================

export const SELF_HOSTED_BASE = 'https://store.huanvae.cn/update/huanvae-chat';
export const SELF_HOSTED_DESKTOP_JSON = `${SELF_HOSTED_BASE}/latest.json`;
export const SELF_HOSTED_ANDROID_JSON = `${SELF_HOSTED_BASE}/android-latest.json`;

// ============================================
// 代理源配置（备用）
// ============================================

/**
 * 代理源列表（按优先级排序）
 * 用于加速国内用户下载 GitHub Release 资源
 * 空字符串表示直连
 */
export const PROXY_URLS = [
  'https://edgeone.gh-proxy.org/',
  'https://cdn.gh-proxy.org/',
  'https://hk.gh-proxy.org/',
  'https://gh-proxy.org/',
  '', // 直连（最后尝试）
];

// ============================================
// GitHub Release 配置
// ============================================

/** GitHub 仓库所有者 */
export const GITHUB_OWNER = 'huanwei520';

/** GitHub 仓库名称 */
export const GITHUB_REPO = 'huanvae-chat-app';

/** GitHub Release 基础地址 */
export const GITHUB_RELEASE_BASE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

// ============================================
// 版本检测配置
// ============================================

/** Android 版本检测 JSON 文件路径（相对于 Release） */
export const ANDROID_LATEST_JSON_PATH = '/latest/download/android-latest.json';

/** 桌面端版本检测 JSON 文件路径（相对于 Release） */
export const DESKTOP_LATEST_JSON_PATH = '/latest/download/latest.json';

// ============================================
// 更新检查配置
// ============================================

/** 更新检查延迟时间（毫秒），避免启动时立即检查 */
export const UPDATE_CHECK_DELAY = 3000;

/**
 * 启动时更新检查延迟（毫秒）
 *
 * 由 App.tsx 顶层的 useStartupUpdateCheck() 使用，在登录页就触发一次检测。
 * 比 UPDATE_CHECK_DELAY（3s，登录后主页用）长 2s，让登录页 UI 先稳定渲染，
 * 同时与主页 hook 错峰避免视觉重叠。
 */
export const UPDATE_CHECK_DELAY_STARTUP = 5000;

/** 单个代理超时时间（秒） */
export const PROXY_TIMEOUT_SECONDS = 10;

/** 开发环境模拟更新（设为 true 可在本地测试弹窗） */
export const DEBUG_UPDATE = false;
