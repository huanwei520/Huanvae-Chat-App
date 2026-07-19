# e2e-real

real-e2e(L2.5-web) 专用 testDir：真前端 React + 真 HTTP/WS 直打本地集群 nginx（18801/18802 钉双后端实例），需集群在位。
运行：`pnpm e2e:real`（配置见仓根 `playwright.real-e2e.config.ts`，与存量 `pnpm test:e2e` 完全隔离）。
