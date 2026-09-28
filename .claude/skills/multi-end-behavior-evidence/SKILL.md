---
name: multi-end-behavior-evidence
description: 验收卡「某端/某场景行为保持不变」条款的各端取证配方 — 端清单纪律（每个"不变"条款=独立举证义务，缺一端即被打穿，前块 1790415150715-ddi1xqmy-1 因此 10 轮预算耗尽）、两条合规举证路径（实测截屏+载荷捕获 / 零触碰 diff+点名原因，禁一句文字断言）、Linux 桌面（Tauri+DBus org.freedesktop.Notifications）通知冒烟实测全配方（Xvfb 24-bit+Mesa EGL override、独立 dbus-daemon、捕获守护+dbus-monitor 双通道交叉配对三要素、dbus-monitor match-rule 语法坑、时区 TZ 陷阱）、验收文书自包含三要素归拢格式（命令+退出码+输出原文 / 截图绝对路径 / sha256 快照锚）与实测时点锚（构建退出码+壳哈希+dist 特征）。凡是"行为不变"验收、要在 Linux 桌面端实测通知、或要把多端证据归拢成自包含文书，先读本 skill。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# 多端行为不变取证 + Linux 桌面通知冒烟 + 验收文书三要素归拢

> 来源：块 `1790474419124-hm3ckupv-1-补桌面端通知实测证据并归拢验收文书`（2026-09-27，review 第3轮 PASS）。
> 该块承接的前块 `1790415150715-ddi1xqmy-1` 因 C1 明文「桌面端不带渠道的行为保持不变」无任何桌面端证据，
> review 10 轮整改预算耗尽被打穿——本文即补此缺口。处理前 `.claude` 全树查重：
> `org.freedesktop.Notifications`/`dbus-monitor`/`notify-send` 在 skills+CLAUDE.md 零命中；
> 「各端取证」仅 forward-echo-e2e:203（跨端实现复用，非验收取证）与 pending-badge-sync（角标链路）相邻，
> 均不构成覆盖。

## 触发场景（命中任一条，先读本 skill）

- 验收卡出现「XX 端 / XX 场景**行为保持不变**」「不带 XX 的行为与改动前一致」类条款；
- 要在 **Linux 桌面端**（Tauri/electron 壳）真实触发并捕获系统通知做实测证据；
- 要把多端证据（截图/logcat/门禁输出）归拢成**复核者可独立复算**的验收文书。

## §1 端清单纪律：每个「不变」条款都是独立举证义务

**事故模式**：实现者注意力集中在「新增行为」（深链跳转），「不变行为」直觉上被当成
"我没改所以它没变"——但验收方无法从「没改」推断「没变」。前块移动端三场景全过、桌面端零证据，
整块打穿，10 轮预算烧光后换写法重派。**规则：拿到验收卡第一步盘端清单，每个"行为不变"条款
逐端列一条举证义务，缺一端按必被打穿处理，提前补。**

两条合规举证路径（可双保险，本块实测两条都做满、review 抽查全过）：

1. **实测路径（首选，证明"行为没变"）**：真实启动该端 → 触发通知 → 截屏 + 载荷捕获（§2 配方）。
   载荷要证明的点：无渠道字段、无深链字段、结构与改动前一致（如 DBus 八元组 `hints={} actions=[]`）。
2. **零触碰路径（替代/兜底，证明"结构没碰"）**：证明改动文件集合对该端通知代码路径零触碰。
   必须 (a) 点名写清不适用原因；(b) 每条给「命令+退出码+输出原文」。**禁一句文字断言**。
   标准证据组合：
   - 词表枚举改动集合：`git status --short | grep -iE 'notif|deeplink'` **加内容特征词表**
     （含"调用点"形态，如 `grep -lE 'deepLink|DeepLink|resizeableActivity|notifyNewMessage'`——
     🔴 词表只枚举定义处会漏调用方文件，本块 wsHandlers.ts 即因此被 review 点名，升级词表后逐一归类）；
   - 命中文件**逐一归类表**（归属本改动 / 归属他块+依据），不归属的保留披露；
   - commit 层：`git diff <基线rev> HEAD --stat -- <全集文件>` 空输出；untracked 文件 `git log -- <file>` 空；
   - 工作树层：M 文件 diff 基线落盘（`git diff -- <file> > evidence/.../xx.diff`），复核循环比对 5/5 MATCH；
   - 归属争议文件用 blame 硬锚：`git blame HEAD -L <行区间>` 证明调用块最后修改自历史提交、不在任何 hunk。

## §2 Linux 桌面（Tauri+DBus）通知冒烟实测配方

桌面通知本体是 DBus 总线调用（`org.freedesktop.Notifications.Notify`），截屏只能证明"有横幅"，
**载荷参数（渠道/深链有无）必须抓总线报文**。双通道交叉印证：

