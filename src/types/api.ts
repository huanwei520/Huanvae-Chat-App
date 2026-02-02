/**
 * API 相关类型定义
 *
 * 统一管理 API 调用中使用的公共类型
 *
 * @module types/api
 * @created 2026-01-26
 */

/**
 * 进度回调类型
 *
 * 用于文件上传、下载等需要进度反馈的操作
 *
 * @param progress - 进度百分比 (0-100)
 *
 * @example
 * ```typescript
 * const onProgress: ProgressCallback = (progress) => {
 *   console.log(`上传进度: ${progress}%`);
 * };
 * ```
 */
export type ProgressCallback = (progress: number) => void;
