/**
 * 媒体预览窗口数据传递
 *
 * 使用 localStorage 在主窗口和媒体预览窗口之间传递数据
 * 与 meeting 模块使用相同的模式
 *
 * 由于媒体窗口需要调用 API 获取预签名 URL，
 * 需要同时传递认证信息（serverUrl 和 accessToken）
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { resolveGroupFileRelatedId } from '../services/groupFileScope';

// ============================================================================
// 类型定义
// ============================================================================

/** 媒体类型 */
export type MediaType = 'image' | 'video';

/** 序列里的一项：预览窗按它取源 */
export interface MediaSequenceEntry {
  /** 媒体类型 */
  type: MediaType;
  /** 文件 UUID */
  fileUuid: string;
  /** 文件名 */
  filename: string;
  /** 文件大小 */
  fileSize?: number;
  /**
   * **已知**的内容哈希。只有个人文件面（「我的文件」）传；
   * 消息面（气泡 / 查找命中）**不传** —— 后端接收面已不再下发 `file_hash`，
   * 预览窗的缓存查找与下载任务以 `fileUuid` 为键（两层键，见 services/fileCache.fileIdentityKey）。
   */
  fileHash?: string | null;
  /** URL 类型（用于构建下载 URL） */
  urlType: 'user' | 'friend' | 'group';
  /**
   * 本地文件路径（如果有）。
   * **只有被点开的那一项**带它（主窗口那侧已经解析过）；序列里的邻居不带 —— 预览窗自己解析。
   */
  localPath?: string | null;
  /** 预获取的预签名 URL（同上，只有被点开的那一项有） */
  presignedUrl?: string | null;
}

/** 媒体预览窗口数据（不含认证信息） */
export interface MediaWindowData extends MediaSequenceEntry {
  /**
   * 同会话媒体序列（**升序，旧 → 新**），用于窗口内左右切上一张 / 下一张。
   *
   * 不传 = 单张序列：「我的文件」/ 会话内查找命中项这类调用方本来就没有"上一张"的概念，
   * 行为逐字不变（见下方 openMediaWindow 的归一化 —— 序列恒非空，窗口侧只有一条路径）。
   */
  sequence?: MediaSequenceEntry[];
  /** 本条在 `sequence` 里的位次；不传 sequence 时忽略 */
  sequenceIndex?: number;
}

/** 存储在 localStorage 中的完整数据（含认证信息） */
export interface MediaStorageData {
  /** 媒体序列，**恒非空**（单张调用方也会被归一化成长度 1 的序列） */
  sequence: MediaSequenceEntry[];
  /** 打开时停在哪一项 */
  index: number;
  /** 服务器地址 */
  serverUrl: string;
  /** 访问令牌 */
  accessToken: string;
  /**
   * 群文件预签名必填的 related_id（= 发起本次访问的群 ID），非群媒体为 null。
   *
   * **不在 `MediaWindowData` 里**：调用方（气泡 / 查找命中项）不该也不必自己传，
   * 由 `openMediaWindow` 在主窗口侧统一解析 —— 预览窗是另一个 webview、chatStore 是空的，
   * 拿不到这个值就只能 400。解析口径见 services/groupFileScope.ts。
   *
   * 整条序列共用同一个值：序列本来就是**同一个会话**里的媒体。
   */
  groupId: string | null;
}

// ============================================================================
// 常量
// ============================================================================

const STORAGE_KEY = 'huanvae_media_data';

// ============================================================================
// 数据传递函数
// ============================================================================

/**
 * 保存媒体数据到 localStorage（内部使用）
 * 包含认证信息
 */
