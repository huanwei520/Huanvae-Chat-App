//! Android 更新模块
//!
//! 提供 Android 平台专属的更新功能：
//! - 获取应用版本号
//! - 获取版本检测 JSON（支持超时）
//! - 下载 APK 文件（带进度通知）
//! - 下载完成后落「待安装」标记 + 后台时发通知（不依赖前端 JS 还活着）
//!
//! 注意：此模块仅在 Android 平台编译，桌面端使用 tauri-plugin-updater
//!
//! ## 为什么「下载完成 → 拉起安装器」不能交给前端 JS
//!
//! 两条 Android 平台规则决定了旧实现（JS 里 `await downloadApk()` 后再 `installApk()`）
//! 在应用切后台时**必然失效**：
//!
//! 1. **后台不许启动 Activity**（Android 10 / API 29 起）。系统**静默**拦截，
//!    调用方拿不到返回值也拿不到异常，只在 logcat 打一行 `Background activity launch blocked!`。
//!    → 后台调安装器 = 什么都不会发生，而且代码层面完全无感知。
//!    官方豁免清单里唯一适用的一条是：**「Activity 由系统发出的 PendingIntent 启动
//!    （例如用户点击通知）」** ⇒ 正确做法是发通知把用户拉回前台，再由前台发起安装。
//!    <https://developer.android.com/guide/components/activities/background-starts>
//! 2. **进程进入 cached 态后后台工作会被禁止**（Android 14 / API 34 起）：
//!    "Shortly after an app process enters a cached state, background work is disallowed,
//!    until a process component re-enters an active state of the lifecycle."
//!    → 连 Rust 侧的下载本身都不保证跑完；更不能指望「下载完那一刻前端 JS 正好在跑」。
//!    <https://developer.android.com/about/versions/14/behavior-changes-all>
//!
//! 所以完成时的三件事全部落在 Rust 侧（不经前端）：写标记文件 → 判可见性 → 必要时发通知。
//! 前端只负责「在前台时」把安装器拉起来，以及重回前台/重启后从标记文件恢复出「可安装」状态。

use tauri::AppHandle;
#[cfg(target_os = "android")]
use tauri::Emitter;
#[cfg(target_os = "android")]
use tauri::Listener;
#[cfg(target_os = "android")]
use tauri::Manager;

// ============================================
// 常量
// ============================================

/// APK 下载落点文件名（应用缓存目录内）
#[cfg(target_os = "android")]
const APK_FILE_NAME: &str = "huanvae-chat-update.apk";

/// 「已下完、待安装」标记文件名（与 APK 同目录）
///
/// 它是**跨进程存活**的那份状态：前端 zustand store 只在内存里，进程被系统回收即丢失，
/// 于是用户回来只能看到一个卡死的满进度条、且必须重下一遍。有了标记文件，
/// 重回前台/冷启动都能恢复出「已下完，点这里安装」。
#[cfg(target_os = "android")]
const APK_MARKER_FILE_NAME: &str = "huanvae-chat-update.pending.json";

/// 前端上报 webview 可见性用的事件名
///
/// 方向很关键：**JS → Rust 是同步可靠的**（`Ipc.postMessage` 是 `@JavascriptInterface`，
/// 由 JS 线程直接同步调进 Rust，见 gen/android 生成的 `Ipc.kt`）；
/// 而 **Rust → JS 要经主线程 `post{}` + `evaluateJavascript`**（`RustWebView.kt`），
/// 应用被 pause/cached 后不可靠。所以「谁可见」这件事由 JS 主动推给 Rust，
/// 让**判断和动作都留在 Rust 侧**。
#[cfg(target_os = "android")]
const UI_VISIBILITY_EVENT: &str = "apk-ui-visibility";

/// APK 分片并发数。
///
/// 与桌面 updater_download.rs 同一思路（Range 并发），但**实现不同**：
/// 桌面把每片整块存在内存里，APK 有 120MB+，八片同时驻留会在手机上 OOM ⇒
/// 这里每片各自 seek 到自己的偏移**直接写盘**，内存只留单个 chunk。
#[cfg(target_os = "android")]
const APK_SHARD_COUNT: u64 = 8;

