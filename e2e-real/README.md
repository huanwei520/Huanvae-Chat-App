# e2e-real

> ⚠️ **层级声明（9/6 huanwei 明令）**：本目录是 **L2.5-web**（真前端浏览器渲染 + 真集群 HTTP/WS）——**不构成真页面 UI 实测**。
> 凡任务要求「真机/页面 UI 实测/截图」，一律走**设备层**：安卓模拟器（adb 在 `/opt/android-sdk/platform-tools`；AVD：fx / hgsmoke / req24，headless 亦可 screencap）或 Windows VM（winserver-hg，VNC 127.0.0.1:1）。
> 标准流程：构建 → 安装（adb install / VM 内安装）→ 启动 → 渲染目标页面 → 真实点击 → `adb screencap` 原件入交付。
> **严禁降级**：本目录的 web 截图、API 链路测试、占位图，一律不得冒充 UI 实测证据（管线判官已立 REJECT 硬条款）。

real-e2e(L2.5-web) 专用 testDir：真前端 React + 真 HTTP/WS 直打本地集群 nginx（18801/18802 钉双后端实例），需集群在位。
运行：`pnpm e2e:real`（配置见仓根 `playwright.real-e2e.config.ts`，与存量 `pnpm test:e2e` 完全隔离）。
