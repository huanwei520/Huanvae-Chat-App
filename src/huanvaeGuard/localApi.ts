/**
 * 本机 HuanvaeGuard 守护进程 API 调用（回环明文 http://127.0.0.1:<控制端口>）
 *
 * - **控制端口不写死，逐次向 Rust 侧解析（默认 19198）**：同一台机器上可以并存多路
 *   守护进程实例，各自监听不同的回环端口。本 App 只该跟自己装的那一路说话，端口真值
 *   由 `hg_local_control_port` 给出（macOS 读已装的服务配置；其余平台就是默认端口）。
 *   写死端口的后果是：别的实例先占住 19198 时，App 会去连**别人家**的守护进程，
 *   把对方的隧道当成自己的显示出来。
 * - **刻意保留 plugin-http(不迁 secure_http)**：本路径是**回环明文 http**(127.0.0.1)，
 *   既无 TLS(故无需 secure_net 的内置 CA 自管 TLS)、也非后端数据面调用(api.huanvae.cn)，
 *   不在"自签 TLS 直连数据面"迁移范围内。plugin-http 在此的作用是绕开浏览器 CORS
 *   （svc 不返回 CORS 头；dev 模式前端 origin 是 http://localhost:1420）。
 *   未来即便加鉴权(HMAC/Token)也是 header 注入，仍走 plugin-http，无需迁移。
 * - 无鉴权 —— 服务仅监听回环地址。未来 P0 计划中会加 HMAC 或 Token
 * - svc 自身由 Tauri 进程生命周期控制（见 src-tauri/src/desktop/huanvaeguard.rs）
 *
 * 函数一览：
 *   getStatus            GET  /api/tunnel/status    获取隧道状态 + peer 明细（兼作探活）
 *   startTunnel          POST /api/tunnel/start     建立 WireGuard 隧道
 *   stopTunnel           POST /api/tunnel/stop      关闭隧道
 *   resolveLocalPort     IPC  hg_local_control_port 解析本次要连的本地控制端口（真值在 Rust 侧）
 */

import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import type {
  ApiResponse,
  TunnelStatus,
  PeerConfig,
  ObfuscationParams,
  ControlCredentials,
} from './types';

/**
 * 本地控制端口的默认值。
 *
 * 守护进程不带参数启动时绑的就是这个端口，安装时的端口候选表也以它排第一。
 * 所以在"本机没有别的实例"的普通机器上解析出来的正是这个值 —— 端口改成动态解析后，
 * 这类机器的行为与写死端口时代**完全一致**。
 *
 * 这个判断的证据链（省得下一个人重新推一遍）：
 * - **macOS 全新机器装出来就是它**：安装时按候选表 `CONTROL_PORT_CANDIDATES = [19198,
 *   19199, … 19207]` 取**第一个空闲**端口写进 plist（`src-tauri/src/desktop/huanvaeguard_macos.rs`
 *   的 `pick_free_port`），候选全空闲时选中的就是排第一的 19198；单测
 *   `pick_free_port_takes_default_when_nothing_is_busy` 正锁着这条。
 * - **守护进程自己的编译内置默认也是它**：不带 `--api-listen` 启动时绑 `127.0.0.1:19198`
 *   （HuanvaeGuard 仓 `client/macos/src/instance.rs` 的 `DEFAULT_API_LISTEN`）；Windows 侧
 *   守护进程更是固定绑这个端口（同仓 `client/windows/src/api_server.rs` 的 `LISTEN_ADDR`）。
 * - **非 macOS 平台这个值就是真值**：`hg_local_control_port` 的
 *   `#[cfg(not(target_os = "macos"))]` 分支（`src-tauri/src/lib.rs`）直接返回 19198，
 *   没有多实例选端口这回事 —— 所以在 Windows/Linux 上兜底值与真值恒等。
 * - **兜底真正生效的场景很窄**：只有 `invoke('hg_local_control_port')` 抛错（命令缺失 /
 *   IPC 失败）或返回值不是可用端口时，`resolveLocalPort` 才会用它；macOS 正常路径下
 *   该命令总能返回一个 u16，不会落到这里。
 *
 * 在没有第二路实例的普通用户机器上，上面每条路径给出的都是 19198，所以这个兜底值
 * **不是随手取的数**，是各条路径一致的正确答案；本机之所以观察到 19199，仅仅因为本机
 * 额外跑了另一路实例把 19198 先占住了 —— 那是本机特例，不能拿来当普通机器的结论。
 */
const DEFAULT_LOCAL_PORT = 19198;

type FetchInit = Parameters<typeof fetch>[1];

