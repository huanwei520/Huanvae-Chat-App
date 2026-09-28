---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
  - "src-tauri/**/*.rs"
---

# 全软件请求路径 SNI 审计基线 与 directIpUrl/pinned client 改造模式（一页）

> **一句话**：生产 `api.huanvae.cn` 的 SNI 字符串被 ICP 边缘**精确匹配 RST**（同 IP 不带 SNI 握手正常）——
> 通往该源站（及其 MinIO 数据面）的每条请求必须以 **IP 字面量直连（不发 SNI）**，由 6 个既有传输 profile 承载。
> **新增出网路径必须挂靠这 6 个 profile 之一，禁止新建 client 构造。**

- **基线审计**：块 `1789364064792-928444fe-1`（2026-09-14；App `ed6ddfe6` / Guard `4679d9e8` / Remote `80842cc8`，审计零写入）。36 条全路径审计表（file:line+证据列）见该块 `code/deliverable.md` §3；锚点复读在其 `review/evidence/rv-anchors-*.txt`。设计原文：Guard `client/common/src/tls.rs:9-11`（系统信任关＋钉私有 Root CA＋**hostname verification off（连发现 IP、不发 SNI、leaf SAN 占位）**＋mTLS）。

## 1. 何时触发本规则（复审条件）

① 新增任何出网请求路径（fetch / WebSocket / XHR / Tauri invoke 网络命令 / reqwest / tokio-tungstenite / TcpStream）；
② 触碰网络敏感文件：`discovery.ts` / `secureFetch.ts` / `rustWebSocket.ts` / `secureProxy.ts` / `fileCache.ts` / `useAccounts.ts` / `api/client.ts` / `secure_net.rs` / `ws_proxy.rs` / `secure_proxy.rs` / `unified_download.rs` / `android_update.rs` / `updater_download.rs`；Guard 侧 `tls.rs` / `daemon.rs` / `control.rs` / `agent/src/pull/*`；
③ discovery 端点协议或 ICP/边缘策略变化的复审。行号锚点只在基准 SHA 内精确，复审前先对关键锚点 spot-check（HEAD 会前移）。

## 2. 六个传输 profile 白名单（2026-09-14 逐 profile ClientHello 抓包 SNI ABSENT 6/6）

| # | profile | 承载路径 | 构造点（基准 SHA 时） | ClientHello |
|---|---|---|---|---|
| 1 | `secure_net` build_client(pin_ca) | HTTP API/登录刷新/端点探测/guard serverApi | `secure_net.rs:69-102`（`:130` acquire_client 缓存；`:150/:204` 调用） | 236B ABSENT |
| 2 | `secure_http_stream` | AI SSE 流式 | 同 1（`:198` 流式命令） | 236B ABSENT |
| 3 | `ws_proxy` ws_connect | 主 WS/会议信令 WS/AI 语音 WS | `rustWebSocket.ts:120` direct_ip 改写 → `ws_proxy.rs:220` connect_async | 218B ABSENT |
| 4 | `unified_download` | 文件/媒体/头像下载 | `unified_download.rs:195-218`（JS 侧 `directIpUrl` 改写后交 Rust） | 233B ABSENT |
| 5 | `secure_proxy` 出站腿 | webview 显示反代/分片上传/语音配置上传 | `secure_proxy.rs:88-106`（webview↔`127.0.0.1` 明文，回环→源站腿钉 CA） | 233B ABSENT |
| 6 | guard `tls::build_client(EMBEDDED)` | daemon 控制面 WS/HTTP、安卓 control 全链 | Guard `tls.rs:68-77`；master_url 由 App `HuanvaeGuardPage.tsx:628(安卓)/:719(桌面)` 经 `directIpUrl` 下发 IP | 236B ABSENT |

机制只有三种，新路径对号入座：**fetch** 用 `resolveForSecureHttp()` 改写（`api/client.ts` 漏斗）；**WS** 带 `direct_ip/direct_port` 让 `rustWebSocket` 改写；**Rust 直连下载** 用 `directIpUrl(url)`（`discovery.ts`）；webview 自身够不着 Rust 时走 **回环反代**（`proxyRequestUrl`）。

## 3. 三分类判据（36 条全路径审计的结构性结论）

