/**
 * 通用文件上传模块
 *
 * 提供带进度回调的 XMLHttpRequest 上传功能
 * 用于头像上传、群头像上传等场景
 *
 * ## 使用方式
 * ```typescript
 * import { uploadWithProgress } from './upload';
 *
 * const result = await uploadWithProgress(
 *   'https://api.example.com/upload',
 *   'Bearer token',
 *   file,
 *   'avatar',
 *   (progress) => console.log(`${progress}%`)
 * );
 * ```
 *
 * ## 注意事项
 * - 使用 XMLHttpRequest 而非 fetch，以支持上传进度监听
 * - 返回 Promise，支持 async/await
 * - 自动处理 JSON 响应解析
 *
 * @module api/upload
 * @created 2026-01-26
 */

import type { ProgressCallback } from '../types/api';
import { proxyRequestUrl } from '../services/secureProxy';

/**
 * 带进度回调的文件上传
 *
 * @param url - 上传目标 URL
 * @param token - 认证 Token（Bearer token）
 * @param file - 要上传的文件
 * @param fieldName - 表单字段名（如 'avatar', 'file' 等）
 * @param onProgress - 可选的进度回调函数
 * @returns Promise，解析为服务器响应的 JSON 数据
 *
 * @throws Error 网络错误或服务器返回非 2xx 状态码时抛出
 *
 * @example
 * ```typescript
 * try {
 *   const result = await uploadWithProgress(
 *     `${serverUrl}/api/profile/avatar`,
 *     accessToken,
 *     file,
 *     'avatar',
 *     (progress) => setUploadProgress(progress)
 *   );
 *   console.log('上传成功:', result);
 * } catch (err) {
 *   console.error('上传失败:', err.message);
 * }
 * ```
 */
export function uploadWithProgress<T = unknown>(
  url: string,
  token: string,
  file: File,
  fieldName: string,
  onProgress?: ProgressCallback,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append(fieldName, file);

    const xhr = new XMLHttpRequest();

    // 监听上传进度
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = Math.round((event.loaded / event.total) * 100);
        onProgress(progress);
      }
    };

    // 完成时处理响应
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as T);
        } else {
          reject(new Error(data.error || data.message || `HTTP ${xhr.status}`));
        }
      } catch {
        reject(new Error('解析响应失败'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('网络错误'));
    };

    // 经回环安全反代上传(webview 原生 XHR 验不过私有 CA 自签 leaf,且连逻辑域名会触发 ICP/SNI 拦截):
    // 反代转发到源站 IP(钉内置 CA、不发 SNI、Host=逻辑域名)。
    xhr.open('POST', proxyRequestUrl(url));
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}
