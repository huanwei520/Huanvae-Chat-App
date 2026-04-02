/**
 * 远程开发模块
 *
 * 功能：
 * - Phase 1: 中继 Token 管理 + API 中继
 * - Phase 2: 远程机器管理（SSH 密码/密钥）
 * - Phase 3: Web 终端（WebSocket + xterm.js）
 * - Phase 4: SFTP 文件浏览器（语法高亮代码查看）
 * - Phase 5: 一键安装 Claude Code
 * - Phase 6/8: Claude Code 对话（多轮对话 WebSocket 流式）
 *
 * 架构：
 * - 独立 Tauri 窗口运行，不依赖 SessionContext
 * - 通过 URL 查询参数传递认证信息
 * - 独立 API 客户端（自动 Token 刷新）
 *
 * @module remoteDev
 */

export { default as RemoteDevPage } from './RemoteDevPage';
export { openRemoteDevWindow, parseWindowDataFromUrl } from './api';
export { createRemoteDevApiClient } from './services/apiClient';
export { createRelayTokenService } from './services/relayTokenService';
export { createMachineService } from './services/machineService';
export { createFileService } from './services/fileService';
export { createSetupService } from './services/setupService';
export { createConversationService } from './services/conversationService';
export { useRemoteDevStore } from './stores/remoteDevStore';

export type { RemoteDevWindowData, ConfigModal } from './types/remoteDev';
export type { RemoteDevApiClient } from './services/apiClient';
export type { FileService } from './services/fileService';
