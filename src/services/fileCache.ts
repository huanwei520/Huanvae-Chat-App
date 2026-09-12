/**
 * 文件缓存服务
 *
 * 统一本地缓存方案的核心服务层，所有文件统一缓存到：
 * data/{用户名}_{服务器}/file/{pictures|videos|documents}/
 *
 * 功能：
 * - 检查本地缓存（file_mappings 表，后端验证文件存在性）
 * - 获取预签名 URL（带内存缓存，有时效性）
 * - 下载并保存文件到统一目录
 * - 获取文件源（本地优先，无缓存则获取远程 URL）
 * - 跨窗口事件通知（下载完成时通知独立媒体窗口）
 * - 局域网优化（自动替换公网 URL 为局域网地址）
 *
 * 缓存入口：
 * 1. 用户上传文件 → copy_file_to_cache → 复制到缓存目录
 * 2. presign URL 取得后立即 kick（F2，不等 <img> onLoad；loadSource 远程分支触发）
 *    → triggerBackgroundDownload → 下载到缓存目录
 * 3. 视频点击播放 → triggerBackgroundDownload → 下载到缓存目录（视频仍等 onPlay）
 *
 * 跨窗口通信：
 * - 下载完成时发送 'file-download-completed' 事件
 * - 独立媒体窗口监听此事件，自动切换到本地文件
 *
 * 文件命名规则：{hash前8位}_{原始文件名}
 *
 * 大文件优化（≥用户设置阈值，默认100MB）：
 * - 上传时不复制到缓存目录，记录 original_path
 * - 读取时优先使用 original_path
 * - 若 original_path 失效（文件被移动/删除），自动从服务器下载到缓存目录
 *
 * URL 优化：
 * - 将公网预签名 URL 替换为当前登录的服务器地址
 * - 局域网登录时自动使用局域网直连（100MB: ~80秒 → ~1秒）
 * - 公网登录时保持公网访问
 *
 * 缓存策略：
 * - 本地文件路径：每次从数据库查询（后端验证文件存在性，约 1-5ms）
 * - 预签名 URL：内存缓存，提前 5 分钟失效
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';
import { getFileHashByUuid } from '../db';
import { localPathToDisplaySrc } from './assetUrl';
import { directIpUrl } from './discovery';
import type { ApiClient } from '../api/client';
import { useFileCacheStore } from '../stores/fileCacheStore';
import { optimizePresignedUrl } from '../utils/network';
import { resolveDisplayUrl } from './secureProxy';
import { resolveGroupFileRelatedId } from './groupFileScope';
import { isMobile, isMacOS } from '../utils/platform';

// ============================================
// 类型定义
// ============================================

/** 下载进度事件（`cacheKey` 与 Rust `DownloadProgress.cache_key` 同一把键） */
interface DownloadProgressEvent {
  cacheKey: string;
  downloaded: number;
  total: number;
  percent: number;
  status: 'downloading' | 'completed' | 'failed';
  /** 仅在 status='completed' 时由 Rust 填充 */
  localPath?: string;
  /** 仅在 status='failed' 时由 Rust 填充 */
  error?: string;
}

/** 下载完成事件（跨窗口通知） */
export interface FileDownloadCompletedEvent {
  cacheKey: string;
  localPath: string;
  fileName: string;
  fileType: 'image' | 'video' | 'document';
}

/** 预签名 URL 响应 */
interface PresignedUrlResponse {
  presigned_url: string;
  expires_at: string;
  file_uuid: string;
  file_size: number;
  content_type: string;
}

/** 文件源结果 */
export interface FileSourceResult {
  /** 可用于 webview `<img>/<video>` 显示的 src（本地 asset，或远程经 resolveDisplayUrl 反代后的回环 URL） */
  src: string;
  /** 是否来自本地缓存 */
  isLocal: boolean;
  /** 文件哈希 */
  fileHash?: string;
  /** 本地路径（如果有） */
  localPath?: string;
  /**
   * 远程文件的**原始** presigned URL（未经反代）。仅远程(isLocal=false)时有值。
   * 用途：Rust 后台下载(directIpUrl 重写 host→IP 给 pinned client)与跨窗 handoff 需要原始 URL，
   * **不能**用反代后的 src（loopback URL 会被 directIpUrl 弄坏 / 跨窗端口烘死）。
   */
  presignedUrl?: string;
}

