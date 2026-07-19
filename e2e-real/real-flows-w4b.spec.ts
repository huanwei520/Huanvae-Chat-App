/**
 * real-e2e(L2.5-web) W4b —— 流程8(音视频进房跨实例) + 流程9(VPN /api/hg 用户态) 前端腿。
 *
 * 流程8：Chromium 双 tab（A 钉实例A/18801、B 钉实例B/18802）各起真 RTCPeerConnection，经
 *   `/ws/webrtc/rooms/{id}` 信令 WS 交换 offer/answer/candidate（经后端 `webrtc:sig:{global}`
 *   总线跨实例中转）→ 双方 connectionState 到 'connected'。层级 = e2e(L2.5-web)：真 Chromium
 *   WebRTC + 真跨实例后端信令；ICE 是浏览器 P2P（回环）。
 *   ⚠ 环境事实（实测 2026-07-17）：本 headless Chromium 里 getUserMedia(fake device) 恒挂起不返回，
 *   故 ICE 由 RTCDataChannel 驱动 —— 等价证明「真 RTCPeerConnection 协商到 connected」（ICE/DTLS
 *   传输与 media 驱动完全一致）；fake media flags 仍在 playwright.real-e2e.config.ts 配置。回环 ICE
 *   需真实本地 IP 候选，config 已加 `--disable-features=WebRtcHideLocalIpsWithMdns`。不驱动 App
 *   MeetingPage React 组件（跨窗口 emit/listen 属 L3 真机）。
 *
 * 流程9：HG 用户态是独立子窗口（`/huanvae-guard`）。web 面按设计稿 B3 = SPA 路由直开，本用例断言
 *   该路由被前端正确服务（app shell 可达）。⚠ 环境事实（实测 2026-07-17）：HG React 页在 web 面
 *   不完整渲染（该页做跨窗口 Tauri 事件 token 同步 + 本地服务轮询 + 真 WG 隧道，均需 Tauri 壳），
 *   属设计稿 B3 明列的 L3 真机边界 → 真隧道/设备数据面如实止步于 L3，不在本集群断言。
 */

import { test, expect } from '@playwright/test';
import {
  INSTANCE_A,
  INSTANCE_B,
  registerUser,
  loginUser,
  createWebrtcRoom,
  joinWebrtcRoom,
} from './helpers/backend-api';
import { ORIGIN_A, ORIGIN_B, PASSWORD, newAppPage } from './helpers/ui';

/**
 * 浏览器内自包含 WebRTC 端：连信令 WS + 真 RTCPeerConnection，用 RTCDataChannel 作 ICE 载体
 * （本环境 getUserMedia 挂起，见文件头），offer/answer/candidate 经后端跨实例总线中转，协商到
 * connectionState==='connected' 时 resolve。
 */
