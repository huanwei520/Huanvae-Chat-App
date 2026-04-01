/**
 * 远程开发模块类型定义
 *
 * 对应后端 Remote Dev API Phase 1-7
 *
 * @module remoteDev/types
 */

// ============================================================================
// 窗口数据
// ============================================================================

export interface RemoteDevWindowData {
  userId: string;
  serverUrl: string;
  accessToken: string;
  refreshToken: string;
}

// ============================================================================
// Phase 1: 中继 Token
// ============================================================================

export interface RelayToken {
  token_id: string;
  name: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  expires_at: string | null;
}

export interface RelayTokenCreateResponse {
  token_id: string;
  raw_token: string;
  name: string;
  expires_at: string | null;
}

export interface RelayTokenCreateParams {
  name?: string;
  expires_in_secs?: number;
}

export interface UsageRecord {
  usage_id: string;
  user_id: string;
  token_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  request_duration_ms: number | null;
  status_code: number | null;
  created_at: string;
}

export interface DailyUsage {
  date: string;
  request_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_read_tokens: number;
}

// ============================================================================
// Phase 2: 机器管理
// ============================================================================

export type AuthType = 'password' | 'key';
export type SetupStatus = 'none' | 'in_progress' | 'ready' | 'failed';

export interface Machine {
  machine_id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  auth_type: AuthType;
  claude_setup_status: SetupStatus | null;
  created_at: string;
}

export interface MachineCreateParams {
  name: string;
  hostname: string;
  port?: number;
  username: string;
  auth_type: AuthType;
  credential: string;
}

export interface MachineUpdateParams {
  name?: string;
  hostname?: string;
  port?: number;
  username?: string;
  auth_type?: AuthType;
  credential?: string;
}

export interface SSHTestResult {
  success: boolean;
  latency_ms: number | null;
  message: string;
}

// ============================================================================
// Phase 3: Web 终端 WebSocket
// ============================================================================

export type TerminalClientMessageType = 'init' | 'input' | 'resize';
export type TerminalServerMessageType = 'status' | 'output' | 'error';

export interface TerminalInitMessage {
  type: 'init';
  cols: number;
  rows: number;
}

export interface TerminalInputMessage {
  type: 'input';
  data: string;
}

export interface TerminalResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

export type TerminalClientMessage =
  | TerminalInitMessage
  | TerminalInputMessage
  | TerminalResizeMessage;

export interface TerminalStatusMessage {
  type: 'status';
  connected: boolean;
  message: string;
}

export interface TerminalOutputMessage {
  type: 'output';
  data: string;
}

export interface TerminalErrorMessage {
  type: 'error';
  message: string;
}

export type TerminalServerMessage =
  | TerminalStatusMessage
  | TerminalOutputMessage
  | TerminalErrorMessage;

// ============================================================================
// Phase 4: SFTP 文件浏览
// ============================================================================

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  permissions: string;
  modified_at: string;
}

// ============================================================================
// Phase 5: Claude Code 安装
// ============================================================================

export interface SetupStatusResponse {
  status: SetupStatus;
  log: string | null;
  relay_token_name: string | null;
}

// ============================================================================
// Phase 6: Claude 对话
// ============================================================================

export interface ClaudeSession {
  session_id: string;
  machine_id: string;
  status: string;
  started_at: string;
}

export interface ClaudeSessionStartParams {
  working_dir: string;
  prompt: string;
}

export type ClaudeEventType = 'status' | 'system' | 'assistant' | 'user' | 'result' | 'error';

export interface ClaudeStatusEvent {
  type: 'status';
  message: string;
}

export interface ClaudeErrorEvent {
  type: 'error';
  message: string;
}

export interface ClaudeSystemEvent {
  type: 'system';
  subtype: string;
  cwd?: string;
  tools?: string[];
  model?: string;
  [key: string]: unknown;
}

export interface ContentBlockText {
  type: 'text';
  text: string;
}

export interface ContentBlockToolUse {
  type: 'tool_use';
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ContentBlockToolResult {
  type: 'tool_result';
  tool_use_id?: string;
  content: string;
}

export type ContentBlock = ContentBlockText | ContentBlockToolUse | ContentBlockToolResult;

export interface ClaudeAssistantEvent {
  type: 'assistant';
  message: {
    model?: string;
    content: ContentBlock[];
    [key: string]: unknown;
  };
}

export interface ClaudeUserEvent {
  type: 'user';
  message: {
    content: ContentBlock[];
    [key: string]: unknown;
  };
}

export interface ClaudeResultEvent {
  type: 'result';
  subtype: string;
  result: string;
  duration_ms: number;
  num_turns: number;
  [key: string]: unknown;
}

export type ClaudeDialogEvent =
  | ClaudeStatusEvent
  | ClaudeErrorEvent
  | ClaudeSystemEvent
  | ClaudeAssistantEvent
  | ClaudeUserEvent
  | ClaudeResultEvent;

// ============================================================================
// Store 类型
// ============================================================================

/** @deprecated 仅用于向后兼容，IDE 布局中不再使用 tab 导航 */
export type RemoteDevTab = 'tokens' | 'machines' | 'terminal' | 'files' | 'dialog';

/** 配置弹窗类型 */
export type ConfigModal = 'machines' | 'tokens' | null;