// ============================================
// Tauri 命令封装
// ============================================

/**
 * 获取已缓存文件的本地路径（键是**内容哈希**，`file_mappings` 表未改）
 */
export async function getCachedFilePath(fileHash: string): Promise<string | null> {
  try {
    return await invoke<string | null>('get_cached_file_path', { fileHash });
  } catch {
    return null;
  }
}

// ============================================
// 两层键（2026-08-16 起）
// ============================================

/**
 * 文件身份键 —— **下载任务 / 进度事件 / 封面**的键，不是内容哈希。
 *
 * | 来源 | 键 | 为什么 |
 * |------|----|--------|
 * | 消息面（气泡 / 相册 / 查找命中 / 独立预览窗） | `file_uuid` | 后端接收面已**不再下发** `file_hash`，下载前只有它 |
 * | 个人文件面（`GET /api/storage/files`） | 服务端下发的 `file_hash` | 该端点未改，哈希一直有 |
 *
 * 两个键空间不相交（uuid 带连字符 / 哈希是 64 位十六进制），同一张任务表里混用不会互相误命中。
 */
export function fileIdentityKey(fileUuid: string, knownHash?: string | null): string {
  return knownHash || fileUuid;
}

/**
 * 解析**内容哈希**（`file_mappings` / `get_local_video_url` 的键）。
 *
 * - 个人文件面：服务端已经给了，直接用；
 * - 消息面：查本地 `file_uuid_hash`（该行由**下载完成时**的 Rust 侧自算哈希写入）。
 *   本机没下载过 ⇒ 返回 `null` ⇒ 调用方走远程取件，这是正常路径。
 */
export async function resolveContentHash(
  fileUuid: string,
  knownHash?: string | null,
): Promise<string | null> {
  if (knownHash) { return knownHash; }
  if (!fileUuid) { return null; }
  try {
    return await getFileHashByUuid(fileUuid);
  } catch {
    return null;
  }
}

/**
 * Detects whether the given error indicates the file was not found on the server (404).
 *
 * Covers the messages thrown by:
 *   - services/fileCache.getPresignedUrl   (rethrows api.post error: "文件 未找到" / "HTTP 404")
 *   - media/MediaPreviewPage.getPresignedUrl (hard-coded "文件不存在")
 *   - other layers that surface a 404 plain status
 */
export function isFileNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /文件不存在|文件\s*未找到|未找到|HTTP\s*404|\b404\b/.test(msg);
}

/**
 * Detects whether the given error indicates the presigned download URL has expired/been
 * rejected (F1, 2026-09-02)。
 *
 * 两种形态都认：
 * - Rust 统一下载引擎的稳定机器前缀 `HV_URL_EXPIRED`（unified_download.rs: 401/403 →
 *   UrlExpired 变体，Display 带 `HV_URL_EXPIRED: ` 前缀；其它状态是 `HV_HTTP_<code>`）；
 * - 裸 HTTP 401/403 文本（TS 层 api 错误 / 未来其它下载通道的同语义形态）。
 *
 * `HV_HTTP_404`、`HV_NET` 等其它形态不会误命中。
 */
export function isUrlExpiredError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /HV_URL_EXPIRED|HTTP[_\s]40[13]\b/.test(msg);
}

/**
 * 下载文件并保存到本地
 */
export function downloadAndSaveFile(
  url: string,
  cacheKey: string,
  fileName: string,
  fileType: 'image' | 'video' | 'document',
  fileSize?: number,
): Promise<string> {
  // presigned URL 按 host 签名(SigV4 SignedHeaders=host):下载改写成源站 IP 后,Rust 必须显式
  // 带【改写前的原始 host】(=签名时的逻辑域名)当 Host 头,否则 reqwest 默认 Host=IP 与签名 host
  // 不符 → MinIO 返 403 SignatureDoesNotMatch。取原始 host 传给 Rust(零假设,后端签哪个域名都精确匹配)。
  let host: string | null = null;
  try { host = new URL(url).host; } catch { host = null; }
  return invoke<string>('download_and_save_file', {
    // 改写主机为源站 IP(IP 字面量=不发 SNI 绕 ICP);Rust 用 secure_net 钉 CA 客户端连、内置 CA 验
    url: directIpUrl(url),
    host,
    // 下载任务的键（不是内容哈希）：内容哈希由 Rust 在下载完成后自算，见 fileIdentityKey
    cacheKey,
    fileName,
    fileType,
    fileSize: fileSize ?? null,
  });
}

