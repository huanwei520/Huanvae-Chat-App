---
name: android-keepalive-notify
description: 安卓端「后台常驻收消息 / 通知点击跳会话 / 小窗支持」三件套查验与改造配方 — 病根图谱（消息与通知全活在 WebView JS、退后台 WryActivity.onPause 停定时器致 WS 约 90s 判死且无人重连、厂商推送通道 App 端与服务端双侧零接入）、六厂商推送通道（HMS/MiPush/OPPO/vivo/荣耀/FCM）双端零接查证命令模板（点名关键词+假阳性甄别+扫描范围计数）、保活方案选型（FGS dataSync Android14+ 6h 配额需 WorkManager 接力、自启动/电池白名单引导、通知深链 tauri-plugin-notification extras 硬约束须自研插件、冷/热启动双路径、仓内 getPendingApkInstall 先例）、小窗（resizeableActivity 在 API24+ 缺省即 true 的「manifest 没写≠不支持」陷阱、PiP 需显式声明、小窗下 WebView 照样 onPause 须与保活联动）。要把 App 做成国产 ROM 杀后台也能收消息、点通知跳对应会话、或支持小米/华为小窗，先读本 skill 再动手。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# 安卓保活收消息 / 通知深链 / 小窗：查验与改造配方

> 来源：块 `1790367135164-2mnf7rct-2-查安卓常驻通知跳转小窗出方案`（2026-09-25，只读查验+出方案，
> code/review 层判官均一轮 PASS）。处理前 `.claude` 全树查重：厂商推送通道 / 通知深链 PendingIntent /
> 小窗 resizeableActivity 三组关键词零命中（`android-screenshare-e2e` 仅 FGS 插件工程手法相邻、
> `tauri-multi-window` 系桌面 WebviewWindow 域不同，均不构成覆盖），本文即补此缺口。
> 锚点时点：2026-09-25 快照，行号以现场重锚为准。

## 触发场景（命中任一条，先读本 skill）

- 要求「国产 ROM 杀后台也能收到消息」「常驻后台」「离线推送」；
- 要求「点通知栏消息跳转到对应会话/页面」；
- 要求「支持小窗/自由窗口/画中画」；
- 排查「退后台一会儿就收不到消息/通知」「后台被杀后消息丢失」。

## §1 病根图谱（三条已坐实，改造前先对图定位）

1. **通知产生于 WebView JS，进程死 = 通知断**。链路：WS 推送 → `src/contexts/wsHandlers.ts:690`
   `notifyNewMessage` → `src/services/notificationService.ts:400` `notify()`。原生层零消息通道，
   进程被杀后无任何补发路径。
2. **退后台 ≈ 90s 后连接死且无人重连**。生成物
   `src-tauri/gen/android/app/src/main/java/.../generated/WryActivity.kt:132-137`
   `onPause()` → `mWebView.onPause()` 暂停 JS 定时器 → 25s 应用层心跳停发
   （`src/contexts/WebSocketContext.tsx:120` PING_INTERVAL）→ Rust 层 90s idle 判死回收
   （`WebSocketContext.tsx:176` WS_IDLE_TIMEOUT_SECS）→ JS 不在跑、重连逻辑（:111,116-118 指数退避）
   也停在 WebView 里 → 直到用户回前台 `visibilitychange`（:934）才重建。前台内保活再完善，
   全部依赖 WebView 定时器 = 退后台全失效，这是总病根。
3. **六厂商推送通道 App 端与服务端双侧零接入**（查证配方见 §2）。即使做了前台服务，
   MIUI/HarmonyOS/ColorOS/OriginOS 的一刀切杀后台仍会杀进程；进程死也能送达的唯一正道是厂商通道，
   而服务端（/work/Huanvae-Chat-Rust）也没有任何推送网关——病根是全链路的。

## §2 六厂商通道「未接」查证配方（可复跑，双端）

