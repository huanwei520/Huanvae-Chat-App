---
name: guard-token-resync
description: App 侧 HuanvaeGuard 令牌链——主窗口→guard 守护进程的令牌传递/推送/失效重取。当 guard 页报「守护进程凭据已失效」「token refresh after 401 failed」「sign-in required」、要改 session:tokens-updated / session:request-tokens / updateControlCredentials 链路、或新增令牌消费方时加载;含 App 半边全链 file:line、Tauri 事件不出进程的边界、空串凭据陷阱、安卓轨差异、refresh 再 401 终态自动重登腿（tu14ytyn 补强）。daemon 侧（熔断/退避/宣告自清）见 HuanvaeGuard 仓 .claude/skills/hg-daemon-credential-resync/SKILL.md。
---

# guard-token-resync — App 侧 guard 令牌传递与失效重取（凭据链 App 半边）

来源：gtcy072z（2026-09-16，修 guard 配置热更新 401 横幅；App 侧合入 `2f7e09e2`，Guard 侧 `acfb104`）。
行号以该版本工作区实跑校准；改动后以锚点名重新 grep。**本文只管 App 半边**；daemon 半边
（四件套/熔断退避/宣告归属/验收清单）在 Guard 仓同名族 skill，两端锚点互引。

## 0. 铁律：Tauri 事件不出进程

`emit('session:tokens-updated')` 只到 Tauri 窗口进程（SessionContext.tsx:126），**到不了
huanvaeguard-svc 守护进程**——它是独立 exe/系统服务，不是窗口。推论：
- 主窗口日志「已同步令牌」只是窗口级事实，**不代表 daemon 已拿到**；
- 令牌进 daemon 只有本地 HTTP 控制面一条路：`POST /api/tunnel/credentials`（localApi.ts:210）；
- 新增任何「窗口内存令牌副本」消费方之前，先回答它失效后怎么重取。

## 1. App 半边全链（谁推、何时推、怎么推）

```
登录/续期  SessionContext.updateTokens → emit('session:tokens-updated')   src/contexts/SessionContext.tsx:126
  ├ HuanvaeGuardPage 监听(:529) → pushControlCredentials(:320)
  │   门控(:321-325)：isAndroid 直接 return；令牌非空；tunnelActiveRef（隧道在跑才推）
  ├ 挂载索要(:543) emit('session:request-tokens') → 主窗口 sessionRef 现取回发(:167-172)
  └ 死凭据探测器(:556-570)：tunnelStatus 报错含 'sign-in required' 或
      'token refresh after 401 failed' → 判凭据死 → 60s 节流(:561-562)
      → emit('session:request-tokens') 向主窗口重取 + windowData 兜底直推(:565-567)

推送出口  localApi.updateControlCredentials   src/huanvaeGuard/localApi.ts:200-216
  POST /api/tunnel/credentials（:210）
  空串归一化(:207-209)：refresh_token 空串 → 键缺省（undefined 键被 JSON.stringify 丢弃）
  ⇒ daemon 侧入口 handle_credentials → apply_credentials → Reconcile（Guard 仓 skill §0/§2）
```

## 2. 三个 App 侧陷阱（回归单测与实证在 Guard 仓 skill）

1. **空串凭据**：`refresh_token: ""` 过线会被 daemon 反序列化成 `Some("")`——「存在但无用」
   比键缺失更糟。归一化收在 localApi 这一道闸（:207-209），调用方忘处理也递不过去；daemon 侧
   还有空令牌拒收双保险。改这条链时别把归一化挪出闸门。
2. **推送门控三条件缺一不可**：安卓不推（:321，见 §3）；空令牌不推；隧道没跑过不推
   （daemon 没起时推了也没人收）。放宽任何一条前先想清对应失效场景谁兜底。
3. **节流不是可选项**：死凭据探测器若不限频，横幅每轮刷新都会触发一次重取循环——
   60s 节流（CRED_RESYNC_THROTTLE_MS）是防自 hammer 的 App 半边，与 daemon 熔断互补。

## 3. 安卓轨差异（为何不推）

- 推送只存在于桌面轨：`POST /api/tunnel/credentials` 端点只在 Guard 仓 client/windows|macos；
  client/android/ 对 `tunnel/credentials|update_credentials|UpdateCredentialsRequest` 穷举零命中。
- 安卓会话机制（Guard 仓实锚点）：`client/android/src/jni.rs:386`「读 sessionFd →
  ControlCredentials → daemon::start」——凭据经插件会话文件管道注入，不走本地 HTTP；
  App 侧同构证据：HuanvaeGuardPage.tsx:319 注释原文、MobileGuardPage.tsx:11-13
  （安卓覆盖页与主窗口同 JS 上下文，凭据经 initialData prop 直传）。