// ============================================
// 预签名 URL 获取
// ============================================

/**
 * 获取预签名 URL（带缓存）
 *
 * 🔴 2026-08-21：删掉了原先的第 4 个参数 `options?: { friendId, fileType }`。
 * 它**唯一**的用途是给「好友文件 403 上报」拼诊断上下文，而那条上报打的
 * `/api/diagnostic/report/friend-permission` 在后端路由表里根本不存在（只有
 * `/api/admin/diagnostic/*` 的几个 GET/PUT），恒 404 且被 console.warn 静默吞掉。
 * 上报整块删除后这两个字段就是死参数 —— 按 .claude/CLAUDE.md「不留 `_xxx` 占位、
 * 能在当前 PR 内删干净就删干净」，连同上游 `getFileSource` / `getVideoSource` /
 * `useFileCache` 的 `friendId` 一路删到调用方。
 */
export async function getPresignedUrl(
  api: ApiClient,
  fileUuid: string,
  urlType: 'user' | 'friend' | 'group' = 'user',
): Promise<{ url: string; expiresAt: string }> {
  const store = useFileCacheStore.getState();

  // 1. 检查缓存
  const cached = store.getUrlCache(fileUuid);
  if (cached) {
    // eslint-disable-next-line no-console
    console.log('[FileCache] 使用缓存的预签名 URL:', fileUuid);
    return { url: cached.url, expiresAt: cached.expiresAt };
  }

  // 2. 请求新的预签名 URL
  let endpoint: string;
  switch (urlType) {
    case 'friend':
      endpoint = `/api/storage/friends_file/${fileUuid}/presigned_url`;
      break;
    case 'group':
      // 群文件专用端点：退群后即失去取件权限、新入群成员可取历史群图。
      // 通用 /file/ 端点做不到这两点（退群成员仍能取件、新成员看不到入群前的历史群图 403）。
      endpoint = `/api/storage/group_file/${fileUuid}/presigned_url`;
      break;
    default:
      endpoint = `/api/storage/file/${fileUuid}/presigned_url`;
  }

  // eslint-disable-next-line no-console
  console.log('[FileCache] 请求预签名 URL:', { fileUuid, urlType, endpoint });

  // 群文件端点 2026-08-13 起 related_id 必填（= 发起本次访问的群 ID），缺失 / 非 UUID 一律 400，
  // 后端明确不做兼容。这里先解析、拿不到就地抛错 —— 比让后端回一句 400 更容易定位到
  // 「群消息在非该群会话下被渲染」这种真正的上游问题。非群路径不碰这段。
  let groupRelatedId: string | null = null;
  if (urlType === 'group') {
    groupRelatedId = resolveGroupFileRelatedId();
    if (!groupRelatedId) {
      throw new Error('群文件预签名缺少 related_id：当前会话不是群聊，无法确定发起访问的群');
    }
  }

  // 🔴 逐键显式构造：字段不写进这个字面量就是静默丢掉（有类型也不报错）。
  // friend / user 两条路径的请求体必须逐字节保持 `{ operation: 'preview' }`。
  const response = await api.post<PresignedUrlResponse>(
    endpoint,
    groupRelatedId
      ? { operation: 'preview', related_id: groupRelatedId }
      : { operation: 'preview' },
  );

  // 3. 优化 URL（用当前服务器地址替换公网域名）
  const optimizedUrl = optimizePresignedUrl(response.presigned_url, api.getBaseUrl());

  // 4. 缓存优化后的 URL
  store.setUrlCache(fileUuid, optimizedUrl, response.expires_at);

  // eslint-disable-next-line no-console
  console.log('[FileCache] 获取新的预签名 URL:', fileUuid);
  return { url: optimizedUrl, expiresAt: response.expires_at };
}