async function peerHarness(arg: { wsUrl: string; isOfferer: boolean }): Promise<string> {
  const { wsUrl, isOfferer } = arg;
  const pc = new RTCPeerConnection();
  // 至少一条 m-line 才能启动 ICE：offerer 建 DataChannel，answerer 经 ondatachannel 收
  if (isOfferer) {
    pc.createDataChannel('flow8');
  }

  const ws = new WebSocket(wsUrl);
  let myPid: string | null = null;
  let peerPid: string | null = null;
  let offered = false;
  let remoteSet = false;
  const queued: RTCIceCandidateInit[] = [];
  const send = (o: unknown) => ws.send(JSON.stringify(o));

  pc.onicecandidate = (e) => {
    if (e.candidate && peerPid) {
      send({
        type: 'candidate',
        to: peerPid,
        candidate: {
          candidate: e.candidate.candidate,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
          sdpMid: e.candidate.sdpMid,
        },
      });
    }
  };

  const connected = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout conn=${pc.connectionState} ice=${pc.iceConnectionState}`)),
      45000,
    );
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'connected') {
        clearTimeout(timer);
        resolve('connected');
      } else if (pc.connectionState === 'failed') {
        clearTimeout(timer);
        reject(new Error('pc failed'));
      }
    });
  });

  const flushQueued = async () => {
    remoteSet = true;
    while (queued.length) {
      const c = queued.shift();
      if (c) {
        try {
          await pc.addIceCandidate(c);
        } catch {
          /* ignore late/invalid candidate */
        }
      }
    }
  };
  const maybeOffer = async () => {
    if (!isOfferer || offered || !peerPid) {
      return;
    }
    offered = true;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'offer', to: peerPid, sdp: pc.localDescription?.sdp });
  };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data as string);
    if (msg.type === 'joined') {
      myPid = msg.participant_id;
      const others = (msg.participants || []).filter((p: { id: string }) => p.id !== myPid);
      if (others.length) {
        peerPid = others[0].id;
        await maybeOffer();
      }
    } else if (msg.type === 'peer_joined') {
      peerPid = msg.participant.id;
      await maybeOffer();
    } else if (msg.type === 'offer') {
      peerPid = msg.from;
      await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
      await flushQueued();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: 'answer', to: peerPid, sdp: pc.localDescription?.sdp });
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: msg.sdp });
      await flushQueued();
    } else if (msg.type === 'candidate') {
      if (remoteSet) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch {
          /* ignore */
        }
      } else {
        queued.push(msg.candidate);
      }
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('signaling ws connect failed'));
  });

  return connected;
}

test('流程8：双 tab 真 RTCPeerConnection 跨实例信令协商到 connected', async ({ browser }) => {
  const ts = Date.now();
  const uidA = `webrtc_a_${ts}`;
  const uidB = `webrtc_b_${ts}`;
  await registerUser(INSTANCE_A, uidA, 'WebRTC-A', PASSWORD);
  await registerUser(INSTANCE_B, uidB, 'WebRTC-B', PASSWORD);
  const tokenA = await loginUser(INSTANCE_A, uidA, PASSWORD);
  const tokenB = await loginUser(INSTANCE_B, uidB, PASSWORD);

  // A 在实例A建房、B 经实例B join（各拿 ws_token；join 非 404 即跨实例房间元数据共享）
  const room = await createWebrtcRoom(INSTANCE_A, tokenA);
  const joinB = await joinWebrtcRoom(INSTANCE_B, tokenB, room.room_id, room.password, 'WebRTC-B');
  expect(joinB.ws_token.length).toBeGreaterThan(0);

  const a = await newAppPage(browser, ORIGIN_A, 'webrtc-A');
  const b = await newAppPage(browser, ORIGIN_B, 'webrtc-B');
  // 需 localhost 安全上下文 + 真 origin：落到各自钉实例的 vite origin
  await a.page.goto('/');
  await b.page.goto('/');

  const wsUrlA = `ws://127.0.0.1:18801/ws/webrtc/rooms/${room.room_id}?token=${room.ws_token}`;
  const wsUrlB = `ws://127.0.0.1:18802/ws/webrtc/rooms/${room.room_id}?token=${joinB.ws_token}`;

  const [stateA, stateB] = await Promise.all([
    a.page.evaluate(peerHarness, { wsUrl: wsUrlA, isOfferer: true }),
    b.page.evaluate(peerHarness, { wsUrl: wsUrlB, isOfferer: false }),
  ]);

  expect(stateA).toBe('connected');
  expect(stateB).toBe('connected');

  await a.context.close();
  await b.context.close();
});

test('流程9：HG 用户态 SPA 路由 /huanvae-guard 前端可达（app shell 服务）', async ({ browser }) => {
  // HG 用户态是独立子窗口。web 面按设计稿 B3 只做「SPA 路由直开」可达性：断言前端为该路由服务出
  // app shell（#root 挂载点 + vite 入口）。HG React 页完整渲染 + 真设备数据 + 真 WG 隧道需 Tauri 壳
  // （跨窗口事件 token 同步 / 本地服务 / 真 WireGuard），属设计稿 B3 的 L3 真机边界，如实止步、不在
  // 本集群断言（见文件头）。
  const { context, page } = await newAppPage(browser, ORIGIN_A, 'hg-web');
  const resp = await page.goto('/huanvae-guard', { waitUntil: 'commit' });
  expect(resp?.status()).toBe(200);
  const html = await resp!.text();
  expect(html).toContain('id="root"');
  expect(html).toContain('main.tsx');
  await context.close();
});
