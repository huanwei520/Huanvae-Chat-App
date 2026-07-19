//! display_cache — 展示资源磁盘缓存(纯本地,不做网络)。
//!
//! 为 secure_proxy 提供"本地优先 + 后台刷新"的展示资源(头像/小程序图标等)缓存:
//! 命中即回本地文件,后端/MinIO 不可达时看过的头像仍能显示;是否回源刷新由调用方决定。
//!
//! ## 缓存键与文件布局
//! - **缓存键 = path+query 全串**(不含 host:port,天然兼容反代端口漂移)。换头像时后端
//!   会变更 `?t=` 时间戳 → URL 变 → 新键;同一 URL 内容不可变,可安全长期缓存。
//! - 文件名 = 键的**十六进制编码**(injective、免哈希依赖、可读可调试);hex 超过 200 字符
//!   的键不缓存(防超长文件名;白名单路径实际都很短)。
//! - 每条目两个文件:`<hex>.bin`(body)+ `<hex>.meta`(content-type 纯文本)。
//!   写入用同目录临时文件(`.tmp` 后缀)+ rename 原子落盘。
//!
//! ## 白名单与上限
//! - 仅缓存 `/avatars/`、`/storage/icons/` 前缀路径(见 [`is_cacheable_path`]);聊天文件/图片
//!   走 presigned URL(带签名 query、路径前缀不同),**绝不缓存**。
//! - 单条目 > 8 MiB 不缓存;目录 `.bin` 总量 > 64 MiB 时按 mtime 从旧到新成对淘汰。
//!
//! ## 后台刷新登记
//! [`should_revalidate`] 用进程级集合保证每键每次运行只后台刷新一次;刷新失败调
//! [`unmark_revalidated`] 撤销登记,下次命中静默重试。

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use once_cell::sync::Lazy;

/// 单条目体量上限(8 MiB):头像/图标远小于此,超限视为异常不缓存。
const MAX_ENTRY_BYTES: usize = 8 * 1024 * 1024;
/// 目录 `.bin` 总量上限(64 MiB):超限按 mtime 从旧到新成对淘汰。
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

/// 已登记"本次运行内做过后台刷新"的键(进程级,每键每次运行只刷新一次)。
static REVALIDATED: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

/// 一条缓存条目:body + content-type。
pub struct CachedEntry {
    pub body: Vec<u8>,
    pub content_type: String,
}

/// 默认缓存目录:应用数据根目录下 `display-cache/`。
fn cache_dir() -> PathBuf {
    crate::user_data::get_app_root().join("display-cache")
}

/// 判断 path+query 是否属于可缓存的展示资源(仅看 path,query 不参与判断)。
/// 白名单:头像 `/avatars/...`、小程序图标 `/storage/icons/...`。
pub fn is_cacheable_path(path_and_query: &str) -> bool {
    let path = match path_and_query.find('?') {
        Some(i) => &path_and_query[..i],
        None => path_and_query,
    };
    path.starts_with("/avatars/") || path.starts_with("/storage/icons/")
}

/// 缓存键 → 文件名主干:path+query 全串的十六进制编码。
/// hex 超过 200 字符返回 None(不缓存,防超长文件名)。
fn cache_file_name(pq: &str) -> Option<String> {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let bytes = pq.as_bytes();
    if bytes.len() * 2 > 200 {
        return None;
    }
    let mut name = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        name.push(HEX[(b >> 4) as usize] as char);
        name.push(HEX[(b & 0x0f) as usize] as char);
    }
    Some(name)
}

/// 临时文件 + rename 原子落盘(同目录 `.tmp` 后缀,避免读到半截文件)。
fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut tmp_os = path.as_os_str().to_owned();
    tmp_os.push(".tmp");
    let tmp = PathBuf::from(tmp_os);
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path)
}

/// 从指定目录读缓存。读失败/缺 meta 一律 None(当 miss,不兜底)。
fn lookup_in(dir: &Path, pq: &str) -> Option<CachedEntry> {
    let name = cache_file_name(pq)?;
    let body = fs::read(dir.join(format!("{name}.bin"))).ok()?;
    let content_type = fs::read_to_string(dir.join(format!("{name}.meta"))).ok()?;
    Some(CachedEntry { body, content_type })
}

