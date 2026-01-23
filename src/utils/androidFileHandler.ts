/**
 * Android 文件处理工具
 *
 * 使用 tauri-plugin-android-fs 处理 Android content:// URI 问题
 * 解决原生文件选择器返回的 URI 无法被 Rust 直接读取的问题
 *
 * 工作原理：
 * 1. 使用 AndroidFs.showOpenFilePicker() 替代 @tauri-apps/plugin-dialog
 * 2. 使用 AndroidFs.getFsPath() 获取可用于 @tauri-apps/plugin-fs 的路径
 * 3. 使用 @tauri-apps/plugin-fs 复制文件到应用缓存目录
 * 4. 返回缓存目录中的真实文件路径供 Rust 后端使用
 *
 * 注意：仅在 Android 平台使用此模块，其他平台使用标准 dialog 插件
 *
 * @since 2026-01-22
 * @see https://github.com/aiueo13/tauri-plugin-android-fs
 */

import { platform } from '@tauri-apps/plugin-os';
import { appDataDir, join } from '@tauri-apps/api/path';
import { mkdir, remove, exists } from '@tauri-apps/plugin-fs';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';

// 动态导入 Android FS 插件（仅在 Android 上可用）
// 使用 any 类型避免 tauri-plugin-android-fs 版本间的类型兼容问题
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AndroidFs: any = null;

let isAndroidFsLoaded = false;

/**
 * 加载 Android FS 插件（延迟加载）
 */
async function loadAndroidFs(): Promise<typeof AndroidFs> {
  if (isAndroidFsLoaded) {
    return AndroidFs;
  }

  try {
    const os = await platform();
    if (os === 'android') {
      const module = await import('tauri-plugin-android-fs-api');
      AndroidFs = module.AndroidFs;
    }
    isAndroidFsLoaded = true;
  } catch (e) {
    console.warn('[AndroidFileHandler] 加载 Android FS 插件失败:', e);
    isAndroidFsLoaded = true;
  }

  return AndroidFs;
}

/**
 * 获取临时文件缓存目录
 */
async function getTempCacheDir(): Promise<string> {
  const dataDir = await appDataDir();
  const cacheDir = await join(dataDir, 'lan_transfer_cache');

  // 确保缓存目录存在
  if (!(await exists(cacheDir))) {
    await mkdir(cacheDir, { recursive: true });
  }

  return cacheDir;
}

/**
 * 生成唯一的临时文件名
 */
function generateTempFileName(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}_${originalName}`;
}

/**
 * 选择文件并准备用于传输
 *
 * 在 Android 上：
 * 1. 使用 AndroidFs.showOpenFilePicker() 选择文件
 * 2. 将文件复制到应用缓存目录
 * 3. 返回缓存目录中的文件路径
 *
 * 在其他平台上：
 * 直接使用 @tauri-apps/plugin-dialog 返回的路径
 *
 * @param options 文件选择选项
 * @returns 可供 Rust 后端读取的文件路径数组
 */
export async function selectFilesForTransfer(options?: {
  multiple?: boolean;
  title?: string;
}): Promise<string[]> {
  const androidFs = await loadAndroidFs();
  const os = await platform();

  if (os === 'android' && androidFs) {
    console.warn('[AndroidFileHandler] 使用 Android FS 插件选择文件');

    try {
      // 使用 Android 文件选择器
      console.warn('[AndroidFileHandler] 正在调用 showOpenFilePicker...');
      const uris = await androidFs.showOpenFilePicker({
        multiple: options?.multiple ?? true,
      });

      console.warn(`[AndroidFileHandler] showOpenFilePicker 返回: ${JSON.stringify(uris)}`);

      if (!uris || uris.length === 0) {
        console.warn('[AndroidFileHandler] 未选择任何文件或用户取消');
        return [];
      }

      console.warn(`[AndroidFileHandler] 选择了 ${uris.length} 个文件`);

      // 获取缓存目录
      console.warn('[AndroidFileHandler] 获取缓存目录...');
      const cacheDir = await getTempCacheDir();
      console.warn(`[AndroidFileHandler] 缓存目录: ${cacheDir}`);
      const filePaths: string[] = [];

      // 处理每个选择的文件
      for (const uri of uris) {
        try {
          // 获取文件元数据
          console.warn(`[AndroidFileHandler] 获取文件元数据: ${JSON.stringify(uri)}`);
          const metadata = await androidFs.getMetadata(uri);
          console.warn(`[AndroidFileHandler] 文件: ${metadata.name}, 大小: ${metadata.byteLength}`);

          // 生成临时文件名并复制到缓存目录
          const tempFileName = generateTempFileName(metadata.name);
          const destPath = await join(cacheDir, tempFileName);

          // 使用 AndroidFs.copyFile 直接从 content:// URI 复制到目标路径
          // 这个方法可以处理 content:// URI，而 @tauri-apps/plugin-fs 的 copyFile 不能
          console.warn(`[AndroidFileHandler] 使用 AndroidFs.copyFile 复制到: ${destPath}`);
          await androidFs.copyFile(uri, destPath);
          console.warn(`[AndroidFileHandler] 复制完成: ${destPath}`);

          filePaths.push(destPath);
        } catch (fileError) {
          console.error('[AndroidFileHandler] 处理文件失败:', fileError);
          // 继续处理下一个文件
        }
      }

      console.warn(`[AndroidFileHandler] 成功处理 ${filePaths.length} 个文件`);
      return filePaths;
    } catch (error) {
      console.error('[AndroidFileHandler] Android 文件选择失败:', error);
      throw error;
    }
  } else {
    // 其他平台使用标准 dialog
    console.log('[AndroidFileHandler] 使用标准 dialog 选择文件');

    const files = await dialogOpen({
      multiple: options?.multiple ?? true,
      title: options?.title ?? '选择要发送的文件',
    });

    if (!files) {
      return [];
    }

    return Array.isArray(files) ? files : [files];
  }
}

/**
 * 清理传输后的临时文件
 *
 * @param filePaths 要清理的文件路径数组
 */
export async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  const os = await platform();

  if (os !== 'android') {
    // 非 Android 平台不需要清理
    return;
  }

  const dataDir = await appDataDir();
  const cacheDir = await join(dataDir, 'lan_transfer_cache');

  for (const filePath of filePaths) {
    try {
      // 只清理缓存目录中的文件
      if (filePath.startsWith(cacheDir)) {
        await remove(filePath);
        console.log(`[AndroidFileHandler] 已清理临时文件: ${filePath}`);
      }
    } catch (error) {
      console.warn(`[AndroidFileHandler] 清理临时文件失败: ${filePath}`, error);
    }
  }
}

/**
 * 清理所有临时文件（应用退出时调用）
 */
export async function cleanupAllTempFiles(): Promise<void> {
  const os = await platform();

  if (os !== 'android') {
    return;
  }

  try {
    const dataDir = await appDataDir();
    const cacheDir = await join(dataDir, 'lan_transfer_cache');

    if (await exists(cacheDir)) {
      await remove(cacheDir, { recursive: true });
      console.log('[AndroidFileHandler] 已清理所有临时文件');
    }
  } catch (error) {
    console.warn('[AndroidFileHandler] 清理临时文件目录失败:', error);
  }
}
