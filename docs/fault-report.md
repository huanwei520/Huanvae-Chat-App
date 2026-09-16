# 故障记录检测（App 端）—— 信封规范与模块说明

> 状态：App 端通道代码已完成；**正式公钥待服务器块（Huanvae-Chat-Rust fault_report 块）交付**，
> 当前 `FAULT_REPORT_PUBLIC_KEY_PEM = null`（fail-closed，见下文「公钥接入」）。

## 1. 用户流程

设置 → 故障记录检测 → 开启记录（自动附带开启前最近 5 分钟日志）→ 复现问题 → 停止 →
附加截图（自动压缩）+ 文字描述 → 提交（整体加密一次）→ 服务器返回工单号；
上传失败 → 本地暂存（密文形态）→ 可见重试入口。

## 2. 采集面（红线）

| 采集 | 说明 |
| --- | --- |
| 前端 console | console.debug/info/log/warn/error 劫持（记录后原样转发，不改语义） |
| 未捕获异常 | `window.onerror` + `unhandledrejection` |
| 网络错误摘要 | 全局 fetch 透传包装：**仅 URL + 状态码**（网络层异常 status=0）；请求头/请求体/响应体零采集 |
| Rust log | `log` 门面追加层（stdout 透传 + 脱敏入环形缓冲，`src-tauri/src/fault_report.rs`） |
| 设备信息 | 平台 / OS 版本 / 架构 / 机型 / App 版本（`fault_report_device_info` 命令） |
| 机器码哈希 | SHA-256(机器码) hex 小写，**原始机器码不出 Rust 层**（`fault_report_machine_code_hash`） |
| 时间戳 | 每条日志 epoch ms；信封 timestamp |
| 环形缓冲 | 前端/Rust 各 10MB 上限，超限滚动丢弃最旧（丢弃计数随报告可感知） |

**脱敏红线**：写入缓冲**前**强制按模式脱敏（前后端两套实现同模式集）：
`Bearer <token>`、`token=` / `access_token=` / `refresh_token=` / `password=` / `passwd=` / `pwd=` /
`secret=` / `client_secret=` / `api_key=` / `apikey=` / `session_id=` / `cookie=`（=与: 两形态、
含单双引号值）、JSON 同名字段（`"token":"..."` 等）、行首 `authorization:` 头、≥32 位长 hex 串。
单测：`tests/faultReport/sanitizer.test.ts`（13 用例）与 `src-tauri/src/fault_report.rs#tests`（9 用例）。

**聊天正文零采集**：按构造实现 —— 采集面只有 console/异常事件/fetch 失败摘要/log 门面/设备元数据，
不挂接任何消息存储、渲染或数据库读取路径。

## 3. 信封规范 FR1（与服务器解密端同一约定）

```json
{
  "version": "FR1",
  "machine_code_hash": "<sha256 hex 小写, 64 字符>",
  "timestamp": 1789000000000,
  "nonce": "<base64, 24 字节随机>",
  "ephemeral_public_key": "<base64, 32 字节裸 X25519 公钥>",
  "ciphertext": "<base64, XChaCha20-Poly1305(密文||16B tag)>"
}
```

- 派生：`ikm = X25519(ephemeral_sk, recipient_pk)`；
  `salt = nonce(24B) || u64be(timestamp)`；`info = "huanvae-fault-report/FR1/xchacha20poly1305"`；
  `key = HKDF-SHA256(ikm, salt, info, 32)`
- AAD：`"FR1\n<machine_code_hash>\n<timestamp>\n<b64(ephemeral_public_key)>"`（UTF-8）——
  信封任一字段被篡改即解密失败（单测覆盖密文/nonce/version/machine_code_hash/timestamp 五路篡改）
- 明文：UTF-8(JSON)（描述 + client_logs + rust_logs + network_errors + device_info +
  machine_code_hash + app_version + recording 窗口 + screenshots[]，整体一次加密）
- 公钥 PEM 兼容：SPKI（`-----BEGIN PUBLIC KEY-----`，DER 尾部 32 字节）、
  裸 32 字节 base64、`X25519 PUBLIC KEY` 包装形态

## 4. 公钥接入（待服务器块交付后单点替换）

`src/services/faultReport/config.ts` → `FAULT_REPORT_PUBLIC_KEY_PEM`：
当前 `null`（fail-closed：未配置时 seal/submit 抛错，UI 明示「未配置正式公钥」）。
**接入 = 将服务器块交付的 `docs/fault-report-public-key.pem` 全文粘贴到该常量，零其他改动。**
私钥只在服务器侧（/vault.env 变量引用），绝不入仓、绝不入 App；本仓全部测试密钥为测试运行时现场生成。

## 5. 上传与暂存

- `POST /api/fault-reports`（复用既有 ApiClient：自动 Bearer、401 刷新），body = 信封本体
- 失败 → 本地暂存**密文信封**（内存主存 + localStorage 写穿，上限 5 条丢最旧），UI 提供重试/放弃
- 响应 `{ ticket_id }` 为工单号，UI 展示供跟进

## 6. 代码地图（全部新增，既有文件仅最小挂载）

| 文件 | 职责 |
| --- | --- |
| `src/services/faultReport/config.ts` | 常量与正式公钥位（fail-closed） |
| `src/services/faultReport/sanitizer.ts` | 写入前脱敏（模式集见 §2） |
| `src/services/faultReport/ringBuffer.ts` | 10MB 字节上限环形缓冲 |
| `src/services/faultReport/capture.ts` | console/异常/fetch 劫持（透传不改语义） |
| `src/services/faultReport/instance.ts` | 进程内单例（缓冲/网络错误列表/记录窗口） |
| `src/services/faultReport/bytes.ts` | 编码工具 |
| `src/services/faultReport/crypto.ts` | ECIES seal/open（FR1） |
| `src/services/faultReport/staging.ts` | 失败暂存队列 |
| `src/services/faultReport/service.ts` | 流程编排（开启/停止/压缩/组包/提交/重试） |
| `src/api/faultReport.ts` | POST /api/fault-reports |
| `src/components/settings/FaultReportPanel.tsx` + `fault-report.css` | 面板 UI |
| `src-tauri/src/fault_report.rs` | Rust 追加层 + 3 命令 + 9 单测 |
| `tests/faultReport/*.test.ts` | 51 个 vitest 用例 |

挂载点（最小改动）：`SettingsPanel.tsx`（入口行 + 面板 overlay）、`settings/index.ts`（导出）、
`main.tsx`（`installFaultCapture()` 尽早安装）、`src-tauri/src/lib.rs`（`mod fault_report;` + `init()` + 3 命令注册）、
`src-tauri/Cargo.toml`（`log = { version = "0.4", features = ["std"] }`）、`package.json`（@noble 三件）。