/// 小于该体积不分片：八条连接的握手/TLS/慢启动开销盖过收益（浏览器厂商同样结论）。
#[cfg(target_os = "android")]
const APK_MIN_SHARD_TOTAL: u64 = 4 * 1024 * 1024;

/// 单片超时。整包超时不设——大包在弱网上本就慢，按片超时才不会误杀。
#[cfg(target_os = "android")]
const APK_SHARD_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// 进度上报间隔：分片是并发的，逐 chunk 报会把事件打爆，改为定时读累计值。
#[cfg(target_os = "android")]
const APK_PROGRESS_TICK: std::time::Duration = std::time::Duration::from_millis(200);

// ============================================
// 待安装状态
// ============================================

/// 已下载完成、等待用户确认安装的 APK
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PendingApkInstall {
    /// 待安装包的版本号
    pub version: String,
    /// APK 本地绝对路径
    pub path: String,
    /// 下载完成时的字节数（用于识别被截断的半截文件）
    pub size: u64,
}

/// webview 是否可见。默认 true：用户是在前台点的「更新」。
#[cfg(target_os = "android")]
static UI_VISIBLE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(true);

/// 可见性监听只注册一次（重试下载不重复挂监听）
#[cfg(target_os = "android")]
static UI_VISIBILITY_LISTENER: std::sync::Once = std::sync::Once::new();

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
struct UiVisibilityPayload {
    visible: bool,
}

/// 注册前端可见性上报监听（幂等）
#[cfg(target_os = "android")]
fn ensure_ui_visibility_listener(app: &AppHandle) {
    UI_VISIBILITY_LISTENER.call_once(|| {
        app.listen(UI_VISIBILITY_EVENT, |event| {
            match serde_json::from_str::<UiVisibilityPayload>(event.payload()) {
                Ok(payload) => {
                    println!("[Android Update] webview 可见性上报: {}", payload.visible);
                    UI_VISIBLE.store(payload.visible, std::sync::atomic::Ordering::Relaxed);
                }
                Err(e) => {
                    eprintln!("[Android Update] 可见性事件解析失败: {}", e);
                }
            }
        });
    });
}

/// 获取应用版本号
///
/// 从 tauri.conf.json 中读取版本号
#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    let version = app.config().version.clone().unwrap_or_else(|| "0.0.0".to_string());
    println!("[Android Update] get_app_version: {}", version);
    version
}

/// 获取更新检测 JSON
///
/// 从指定 URL 获取版本信息 JSON，支持超时设置
#[tauri::command]
pub async fn fetch_update_json(url: String, timeout_secs: u64) -> Result<String, String> {
    use std::time::Duration;

    println!("[Android Update] fetch_update_json 开始");
    println!("[Android Update] URL: {}", url);
    println!("[Android Update] 超时: {} 秒", timeout_secs);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| {
            eprintln!("[Android Update] 创建 HTTP 客户端失败: {}", e);
            format!("创建 HTTP 客户端失败: {}", e)
        })?;

    println!("[Android Update] 发送请求...");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Android Update] 请求失败: {}", e);
            format!("请求失败: {}", e)
        })?;

    println!("[Android Update] 响应状态: {}", response.status());
    if !response.status().is_success() {
        let err = format!("HTTP 错误: {}", response.status());
        eprintln!("[Android Update] {}", err);
        return Err(err);
    }

    let text = response
        .text()
        .await
        .map_err(|e| {
            eprintln!("[Android Update] 读取响应失败: {}", e);
            format!("读取响应失败: {}", e)
        })?;

    println!("[Android Update] 响应长度: {} 字节", text.len());
    println!("[Android Update] 响应内容: {}", &text[..text.len().min(200)]);
    Ok(text)
}

