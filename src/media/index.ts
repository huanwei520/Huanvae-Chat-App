/**
 * 媒体预览模块导出
 *
 * 提供图片和视频的独立窗口预览功能
 */

// 页面组件
export { default as MediaPreviewPage } from './MediaPreviewPage';

// API 和工具函数
export {
  openMediaWindow,
  takeMediaData,
  clearMediaData,
  type MediaWindowData,
  type MediaSequenceEntry,
  type MediaStorageData,
  type MediaType,
  type MediaAuthInfo,
} from './api';
