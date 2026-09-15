/**
 * 会议内远程控制——主 WS 发送器注册表（dev 门控域内）
 *
 * 主窗的 WS 连接活在 WebSocketContext（wsRef 私有，上下文未暴露通用 send）。
 * 本模块给控制裁决 M1/M2/M3 上行提供单一注册点：WebSocketContext 在建连成功后
 * （`ws.onopen`，isDevControl() 门控）注册发送器；disconnect 注销。
 * 生产构建 isDevControl() 恒 false → 注册永不发生 → 零行为改变。
 *
 * @module remote-control/wsSender
 */

type ControlWsSender = (payload: Record<string, unknown>) => void;

let sender: ControlWsSender | null = null;

/** 注册/注销主 WS 发送器（仅 WebSocketContext 的 dev 门控分支调用） */
export function registerControlSessionWsSender(s: ControlWsSender | null): void {
  sender = s;
}

/** 经主 WS 发送控制裁决上行帧（M1/M2/M3）。未注册/未连接时返回 false（调用方留痕）。 */
export function sendControlSessionWs(payload: Record<string, unknown>): boolean {
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('rc_debug_marker', { marker: `DBG3-send-entry type=${String((payload as { type?: string }).type)}` })).catch(() => undefined); // RC-DBG3
  if (!sender) {
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('rc_debug_marker', { marker: 'DBG4-sender-null' })).catch(() => undefined); // RC-DBG4
    console.warn('[RemoteControl] 主 WS 发送器未注册（未登录或 dev 门控关闭），丢弃上行帧');
    return false;
  }
  sender(payload);
  void import('@tauri-apps/api/core').then(({ invoke }) => invoke('rc_debug_marker', { marker: 'DBG3b-handoff-to-wsRef' })).catch(() => undefined); // RC-DBG3b
  return true;
}