#[cfg(target_os = "android")]
/// 下载完成后的收尾（**分片路径与单连接路径共用**）
///
/// 抽出来是因为接分片时必须保证两条路的收尾**完全一致** ——
/// 收尾里的三件事（写标记 / 判可见 / 后台发通知）正是「切后台回来要重下」那个缺陷的修复，
/// 若只有单连接路径有、分片路径漏掉，那个缺陷就会在安卓上原样复发。
fn finish_apk_download(
    file_path_str: String,
    marker_path: std::path::PathBuf,
    version: String,
    downloaded: u64,
    app: &AppHandle,
) -> Result<String, String> {
    println!(
        "[Android Update] ✓ 下载完成: {} ({} bytes)",
        file_path_str, downloaded
    );


    // 1) 落「待安装」标记（跨进程存活）
    let pending = PendingApkInstall {
        version: version.clone(),
        path: file_path_str.clone(),
        size: downloaded,
    };
    match serde_json::to_string(&pending) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&marker_path, json) {
                // 标记写失败不影响本次安装（前台路径仍能直接拉起安装器），
                // 只是丢掉「重启后免重下」的能力 —— 如实报错，不静默。
                eprintln!("[Android Update] 写待安装标记失败: {}", e);
            } else {
                println!("[Android Update] ✓ 已写待安装标记: {:?}", marker_path);
            }
        }
        Err(e) => eprintln!("[Android Update] 序列化待安装标记失败: {}", e),
    }

    // 2) 后台则发通知把用户拉回前台（后台直接拉安装器会被系统静默拦掉）
    if UI_VISIBLE.load(std::sync::atomic::Ordering::Relaxed) {
        println!("[Android Update] webview 可见，交由前端直接拉起安装器");
    } else {
        println!("[Android Update] webview 不可见，发通知提醒用户回到应用安装");
        // 🔴 另起线程发：`show()` 是一次同步 JNI 往返，要等 Android 主线程处理。
        //    应用正处于后台（很可能已经 cached），主线程什么时候被调度不由我们说了算。
        //    若在这里同步等，本命令就可能迟迟不返回 ⇒ 前端的 invoke 也就迟迟不 resolve
        //    ⇒ 又变回「卡在满进度条」。通知是尽力而为的旁路，绝不能挡住主返回路径。
        let app_for_notify = app.clone();
        let version_for_notify = version.clone();
        std::thread::spawn(move || {
            notify_download_complete(&app_for_notify, &version_for_notify);
        });
    }

    Ok(file_path_str)
}

#[cfg(target_os = "android")]
/// 探测服务端是否支持 Range，并拿到总长。
///
/// 用 HEAD 而不是「先 GET 再看头」：后者会把整个响应体也拉起来，探测完还得丢掉。
/// 任何一步不确定就返回 None ⇒ 调用方回退到单连接顺序流（**能用**优先于**快**）。
async fn probe_apk_ranges(client: &reqwest::Client, url: &str) -> Option<u64> {
    let resp = client.head(url).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let accepts = resp
        .headers()
        .get(reqwest::header::ACCEPT_RANGES)?
        .to_str()
        .ok()?
        .to_ascii_lowercase();
    if !accepts.contains("bytes") {
        return None;
    }
    resp.content_length().filter(|n| *n > 0)
}