// ============================================
// 核心功能：获取文件源
// ============================================

/**
 * 获取文件源（本地优先）
 *
 * 工作流程：
 * 1. 检查本地缓存
 * 2. 无本地缓存则获取预签名 URL
 * 3. 返回可用的 src
 *
 * @param api - API 客户端
 * @param fileUuid - 文件 UUID（**快路径的键**：消息面下载前唯一已知的身份）
 * @param knownHash - **已知**的内容哈希：个人文件面（`GET /api/storage/files`）有；
 *                    消息面没有（后端接收面已不再下发）⇒ 传 `null`，由本函数经
 *                    `file_uuid_hash` 解析
 * @param urlType - URL 类型（用于选择正确的预签名端点）
 */
export async function getFileSource(
  api: ApiClient,
  fileUuid: string,
  knownHash: string | null | undefined,
  urlType: 'user' | 'friend' | 'group' = 'user',
): Promise<FileSourceResult> {
  // 1. 解析内容哈希后检查数据库缓存（两层键的第一跳：uuid -> hash -> file_mappings）
  // 后端 get_cached_file_path 会验证文件存在性，无效则返回 null
  const fileHash = await resolveContentHash(fileUuid, knownHash);
  if (fileHash) {
    const localPath = await getCachedFilePath(fileHash);
    if (localPath) {
      // 本地路径 → asset 协议显示 src（含 Android 的百分号编码修复），
      // 与视频封面共用同一个转换点，见 services/assetUrl.ts
      const src = localPathToDisplaySrc(localPath);
      return {
        src,
        isLocal: true,
        fileHash,
        localPath,
      };
    }
  }

  // 2. 无本地缓存，获取预签名 URL
  //    显示 src 经 resolveDisplayUrl 收口反代（私有 CA，webview 直连验不过）；
  //    原始 url 留作 presignedUrl，供 Rust 下载(directIpUrl)与跨窗 handoff。
  const { url } = await getPresignedUrl(api, fileUuid, urlType);
  return {
    src: resolveDisplayUrl(url) ?? url,
    isLocal: false,
    fileHash: fileHash ?? undefined,
    presignedUrl: url,
  };
}

/**
 * 获取移动端本地视频的 HTTP URL
 *
 * 调用 Rust 端命令，如果视频已缓存，返回本地服务器 URL
 */
async function getLocalVideoUrl(fileHash: string): Promise<string | null> {
  // Android 与 macOS 都要走本地 HTTP 媒体服务器（原因见 Rust local_media_server 模块头）：
  // 两者的 WebView 都无法可靠地用自定义协议加载媒体 —— Android 播不了，
  // macOS 是 WKURLSchemeHandler 收不到 Range 头（WebKit 203302）⇒ 只剩灰块没封面。
  if (!isMobile() && !isMacOS()) {
    return null;
  }
  try {
    const url = await invoke<string | null>('get_local_video_url', { fileHash });
    return url;
  } catch {
    return null;
  }
}

/**
 * 获取视频文件源（移动端优化版本）
 *
 * 移动端问题：Android WebView 无法通过 asset:// 协议播放本地视频
 * 解决方案：使用 Rust 端本地 HTTP 服务器提供视频文件
 *
 * @param api - API 客户端
 * @param fileUuid - 文件 UUID（**快路径的键**）
 * @param knownHash - **已知**的内容哈希：个人文件面有，消息面没有（传 `null` 由本函数解析）
 * @param urlType - URL 类型
 */
