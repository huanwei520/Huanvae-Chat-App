---
name: android-screenshare-e2e
description: 安卓屏幕共享（Tauri 自研 MediaProjection 插件 → canvas captureStream → 会议 WebRTC）实现与实测配方 — 插件三件套接线图（Plugin.kt 系统授权 startActivityForResult+@ActivityCallback / Service.kt FGS mediaProjection+createVirtualDisplay+ImageReader / Rust commands 面）、桌面 getDisplayMedia 形态四要素与 ternary 分流零回归法、双模拟器 adb 实测流程（screencap -p 帧缓冲 / uiauto 定点授权弹窗 / dumpsys FGS 判据 / pcdump RTP 统计 / logcat 帧计数判据）、三大坑（ImageReader 首帧停滞且自拷贝 dirty 化=假修复、track.stop() 不派发 ended 致原生停止桥成死代码、模拟器渲染器回收）、停止释放三判据与内容变更标记测试两条硬验收。要对安卓屏幕共享/原生采集/Tauri 安卓插件做开发或实测复核，先读本 skill 再动手。
disable-model-invocation: false
allowed-tools: Read, Grep, Glob, Bash, Write
---

# 安卓屏幕共享（MediaProjection→WebRTC）实现与 E2E 实测

> 来源：块 `1789015782517-2-安卓屏幕共享对齐桌面实测` update 层沉淀（2026-09-10）。
> 过程：code 层 7 轮交付（r6 完成正式验收、r7 补证）；review 层实测新发现 2 项实质缺陷
> （首帧停滞假实时 + 停止不释放），两项截至沉淀时**均未修复**，本 skill 固化正反两面经验。
> 上游证据：`/work/huanvae-android-screenshare-e2e-1789015782517/`（84 文件）与
> `/work/huanvae-android-screenshare-review-verify-1789015782517/`（16 文件，含 R06/R07 标记测试铁证）。
> 仓库：/work/Huanvae-Chat-App。下述 file:line 为 2026-09-10 代码快照实测值，改码后必须重查。

## 触发场景（命中任一条，先读本 skill）

- 安卓端做屏幕共享/录屏/原生采集（MediaProjection / VirtualDisplay / ImageReader）；
- 给 Tauri 写 Android 侧自研插件：系统授权回调、前台服务、帧数据经 Channel 下行到 JS；
- 要主张或复核「安卓共享画面**对端实时**可见」「停止共享后系统态已归零」类结论；
- 双模拟器 adb E2E：系统授权弹窗自动点击、RTP 统计取证、FGS/虚拟显示判据。

## §1 架构接线图（谁调谁，file:line 实测）

```
JS 发起  useWebRTC.ts:1426 ternary — isAndroidScreenShareSupported() ?
           true  → startAndroidScreenShare()  (androidScreenShare.ts:129)
           false → navigator.mediaDevices.getDisplayMedia(...)   ← 桌面原路径零改动
JS 桥    androidScreenShare.ts: invoke("plugin:screen-capture|capture_start")
           + tauri Channel 下行 JPEG Base64 帧 → 绘入 canvas → captureStream(0)
Rust 面  src-tauri/tauri-plugin-screen-capture/src/commands.rs:44 "captureStart"
           → lib.rs JNI → PluginHandle.run_mobile_plugin
Kotlin   ScreenCapturePlugin.kt:50 captureStart
           :62 mgr.createScreenCaptureIntent()
           :64 startActivityForResult(invoke, consentIntent, "captureConsentResult")
           :68-69 @ActivityCallback captureConsentResult（授权后 :104 startForegroundService）
           :116 captureStop（ACTION_STOP → 服务统一收尾）
服务     ScreenCaptureService.kt:169 startForeground(…TYPE_MEDIA_PROJECTION)
           :193 projection.createVirtualDisplay + ImageReader(RGBA_8888)
           :220-221 帧日志策略 frameCount==1 || %30==0（logcat 判据锚点）
           :337 stopForeground(STOP_FOREGROUND_REMOVE) / :341 stopSelf（收尾链）
注入     useWebRTC.ts:1442 screenStreamRef → addScreenTransceiver → 对端同桌面链路渲染
```

注册三处（缺一即插件不生效）：`src-tauri/Cargo.toml`（path 依赖）、
`src-tauri/src/lib.rs:862` `.plugin(tauri_plugin_screen_capture::init())`（Android cfg 段内）、
`src-tauri/capabilities/android.json:22` `"screen-capture:default"`。

## §2 MediaProjection 接入法要点

1. **授权流**：Tauri 移动插件框架的 `startForResult(invoke, intent, callbackName)` +
   `@ActivityCallback` 是唯一正解——授权 Intent 必须由 Activity 发起，插件暂存启动参数
   （Plugin.kt:37 注释：框架回调无法携带闭包状态），授权回调里再 `startForegroundService`。
   用户可拒绝：回调 `authorized:false` → JS 侧 reject `screen_capture_denied`（androidScreenShare.ts:273-277）。