function saveMediaDataInternal(data: MediaStorageData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/**
 * 取走 localStorage 里的媒体数据（**读完即删**，一次性）
 *
 * 在媒体窗口初始化时调用，返回包含认证信息的完整数据。
 *
 * 🔴 为什么是「取走」而不是「读取」：这份 handoff 里带着完整的 accessToken，
 * 而 localStorage 是**按 origin 共享**且**落盘**的 —— 只读不删的话，令牌会一直躺在
 * 磁盘上直到下次被覆盖或用户卸载，同 origin 的任何其它 webview（主窗、主题编辑器、
 * 股票窗…）一句 `getItem` 就能读走。
 *
 * 做成「读+删」一个动作，是为了让「忘记清理」在结构上不可能发生 ——
 * 上一版把清理留给调用方（`clearMediaData` 写了、导出了、注释了「窗口关闭时调用」），
 * 结果全仓没有一个业务调用点，令牌就这么一直留在盘上。
 *
 * 解析失败时同样会删掉：坏掉的那份一样可能带着令牌。
 */
export function takeMediaData(): MediaStorageData | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  // 无论后面解析成不成功，先把盘上那份清掉。
  localStorage.removeItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as MediaStorageData;
  } catch {
    return null;
  }
}

/**
 * 清除媒体数据
 *
 * 正常路径由 [`takeMediaData`] 自己清（读+删同一个动作）；这里只剩一个调用点：
 * 窗口创建失败（`tauri://error`）时的兜底 —— 那种情况没有任何人会去读它，
 * 不清就等于把带令牌的 handoff 永久留在盘上。
 */
export function clearMediaData(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// 窗口操作函数
// ============================================================================

/** 打开媒体窗口所需的认证信息 */
export interface MediaAuthInfo {
  serverUrl: string;
  accessToken: string;
}

/**
 * 打开媒体预览窗口
 *
 * @param data 媒体数据
 * @param auth 认证信息（从 session 获取）
 */
export async function openMediaWindow(
  data: MediaWindowData,
  auth: MediaAuthInfo,
): Promise<void> {
  const { sequence: givenSequence, sequenceIndex, ...entry } = data;

  // 归一化成「恒非空的序列 + 位次」：没给序列的调用方（「我的文件」/ 查找命中项）
  // 得到长度 1 的序列 —— 于是预览窗侧只有一条代码路径，不需要判"有没有序列"。
  const hasSequence = !!givenSequence && givenSequence.length > 0;
  const index = hasSequence
    ? Math.min(Math.max(sequenceIndex ?? 0, 0), givenSequence.length - 1)
    : 0;
  // 被点开的那一项一律用 entry 整条覆盖：只有它带着主窗口已经解析好的
  // localPath / presignedUrl（邻居项由预览窗自己解析），覆盖掉才不会两边打架。
  const sequence: MediaSequenceEntry[] = hasSequence
    ? givenSequence.map((it, i) => (i === index ? entry : it))
    : [entry];

  // 保存数据到 localStorage（含认证信息 + 群文件预签名要用的 related_id）
  saveMediaDataInternal({
    sequence,
    index,
    serverUrl: auth.serverUrl,
    accessToken: auth.accessToken,
    // 主窗口侧解析：预览窗自己读不到 chatStore（另一个 webview）
    groupId: data.urlType === 'group' ? resolveGroupFileRelatedId() : null,
  });

  // 检查是否已有媒体窗口
  const existing = await WebviewWindow.getByLabel('media');
  if (existing) {
    // 如果已存在，关闭旧窗口
    await existing.close();
  }

  // 根据媒体类型设置窗口大小
  const isVideo = data.type === 'video';
  const width = isVideo ? 1280 : 1024;
  const height = isVideo ? 720 : 768;

  // 创建新的媒体窗口
  const mediaWindow = new WebviewWindow('media', {
    url: '/media',
    title: data.filename,
    width,
    height,
    center: true,
    decorations: true,
    resizable: true,
    focus: true,
  });

  // 监听窗口创建结果
  mediaWindow.once('tauri://error', (e) => {
    console.error('[Media] 创建媒体窗口失败:', e);
    clearMediaData();
  });
}
