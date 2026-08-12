# 更新下载器测速台

> **它为什么入仓**：此前两次下载器调优（h2 窗口、分片）用的 harness 都是**一次性、未入仓**的。
> 后果是再问「新参数快多少」时**一个数字都拿不出来**，只能重新造轮子。所以这次它跟代码一起活着。

## 组成

| 文件 | 作用 |
|---|---|
| `download-bench/`（Rust crate） | 主测速台：复刻生产的 reqwest client + 分片逻辑，量总耗时 / 峰值·均值速率 / **各分片完成时刻** / 重试次数 |
| `run-download-bench.sh` | 一键：构建 → 跑 → 落 JSON → 打人读摘要 |
| `chromium-baseline.mjs` | 浏览器对照组（Playwright Chromium 单连接），用来判断"慢"是我们的问题还是链路上限 |
| `results/`（gitignore） | 每次跑的机器可读 JSON |

## 跑

```bash
# 🔴 URL 一律经环境变量注入 —— 本仓是 PUBLIC 公开仓，脚本里不写任何地址
export BENCH_URL='https://<更新源>/<产物文件>'

./scripts/bench/run-download-bench.sh --rounds 12 --label baseline
node  scripts/bench/chromium-baseline.mjs 6        # 浏览器对照（可选，需已装 chromium）
```

常用参数（原样透传给 `download-bench`）：

| 参数 | 默认 | 说明 |
|---|---|---|
| `--rounds N` | 10 | 轮数。**别少于 10** —— 单轮抖动很大（见下「怎么读数字」） |
| `--shards N` | 8 | 分片数，与生产 `SHARD_COUNT` 同值 |
| `--variants sharded,single` | 两者 | 每轮**交错**跑，次序按轮次轮换（拉丁方）消位次偏差 |
| `--h2-windows on\|off` | on | `off` = 复现 reqwest 默认的 64 KiB 窗口，用来自己把 decision doc 那张表再跑一遍 |
| `--label 名字` | current | 进结果文件名与报告 |
| `--out 路径` | results/ 下 | JSON 落点 |

构建产物默认放本机盘（`BENCH_TARGET_DIR`，默认 `$TMPDIR/hv-bench-target`）：
本工作区在共享盘（virtiofs）上，把 `target` 放共享盘会慢一个数量级。

## 怎么读数字（不这么读就会读错）

1. **只比比值，不比绝对值。** 本机出口可能有透明代理，且实测同一 URL 在同一分钟内
   单轮速率能从 7 MB/s 漂到 32 MB/s。绝对值只对当时那条链路成立。
2. **取中位数，别取平均**（脚本已经这么做）。偶发的 20 秒级停顿会把平均值毁掉。
3. **看 `⭐ 分片完成时刻`那一行** —— 这是本测速台最主要的产出：
   - `跨度` = 最后一片比第一片晚多少毫秒；
   - `离散度` = 跨度 / 总耗时；
   - **`空转占比`** = Σ(最后完成时刻 − 各片完成时刻) / (片数 × 最后完成时刻)
     ，即**有多少并发容量被尾延迟浪费掉了**。

   这是判「要不要做小块 + 有界并发 + 工作窃取」的**唯一依据**：空转占比就是那套改造的
   **收益上限**。接近 0 ⇒ 尾延迟不是瓶颈 ⇒ 别做。

## 与生产代码的一致性（会漂移，看到就核）

测速台是**另一份代码**，天然会漂。三道防线：

1. `download-bench/src/main.rs` 顶部 `PROD_*` 常量块逐条标注了生产侧出处；
2. `src-tauri` 侧有两条静态守卫测试盯着它：
   - `bench_harness_mirrors_production_http2_windows` —— 两个 h2 窗口值必须与生产一致；
   - `http2_adaptive_window_is_never_enabled` —— 三份代码里都不许开自适应窗口；
3. `download-bench/Cargo.toml` 写死了「特性集必须与生产**解析结果**一致」的理由。

### ⚠️ 最容易踩的两个坑（都真踩过）

- **reqwest 特性集不能照抄 `src-tauri/Cargo.toml` 的字面写法。** 那里写的是
  `default-features = false, features=["json","rustls-tls","stream"]`（看着没有 http2），
  但同文件的 `tauri-plugin-http` 未关默认特性、依赖同一个 reqwest ⇒ Cargo 取并集 ⇒
  `http2` 实际是开的。照抄字面写法 ⇒ 测速台跑在 HTTP/1.1 上 ⇒ h2 窗口那两行完全不生效
  ⇒ 测出来的数字与线上毫不相干。核实口径：`cargo tree -e features -i -p reqwest@0.12.28`。
- **`Response::content_length()` 在 HEAD 上恒失真。** 它读的不是 `content-length` 头，
  而是 hyper 的 body size hint；HEAD 响应没有 body ⇒ 恒给 0。要拿 HEAD 的长度必须自己读头。
  （本测速台第一次跑就撞上，顺带暴露了生产侧同款缺陷。）

## 已知不足（如实写，别当成全覆盖）

- 只量**网络**：收到的字节直接丢弃，不落盘，所以磁盘写入的开销不在测量范围内
  （生产的安卓侧是边收边写盘的）。
- 只在**桌面** host 上跑；移动网络 / 安卓真机没有对应测速台。
- 没有链路损伤注入（丢包 / 高 RTT）。要复现「弱网下分片赢多少」得另外用
  `dnctl` + `pfctl` 造损伤 —— 那会影响整台机器上所有在跑的东西，做之前先看
  `.claude/rules/common.md`「改系统级网络状态：安全网必须活得比清场命令久」。