2. **Android 14 硬要求**：Manifest 声明 `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PROJECTION`
   + `POST_NOTIFICATIONS`，service 标签 `android:foregroundServiceType="mediaProjection"`、
   `exported="false"`（仅应用内 startForegroundService 可触达）。漏 type 声明直接 crash。
3. **startForeground 时序**：早期构建曾因 Handler/getMainLooper null 在服务构造期 NPE
   FATAL（logcat 06:05 两次，r1-r3 时代，后已修）——FGS 必须 onStartCommand 里第一时间
   startForeground，且 `getMediaProjection` 前置条件是「startForeground 就绪」（Plugin.kt:26 注释）。
4. **帧下行**：createVirtualDisplay 的 surface 给 ImageReader(RGBA_8888)，按 fps 节流取
   Image → JPEG Base64 → tauri Channel。**注意 ImageReader 行序自底向上**：A 端自预览
   出现上下颠倒属管线固有瑕疵，可作「帧为真实采集非伪造」的佐证（review 用过此判据）。
5. **一次性授权凭据**：resultData 只在本次 projection 生命周期有效；服务被杀即授权作废，
   恢复共享必须重走系统弹窗，不要试图缓存 resultData。

## §3 桌面形态对齐要点（零回归三原则）

桌面形态四要素：控制条「共享」按钮（`toggleScreenShare`）→ `getDisplayMedia`；
共享中瓦片绿框+「屏幕共享」徽标（`media_state.screen`/`screenStream`）；再点停止
（`stopScreenShareInternal`，useWebRTC.ts:1381）；对端走同一 screen transceiver 渲染。

- **分流不做抽象**：useWebRTC.ts:1426-1441 用一个 ternary 包裹取流，安卓分支钳制
  `min(width,1280) x min(height,720), fps≤10`（帧经 IPC Base64，带宽理由），桌面 else
  分支保持原 getDisplayMedia 代码语义零变化。其余链路（transceiver/media_state/onended/
  对端渲染）桌面移动共用不分叉。抽象成策略接口反而扩大桌面回归面。
- **UI 同构**：MobileMeetingPage.tsx:596-599 按钮（共享中切「停止共享」+sharing 态样式）、
  :209 瓦片徽标、:710-742 发起前敏感内容确认弹窗（合规要求：告知整屏含通知等敏感信息）。
- **红线自查法**：主张「桌面零回归」必须 git diff 逐 hunk 归属（本任务 vs 在飞任务），
  「该文件唯一改动是 X」这类表述必须与 diff 完全对得上，否则判官按失实打回。

## §4 双模拟器实测流程（配方）

- 拓扑：emulator-5556=共享端 A、emulator-5600=观看端 B；会议服务 + TURN/TCP relay；
  房间号密码存 0600 文件，交付文内 `****` redact，**另查所有 cmdout/json 副本权限**
  （本次 `.meeting_r6.cmdout` 0644 泄明文，是 review 新发现的破损点）。
- 取图：`adb -s <dev> exec-out screencap -p > file`（二进制安全帧缓冲），PNG 应等于
  `wm size` 原生分辨率（1080x2400）——可排除「桌面窗口拉窄」类伪证据。
- APK 溯源闭合：本地构建 APK `sha256sum` 与 `adb shell pm path <pkg>` 取到的 base.apk
  比对同值，才可主张「双机跑的就是受测包」（本次 build11 `3db6e6a7…` 双机同值）。
- E2E 时序坑：`join` 偶发 `NO_MEETING_ITEM`（抽屉懒加载未就绪）→ 重试/重启 App 必现可解；
  统计探针（pcdump）要先装再入会（渲染器回收致 SPA 重载后，探针与会议状态时序互扰会取空）；
  A 端 pcdump 可能 `n=0`（移动端会议文档与主文档分离）——发送侧缺数时以 B 端**接收侧**
  统计为准（frames/bytes 双端对账）。
- 系统授权弹窗自动化：`uiautomator dump` 找 `Start now` 节点坐标再 `input tap`
  （弹窗文字随系统语言/版本变，按节点文本定位而非死坐标）。
- 共享中判据（四件套，缺一不可）：
  1. A 端 pcdump：`senders:[{kind:video,muted:false,state:live}] st.out={frames,fps}`;
  2. B 端 pcdump：`receivers:[...muted:false] st.in={frames}`;
  3. dumpsys FGS：`dumpsys activity services <pkg>` → `isForeground=true types=00000020`(mediaProjection);
  4. logcat：`frame #N ... emitted`（Kotlin :220-221 只在 #1 与 %30 打点）。
- 停止判据：B 端 receiver muted=true + **释放三判据**（dumpsys 无 ScreenCaptureService、
  logcat `Display device removed ... hg-screen-share`、状态栏投屏图标消失）。
- **内容变更标记测试（假实时照妖镜，必做）**：共享中把 A 按 HOME 切到 launcher，等 N 秒
  截 B 端——若 B 瓦片仍是开场画面即首帧停滞（R06/R07 铁证，9/9 会话复现）。
  RTP 流动+帧数增长**不能**证明内容实时：同帧重编码也能刷帧数。
