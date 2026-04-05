/**
 * 拓扑 & 配置同步模块
 *
 * 架构原则（hub-and-spoke relay）：
 *   - Topology API → 仅用于 UI 展示在线设备列表
 *   - Config API   → 包含 relay peer，用于隧道 peer 更新
 *
 * 事件处理：
 *   hg_topology_changed → 拉取 topology → 回调 onTopologyUpdated（UI）
 *   hg_config_changed   → 拉取 config   → POST /api/tunnel/peers（relay peer）
 */

import type { HgApiClient } from './serverApi';
import * as localApi from './localApi';
import type { TopologyPeer } from './types';

export interface TopologySyncOptions {
  api: HgApiClient;
  deviceId: string;
  topologyIntervalMs?: number;
  onLog?: (msg: string) => void;
  onTopologyUpdated?: (peers: TopologyPeer[], version: number) => void;
}

export function createTopologySync(opts: TopologySyncOptions) {
  const {
    api, deviceId,
    topologyIntervalMs = 30_000,
    onLog, onTopologyUpdated,
  } = opts;

  let topologyVersion = 0;
  let topoTimer: ReturnType<typeof setInterval> | null = null;
  let ws: WebSocket | null = null;
  let stopped = false;

  const log = (msg: string) => onLog?.(`[Sync] ${msg}`);

  async function syncTopology(full = false) {
    try {
      const since = full ? undefined : topologyVersion || undefined;
      const topo = await api.getTopology(deviceId, since);

      if (topo.topology_version <= topologyVersion && !full) return;
      topologyVersion = topo.topology_version;

      log(`拓扑已更新: ${topo.peers.length} 设备在线 (v=${topologyVersion})`);
      onTopologyUpdated?.(topo.peers, topologyVersion);
    } catch (e) {
      log(`拓扑同步失败: ${e}`);
    }
  }

  async function syncConfig() {
    try {
      const config = await api.getDeviceConfig(deviceId);
      log(`Config 已拉取: ${config.peers.length} relay peers`);

      const status = await localApi.getStatus();
      if (status.success && status.data?.active) {
        const r = await localApi.updatePeers(config.peers, true);
        if (r.success) {
          log('隧道 peers 已通过 Config API 热更新');
        } else {
          log(`隧道 peers 更新失败: ${r.error}`);
        }
      }
    } catch (e) {
      log(`Config 同步失败: ${e}`);
    }
  }

  function connectWs() {
    const serverUrl = api.getServerUrl();
    const token = api.getAccessToken();
    const wsProto = serverUrl.startsWith('https') ? 'wss' : 'ws';
    const host = serverUrl.replace(/^https?:\/\//, '');
    const url = `${wsProto}://${host}/ws?token=${encodeURIComponent(token)}`;

    ws = new WebSocket(url);

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'hg_topology_changed') {
          log('收到拓扑变更推送');
          void syncTopology(false);
        } else if (msg.type === 'hg_config_changed') {
          log('收到配置变更推送');
          void syncConfig();
        }
      } catch { /* ignore non-JSON frames */ }
    };

    ws.onclose = () => {
      if (!stopped) {
        log('WS 断开，5s 后重连');
        setTimeout(() => { if (!stopped) connectWs(); }, 5000);
      }
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  return {
    start() {
      stopped = false;
      void syncTopology(true);
      topoTimer = setInterval(() => void syncTopology(false), topologyIntervalMs);
      connectWs();
      log('同步已启动（拓扑=UI / 配置=隧道）');
    },

    stop() {
      stopped = true;
      if (topoTimer) { clearInterval(topoTimer); topoTimer = null; }
      if (ws) { ws.onclose = null; ws.close(); ws = null; }
      log('同步已停止');
    },

    forceSync() {
      void syncTopology(true);
    },

    forceSyncConfig() {
      void syncConfig();
    },
  };
}

export type TopologySyncHandle = ReturnType<typeof createTopologySync>;
