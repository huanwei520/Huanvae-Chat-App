/**
 * 局域网传输模块导出
 *
 * 提供局域网设备发现和文件传输的独立窗口功能
 */

// 页面组件
export { default as LanTransferPage } from './LanTransferPage';

// API 和工具函数
export {
  openLanTransferWindow,
  loadLanTransferData,
  clearLanTransferData,
  saveLanTransferData,
  type LanTransferWindowData,
} from './api';
