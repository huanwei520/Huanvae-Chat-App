/**
 * 更新模块配置
 *
 * 集中管理更新相关的配置，包括：
 * - 代理源列表（与 tauri.conf.json 保持一致）
 * - GitHub Release 地址
 * - 版本检测 JSON 文件路径
 *
 * 注意：修改代理源时需同步更新 tauri.conf.json 中的 updater.endpoints
 */

// ============================================
// 代理源配置
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

/** 单个代理超时时间（秒） */
export const PROXY_TIMEOUT_SECONDS = 10;

/** 开发环境模拟更新（设为 true 可在本地测试弹窗） */
export const DEBUG_UPDATE = false;
