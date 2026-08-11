# 手机端真机截图规则（mobile-screenshot）

**审核层的截图硬指标要求「手机端那张是必需项」**（见 [code-review/SKILL.md](../skills/code-review/SKILL.md) 维度 0.5、
[blind-review/SKILL.md](../skills/blind-review/SKILL.md) 交叉验证 E）。
本文件回答「那张图**到底怎么取**」——因为**「拿不到」在本仓不是合法理由：这条路径早已跑通过一次。**

> 出处：2026-08-11 用户明令 —— 「ai-host 的远程编译服务器不是有用来做过吗，当时不是已经截过图了，
> 查找这个流程并将这个远程安卓的流程写入 app 的 worker 的流程核查中」。

---

## 一、本机跑不了移动模拟器，是硬件级的，别再试

开发用的 macOS VM `kern.hv_support=0`（`hv_vmm_present=1` ⇒ **自己就是 guest**，宿主没开嵌套虚拟化；
Apple 虚拟化的嵌套虚拟要 M3+ 且宿主显式启用）。因此：

- **Android 模拟器**（ARM 镜像要 HVF）——起不来
- **iOS 模拟器**（无 Xcode）——起不来
- 本机 OrbStack 同理（arm64，一样没有嵌套虚拟）

**重启 / 换参数 / 换镜像都翻不过来。** 交付里写「本机起不了模拟器」只是陈述这一条，
**不构成缺手机端截图的理由**——因为还有下面这条路径。

## 二、正路：ai-host 远程编译服务器 + KVM 模拟器 + adb

### 为什么不用 computer-use

Android 有**程序接口**，比截屏+点击更准更稳：

| 动作 | 命令 | 说明 |
|------|------|------|
| 截图 | `adb exec-out screencap -p > x.png` | **帧缓冲像素级**，不是屏幕录制、不是合成 |
| 点击 | `adb shell input tap <x> <y>` | 注入事件，确定可脚本 |
| 输入 | `adb shell input text '<str>'` / `keyevent` | 同上 |
| 装包 | `adb install -r <apk>` | |
| 崩溃核验 | `adb logcat` | 见下方判读口径 |

全程 **headless**，无需图形界面、无需 TCC 权限。
（Claude Code 的 computer-use 只有 macOS 有、Linux 没有；但这条路径根本不需要它。）

### 连接与主机（⚠️ 易变态，执行前现查，别照抄下面的数字）

- 地址：`ssh root@10.42.0.5`（**mesh vip**；VM 在 mesh 内经 utun0 可达。
  home LAN 那个地址从 VM **不通**，别用）
- 免密：统一 key `~/.ssh/id_ed25519_unified`
- 2026-07-25 实测规格：x86_64 Ubuntu 24.04 / 256 核 / 125G 内存 / **`/dev/kvm` 在**（硬件 KVM，模拟器很快）
- 🔴 **它同时跑着生产服务**（vLLM / litellm / quant-weather / minio / syncthing）⇒
  **模拟器必须限资源**（`-memory 4096 -cores 4`），装东西放独立目录，**别踩生产服务**。

### 流程（2026-07-25 req-24 实跑通过的形态）

1. **同步源码**：从 VM 的 `Huanvae-Chat-App` 工作树 `rsync` 到 ai-host
   —— **可带未提交改动**（这正是"验证还没发布的改动"所需）
2. **构建**：`tauri android build`（本仓真有 `src-tauri/gen/android`），
   产出 **debug APK（universal，含 x86_64 lib）**
   —— x86_64 是关键：模拟器是 x86_64 镜像，ARM-only APK 装不上
3. **起模拟器**：headless KVM AVD，Android 14 / google_apis / **x86_64**，1080×2400
4. **装 + 驱动 + 截图**：`adb install` → `adb shell input …` 走到目标界面 → `adb exec-out screencap -p`
5. **拉回**：产物落 `/Volumes/My Shared Files/shots/<主题>/`，**并写一份 `mapping.md`**（见下）

App 在模拟器里**直连生产** `https://api.huanvae.cn`（模拟器 NAT 联网即连真数据），出的是真数据不是 mock。

### iOS

**没有这条等价路径**——iOS 真机/模拟器需要有 Xcode 的开发机（huanwei 本人那台）。
交付里涉及 iOS 专属界面时，如实写「iOS 需本人开发机，未取到」，不要拿 Android 图冒充。

---

## 三、判读口径：什么样的手机端截图才算数

一张 PNG 不等于一次验证。**每批手机端截图必须同时给出下面四样**，缺一项在审核层按「证据不完整」处理：

1. **帧缓冲来源**：`adb exec-out screencap -p` 产出。
   ❌ 不接受：示意图、Figma、把桌面窗口拉窄截的图、代码片段截图、模拟器窗口的屏幕录制帧。
2. **分辨率核验**：`sips -g pixelWidth -g pixelHeight <png>`，应是移动形态尺寸（如 1080×2400）。
   桌面尺寸的图出现在"手机端"栏 ⇒ 证据与标签不符。
3. **`adb logcat` 全程零崩溃**：无 `FATAL EXCEPTION` / `SIGSEGV` / `SIGABRT` / `ANR` / `tombstone`。
   把 logcat 全文一并落盘（`logcat-full.txt`），别只写"没崩"。
   —— 这是移动端版的「Console 0 报错」。
4. **`mapping.md` 映射表**：每张图 → 它证明了哪条需求 → **对应实码 file:line**。
   截图不带映射 = 读者无法判断它证明了什么。

**参考样板（真实产物，直接照着写）**：`/Volumes/My Shared Files/shots/req24-mobile/`
—— 10 张 PNG + `logcat-full.txt` + [`mapping.md`](/Volumes/My%20Shared%20Files/shots/req24-mobile/mapping.md)，
2026-07-25 实跑。mapping.md 的结构（每条需求一张表：截图 / 演示内容 / 对应实码）是本仓的既定格式。

---

## 四、审核层怎么用这条规则

| 角色 | 做什么 |
|------|--------|
| **实现方 / leader** | 界面类改动，安排走本流程取手机端图；受阻要写明**卡在哪一步**（第几步、什么报错） |
| **code-review**（维度 0.5） | 只读核实：`ls -la` 逐个截图路径确认文件存在；核对四样判读口径 |
| **blind-review**（交叉验证 E） | 同上，且**不接受"路径看起来合理"** |
| **fw 判官门**（`prompts/review.md` 第 5 条） | 缺手机端且无合法理由 ⇒ REJECT |

**「拿不到」的合法形态**：写明尝试到第几步、失败原因（如「ai-host 上 AVD 不存在需重建」「/dev/kvm 不可用」），
由 leader 或总管调度补齐。**只写"没做 / 后续再补 / 拿不到" ⇒ 打回。**

---

## 五、这份记录里哪些是「点时快照」

上面凡出现**具体主机规格、AVD 名字、Android 版本、目录是否存在**的地方，都是 **2026-07-25 的实测值**，
属易变态。执行前**现查**（ssh 上去看 `/dev/kvm`、看 SDK/AVD 还在不在），
**不要把这份文档的数字当成当前状态来汇报**——那正是本仓反复踩过的「拿旧结论当现状」。

不变的是三条：① 本机硬件级跑不了移动模拟器；② ai-host 是那条路径的宿主；
③ 判读口径（帧缓冲 / 分辨率 / 0 crash / mapping）。
