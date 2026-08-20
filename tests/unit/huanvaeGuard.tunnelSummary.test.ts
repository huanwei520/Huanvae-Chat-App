/**
 * HuanvaeGuard 隧道摘要取数单测（零 mock 纯函数）
 *
 * 钉的是 213cc60 的行为契约：「正常但空闲」不许被显示成「坏了」。
 *
 * `last_handshake` 是**距今秒数**，且 `0` 有歧义（从未握手 / 刚握手不到 1 秒）。
 * 天真的 `Math.min(...ages)` 会被任意一个 age=0 的空闲对端拖成 0 →
 * 状态冠据此写出「尚未握手」，而同一时刻对端表里另一行明明是「4 秒前」。
 * 下面第二、三条就是那个回归的直接复现（在旧写法下必 FAIL）。
 */

import { describe, it, expect } from 'vitest';
import { freshestHandshakeAge, controlPlaneWarning } from '../../src/huanvaeGuard/tunnelSummary';
import type { ControlPlaneStatus } from '../../src/huanvaeGuard/types';

/** 只有 last_handshake 参与判定，构造最小对象即可 */
function peersOf(...ages: number[]): { last_handshake: number }[] {
  return ages.map((last_handshake) => ({ last_handshake }));
}

describe('freshestHandshakeAge', () => {
  it('没有对端 → null', () => {
    expect(freshestHandshakeAge([])).toBeNull();
  });

  it('所有对端都是 0（一个都没握过手）→ null', () => {
    expect(freshestHandshakeAge(peersOf(0))).toBeNull();
    expect(freshestHandshakeAge(peersOf(0, 0, 0))).toBeNull();
  });

  it('混合 [4, 0] → 4（空闲对端不许把结论拖成"尚未握手"）', () => {
    // 旧写法 Math.min(4, 0) = 0 → 冠上写「尚未握手」，而对端表里明明有「4 秒前」
    expect(freshestHandshakeAge(peersOf(4, 0))).toBe(4);
    expect(freshestHandshakeAge(peersOf(0, 4))).toBe(4);
  });

  it('多个握过手的对端取最新（最小 age）：[0, 9, 3] → 3', () => {
    expect(freshestHandshakeAge(peersOf(0, 9, 3))).toBe(3);
  });

  it('全部握过手时就是普通最小值', () => {
    expect(freshestHandshakeAge(peersOf(120, 7, 45))).toBe(7);
    expect(freshestHandshakeAge(peersOf(1))).toBe(1);
  });

  it('不修改入参', () => {
    const peers = peersOf(0, 9, 3);
    freshestHandshakeAge(peers);
    expect(peers.map((p) => p.last_handshake)).toEqual([0, 9, 3]);
  });
});

/**
 * 控制面（配置热更新链路）告警 —— 「一个功能缺失时，界面不许显示成功」的机器化
 *
 * 这条链路坏掉的全部症状是**什么都没发生**：`/api/tunnel/start` 200、隧道 `active: true`、
 * 对端表照常有数字，只有"后来加入的设备永远不出现"这一件事，而它不看几天看不出来。
 * 所以「坏了要喊」不能靠人自觉，得有断言钉着。
 *
 * 五种读数各自的处置完全不同（升级守护进程 / 断开重连 / 看启动失败原因 / 等重连 /
 * 按原因重建隧道），压成一句就等于没说 —— 因此下面逐条断言它们**两两不同**，
 * 而不是只断言"有告警"。
 *
 * 入参用 `ControlPlaneStatus`（types.ts 的真类型）而不是随手写的字面量：
 * 这就把「tunnelSummary 里那份结构式声明」与「types.ts 里的镜像」在编译期钉在一起 ——
 * 任何一边改字段，本文件当场 typecheck 失败。
 */