**判定纪律**：厂商专名零命中才算「未接」；泛词（push）命中必须抽样甄别定性；
子串假阳性必须逐行点名（`getui` ⊂ `getUint32/getUint16` 是惯犯）。

```
# App 端四面（manifest + gradle + Cargo.toml）+ src 面，14 关键词逐词计数：
cd /work/Huanvae-Chat-App
FILES="src-tauri/gen/android/app/src/main/AndroidManifest.xml src-tauri/gen/android/app/build.gradle.kts src-tauri/gen/android/build.gradle.kts src-tauri/Cargo.toml"
for kw in hms HmsMessageService agconnect MiPush xiaomi.push heytap com.vivo hihonor fcm firebase google-services getui jpush umeng; do
  c1=$(grep -rniE "$kw" $FILES 2>/dev/null | wc -l); c2=$(grep -rniE "$kw" src/ --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l)
  echo "kw=$kw config=$c1 src=$c2"
done
# 2026-09-25 实测：14 词中 13 词双面全 0；仅 getui src=12 且全为 frameChannel.ts 的
# getUint32/getUint16/getUint8 DataView 方法子串假阳性（逐行核对方法名即可甄别）。

# 服务端仓（后端一侧必须同样扫，结论才可写「双侧未接」）：
cd /work/Huanvae-Chat-Rust
for kw in hms mipush xiaomi heytap vivo hihonor fcm firebase jpush getui umeng push; do
  echo "kw=$kw hits=$(grep -rniE "$kw" src/ Cargo.toml 2>/dev/null | wc -l)"
done
# 2026-09-25 实测：11 个厂商/SDK 专名全 0；泛词 push=271 抽样甄别全为 Vec::push/
# agent_push 总线/nginx_routes.push 等业务用语；src/huanvaeguard/services/notification.rs
# 头注释自证是「WS 事件推送辅助」（用户端 WS + Agent broadcast），非厂商通道。
```

**覆盖面与上界声明模板**：结论「六厂商全部未接」是**点名非穷举**——点名=上表 14（App）+12（后端）
关键词、扫描范围=App 端 4 配置文件+448 个 ts/tsx、后端 446 个 rs+Cargo.toml；未纳入同类=
魅族 Flyme Push、三星 Push 等小众通道（卡面 mandate 仅点名六厂商，份额低故不纳，方法同模板可扩展）。
**接入门槛速记**：六通道全部要求企业主体+应用市场上架（MiPush 强制上架小米商店；FCM 国内无 GMS
基本不可用）——上架决策未定时只能试点 1~2 家，建议 HMS→小米顺序。

## §3 保活方案选型（组合拳，非单选）

- **FGS + 常驻通知（主力，工作量大）**：自研 tauri 插件声明 `foregroundServiceType="dataSync"`
  （仓内先例：`tauri-plugin-hg-guard` specialUse、`tauri-plugin-screen-capture` mediaProjection，
  manifest-merger 模式照抄；插件工程手法另见 `android-screenshare-e2e` skill）。Rust 侧在 FGS 里
  维持 ws_proxy 连接，绕开 WebView 暂停。⚠ Android 14+ 对 dataSync 型 FGS 有 **6 小时/天配额**，
  超时强制 onTimeout——必须设计「到期降级 WorkManager 轮询」接力，不是二选一。
- **WorkManager 兜底轮询（保底，中）**：进程被杀后周期唤醒拉 `/api/messages/sync` 增量
  （`src/services/syncService.ts:285-310` last_seq 增量可复用），有新消息发通知后退出；
  受 15 分钟下限与 Doze 约束，延迟分钟级但不依赖任何厂商资质。
- **自启动/电池白名单引导页（前置增益，小~中）**：`Build.MANUFACTURER` 分发跳 ROM 自启动管理页 +
  `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`；跳转 intent 多为非公开 API，逐机型 try-catch
  降级到设置首页。零后端成本显著降被杀概率。
- **落地顺序建议**：引导页+通知深链（用户可感知）→ FGS+小窗适配 → 厂商通道分期。