- 令牌保鲜事件（`session:tokens-updated`/`session:request-tokens`）本身平台无关，安卓页面照用；
  差异只在「过线给 daemon」这一跳的通道。

## 4. 改动前检查单

- [ ] 改 SessionContext 发词/发时机 → 确认 guard 页监听方(:529)与探测器(:559-560)的字符串匹配不受影响；
- [ ] 改 localApi 凭据体 → 空串归一化必须在（§2.1）；日志不得落令牌值；
- [ ] 新增令牌消费方 → 先读 Guard 仓 hg-daemon-credential-resync §2 四件套（失效感知/重取路径/退避熔断/恢复重试）；
- [ ] 涉安卓 → 记住安卓凭据走 sessionFd（§3），别把桌面推送语义照搬过去。
- [ ] 动 SessionContext/onSessionExpired 链 → 确认自动重登腿仍在（§5.2）：refresh 再 401 必须有终态出口（autoRelogin），不得退化成无限重试或只清 session。

## 5. refresh 再 401 是终态 → 自动重登腿（2026-09 块 tu14ytyn 复发补强）

gtcy072z 只修了「凭据怎么从窗口推到 daemon」，2026-09-26 同类 401 复发（banner「token refresh after 401 failed」+ 数据面已连接）暴露出它没管的两段。本节锚点行号以 tu14ytyn 工作区实测校准（2026-09-27）。

### 5.1 根因三件套（后端 Huanvae-Chat-Rust；客户端必须把撤销类 401 当终态）

- 同设备重新登录撤销旧 refresh 对：`token_service.rs:69-80`（revoked-reason「设备重新登录」）；
- refresh 成功只回新 access、不轮换 refresh：`refresh_token.rs:44-62`；
- TTL 900s / 604800s：`config.rs:55-56`。

病理链：同机重登 → 旧对被撤 → App 内存 session 与 daemon 持久凭据里的存量旧对 → access 15min 过期 401 → 拿已撤 refresh 去换再 401 → banner 常驻；已建 WireGuard 数据面不受影响。**「banner 401 + 已连接」= 通道级断链**，别误判成全链鉴权死，也别只消 banner。

### 5.2 自愈链四段（App 侧）

1. **自动重登腿**：`src/services/autoRelogin.ts`——`pickAccountForSession`(:50, 纯函数可单测) + `performAutoRelogin`(:79)：用已存账号+密码走与手动登录同一条 `login(...macAddress)`，不另造鉴权路径；
2. **挂接与防重入**：SessionContext `onSessionExpired` 动态 import autoRelogin（注释锚「401→refresh→再401 的『自动重登腿』」，SessionContext.tsx:194 起），in-flight ref 防重入，失败回退 clearSession；
3. **续期即推送（双写陷阱）**：登录(:84)与 updateTokens(:163) 都挂 `pushGuardCredentials`(:58)——App 内存 session 与 daemon 持久凭据是两份存量，续期后必须同步推，否则 daemon 永远拿旧对；
4. **推送门控/404 语义**：`daemonCredentialSync.ts` `shouldSyncToDaemon`(:48, isMobilePlatform 直接 false) / `syncToDaemon`(:60)；404 → `localApi.credentialsEndpointMissing`(:210) 结构化错误 → HuanvaeGuardPage.tsx:332-336 给「升级守护进程」可执行指引，不静默消 banner。

**撤销类 401 不是可重试错误**：refresh 也 401 时无限重试只会把 banner 焊死（实测 5 分钟打到 daemon CONTROL_FETCH_EXHAUSTED），唯一出路是重登腿换全新对。

### 5.3 排障法：装机二进制 ≠ 仓库 HEAD

排查「上次修复为什么没拦住」，第一假设是装机版本旧而非修复设计缺陷。用**日志形态分界线**验证：本例旧 daemon 时段日志只有 401 死循环，换装 acfb104 构建后才出现 `refresh circuit open: … waiting for the frontend to push a fresh one` 与 `API_CREDENTIALS_UPDATE_*` 处理——修复代码在仓但没进装机。

回归单测：`tests/unit/huanvaeGuard.autoRelogin.test.ts`（7 用例）、`tests/unit/huanvaeGuard.daemonCredentialSync.test.ts`（8 用例）。

## 相关

- daemon 半边（熔断退避表/ControlHandle 所有权/宣告归属/实测验收清单）：Guard 仓
  `.claude/skills/hg-daemon-credential-resync/SKILL.md`。
- 回归单测（App 侧）：`tests/unit/huanvaeGuard.localApi.test.ts:234` 起 updateControlCredentials 四用例；自动重登/凭据同步链：`tests/unit/huanvaeGuard.autoRelogin.test.ts`、`tests/unit/huanvaeGuard.daemonCredentialSync.test.ts`（§5.2）。