export async function getVideoSource(
  api: ApiClient,
  fileUuid: string,
  knownHash: string | null | undefined,
  urlType: 'user' | 'friend' | 'group' = 'user',
): Promise<FileSourceResult> {
  // 本地媒体服务器与 file_mappings 一样按内容哈希索引 ⇒ 先做 uuid -> hash 那一跳
  const fileHash = await resolveContentHash(fileUuid, knownHash);
  // 1. 移动端 / macOS：优先尝试本地 HTTP 服务器（见 getLocalVideoUrl 注释）
  if ((isMobile() || isMacOS()) && fileHash) {
    const localVideoUrl = await getLocalVideoUrl(fileHash);
    if (localVideoUrl) {
      // 同步取实际文件系统路径用于 openInFolder / saveToGallery / 「通过其它方式打开」
      // —— src 是 HTTP 服务器 URL（给 <video> 播放），localPath 是磁盘路径（给 Rust 命令）
      const localPath = await getCachedFilePath(fileHash);
      // eslint-disable-next-line no-console
      console.log('[FileCache] 使用本地视频服务器:', localVideoUrl, 'localPath:', localPath);
      return {
        src: localVideoUrl,
        isLocal: true,
        localPath: localPath ?? undefined,
        fileHash,
      };
    }
  }

  // 2. 无本地缓存或桌面端，获取预签名 URL（桌面端 <video> 同样经反代显示）
  const { url } = await getPresignedUrl(api, fileUuid, urlType);
  return {
    src: resolveDisplayUrl(url) ?? url,
    isLocal: false,
    fileHash: fileHash ?? undefined,
    presignedUrl: url,
  };
}

/**
 * URL 过期（HV_URL_EXPIRED / 401 / 403）的最大重取次数（F1，不含首次下载尝试）。
 * 超过即终态失败，DownloadTask.urlExpiredExhausted = true。
 */
export const URL_EXPIRED_REFETCH_LIMIT = 2;
/**
 * 一般下载失败（网络/IO 等，非 URL 过期）的最大退避重试次数（F2，不含首次尝试）。
 */
export const DOWNLOAD_RETRY_LIMIT = 3;
/**
 * 退避基数（毫秒）：第 n 次重试前等待 base × 2^(n-1) = 1s / 2s / 4s（指数退避）。
 */
export const DOWNLOAD_RETRY_BASE_DELAY_MS = 1000;

/** URL 过期重取所需的调用方上下文；不传 `api` ⇒ 不重取（过期即终态失败）。 */
export interface BackgroundDownloadRefetchOptions {
  /** API 客户端：重取 presign 端点用 */
  api?: ApiClient;
  /** presign 端点类型（默认 'user'），与首次取 URL 时一致 */
  urlType?: 'user' | 'friend' | 'group';
  /**
   * presign / urlCache 用的 fileUuid。消息面 cacheKey 就是 fileUuid 可省；
   * 个人文件面 cacheKey 是内容哈希（urlCache 的键是 uuid），必须显式传。
   */
  fileUuid?: string;
}

/**
 * 同一 cacheKey 的在飞去重（模块级，同步读写）：F2 把缓存下载触发提前到 presign
 * 取得后，同一张图可能被「loadSource kick」+「onLoad cacheFile」几乎同时 kick，
 * 两次调用都会先撞上 async 的本地缓存预检查才能到 addDownloadTask，仅靠 store
 * 任务表挡不住这个窗口。进入函数即同步占位，终了（成功/失败/异常）在 finally 释放。
 */
const inFlightDownloads = new Set<string>();

