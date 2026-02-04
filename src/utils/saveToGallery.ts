/**
 * 保存媒体文件到系统相册工具
 *
 * 移动端专用功能，将聊天中的图片/视频保存到系统相册
 *
 * 实现方式：
 * - Android：使用 tauri-plugin-android-fs 创建公共文件并复制内容
 *   1. 使用 createNewPublicImageFile/createNewPublicVideoFile 创建公共文件（返回 URI）
 *   2. 使用 AndroidFs.copyFile 从源路径复制到目标 URI
 *   3. 使用 scanPublicFile 注册到系统相册
 * - iOS：未来可扩展支持
 *
 * @since 2026-02-04
 */

import { platform } from '@tauri-apps/plugin-os';
import { basename } from '@tauri-apps/api/path';

/**
 * 保存结果
 */
export interface SaveToGalleryResult {
  success: boolean;
  message: string;
  savedPath?: string;
}

/**
 * 保存媒体文件到系统相册
 *
 * @param localPath - 本地缓存文件路径
 * @param fileType - 文件类型（image 或 video）
 * @returns 保存结果
 */
export async function saveToGallery(
  localPath: string,
  fileType: 'image' | 'video',
): Promise<SaveToGalleryResult> {
  try {
    const os = await platform();

    if (os !== 'android') {
      return {
        success: false,
        message: '当前平台不支持保存到相册',
      };
    }

    // 动态导入 Android FS 插件
    const androidFsModule = await import('tauri-plugin-android-fs-api');
    const AndroidFs = androidFsModule.AndroidFs;

    // 获取文件名
    const fileName = await basename(localPath);

    // 相对路径：HuanvaeChat/文件名
    const relativePath = `HuanvaeChat/${fileName}`;

    // 根据文件类型获取 MIME 类型
    const mimeType = getMimeType(fileName, fileType);

    // 创建公共文件
    // Pictures 对应 AndroidPublicImageDir.Pictures
    // Movies 对应 AndroidPublicVideoDir.Movies
    // createNewPublicImageFile/createNewPublicVideoFile 返回 URI 对象
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let destUri: any;

    if (fileType === 'image') {
      // AndroidPublicImageDir 枚举值：Pictures = "Pictures", DCIM = "DCIM"
      destUri = await AndroidFs.createNewPublicImageFile(
        'Pictures', // AndroidPublicImageDir.Pictures
        relativePath,
        mimeType,
      );
    } else {
      // AndroidPublicVideoDir 枚举值：Movies = "Movies", DCIM = "DCIM"
      destUri = await AndroidFs.createNewPublicVideoFile(
        'Movies', // AndroidPublicVideoDir.Movies
        relativePath,
        mimeType,
      );
    }

    console.warn('[SaveToGallery] 创建公共文件 URI:', JSON.stringify(destUri));

    // 使用 AndroidFs.copyFile 从源路径复制到目标 URI
    // copyFile 可以接受路径作为源，URI 作为目标
    await AndroidFs.copyFile(localPath, destUri);
    console.warn('[SaveToGallery] 文件内容已复制');

    // 扫描文件以注册到系统媒体库
    await AndroidFs.scanPublicFile(destUri);
    console.warn('[SaveToGallery] 已注册到系统相册');

    return {
      success: true,
      message: '已保存到相册',
      savedPath: relativePath,
    };
  } catch (error) {
    console.error('[SaveToGallery] 保存失败:', error);
    return {
      success: false,
      message: `保存失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 根据文件名和类型获取 MIME 类型
 */
function getMimeType(fileName: string, fileType: 'image' | 'video'): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  if (fileType === 'image') {
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'bmp':
        return 'image/bmp';
      default:
        return 'image/jpeg';
    }
  } else {
    switch (ext) {
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'avi':
        return 'video/x-msvideo';
      case 'mov':
        return 'video/quicktime';
      case 'mkv':
        return 'video/x-matroska';
      default:
        return 'video/mp4';
    }
  }
}
