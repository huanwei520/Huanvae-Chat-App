/**
 * 使用外部应用打开文件工具
 *
 * 移动端专用功能，将私有目录中的文件复制到公共目录后用其他应用打开
 *
 * 实现原理：
 * - Android 安全限制：私有目录文件无法直接通过 Intent 分享给其他应用
 * - 解决方案：先复制到 Download 公共目录，再使用 showViewFileDialog 打开
 * - 使用 tauri-plugin-android-fs-api 的 API
 *
 * @since 2026-02-04
 */

import { platform } from '@tauri-apps/plugin-os';
import { basename } from '@tauri-apps/api/path';

/**
 * 打开结果
 */
export interface OpenWithExternalAppResult {
  success: boolean;
  message: string;
}

/**
 * 根据文件扩展名获取 MIME 类型
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  // 文档类型
  const mimeTypes: Record<string, string> = {
    // 文档
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    ts: 'application/typescript',
    // 压缩包
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    tar: 'application/x-tar',
    gz: 'application/gzip',
    // 图片
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    // 视频
    mp4: 'video/mp4',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    // 音频
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

// 缓存已复制到公共目录的文件映射：源路径 -> 公共目录 URI
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publicFileCache = new Map<string, any>();

/**
 * 使用外部应用打开文件
 *
 * Android 上会先将文件复制到 Download 公共目录，然后弹出应用选择器
 * 同一文件只会复制一次，后续打开直接使用缓存的 URI
 *
 * @param localPath - 本地缓存文件路径（私有目录）
 * @returns 打开结果
 */
export async function openWithExternalApp(
  localPath: string,
): Promise<OpenWithExternalAppResult> {
  try {
    const os = await platform();

    if (os !== 'android') {
      // 非 Android 平台使用 opener 插件
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(localPath);
      return {
        success: true,
        message: '已打开文件',
      };
    }

    // Android: 复制到公共目录后打开
    const androidFsModule = await import('tauri-plugin-android-fs-api');
    const AndroidFs = androidFsModule.AndroidFs;

    // 检查是否已有缓存的公共文件 URI
    let destUri = publicFileCache.get(localPath);

    if (!destUri) {
      // 首次打开：复制到公共目录
      const fileName = await basename(localPath);

      // 相对路径：HuanvaeChat/OpenWith/文件名
      // 使用子目录避免与用户保存的文件混淆
      const relativePath = `HuanvaeChat/OpenWith/${fileName}`;

      // 获取 MIME 类型
      const mimeType = getMimeType(fileName);

      console.warn('[OpenWithExternalApp] 首次打开，复制文件:', {
        localPath,
        fileName,
        mimeType,
      });

      // 在 Download 目录创建公共文件
      destUri = await AndroidFs.createNewPublicFile(
        'Download', // AndroidPublicGeneralPurposeDir.Download
        relativePath,
        mimeType,
      );

      console.warn('[OpenWithExternalApp] 创建公共文件 URI:', JSON.stringify(destUri));

      // 复制文件内容
      await AndroidFs.copyFile(localPath, destUri);
      console.warn('[OpenWithExternalApp] 文件已复制到公共目录');

      // 缓存 URI，避免重复复制
      publicFileCache.set(localPath, destUri);
    } else {
      console.warn('[OpenWithExternalApp] 使用缓存的公共文件 URI');
    }

    // 使用 showViewFileDialog 打开文件（弹出应用选择器）
    await AndroidFs.showViewFileDialog(destUri);
    console.warn('[OpenWithExternalApp] 已弹出应用选择器');

    return {
      success: true,
      message: '已打开文件',
    };
  } catch (error) {
    console.error('[OpenWithExternalApp] 打开失败:', error);
    // 如果打开失败，清除缓存以便下次重试
    publicFileCache.delete(localPath);
    return {
      success: false,
      message: `打开失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