/** 测试用：清空在飞占位（prod 不调用）。用例中途失败可能把占位泄漏给同文件后续用例。 */
export function __resetInFlightDownloadsForTest(): void {
  inFlightDownloads.clear();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * 触发后台下载（图片 onLoad / 视频 onPlay / presign 取得后 kick 时调用）
 *
 * 将远程文件下载并保存到本地缓存目录：
 * data/{用户名}_{服务器}/file/{pictures|videos|documents}/
 *
 * `cacheKey` 是**文件身份键**（见 `fileIdentityKey`），不是内容哈希 —— 消息面开下载这一刻
 * 内容哈希还不存在，它由 Rust 在下载完成后自算并落 `file_mappings` / `file_uuid_hash`。
 *
 * 失败处置（F1/F2，2026-09-02）：
 * - URL 过期（HV_URL_EXPIRED / 401 / 403）：重试同一个过期 URL 只会再 403（引擎注释
 *   明示），唯一有效动作是重新 presign 换新 URL 重调。重调同一 cacheKey 时 Rust 侧
 *   `.hvpart`/sidecar 按身份键（identity+ETag，与 URL 无关）续传，不重头下载。
 *   最多重取 [`URL_EXPIRED_REFETCH_LIMIT`] 次，穷举后终态失败并标
 *   `urlExpiredExhausted = true`。需要 `refetch.api`（无重取上下文时过期即终态）。
 * - 其它失败：指数退避重试 [`DOWNLOAD_RETRY_LIMIT`] 次（base × 2^(n-1)）。
 * - 同一 cacheKey 并发调用幂等（在飞占位 + store 任务表双保险）。
 */
export async function triggerBackgroundDownload(
  presignedUrl: string,
  cacheKey: string,
  fileName: string,
  fileType: 'image' | 'video' | 'document',
  fileSize?: number,
  refetch?: BackgroundDownloadRefetchOptions,
): Promise<void> {
  const store = useFileCacheStore.getState();

  // eslint-disable-next-line no-console
  console.log('%c[FileCache] triggerBackgroundDownload 被调用', 'color: #9C27B0; font-weight: bold', {
    cacheKey,
    fileName,
    fileType,
    fileSize,
  });

  // 并发 kick 幂等：同 cacheKey 已在飞 ⇒ 直接返回（见 inFlightDownloads 注释）
  if (inFlightDownloads.has(cacheKey)) {
    // eslint-disable-next-line no-console
    console.log('[FileCache] 跳过：同 cacheKey 下载已在飞', { cacheKey });
    return;
  }

  // 检查是否已在下载/已完成（failed 允许重试）
  const existingTask = store.downloadTasks[cacheKey];
  if (existingTask && existingTask.status !== 'failed') {
    // eslint-disable-next-line no-console
    console.log('[FileCache] 跳过：任务已存在', { status: existingTask.status });
    return; // 已在下载中或已完成
  }

  inFlightDownloads.add(cacheKey);

  // 检查本地是否已有缓存（避免 HMR 后重复触发）。
  // 先做 uuid -> hash 那一跳；解析不到就没有本地缓存可查（本机从没下过这个 uuid）。
  try {
    const contentHash = await resolveContentHash(cacheKey, null);
    const cachedPath = contentHash ? await getCachedFilePath(contentHash) : null;
    if (cachedPath) {
      // eslint-disable-next-line no-console
      console.log('[FileCache] 跳过：本地已有缓存', { cachedPath });
      // 直接标记为完成
      store.addDownloadTask({ cacheKey, fileName, fileType, total: fileSize ?? 0 });
      store.completeDownload(cacheKey, cachedPath);
      return;
    }
  } catch {
    // 忽略检查错误，继续下载
  }

  // 添加下载任务
  store.addDownloadTask({
    cacheKey,
    fileName,
    fileType,
    total: fileSize ?? 0,
  });

  let currentUrl = presignedUrl;
  let urlExpiredRefetches = 0;
  let generalRetries = 0;

  try {
    // 循环重试：URL 过期走重取链（≤ URL_EXPIRED_REFETCH_LIMIT），其它失败走指数退避（≤ DOWNLOAD_RETRY_LIMIT）
    for (;;) {
      try {
        // eslint-disable-next-line no-console
        console.log('[FileCache] 开始后台下载...', { fileName });

        // 串行重试是刻意的：同一 cacheKey 同一时刻只允许一个在飞下载（见 inFlightDownloads）
        // eslint-disable-next-line no-await-in-loop
        const localPath = await downloadAndSaveFile(
          currentUrl,
          cacheKey,
          fileName,
          fileType,
          fileSize,
        );
        store.completeDownload(cacheKey, localPath);

        // eslint-disable-next-line no-console
        console.log('%c[FileCache] 后台下载完成', 'color: #4CAF50; font-weight: bold', {
          fileName,
          localPath,
          urlExpiredRefetches,
          generalRetries,
        });

        // 发送跨窗口事件，通知所有窗口（包括独立媒体窗口）
        emit('file-download-completed', {
          cacheKey,
          localPath,
          fileName,
          fileType,
        } as FileDownloadCompletedEvent);
        return;
      } catch (error) {
        if (isUrlExpiredError(error)) {
          // URL 过期：重试同一个 URL 无意义，只能换新 URL（重取后 Rust 按身份键续传）
          if (refetch?.api && urlExpiredRefetches < URL_EXPIRED_REFETCH_LIMIT) {
            urlExpiredRefetches += 1;
            console.warn(
              `[FileCache] 下载 URL 过期，重取 presigned URL（第 ${urlExpiredRefetches}/${URL_EXPIRED_REFETCH_LIMIT} 次）`,
              error,
            );
            const refetchUuid = refetch.fileUuid ?? cacheKey;
            // 先清 URL 缓存：里面存的正是刚过期的这条 URL，不清会把旧 URL 又拿回来
            useFileCacheStore.getState().removeUrlCache(refetchUuid);
            try {
              // eslint-disable-next-line no-await-in-loop -- 重取必须串行在重试循环内
              const { url } = await getPresignedUrl(refetch.api, refetchUuid, refetch.urlType ?? 'user');
              currentUrl = url;
            } catch (refetchError) {
              // 重取端点本身失败（鉴权/网络/404）：如实终态，非「穷举」但同样不可自动恢复
              store.failDownload(
                cacheKey,
                `URL 过期后重取 presigned URL 失败: ${String(refetchError)}`,
                false,
              );
              console.error('[FileCache] 后台下载失败（重取 presign 失败）:', refetchError);
              return;
            }
            continue;
          }
          // 重取已穷举（或无重取上下文）：终态失败，如实标穷举位
          const exhausted = Boolean(refetch?.api);
          const terminalMsg = exhausted
            ? `URL 过期，重取 ${URL_EXPIRED_REFETCH_LIMIT} 次后仍失败: ${String(error)}`
            : `URL 过期且无重取上下文: ${String(error)}`;
          store.failDownload(cacheKey, terminalMsg, exhausted);
          console.error('[FileCache] 后台下载失败（URL 过期重取已穷举）:', error);
          return;
        }

        if (generalRetries < DOWNLOAD_RETRY_LIMIT) {
          generalRetries += 1;
          const delayMs = DOWNLOAD_RETRY_BASE_DELAY_MS * 2 ** (generalRetries - 1);
          console.warn(
            `[FileCache] 后台下载失败，${delayMs}ms 后第 ${generalRetries}/${DOWNLOAD_RETRY_LIMIT} 次重试`,
            error,
          );
          // 退避等待必须串行：下一轮尝试要等上一轮失败后间隔到期（见 sleep 注释）
          // eslint-disable-next-line no-await-in-loop
          await sleep(delayMs);
          continue;
        }

        store.failDownload(cacheKey, String(error));
        console.error('[FileCache] 后台下载失败:', error);
        return;
      }
    }
  } finally {
    inFlightDownloads.delete(cacheKey);
  }
}

// ============================================
// 事件监听
// ============================================

let unlistenProgress: UnlistenFn | null = null;

/**
 * 开始监听下载进度事件
 */
export async function startProgressListener(): Promise<void> {
  if (unlistenProgress) { return; }

  unlistenProgress = await listen<DownloadProgressEvent>('download-progress', (event) => {
    const { cacheKey, downloaded, total, percent, status, localPath, error } = event.payload;
    const store = useFileCacheStore.getState();
    // 仅当 store 已注册过该键的任务时才处理状态变更，避免误为不相关的键创建空任务
    const existingTask = store.downloadTasks[cacheKey];

    if (status === 'downloading') {
      if (existingTask) {
        store.updateDownloadProgress(cacheKey, downloaded, total, percent);
      }
    } else if (status === 'completed') {
      // 由 Rust 事件直接驱动状态机，不再依赖 triggerBackgroundDownload 的 await 回调
      // —— 解决 HMR / fire-and-forget / 跨窗口下载导致进度环卡 100% 的问题
      if (existingTask && localPath) {
        store.completeDownload(cacheKey, localPath);
      }
    } else if (status === 'failed') {
      if (existingTask) {
        store.failDownload(cacheKey, error ?? '下载失败');
      }
    }
  });
}

/**
 * 停止监听下载进度事件
 */
export function stopProgressListener(): void {
  if (unlistenProgress) {
    unlistenProgress();
    unlistenProgress = null;
  }
}

// ============================================
// 工具函数
// ============================================

/**
 * 根据 MIME 类型判断文件类型
 */
export function getFileTypeFromMime(contentType: string): 'image' | 'video' | 'document' {
  if (contentType.startsWith('image/')) { return 'image'; }
  if (contentType.startsWith('video/')) { return 'video'; }
  return 'document';
}