#[cfg(target_os = "android")]
/// 分片并发下载到文件：每片 seek 到自己的偏移直接写盘，内存只留单个 chunk。
///
/// 返回实际写入字节数。任一分片失败即整体失败 —— APK 少一段就是坏包，
/// 没有「传一半也能用」的余地（与相册那条「失败即停但保留已成功项」的口径不同，
/// 因为这里的产物是**单个文件**而不是 N 条独立消息）。
async fn download_apk_sharded(
    client: &reqwest::Client,
    url: &str,
    total: u64,
    file_path: &std::path::Path,
    app: &AppHandle,
) -> Result<u64, String> {
    use futures_util::StreamExt;
    use std::io::{Seek, SeekFrom, Write};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    // 预分配：各片要按偏移写入，文件必须先有足够长度
    {
        let f = std::fs::File::create(file_path).map_err(|e| format!("创建文件失败: {e}"))?;
        f.set_len(total).map_err(|e| format!("预分配失败: {e}"))?;
    }

    let progress = Arc::new(AtomicU64::new(0));
    let chunk = total.div_ceil(APK_SHARD_COUNT);

    // 进度上报器：定时读累计值，保住原有的 apk-download-progress 事件契约
    let reporter = {
        let progress = Arc::clone(&progress);
        let app = app.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(APK_PROGRESS_TICK).await;
                let done = progress.load(Ordering::Relaxed);
                let percent = (done * 100).checked_div(total).unwrap_or(0) as u8;
                let _ = app.emit("apk-download-progress", (percent, done, total));
                if done >= total {
                    break;
                }
            }
        })
    };

    let mut tasks = Vec::new();
    for i in 0..APK_SHARD_COUNT {
        let start = i * chunk;
        if start >= total {
            break;
        }
        let end = ((i + 1) * chunk - 1).min(total - 1);
        let client = client.clone();
        let url = url.to_string();
        let path = file_path.to_path_buf();
        let progress = Arc::clone(&progress);

        tasks.push(tokio::spawn(async move {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .map_err(|e| format!("分片打开文件失败: {e}"))?;
            file.seek(SeekFrom::Start(start))
                .map_err(|e| format!("分片定位失败: {e}"))?;

            let resp = client
                .get(&url)
                .header(reqwest::header::RANGE, format!("bytes={start}-{end}"))
                .timeout(APK_SHARD_TIMEOUT)
                .send()
                .await
                .map_err(|e| format!("分片请求失败: {e}"))?;
            // 必须 206；200 说明服务端忽略了 Range，会把整包塞回来、写坏偏移
            if resp.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                return Err(format!("分片响应状态非 206（实际 {}）", resp.status()));
            }

            let mut stream = resp.bytes_stream();
            while let Some(item) = stream.next().await {
                let bytes = item.map_err(|e| format!("分片读取失败: {e}"))?;
                file.write_all(&bytes)
                    .map_err(|e| format!("分片写入失败: {e}"))?;
                // 边收边计：进度的唯一来源（不能等整片下完再加，那样会「0% 然后突然完成」）
                progress.fetch_add(bytes.len() as u64, Ordering::Relaxed);
            }
            file.flush().map_err(|e| format!("分片刷新失败: {e}"))?;
            Ok::<(), String>(())
        }));
    }

    let mut first_err: Option<String> = None;
    for t in tasks {
        match t.await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                if first_err.is_none() {
                    first_err = Some(e);
                }
            }
            Err(e) => {
                if first_err.is_none() {
                    first_err = Some(format!("分片任务panic: {e}"));
                }
            }
        }
    }
    reporter.abort();

    if let Some(e) = first_err {
        return Err(e);
    }
    let done = progress.load(Ordering::Relaxed);
    let _ = app.emit("apk-download-progress", (100u8, done, total));
    Ok(done)
}

