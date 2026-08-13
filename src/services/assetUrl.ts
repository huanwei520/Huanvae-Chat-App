/**
 * 本地文件路径 → webview 可显示 src 的**唯一**转换点
 *
 * @module services/assetUrl
 *
 * 原本这段逻辑（`convertFileSrc` + Android/桌面 URL 解码修复）私有在
 * `services/fileCache.ts` 里，只有图片/文件缓存用得到。视频封面持久化
 * （`services/videoPoster.ts`）要走**完全同一条**显示通道 —— 「和图片的加载一样」
 * 是硬约束 —— 所以把它提到本模块共享，而不是抄一份。
 *
 * ⚠️ 提出来而不是从 fileCache 再导出一个符号，是因为 `services/fileCache` 被 18 个
 * 测试文件 `vi.mock` 掉（工厂是整体替换），给它加新导出会把那些既有测试打穿
 * （见 .claude/rules/frontend-test.md「给模块新增导出后必须同步补全所有 vi.mock 工厂」）。
 * 本模块是新文件、没人 mock，两边 import 它即可。
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { isMobile } from '../utils/platform';

/**
 * 修复 `convertFileSrc` 返回的 URL 里被百分号编码的路径
 *
 * 问题：Tauri 的 convertFileSrc 在 Android 上返回的 URL 路径被 URL 编码
 * 例如：http://asset.localhost/%2Fdata%2Fuser%2F0%2F...
 * 应该是：http://asset.localhost/data/user/0/...
 *
 * 这导致 video/audio 元素报告 MEDIA_ERR_SRC_NOT_SUPPORTED 错误
 */
function fixAssetUrl(url: string): string {
  // 只在移动端处理
  if (!isMobile()) {
    return url;
  }

  // 检查是否是 asset 协议 URL（Android 上是 http://asset.localhost/...）
  if (url.startsWith('http://asset.localhost/')) {
    // 提取路径部分并解码
    const prefix = 'http://asset.localhost/';
    const encodedPath = url.substring(prefix.length);
    const decodedPath = decodeURIComponent(encodedPath);
    return prefix + decodedPath;
  }

  // 桌面端格式 asset://localhost/...
  if (url.startsWith('asset://localhost/')) {
    const prefix = 'asset://localhost/';
    const encodedPath = url.substring(prefix.length);
    const decodedPath = decodeURIComponent(encodedPath);
    return prefix + decodedPath;
  }

  return url;
}

/**
 * 把一个**本地磁盘路径**转成 webview `<img>/<video>` 能直接吃的 src（asset 协议）。
 *
 * 图片本地缓存（`fileCache.getFileSource` 本地分支）与视频封面
 * （`videoPoster.loadVideoPosterSrc`）共用这一个函数 —— 两者的显示通道逐字节相同。
 */
export function localPathToDisplaySrc(localPath: string): string {
  return fixAssetUrl(convertFileSrc(localPath));
}