/// 写入指定目录(超限/编码失败/IO 失败静默放弃 — 缓存缺失只是回源,不掩盖错误);
/// 写入成功后执行体量上限淘汰。
fn store_in(dir: &Path, pq: &str, content_type: &str, body: &[u8]) {
    if body.len() > MAX_ENTRY_BYTES {
        return;
    }
    let Some(name) = cache_file_name(pq) else {
        return;
    };
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    // 先写 meta 再写 bin:lookup 以 bin 为先导,bin 就位时 meta 必已就位
    let meta_path = dir.join(format!("{name}.meta"));
    if write_atomic(&meta_path, content_type.as_bytes()).is_err() {
        return;
    }
    if write_atomic(&dir.join(format!("{name}.bin")), body).is_err() {
        // bin 未落盘则 meta 无意义,成对清理避免孤儿
        let _ = fs::remove_file(&meta_path);
        return;
    }
    enforce_cap(dir, MAX_TOTAL_BYTES);
}

/// 与现有缓存 body 相同则跳过(后台刷新用,避免内容未变时重写磁盘)。
fn store_if_changed_in(dir: &Path, pq: &str, content_type: &str, body: &[u8]) {
    if let Some(existing) = lookup_in(dir, pq)
        && existing.body == body
    {
        return;
    }
    store_in(dir, pq, content_type, body);
}

/// 体量上限淘汰:目录 `.bin` 总量 > `max_total` 时按 mtime 从旧到新删(`.bin`+`.meta` 成对删)。
fn enforce_cap(dir: &Path, max_total: u64) {
    let Ok(read_dir) = fs::read_dir(dir) else {
        return;
    };
    let mut bins: Vec<(PathBuf, SystemTime, u64)> = Vec::new();
    let mut total: u64 = 0;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("bin") {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let len = meta.len();
        total += len;
        bins.push((
            path,
            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            len,
        ));
    }
    if total <= max_total {
        return;
    }
    bins.sort_by_key(|(_, mtime, _)| *mtime);
    for (bin_path, _, len) in bins {
        if total <= max_total {
            break;
        }
        let _ = fs::remove_file(&bin_path);
        let _ = fs::remove_file(bin_path.with_extension("meta"));
        total = total.saturating_sub(len);
    }
}

/// 读缓存(默认目录)。任何读失败一律当 miss。
pub fn lookup(pq: &str) -> Option<CachedEntry> {
    lookup_in(&cache_dir(), pq)
}

/// 写缓存(默认目录):单条目 > 8 MiB 不缓存;写入后执行 64 MiB 体量上限淘汰。
pub fn store(pq: &str, content_type: &str, body: &[u8]) {
    store_in(&cache_dir(), pq, content_type, body);
}

/// 写缓存(默认目录),与现有 body 相同则跳过(后台刷新用)。
pub fn store_if_changed(pq: &str, content_type: &str, body: &[u8]) {
    store_if_changed_in(&cache_dir(), pq, content_type, body);
}

/// 该键本次运行是否应做后台刷新:首次返回 true 并登记,之后 false。
pub fn should_revalidate(pq: &str) -> bool {
    REVALIDATED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .insert(pq.to_string())
}

