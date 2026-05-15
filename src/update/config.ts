/**
 * 更新模块配置
 *
 * 仅支持两条更新源（按优先级）：
 * 1. 自建 Cloudflare R2（store.huanvae.cn） — 优先
 * 2. GitHub Release 直连 — 备用
 *
 * 桌面端原生更新由 tauri.conf.json updater.endpoints 控制（同样的两源顺序）
 * Android 更新由 service.android.ts 按上述优先级回退
 */

// ============================================
// 自建更新源（Cloudflare R2，优先）
// ============================================

export const SELF_HOSTED_BASE = 'https://store.huanvae.cn/update/huanvae-chat';
export const SELF_HOSTED_DESKTOP_JSON = `${SELF_HOSTED_BASE}/latest.json`;
export const SELF_HOSTED_ANDROID_JSON = `${SELF_HOSTED_BASE}/android-latest.json`;

// ============================================
// GitHub Release 直连（备用）
// ============================================

/** GitHub 仓库所有者 */
export const GITHUB_OWNER = 'huanwei520';

/** GitHub 仓库名称 */
export const GITHUB_REPO = 'huanvae-chat-app';

/** GitHub Release 基础地址 */
export const GITHUB_RELEASE_BASE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases`;

/** Android 版本检测 JSON 文件路径（相对于 Release） */
export const ANDROID_LATEST_JSON_PATH = '/latest/download/android-latest.json';

/** 桌面端版本检测 JSON 文件路径（相对于 Release） */
export const DESKTOP_LATEST_JSON_PATH = '/latest/download/latest.json';

/** GitHub 直连 Android android-latest.json 完整地址 */
export const GITHUB_ANDROID_JSON = `${GITHUB_RELEASE_BASE}${ANDROID_LATEST_JSON_PATH}`;

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

/** 单个源请求超时时间（秒） */
export const SOURCE_TIMEOUT_SECONDS = 10;

/** 开发环境模拟更新（设为 true 可在本地测试弹窗） */
export const DEBUG_UPDATE = false;
