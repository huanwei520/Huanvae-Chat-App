/**
 * e2eMode —— real-e2e(L2.5-web)测试专用注入开关。
 *
 * `VITE_E2E_BASE_URL` 仅由 playwright.real-e2e.config.ts 的 webServer env 注入
 * （形如 http://127.0.0.1:18801，指向本地 e2e 集群 nginx 的钉实例口）。
 * 生产/常规构建该变量未定义 → isE2E() 恒 false，全部 e2e 分支为死代码被 vite 摇树，
 * 生产路径零改变。本模块只允许被五个注入点文件 import
 * （secureFetch / rustWebSocket / discovery / secureProxy / App），
 * 由 tests/e2e-mode-routing.test.ts 静态契约测试锁定。
 * @module services/e2eMode
 */

/** 是否处于 real-e2e 模式（构建期注入 VITE_E2E_BASE_URL 才为 true） */
export function isE2E(): boolean {
  return !!import.meta.env.VITE_E2E_BASE_URL;
}

/** e2e 集群基址（如 http://127.0.0.1:18801）。仅 isE2E() 为 true 时调用。 */
export function e2eBaseUrl(): string {
  return import.meta.env.VITE_E2E_BASE_URL as string;
}

/**
 * e2e 下解析资源 URL：完整 URL 原样（presigned 按原 Host 签名，不得改写）；
 * 相对路径拼到 e2e 基址（本地 nginx 与生产同构，可直接取 /avatars/ 等资源）。
 */
export function e2eResourceUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  return `${e2eBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}