/// 撤销刷新登记(刷新失败时调用),下次命中重试(静默重试语义)。
pub fn unmark_revalidated(pq: &str) {
    REVALIDATED
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .remove(pq);
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    use super::*;

    /// 进程唯一测试目录(pid + 计数器,纯 std,无随机/时间依赖)。
    fn temp_dir() -> PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "display-cache-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).expect("创建测试目录失败");
        dir
    }

    #[test]
    fn cacheable_path_whitelist() {
        assert!(is_cacheable_path("/avatars/u.jpg?t=1"));
        assert!(is_cacheable_path("/avatars/background/u.jpg?t=2"));
        assert!(is_cacheable_path("/storage/icons/a.png"));
        assert!(!is_cacheable_path("/api/profile"));
        assert!(!is_cacheable_path("/huanvae-chat/x.jpg?X-Amz-Signature=abc"));
    }

    #[test]
    fn cache_key_includes_query() {
        let a = cache_file_name("/avatars/u.jpg?t=1").expect("应可编码");
        let b = cache_file_name("/avatars/u.jpg?t=2").expect("应可编码");
        assert_ne!(a, b, "不同 query 必须生成不同文件名");
        let a2 = cache_file_name("/avatars/u.jpg?t=1").expect("应可编码");
        assert_eq!(a, a2, "同串必须同名");
        // hex 超 200 字符(> 100 字节键)不缓存
        let long_pq = format!("/avatars/{}.jpg", "x".repeat(200));
        assert!(cache_file_name(&long_pq).is_none());
    }

    #[test]
    fn store_lookup_roundtrip() {
        let dir = temp_dir();
        let pq = "/avatars/u.jpg?t=1";
        store_in(&dir, pq, "image/jpeg", b"jpegbody");
        let entry = lookup_in(&dir, pq).expect("应命中");
        assert_eq!(entry.body, b"jpegbody");
        assert_eq!(entry.content_type, "image/jpeg");
        assert!(lookup_in(&dir, "/avatars/other.jpg?t=9").is_none(), "未存条目应 miss");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_entry_not_stored() {
        let dir = temp_dir();
        let pq = "/avatars/big.jpg?t=1";
        let body = vec![0u8; MAX_ENTRY_BYTES + 1];
        store_in(&dir, pq, "image/jpeg", &body);
        assert!(lookup_in(&dir, pq).is_none(), "超 8 MiB 条目不应落盘");
        let name = cache_file_name(pq).expect("应可编码");
        assert!(!dir.join(format!("{name}.bin")).exists());
        assert!(!dir.join(format!("{name}.meta")).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cap_evicts_oldest_pair() {
        let dir = temp_dir();
        let old_pq = "/avatars/old.jpg?t=1";
        let new_pq = "/avatars/new.jpg?t=2";
        store_in(&dir, old_pq, "image/jpeg", &[1u8; 100]);
        store_in(&dir, new_pq, "image/jpeg", &[2u8; 100]);
        // 显式回拨旧条目 mtime,避免秒级粒度平局
        let old_name = cache_file_name(old_pq).expect("应可编码");
        let old_bin = dir.join(format!("{old_name}.bin"));
        let f = fs::OpenOptions::new()
            .write(true)
            .open(&old_bin)
            .expect("打开旧条目失败");
        f.set_modified(SystemTime::now() - Duration::from_secs(3600))
            .expect("回拨 mtime 失败");
        drop(f);

        // 总量 200 > 上限 150 → 淘汰最旧一对后 100 ≤ 150 停止
        enforce_cap(&dir, 150);
        assert!(!old_bin.exists(), "旧 .bin 应被淘汰");
        assert!(
            !dir.join(format!("{old_name}.meta")).exists(),
            ".meta 应与 .bin 成对删除"
        );
        assert!(lookup_in(&dir, new_pq).is_some(), "新条目应保留");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn store_if_changed_skips_same_body() {
        let dir = temp_dir();
        let pq = "/avatars/u.jpg?t=1";
        store_in(&dir, pq, "image/jpeg", b"same");
        // 回拨 mtime 作为"未重写"的观测基准(内容相同时 mtime 不应变化)
        let name = cache_file_name(pq).expect("应可编码");
        let bin = dir.join(format!("{name}.bin"));
        let past = SystemTime::now() - Duration::from_secs(3600);
        let f = fs::OpenOptions::new()
            .write(true)
            .open(&bin)
            .expect("打开条目失败");
        f.set_modified(past).expect("回拨 mtime 失败");
        drop(f);

        store_if_changed_in(&dir, pq, "image/jpeg", b"same");
        let mtime_after = fs::metadata(&bin)
            .expect("读元数据失败")
            .modified()
            .expect("读 mtime 失败");
        assert_eq!(mtime_after, past, "内容相同时不应重写文件");

        store_if_changed_in(&dir, pq, "image/png", b"changed");
        let entry = lookup_in(&dir, pq).expect("应命中");
        assert_eq!(entry.body, b"changed", "内容不同时应覆盖 body");
        assert_eq!(entry.content_type, "image/png", "内容不同时应覆盖 content-type");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn revalidate_marking_lifecycle() {
        let pq = "/avatars/reval-test-unique.jpg?t=1";
        assert!(should_revalidate(pq), "首次应返回 true 并登记");
        assert!(!should_revalidate(pq), "二次应返回 false");
        unmark_revalidated(pq);
        assert!(should_revalidate(pq), "撤销登记后应再次返回 true");
    }
}