## §4 通知点击跳对应会话（深链三路径）

**硬约束（先记住再设计）**：tauri-plugin-notification 2.3.3 的 JS API `sendNotification`
不透传自定义 extras 到 contentIntent——插件安卓侧 `TauriNotificationManager.kt` buildIntent
只 `putExtra(NOTIFICATION_INTENT_KEY, notification.id)`（仅通知 id）。业务代码里给
`sendNotification` 加参数（`src/services/notificationService.ts:244-249` 现状只传
title/body/channelId）**到不了安卓 intent**，必须自研小插件子类化 `TauriNotificationManager`
加 `putExtra("conversation_id",…)`，或迁 Rust `NotificationExt` builder
（仓内先例 `src-tauri/src/android_update.rs:929-942`）。

- **热启动**：插件点击时发 `actionPerformed` 事件（`NotificationPlugin.kt:119-132`）——
  前端现状**零监听**（这是「点了只回首页」的直接原因）→ `listen('actionPerformed')` 解析
  conversationId → 调 `page.handleSelectTarget(); nav.enterChat()`（导航是纯 React state，
  `src/hooks/useMobileNavigation.ts:23,47` + `src/pages/mobile/MobileMain.tsx:177-181`，无路由库）。
- **冷启动**：intent 在 onCreate 到达时 WebView 未就绪——仿仓内 `getPendingApkInstall` 先例
  （`android_update.rs:956-960` 注释「前端在冷启动、以及每次重回前台时调用它恢复状态」）：
  插件落 intent extra 到插件状态，前端首帧后主动拉取消费。不与热启动同做则冷启动点击仍落首页。
- **通用 scheme 深链**（`huanvae://chat/<type>/<id>` + intent-filter）：一次投入外链/快捷方式
  长期复用，注意 `launchMode="singleTask"` 下 onNewIntent 与冷启动双路径都要处理 + 参数合法性校验。
- 时序坑：跳会话前确保该会话数据可渲染（sessionPersist 恢复 → WS 连接 → 数据就绪），
  否则先跳列表再定位。

## §5 小窗（自由窗口/画中画）

- **「manifest 没写 ≠ 不支持」陷阱**：`resizeableActivity` 在 API 24+ **缺省即 true**——
  manifest 里搜不到不能下「不支持小窗」结论，必须结合 targetSdk 缺省行为判定（本仓
  targetSdk=36：框架层已可用）。正确做法是**显式补声明钉死行为**（防未来 targetSdk 变化），
  真正缺的是小尺寸（~600dp 宽以下）逐页布局适配，需真机小窗实测列断点清单。
- **PiP 须显式声明**：`android:supportsPictureInPicture="true"` + 会议页
  `enterPictureInPictureMode`（Android 12+ 用 `setAutoEnterEnabled`），与仓内
  meetingMinimized 浮窗（MobileMain.tsx:136-137）体验互补。
- **小窗 × 保活联动**：小窗/freeform 下窗口可见但 `onPause` 语义与全屏一致，WebView 照样被
  暂停（§1 病根 2）→ 不做 §3 联动，小窗会「界面在、消息不来」。
- 厂商小窗（小米自由窗口/华为智慧多窗）本质都是系统级 freeform，App 侧无厂商专属 API 要接；
  `singleTask` 已防多实例。

## §6 查验交付口径备忘（本块实证）

- 集合结论（「全部未接」类）必须：点名关键词全集 + 可复跑命令原文 + 逐词精确计数 +
  假阳性逐行甄别 + 扫描范围计数 + 上界声明（哪些同类未纳、为何）——「14~15 个关键词」式
  区间表述会被判「计数不确定」。
- 第三方插件的真实现去 `~/.cargo/registry` 读源码，业务仓里查不到；「manifest 没写」类负面
  结论先查平台缺省行为再下笔。
- 遗留真机验证项：国产 ROM 对 FGS+常驻通知的存活时长；小窗逐页断点清单；「小窗挂着+点通知跳会话」联动回归。