describe('controlPlaneWarning', () => {
  /** 一条健康链路：enabled + connected + 无 last_error + 零 auth_failures */
  const HEALTHY: ControlPlaneStatus = {
    enabled: true,
    connected: true,
    applied_peers: 3,
    applied_at: 1_760_000_000,
    auth_failures: 0,
  };

  it('健康（enabled && connected && 无 last_error）→ null（不制造噪音）', () => {
    expect(controlPlaneWarning(HEALTHY)).toBeNull();
  });

  it('undefined（旧守护进程根本没下发这个字段）→ 提示升级守护进程', () => {
    const msg = controlPlaneWarning(undefined);
    // 处置是"升级/修复守护进程"，所以必须说出守护进程版本这件事，
    // 不能与"本次启动没带凭据"用同一句话
    expect(msg).toContain('守护进程版本过旧');
  });

  it('enabled=false 且无 last_error（CONTROL_PLANE_ABSENT）→ 说明本次启动未携带凭据', () => {
    const msg = controlPlaneWarning({ ...HEALTHY, enabled: false, connected: false });
    expect(msg).toContain('未启用配置热更新');
    expect(msg).toContain('未携带控制面凭据');
  });

  it('enabled=false 且有 last_error（CONTROL_PLANE_START_FAILED）→ 带出原因', () => {
    const msg = controlPlaneWarning({
      ...HEALTHY, enabled: false, connected: false, last_error: 'tls profile is broken',
    });
    expect(msg).toContain('启动失败');
    // 原因必须原样带出：只说"失败了"等于把排查线索丢掉
    expect(msg).toContain('tls profile is broken');
  });

  it('enabled && !connected（链路断了在重连）→ 说"已断开"，并带出原因', () => {
    expect(controlPlaneWarning({ ...HEALTHY, connected: false })).toContain('已断开');
    expect(
      controlPlaneWarning({ ...HEALTHY, connected: false, last_error: 'websocket closed' }),
    ).toContain('websocket closed');
  });

  it('enabled && connected 但有 last_error（中继迁移 / 混淆轮换）→ 仍然要喊', () => {
    // 守护进程的 NodeMigrated / ObfsChanged 两个分支只写 last_error、**不动** connected：
    // 这两件事没法热更新、必须重建隧道。若按"连着就算健康"处理，
    // 这里就成了唯一一处「链路好好的、功能却真的失效了」而界面显示正常 —— 正是要防的那种。
    const msg = controlPlaneWarning({
      ...HEALTHY, last_error: 'relay node migrated; restart the tunnel',
    });
    expect(msg).not.toBeNull();
    expect(msg).toContain('relay node migrated; restart the tunnel');
  });

  it('五种不健康读数两两不同（压成一句就等于没说）', () => {
    const messages = [
      controlPlaneWarning(undefined),
      controlPlaneWarning({ ...HEALTHY, enabled: false, connected: false }),
      controlPlaneWarning({ ...HEALTHY, enabled: false, connected: false, last_error: 'boom' }),
      controlPlaneWarning({ ...HEALTHY, connected: false }),
      controlPlaneWarning({ ...HEALTHY, last_error: 'relay node migrated' }),
    ];
    expect(messages.every((m) => m !== null)).toBe(true);
    expect(new Set(messages).size).toBe(5);
  });

  it('auth_failures 只在已判定不健康时**追加**次数，不单独触发告警', () => {
    // access_token 900 秒过期，长命隧道正常就会「被拒 → 刷新 → 重连」⇒ auth_failures > 0
    // 在健康链路上是常态。拿它单独报警 = 一条永远亮着的红灯，训练所有人忽略红灯。
    expect(controlPlaneWarning({ ...HEALTHY, auth_failures: 7 })).toBeNull();

    const msg = controlPlaneWarning({ ...HEALTHY, connected: false, auth_failures: 7 });
    expect(msg).toContain('7');
    expect(msg).toContain('拒绝');
  });

  /**
   * 下面三段 JSON 是**真守护进程实测抓到的原文**，不是手写的假数据。
   *
   * 取证方式：把 HuanvaeGuard 仓当前构建的 hg-macos 以第二实例跑起来（不碰本机已装的那一路），
   * 用 App 现在构造的同一份 body 打 `POST /api/tunnel/start`，再读 `GET /api/tunnel/status`。
   * 三段分别对应：老守护进程 / 带凭据 / 不带凭据。
   *
   * 它们钉的是**手写 fixture 钉不住的那一半**：types.ts 里哪些字段必填、哪些可缺，
   * 是照守护进程的 serde 属性抄的（`applied_at` / `last_error` 带
   * `skip_serializing_if`），抄错了这里立刻露馅 —— 真实报文里那两个键**确实不出现**。
   */
  it('真守护进程报文：老版本不下发 control_plane（键整个不存在）', () => {
    // 本机已装的旧 hg-macos（2026-08-06 构建）实测响应，逐字：
    const real = JSON.parse('{"active":false,"peers":[]}') as { control_plane?: ControlPlaneStatus };
    expect(real.control_plane).toBeUndefined();
    expect(controlPlaneWarning(real.control_plane)).toContain('守护进程版本过旧');
  });

  it('真守护进程报文：带凭据启动 → 健康，界面不该有任何告警', () => {
    const real = JSON.parse(
      '{"enabled":true,"connected":true,"applied_peers":1,"applied_at":1786991833,"auth_failures":0}',
    ) as ControlPlaneStatus;
    expect(controlPlaneWarning(real)).toBeNull();
  });

  it('真守护进程报文：不带凭据启动（CONTROL_PLANE_ABSENT）→ 必须喊出来', () => {
    // 同一台机器、同一个守护进程、同一份 body，唯一变量是去掉了 control 这一项。
    // 守护进程侧同刻打出 `CONTROL_PLANE_ABSENT: … this tunnel will not learn about
    // devices added later`，而这段读数就是它在 HTTP 上的样子 —— 注意 last_error **不存在**，
    // 所以"没传凭据"与"传了但启动失败"必须靠 last_error 的有无来分，不能靠 enabled 一个字段。
    const real = JSON.parse(
      '{"enabled":false,"connected":false,"applied_peers":0,"auth_failures":0}',
    ) as ControlPlaneStatus;
    expect(real.last_error).toBeUndefined();
    const msg = controlPlaneWarning(real);
    expect(msg).toContain('未携带控制面凭据');
    expect(msg).not.toContain('启动失败');
  });

  /**
   * 第四段真报文：**带了凭据、控制链却连不上** —— 上面三段没覆盖到的那一档。
   *
   * 取证方式与上面三段同源（HuanvaeGuard 仓当前构建的 hg-macos 起第二实例），差别只在
   * `control.master_url` 指向一个 RFC 2606 保留域（`.invalid`，全球不可解析）⇒ 控制链
   * 起得来（`CONTROL_PLANE_STARTED`）但连不上 ⇒ `enabled=true` 而 `connected=false`。
   *
   * 🔴 它钉的是手写 fixture 钉不住的一件事：`last_error` 的**真实文本形态**。
   * 守护进程把令牌换成了 `<redacted>` 再放进这个字段 —— 而 `controlPlaneWarning`
   * 是把 `last_error` **逐字**拼进用户可见的告警条的。这条断言就是那份依赖的书面形式：
   * 哪天守护进程改成打印原始 URL，令牌就会直接显示在界面上，这里当场翻红。
   */
  it('真守护进程报文：带凭据但连不上（enabled=true / connected=false）→ 说"已断开"并原样带出原因', () => {
    const real = JSON.parse(
      '{"enabled":true,"connected":false,"applied_peers":0,'
      + '"last_error":"upgrade request failed: error sending request for url '
      + '(https://master.example.invalid/ws?token=<redacted>)","auth_failures":0}',
    ) as ControlPlaneStatus;
    const msg = controlPlaneWarning(real);
    expect(msg).toContain('已断开');
    // 原因逐字带出：分不清"连不上"与"被拒"的话，用户无从判断该等还是该重连
    expect(msg).toContain('upgrade request failed');
    // 守护进程的脱敏必须一路留到界面上 —— 反向断言，防它哪天把原始令牌塞进 last_error
    expect(msg).toContain('<redacted>');
    expect(msg).not.toContain('FWPROBE-FAKE-ACCESS');
  });

  it('健康读数不因 applied_peers=0 而报警（peer 集本来就可能是空的）', () => {
    // 账号只剩一台设备时 master 下发的就是空 peer 集，那是要被应用的**正常**状态
    // （daemon.rs 的 an_account_down_to_one_device_parses_as_an_empty_peer_set）
    expect(controlPlaneWarning({ ...HEALTHY, applied_peers: 0 })).toBeNull();
  });
});