/** IPC 拿回来的值是否是一个能用的端口号（1..=65535 的整数）。 */
function isUsablePort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * 解析本次请求要连的本地控制端口。
 *
 * 端口真值只在 Rust 侧（macOS 以已安装的服务配置为准，其余平台是固定的默认端口），
 * 这里经 `hg_local_control_port` 取回。跨 IPC 回来的值先验一遍是不是可用端口：
 * 拿不到值（命令缺失 / 调用失败）或值不可用时用 `DEFAULT_LOCAL_PORT`。这不是"出错了
 * 随便给个数"的兜底 —— 全新安装绑的就是这个端口，所以在没有更准确信息的情况下，
 * 它就是**正确答案**，照它发请求能连上的概率最高。
 *
 * 界面要告诉用户"刚才连上的是哪个端口"时用的也是这个函数，所以显示出来的端口
 * 永远不会和真正发请求用的端口对不上。
 *
 * **刻意不缓存解析结果**：窗口开着的时候端口是会变的 —— 修复 / 重装路径可能把守护进程
 * 落到另一个端口上。缓存下来的端口此后就指向一个没人监听的端口，更糟的是指向别人家的
 * 实例（前者只是连不上，后者会让界面显示不属于自己的隧道）。而解析本身只是一次本机 IPC，
 * 调用方紧接着就要发一次真正的网络请求，逐次解析的开销测不出来，换掉的却是一整类
 * "状态过期"引发的 bug。
 * 这里也不提供缓存失效 API：那需要调用方在合适的时机调它，会牵连到本次不该动的文件。
 */
export async function resolveLocalPort(): Promise<number> {
  let resolved: unknown;
  try {
    resolved = await invoke<number>('hg_local_control_port');
  } catch {
    // 端口查询失败：按默认端口处理（理由见上），不让它影响紧随其后的请求
  }
  return isUsablePort(resolved) ? resolved : DEFAULT_LOCAL_PORT;
}

/** 本次请求要用的回环基址；端口取自 `resolveLocalPort`（全仓唯一的解析口）。 */
async function resolveLocalBase(): Promise<string> {
  const port = await resolveLocalPort();
  return `http://127.0.0.1:${port}`;
}

/**
 * 单次本机请求的超时上限（ms）。
 *
 * 取值依据：守护进程侧的状态查询在最坏情况下可能耗时数秒（其内部需等待一次关停完成），
 * 即一次状态查询**本来就可能耗时数秒**，上限必须高于该量级，才不会把合法慢响应
 * 误判成"服务没起"。
 * 另一方面又必须有上限：守护进程"在监听但不应答"时（半死态）裸 fetch 的 promise 永不落地，
 * 调用方的 finally 也就永远不执行（按钮永久卡在 loading）。8 秒是二者之间的取值。
 */
export const LOCAL_TIMEOUT_MS = 8000;

async function localFetch<T>(path: string, init?: FetchInit): Promise<ApiResponse<T>> {
  // 每次请求都重新解析基址（不缓存的理由见 resolveLocalPort）
  const base = await resolveLocalBase();
  // plugin-http 的 fetch 遵循 init.signal：发请求前检查 aborted、并在 signal 上挂 abort
  // 监听器调 plugin:http|fetch_cancel 真正取消 Rust 侧请求（见 node_modules/@tauri-apps/
  // plugin-http/dist-js/index.js 的 46 / 88 / 104-113 / 151 行），故这里的超时是真取消，
  // 不是"只丢结果、请求还在后台跑"。
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, LOCAL_TIMEOUT_MS);
  try {
    const resp = await fetch(`${base}${path}`, { ...init, signal: controller.signal });
    const parsed = await resp.json().catch(
      () => ({ success: false, error: `HTTP ${resp.status}` }) as ApiResponse<T>,
    );
    return parsed;
  } finally {
    // 无论正常返回、解析失败还是超时/异常，都要拆掉定时器，避免留下悬挂的 abort 计时
    clearTimeout(timer);
  }
}

export function getStatus(): Promise<ApiResponse<TunnelStatus>> {
  return localFetch('/api/tunnel/status');
}

/**
 * 建立隧道。
 *
 * 🔴 **body 是 `JSON.stringify(params)` 整体透传 ⇒ 这里的类型就是唯一的闸门。**
 * 工作区 CLAUDE.md 记着一条镜像面的坑「改了类型 ≠ 传了字段」（逐键构造 body 时类型加了、
 * 构造处没加就静默丢字段）；整体透传是它的反面：**类型漏了就静默丢字段**，
 * 而 `/api/tunnel/start` 照样 200、界面照样显示「已连接」。`control` 正是这么丢了整整一个功能的
 * —— 桌面端此前发出的 body 恰好 6 个键，没有 `control`，于是守护进程走
 * `CONTROL_PLANE_ABSENT` 分支，这条隧道的 peer 集在启动那一刻就冻住了。
 * 回归防线：`tests/unit/huanvaeGuard.localApi.test.ts` 正反两条（传了必须出现在 body 里 /
 * 不传必须整个键都不出现）。
 */
export function startTunnel(params: {
  address: string;
  private_key: string;
  peers: PeerConfig[];
  obfuscation: ObfuscationParams;
  dns?: string;
  mtu?: number;
  /**
   * 控制面凭据。缺它 = 这条隧道**不会**知道后来加入的设备（语义见 types.ts 的
   * `ControlCredentials` 注释）。可选是为了对齐守护进程侧的 `#[serde(default)]`，
   * **不是**给调用方留一条"figure it out later"的静默降级路 ——
   * 调用方缺必需值时应当中止连接，而不是发一个没有 control 的 start。
   */
  control?: ControlCredentials;
}): Promise<ApiResponse<void>> {
  return localFetch('/api/tunnel/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

export function stopTunnel(): Promise<ApiResponse<void>> {
  return localFetch('/api/tunnel/stop', { method: 'POST' });
}