1. **通向 ICP 阻断源站**（api.huanvae.cn 阿里云边缘/其 MinIO）→ 必须 IP 字面量，挂 6 profile。基线实测：15 条逻辑路径全部合规，逐 profile 抓包 SNI ABSENT ＋ 域名负对照 RST。
2. **CF/GH 公共证书面**（`ca.huanvae.cn` 发现面、`store.huanvae.cn` 更新面、github 兜底）→ SNI 发为**owner 豁免**，去 SNI 不可行：CF 边缘按 SNI 路由 zone（直连 IP 无 SNI 无法路由，实测 alert 40），且公共 CA 证书在 IP 直连下主机名校验必败——强行改造直接打断发现/更新面。**不要对这两条域套 directIpUrl。** 豁免依据=owner 09-14 明令原话「请求cloudflare的不需要去掉，也就是cloudflare受豁免其它的请求阿里云服务器的那些需要被去干净」，持久记录=块 1789364064792 `rework-history/7824790e-0d87-4c15-b383-2486aa1964c6/rework-record.json:13`（ac3b0485 同文）；验收口径=CF 面豁免+阿里云源站面去干净。
3. **用户/运维输入目标**（NFC 用户内容 URL、安卓手输 master、hg-agent master_url=CLI 传值）→ 非软件固定路径；guard 侧新出网点保持"**无内置域名默认**"形态（`agent/src/pull/config.rs:18`）。

设计内无 TLS 面（不算 SNI 事项）：回环（localApi 127.0.0.1 / 远控 19290 / 本地媒体 9527 / guard 探活 19198）、LAN 互传（明文，`Client::new()` 仅允许在此）、guard 数据面（noise/UDP）、Remote relay（裸 TCP）。

## 4. 兜底语义（已评估，维持勿改）

`directIpUrl` / `resolveForSecureHttp()` 无 active 端点时**原样返回域名** → ICP 拦截下该次连接 RST。但其可达前提是 discovery 整体失败**且**内置默认 IP 池（`discovery.ts:37-46`）全部不可达＝网络整体不可用态——此时域名直连无论如何不通。维持与既有先例一致的兜底**不构成漏网**（块 1789364064792 code §7 评估、review R8 复核）。

## 5. 复审计最小命令集（在 /work/Huanvae-Chat-App 执行；判 0 命中须 rc=1 且带阳性对照）

```bash
# a) 第三方网络 SDK 应为 0 命中（exit=1）
grep -inE "firebase|socket\.io|signalr|axios|umeng|sentry|mapbox" package.json
# b) api.huanvae.cn 字面量应恰 10 处：注释/文档 6 + discovery.ts:38 domains 配置 + network.ts:21 PUBLIC_DOMAIN（域名移除式兼容，非连接）+ 测试 2
grep -rn "api\.huanvae\.cn" src src-tauri/src --include="*.ts" --include="*.tsx" --include="*.rs"
# c) 6 profile 构造点在位（改了这些文件=触发复审）
grep -n "danger_accept_invalid_hostnames\|add_root_certificate" src-tauri/src/{secure_net,unified_download,secure_proxy}.rs /work/HuanvaeGuard/client/common/src/tls.rs
# d) ICP 三态对照（live，每态判据见输出注释）
openssl s_client -connect 47.105.101.42:443 -servername api.huanvae.cn </dev/null 2>&1 | grep -E "write:errno|subject="   # 带 SNI → 预期 write:errno=104(RST)
openssl s_client -connect 47.105.101.42:443 -noservername </dev/null 2>&1 | grep -E "subject=|issuer="                    # 无 SNI → 预期 CN=Huanvae Edge 握手成功
curl -s https://api.huanvae.cn/health -o /dev/null -w '%{http_code}\n'; echo "rc=$?"                                      # 域名带 SNI → 预期 000/rc=35
curl -s -o /dev/null -w '%{http_code} %{remote_ip}\n' https://ca.huanvae.cn/endpoints                                     # CF 面 → 预期 200（设计内发 SNI）
```

## 6. 已知测量坑

1. `openssl s_client` 握手被 RST 时**仍会打印** `Verify return code: 0 (ok)` 尾行（verify 状态与握手成败独立）——判定握手成败必须看 `write:errno=…` 行与 subject 行有无，禁只 tail 尾 3 行（2026-09-14 复审计实测踩过：首跑 tail 3 行误读"握手成功"，全量输出重跑见 `write:errno=104` 才定性）。
2. **判官复算环境 PATH 不含 rustup 工具链**：本机 cargo 装在 `/root/.cargo/bin`（工具链 `/root/.rustup`），交付里 cargo 类 verify 命令若写裸 `cargo test …`，判官复跑得 exit=127（`cargo: not found`）＝复跑矛盾直接打回（块 1789364064792 code 第 7 轮实测）。命令原文必须带完整前缀，金标准=判官同形态裸外壳：`env -i HOME=/root sh -c 'cd <仓> && PATH="/root/.cargo/bin:$PATH" RUSTUP_HOME=/root/.rustup cargo test …; echo "rc=$?"'`（范式见该块 evidence/E18a-verify-guard-cargo-r8.txt）。