/// 下载 APK 文件（仅 Android）
///
/// 下载 APK 到应用缓存目录（无需权限），并通过事件发送进度。
///
/// 下载完成后**在 Rust 侧**收尾（见模块头注释）：
/// 1. 写「待安装」标记文件 —— 进程被系统回收也不丢，重启后不必重下
/// 2. 若此刻 webview 不可见，发一条通知把用户拉回前台
///    （后台直接拉安装器会被系统静默拦掉，通知点击是官方唯一适用的豁免路径）
///
/// `version` 只用于写进标记文件与通知文案，不参与下载本身。
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn download_apk(url: String, version: String, app: AppHandle) -> Result<String, String> {
    use futures_util::StreamExt;
    use std::io::Write;

    println!("[Android Update] ========== download_apk 开始 ==========");
    println!("[Android Update] 下载 URL: {}", url);
    println!("[Android Update] 目标版本: {}", version);

    ensure_ui_visibility_listener(&app);

    let client = reqwest::Client::new();

    // 落盘路径要在选择下载方式**之前**准备好：分片路径需要先预分配文件再并发按偏移写。
    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| format!("获取缓存目录失败: {}", e))?;
    let file_path = cache_dir.join(APK_FILE_NAME);
    let file_path_str = file_path.to_string_lossy().to_string();
    println!("[Android Update] 保存路径: {}", file_path_str);
    if let Err(e) = std::fs::create_dir_all(&cache_dir) {
        eprintln!("[Android Update] 创建缓存目录失败（可能已存在）: {}", e);
    }
    // 先把上一轮的「待安装」标记清掉：接下来要把同名 APK 截断重写，
    // 标记若留着就会短暂地指向一个半截文件。
    let marker_path = cache_dir.join(APK_MARKER_FILE_NAME);
    let _ = std::fs::remove_file(&marker_path);

    // ── 分片并发下载（v1.1.23 桌面已有，安卓此前一直是单连接顺序流 —— 本次补上）──
    // 探测失败 / 服务端不支持 Range / 包太小 ⇒ 回退到原来的单连接路径。
    // **能用优先于快**：分片只是加速手段，不能因为它让下载变得不可用。
    if let Some(total) = probe_apk_ranges(&client, &url).await {
        if total >= APK_MIN_SHARD_TOTAL {
            println!(
                "[Android Update] 服务端支持 Range，改用 {} 段并发下载（{} bytes）",
                APK_SHARD_COUNT, total
            );
            match download_apk_sharded(&client, &url, total, &file_path, &app).await {
                Ok(done) => {
                    println!("[Android Update] ✓ 分片下载完成: {} bytes", done);
                    return finish_apk_download(file_path_str, marker_path, version, done, &app);
                }
                Err(e) => {
                    // 分片失败不直接判死：回退单连接再试一次，用户拿到的是「慢但能成」
                    eprintln!("[Android Update] 分片下载失败，回退单连接: {}", e);
                }
            }
        } else {
            println!("[Android Update] 包体 {} bytes 小于分片阈值，走单连接", total);
        }
    } else {
        println!("[Android Update] 服务端未声明 Range 支持，走单连接");
    }

    println!("[Android Update] 发送下载请求...");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| {
            eprintln!("[Android Update] 下载请求失败: {}", e);
            format!("下载请求失败: {}", e)
        })?;

    println!("[Android Update] 响应状态: {}", response.status());
    if !response.status().is_success() {
        let err = format!("下载失败: HTTP {}", response.status());
        eprintln!("[Android Update] {}", err);
        return Err(err);
    }

    let total = response.content_length().unwrap_or(0);
    println!("[Android Update] 文件大小: {} bytes", total);
    let mut downloaded: u64 = 0;

    // 创建文件
    println!("[Android Update] 创建文件...");
    let mut file =
        std::fs::File::create(&file_path).map_err(|e| {
            eprintln!("[Android Update] 创建文件失败: {}", e);
            format!("创建文件失败: {}", e)
        })?;
    println!("[Android Update] 文件创建成功");

    // 流式下载
    println!("[Android Update] 开始流式下载...");
    let mut stream = response.bytes_stream();
    let mut last_log_percent: u8 = 0;
    
    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| {
            eprintln!("[Android Update] 下载数据失败: {}", e);
            format!("下载数据失败: {}", e)
        })?;

        file.write_all(&chunk)
            .map_err(|e| {
                eprintln!("[Android Update] 写入文件失败: {}", e);
                format!("写入文件失败: {}", e)
            })?;

        downloaded += chunk.len() as u64;

        // 发送进度事件
        let percent = (downloaded * 100).checked_div(total).unwrap_or(0) as u8;

        // 每 10% 输出一次日志
        if percent >= last_log_percent + 10 {
            println!("[Android Update] 下载进度: {}% ({}/{})", percent, downloaded, total);
            last_log_percent = percent;
        }

        let _ = app.emit("apk-download-progress", (percent, downloaded, total));
    }

    // 确保写入完成
    println!("[Android Update] 刷新缓冲区...");
    file.flush().map_err(|e| {
        eprintln!("[Android Update] 刷新文件失败: {}", e);
        format!("刷新文件失败: {}", e)
    })?;

    println!(
        "[Android Update] ✓ 下载完成: {} ({} bytes)",
        file_path_str, downloaded
    );

    finish_apk_download(file_path_str, marker_path, version, downloaded, &app)
}