- **通道A 捕获守护**：自建 python 守护认领 `org.freedesktop.Notifications`，把每次 Notify 参数
  （app_name/summary/body/hints/actions…）落 JSONL，并用 xmessage 可视化（横幅入截屏）。
- **通道B dbus-monitor 旁听**：原始报文独立留档。
  🔴 **match-rule 语法坑**：`dbus-monitor "type=session"` 是无效写法（报错不采集）；直接无参启动
  默认监听全部 session 消息即可。失败尝试的错误原文留在日志里如实披露，不删。
- **配对三要素（机械复核，禁目测）**：body 一致 + 时间一致（`date -u -d @<dbus-monitor epoch>` 换算
  后与 JSONL `ts_utc` 相等）+ 序号一致（dbus-monitor `method return … uint32 N` 的 N == JSONL 的 `n`）。
  本块曾目测错配 n=6，机械复算勘误为 n=7——配对结论必须跑得出三要素。

**环境配方与坑**（宿主无桌面会话时）：

```
Xvfb :99 -screen 0 1920x1080x24        # 🔴 必须 24-bit：8-bit 下 WebKitGTK 全黑不可用
# 24-bit 仍崩（宿主 NVIDIA EGL）：加 __EGL_VENDOR_LIBRARY_FILENAMES=…/glvnd/egl_vendor.d/50_mesa.json
dbus-daemon --session --address=unix:path=/tmp/<bus> --fork --print-address   # 独立总线，别混宿主
DBUS_SESSION_BUS_ADDRESS=… DISPLAY=:99 <壳> &                                  # 壳 + xdotool 驱动 UI 登录
```

🔴 **时区陷阱**：守护里 `time.localtime()` 生成的时间戳依赖**采集会话 TZ**（CI/无人值守常为 UTC），
`ts_cst` 会与 `ts_utc` 相同、无判别力。时间锚一律用 dbus-monitor 报文自带的 epoch +
`date -u -d @<epoch>` / `TZ=Asia/Shanghai date -d @<epoch>` 换算，不信任 localtime 字段。

**生产链路造通知**：双账号夹具（注册→好友请求→approve→发消息）走生产 API，比本地 mock 可信；
App 日志（`[Command] set_current_user 成功`、会话锁行）与捕获 JSONL 时间线互证。

**时点锚（证明"实测跑的是当前受审代码"）**：构建退出码（如 REBUILD_EXIT=0）+ 壳 sha256 + mtime +
嵌入 dist 特征（`grep -l <业务标识> dist/assets/*.js` + 该文件 sha256）。有质疑时直接用当前工作区
重建重跑一轮，比解释跨时点一致性便宜。**证据完整性**：落 `sha256-*.txt` 快照，复核用
`diff <(sha256sum <文件列表> | sort) <(sort evidence/sha256-*.txt)` 空输出复算。

## §3 验收文书自包含三要素归拢格式

「记录于会话」＝无证据。每条证据必须自包含，形态三选一：

1. **命令类**：代码块内 `CMD: <命令原文>` + `<输出原文>` + `EXIT=<n>` 三行俱全；
2. **截图类**：绝对路径 + 场景说明 + 对应日志文件路径（如截图 ↔ logcat 一一对应表）；
3. **哈希锚类**：证据文件 sha256 快照文件路径，任何人可复算完整性。

归拢章节模板（本块实际使用、review 一轮通过）：

```
## 二、验收文书归拢
2.1 截图类：| 截图绝对路径 | 场景说明 | 对应 logcat |  （逐张，不省略）
2.2 日志类：tag + 关键行原文摘录直接内嵌（"见某文件"不能代替关键行）
2.3 门禁类：| 门禁 | 日志绝对路径 | 命令 | 退出码 | 输出原文/尾段 |
零代码改动时门禁可引用前块结果，但必须注明来源路径与采集时间。
另加一章「集合闭合与零擅改证明」：git status 计数 + 枚举归类表 + commit 层 diff 空 + 工作树基线哈希。
```

**交付后漂移防御**：交付定稿后构建产物可能被工作区并发活动重建（本块 debug 壳即被重建、哈希漂移）。
证据自锚（快照哈希+实测时点壳哈希）使链条不受影响；交付里如实披露漂移属非违规观察项，
并给出复跑命令（§2 时点锚）让复核者可重建。

## §4 快速核查单（交付前自查）

- [ ] 每个"行为不变"条款都有对应端的证据行？
- [ ] 实测类：截图原件路径+场景说明在文书里？载荷参数（渠道/深链有无）有总线级报文而非只有截屏？
- [ ] 双通道配对跑过三要素机械复核？
- [ ] 零触碰类：不适用原因点名 + 每条命令三要素 + 词表覆盖调用点形态？
- [ ] 全部核验声称带 `verify:` 命令原文+退出码+输出原文，无裸声称？
- [ ] 时点锚三件套（构建退出码/壳哈希+mtime/dist 特征）齐全？