- logcat 判定窗口纪律：全天 logcat 与验收窗口分开 grep（FATAL/ANR/tombstone），
  窗口外的历史崩溃也要如实披露并注明构建代次，原件入证据目录（18MB 也留）。

## §5 三大坑（截至沉淀日均未真修，接手先看 §7）

1. **ImageReader/VirtualDisplay 首帧停滞**：MediaProjection 仅在屏幕**内容变化**时产帧，
   静屏零帧 → 9/9 会话 logcat 只有 `frame #1`，23s 会话从未到 %30 打点。
   r6 的「修复」（androidScreenShare.ts:172-183 帧泵每拍 `ctx.drawImage(canvas,0,0)`
   自拷贝 dirty 化再 `requestFrame()`，自拷贝行 :175）**已被 review 证伪为假修复**：
   它让编码器持续重发同一张画布（fps=10-11、约 360B/帧），造就「RTP 在流动」假象，
   内容从未更新。切勿再把它当成功案例引用。真修方向：改可持续出帧的采集路径
   （Surface 侧重挂载 / ImageWriter 侧泵），并以 §4 标记测试为硬验收。
2. **track.stop() 不派发 ended → 原生停止桥是死代码**：桥只注册了
   `track.addEventListener('ended', () => invoke(CMD.stop))`（androidScreenShare.ts:291-293），
   而 JS 侧 stop() 触发 readyState=ended 但**不派发 ended 事件**（WebRTC spec 行为）；
   `stopScreenShareInternal`（useWebRTC.ts:1381-1414）只 `track.stop()`（:1388），
   `stopAndroidScreenShare()`（androidScreenShare.ts:318）全仓 grep **零生产调用方**
   （仅测试文件引用）→ captureStop 永不执行，Kotlin 完整释放链（:337/:341）走不到：
   虚拟显示驻留实测最长 37 分钟、状态栏投屏图标残留。修法：停止链显式调用
   stopAndroidScreenShare()，不得依赖 onended。
3. **模拟器渲染器回收**：共享 ~22s 后 WebView 渲染器进程被系统回收（logcat 可见渲染器
   重启 + Gralloc4 重初始化），SPA 重载回主页，但 Android 主进程与 FGS 存活。
   定性为模拟器资源压力环境抖动；长时间共享应降解码垃圾（ImageBitmap/OffscreenCanvas）。

## §6 取证工具坑

- **gitignore-aware 检索会漏证据文件**：总仓 /work/.gitignore 全局 `*.log`（各子仓还有
  `logs` 规则），`find/grep` 类尊重 gitignore 的工具清点证据目录时会静默漏掉全部 .log
  （本次初查 84 文件只见到 65）。清点/取证一律 `ls -R` 直读或禁用 ignore。
- **零命中结论的举证标准**：「XXX 无调用方」必须给：穷举搜索命令原文 + 覆盖面界定
  （搜了哪些根、排除了哪些路径及为何不影响结论）+ 零命中真实输出 + 未覆盖格自报。
  「本会话已复核」一句自陈不构成证据。
- **时间线与哈希对账口径**：日志/交付时刻一律 `UTC|CST(+0800)` 双标（例
  `2026-09-10T08:31:58Z|16:31:58+0800`），cmdlog 步骤时刻 ↔ 截图 mtime ↔ logcat 才有
  统一坐标系；同哈希≠伪造——静屏/同分钟双机截图字节级相同可解释（无动画、沉浸式无状态
  栏），判定伪造要靠分辨率/mtime 时间窗/内容逐张判读，哈希只做去重与对账。

## §7 现状与待修清单（2026-09-10 快照，接手必读）

- [ ] 缺陷①首帧停滞：换采集路径，验收=§4 标记测试（B 端 N 秒内见 A 屏新内容）。
- [ ] 缺陷②停止泄漏：useWebRTC stopScreenShareInternal 显式调 stopAndroidScreenShare()，
      验收=§4 停止释放三判据。
- [ ] 凭据收口：删除/chmod 0600 `.meeting_r6.cmdout`，SUMS 重算。
- [ ] 文档债：code/deliverable.md 补 frontmatter、mapping.md（截图→需求→实码）、
      「实时可见」表述按 R06/R07 事实改写、useWebRTC「唯一改动」表述更正（另有 8.2 在飞
      任务两处 hunk）。
- 已成立可依赖的事实：桌面 getDisplayMedia 语义零变化（else 分支原文保留，被 ternary 包裹）；
  全量测试绿——2026-09-10 code 层 08:39:34Z 与 review 层 09:19:56Z 两次独立 `npm run test:run`
  均 Test Files 378 / Tests 4240（review 存档含显式 EXIT=0；存档：e2e 证据目录
  `logs/frontend-tests-full-r7.log`、review 证据目录 `logs-review-tests-full.log`；
  当日快照结论，测试面再变动须重跑）；授权弹窗/敏感提示/FGS 启动链合规且有截屏原件；
  截屏全为真实帧缓冲非占位。