## 7. 探测与取证方法（去 SNI 审计的三个可复用法）

### 7.1 三态对照探测法（判定"拦截是否 SNI 精确匹配"）

同一目标 IP:443 上用 openssl/curl 打三态，两侧形状不同才有判别力：

| 态 | 命令形态 | 预期（ICP 精确匹配型边缘） | 在档实证 |
|---|---|---|---|
| ① 域名 SNI | `openssl s_client -connect <IP>:443 -servername <被拦域名>` | `write:errno=104`（RST） | E9/E10 对照组、code §5.6 |
| ② 无 SNI | `… -noservername` | 握手成功（私有 CA 占位证书 Verify 21 属预期） | E9、E10（ca 面 -noservername=alert 40＝CF 面形状不同） |
| ③ 伪 SNI | `… -servername <其它合法域名>` | 放行＝证明拦截是 SNI 精确匹配而非全网阻断 | **在盘无独立实测**（原诊断存档已随块 3 目录回收）；复用时按同法补测即可，勿引用不存在的实测 |

⚠ 态①②形态差异 + curl 负对照（`curl https://<被拦域名>/…` → rc=35/000）构成最小可复现对照；判定握手成败看 errno/subject 行（见 §6.1）。

### 7.2 设备内 tcpdump + ClientHello 解析取证法（真 App 线级证据）

1. `adb shell tcpdump -i any -w /sdcard/cap.pcap host <源站IP> and port 443` → 制造流量（force-stop 重启/逐条 UI 触发目标功能）→ `adb pull`；
2. 自写极简解析器（pcap+TLS ClientHello server_name 扩展，无外部依赖，范式 code/evidence/E8-pcap-parse.txt、E15-g6-parse.txt）；**判定可 signal**：①每条流记 `时间 源→目的 len=<ClientHello字节> SNI= None/<值>`，字节数可反查 profile（236=secure_http/tls、218=ws_connect、233=download/proxy）；②SNI 是 ClientHello 明文，全文件 ASCII 字节扫描（`huanvae`/`api.` 等）零命中可补单包解析不到的分段盲区；
3. **触发动作与 pcap 文件一一对应**（每条审计行独立 pcap+注释行标明 UI 路径，范式 E15 系列：A8=我的文件→下载、A7=声音管理→上传），防止"覆盖声称超出实际抓到的流"（该块第 4 轮判官打回点）。

### 7.3 directIpUrl 销项模式

见 §2/§3：JS 侧 `directIpUrl()`/`resolveForSecureHttp()`/`direct_ip` 三入口改写主机为源站 IP，Rust 侧挂 6 profile 白名单；guard 双腿由 App 下发 IP（`HuanvaeGuardPage.tsx:628/:719`），agent 侧保持无内置域名默认。兜底语义与 ICP 下行为评估原文=块 code 交付 §7（节号恒定；第 28 派发窗现值 ：3044-:3077，alert 40 计数=3；行号随版本漂移，复读先 grep '^## 7\.'）。

## 8. 相关沉淀索引（updateScope 四项 ↔ 落点）

| updateScope 点名项 | 落点 file:line |
|---|---|
| SNI 审计表可复用基线 | 本文件 §1-§3（:16-:41，行 ID 全集 36+6 profile 白名单）；权威全表=块 code 交付 §3 |
| directIpUrl/pinned client 跨仓改造模式 | 本文件 §2/§3 + §7.3（:88）；Guard 侧同构=原 Guard 仓 `.claude/rules/huanvaeguard.md:332`（2026-09-22 起 gen191/193 后续块重写该文件后未随迁，现版无 SNI 节，正典=本文件） |
| ICP 拦截下域名兜底行为评估 | 本文件 §4（:43）；评估原文=块 code 交付 §7（v15·:618-:650；节号恒定，行号随版本漂移） |
| 串行窗口门控规程 | App 仓 `.claude/rules/common.md:2637-2644`（第 4 条=门控五件套证据链+调度器改进建议） |
| 本块处置史 | App 仓 `.claude/CLAUDE.md:663-:691`（十五条 复发备案） |