/// 下载完成通知（仅在应用不可见时发）
///
/// 点击该通知会走 tauri-plugin-notification 设置的 content PendingIntent 打开主 Activity，
/// 正好命中官方后台启动 Activity 豁免清单第 3 条（"started from a PendingIntent that was
/// sent by the system, for example, from a notification tap"）—— 用户回到前台后，
/// 前端再发起安装就是合法的前台启动。
#[cfg(target_os = "android")]
fn notify_download_complete(app: &AppHandle, version: &str) {
    use tauri_plugin_notification::NotificationExt;

    if let Err(e) = app
        .notification()
        .builder()
        .title("更新已下载完成")
        .body(format!("点击回到应用，安装 v{}", version))
        .show()
    {
        eprintln!("[Android Update] 发送下载完成通知失败: {}", e);
    }
}

/// 下载 APK 文件（非 Android 平台的存根）
///
/// 桌面端不需要此功能，返回错误
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn download_apk(
    _url: String,
    _version: String,
    _app: AppHandle,
) -> Result<String, String> {
    Err("APK 下载仅支持 Android 平台".to_string())
}

/// 查询是否有「已下完、待安装」的 APK（仅 Android）
///
/// 前端在冷启动、以及每次重回前台时调用它恢复状态 —— 这是把
/// 「切回来只剩一个卡死的满进度条 / 必须清后台重下一遍」修掉的那一环。
///
/// 三重校验，任一不过就当作没有并顺手清理，绝不把半截文件报成可安装：
/// - 标记文件能解析
/// - 标记版本 ≠ 当前应用版本（相等说明已经装上了，标记过期）
/// - APK 仍在盘上，且字节数与下载完成时**完全一致**
#[cfg(target_os = "android")]
#[tauri::command]
pub fn pending_apk_install(app: AppHandle) -> Result<Option<PendingApkInstall>, String> {
    let cache_dir = app
        .path()
        .cache_dir()
        .map_err(|e| format!("获取缓存目录失败: {}", e))?;
    let marker_path = cache_dir.join(APK_MARKER_FILE_NAME);

    let Ok(raw) = std::fs::read_to_string(&marker_path) else {
        return Ok(None);
    };

    let pending: PendingApkInstall = match serde_json::from_str(&raw) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[Android Update] 待安装标记损坏，清理: {}", e);
            let _ = std::fs::remove_file(&marker_path);
            return Ok(None);
        }
    };

    // 版本与当前一致 ⇒ 这个包已经装上了，标记连同 APK 一起清掉，别再提示
    let current_version = app.config().version.clone().unwrap_or_default();
    if pending.version == current_version {
        println!("[Android Update] 待安装包与当前版本一致，清理标记与 APK");
        let _ = std::fs::remove_file(&marker_path);
        let _ = std::fs::remove_file(&pending.path);
        return Ok(None);
    }

    match std::fs::metadata(&pending.path) {
        Ok(meta) if meta.len() == pending.size => {
            println!(
                "[Android Update] 发现待安装包 v{} ({} bytes)",
                pending.version, pending.size
            );
            Ok(Some(pending))
        }
        Ok(meta) => {
            eprintln!(
                "[Android Update] 待安装 APK 字节数不符（{} != {}），清理标记",
                meta.len(),
                pending.size
            );
            let _ = std::fs::remove_file(&marker_path);
            Ok(None)
        }
        Err(e) => {
            eprintln!("[Android Update] 待安装 APK 已不存在（{}），清理标记", e);
            let _ = std::fs::remove_file(&marker_path);
            Ok(None)
        }
    }
}

/// 查询待安装 APK（非 Android 平台的存根）
///
/// 桌面端走 tauri-plugin-updater，不存在「下完等用户点安装」这一步
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn pending_apk_install(_app: AppHandle) -> Result<Option<PendingApkInstall>, String> {
    Ok(None)
}
