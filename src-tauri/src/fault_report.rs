//! 故障记录检测 —— Rust 侧采集模块（追加层，不改既有日志系统语义）
//!
//! 【接入形态】实现 `log::Log` facade：本模块是**追加层** —— 既有代码的 `println!`
//! 输出保持原样不受影响（不改语义）；安装本层后，任何走 `log` 门面的新增日志在
//! 输出到 stdout 的同时进入本模块的脱敏环形缓冲，供前端组包故障报告时拉取。
//!
//! 【脱敏红线】写入缓冲前强制按模式脱敏（Bearer/token=/password=/secret=/authorization 头/
//! JSON 同名字段/长 hex 串），与前端 sanitizer 模式集一致。
//!
//! 【聊天正文零采集】本模块只接 `log` 门面与显式命令，不触碰任何消息存储/渲染路径。
//!
//! 【命令】
//! - `fault_report_get_rust_logs(since_ms)`  拉取缓冲（前端组包用）
//! - `fault_report_device_info()`            平台/系统版本/架构/机型/App 版本
//! - `fault_report_machine_code_hash()`      机器码哈希（SHA-256 hex，不落原始机器码）
//!
//! @module src-tauri/src/fault_report.rs

use std::io::Write;

use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::Serialize;
use sha2::{Digest, Sha256};

/// 缓冲字节上限：10MB，超限滚动丢弃最旧
pub const BUFFER_MAX_BYTES: usize = 10 * 1024 * 1024;

/// 脱敏占位符
pub const REDACTED: &str = "[REDACTED]";

// ============================================
// 环形缓冲
// ============================================

#[derive(Debug, Clone, Serialize)]
pub struct FaultLogEntry {
    /// epoch ms
    pub at: i64,
    /// 级别（error/warn/info/debug/trace）
    pub level: String,
    /// 已脱敏文本
    pub text: String,
}

#[derive(Default)]
struct RingBuffer {
    entries: Vec<FaultLogEntry>,
    bytes: usize,
    dropped: usize,
}

impl RingBuffer {
    fn push(&mut self, entry: FaultLogEntry) {
        let size = entry.text.len() + 64;
        if size > BUFFER_MAX_BYTES {
            self.dropped += 1;
            return;
        }
        while self.bytes + size > BUFFER_MAX_BYTES && !self.entries.is_empty() {
            if let Some(oldest) = self.entries.first() {
                self.bytes -= oldest.text.len() + 64;
                self.entries.remove(0);
                self.dropped += 1;
            }
        }
        self.bytes += size;
        self.entries.push(entry);
    }

    fn since(&self, since_ms: i64) -> Vec<FaultLogEntry> {
        self.entries.iter().filter(|e| e.at >= since_ms).cloned().collect()
    }
}

static BUFFER: Lazy<Mutex<RingBuffer>> = Lazy::new(|| Mutex::new(RingBuffer::default()));

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ============================================
// 脱敏（写入前强制；模式与前端 sanitizer 对齐）
// ============================================

/// 判定键名是否属于脱敏键集合
fn is_sensitive_key(name: &str) -> bool {
    let normalized: String = name
        .to_lowercase()
        .chars()
        .filter(|c| *c != '_' && *c != '-' && *c != ' ')
        .collect();
    matches!(
        normalized.as_str(),
        "accesstoken" | "refreshtoken" | "idtoken" | "authtoken" | "token" | "password" | "passwd"
            | "pwd" | "secret" | "clientsecret" | "apikey" | "accesskey" | "privatekey"
            | "sessionid" | "cookie" | "authorization"
    )
}

fn is_key_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'-'
}

/// UTF-8 首字节 → 该字符总字节数（非法首字节按 1 处理，保证不 panic）
fn utf8_char_len(first: u8) -> usize {
    if first < 0x80 {
        1
    } else if first >> 5 == 0b110 {
        2
    } else if first >> 4 == 0b1110 {
        3
    } else if first >> 3 == 0b11110 {
        4
    } else {
        1
    }
}

/// 在 `pos` 处尝试识别敏感键名形态：
/// - 裸键：`token=xxx` / `token: xxx`（含键后空白）
/// - 引号键（JSON 形态）：`"token" : "xxx"`
///   返回 (替换起点, 键名结束, 值起点)；替换起点包含前导引号（若有），调用方重建该段。
fn try_match_sensitive_kv(input: &str, pos: usize) -> Option<(usize, usize, usize)> {
    let b = input.as_bytes();
    let mut i = pos;

    // 形态 A：JSON 引号键 `"key" :`
    let quoted = b.get(i) == Some(&b'"');
    if quoted {
        i += 1;
    }
    let key_start = i;
    let mut key_end = i;
    while key_end < b.len() && is_key_char(b[key_end]) {
        key_end += 1;
    }
    if key_end == key_start || key_end - key_start < 3 || key_end - key_start > 20 {
        return None;
    }
    let key = input.get(key_start..key_end)?;
    if !is_sensitive_key(key) {
        return None;
    }
    let mut j = key_end;
    if quoted {
        if b.get(j) != Some(&b'"') {
            return None;
        }
        j += 1;
    }
    while j < b.len() && (b[j] as char).is_whitespace() {
        j += 1;
    }
    if j >= b.len() || (b[j] != b'=' && b[j] != b':') {
        return None;
    }
    j += 1;
    while j < b.len() && (b[j] as char).is_whitespace() {
        j += 1;
    }
    Some((pos, key_end, j))
}

/// 跳过一个完整值：带引号则到配对引号，否则到空白/&/;/,/}/引号 为止
fn skip_value(input: &str, start: usize) -> usize {
    let b = input.as_bytes();
    let mut j = start;
    if j < b.len() && (b[j] == b'"' || b[j] == b'\'') {
        let quote = b[j];
        j += 1;
        while j < b.len() && b[j] != quote {
            j += 1;
        }
        if j < b.len() {
            j += 1;
        }
        return j;
    }
    while j < b.len() {
        let c = b[j];
        if c.is_ascii_whitespace() || matches!(c, b'&' | b';' | b',' | b'}' | b'"' | b'\'') {
            break;
        }
        j += 1;
    }
    j
}

fn starts_with_ignore_case(s: &str, prefix: &str) -> bool {
    // 字节级前缀比较：str 切片会在多字节 UTF-8 字符中间 panic，字节切片不会
    let sb = s.as_bytes();
    let pb = prefix.as_bytes();
    sb.len() >= pb.len() && sb[..pb.len()].eq_ignore_ascii_case(pb)
}

/// 对一条日志文本做脱敏（幂等）。模式：
/// 敏感键值对（裸键/JSON 引号键）、Bearer 载荷、authorization 头（行首）、长 hex 串（≥32 位）。
pub fn sanitize_for_fault_log(input: &str) -> String {
    let b = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    let mut line_start = true;

    while i < b.len() {
        // 0) authorization 头（仅行首，整行替换为 header: [REDACTED]；
        //    必须先于 KV 分支 —— "authorization: Bearer xxx" 的值含两段，KV 只吞第一段会漏掉 token 本体）
        if line_start && starts_with_ignore_case(&input[i..], "authorization") {
            let rest = &input[i..];
            let colon = rest.find(':');
            let head_ascii = colon
                .map(|c| c <= 20 && rest[..c].bytes().all(|x| x.is_ascii_alphabetic() || x == b' '))
                .unwrap_or(false);
            if head_ascii {
                out.push_str(&rest[..=colon.unwrap()]);
                out.push_str(REDACTED);
                i = b.len();
                continue;
            }
        }

        // 1) 敏感键值对（含 JSON 引号键）
        if let Some((_seg_start, key_end, value_start)) = try_match_sensitive_kv(input, i) {
            out.push_str(&input[i..key_end]);
            out.push_str(&input[key_end..value_start]);
            out.push_str(REDACTED);
            i = skip_value(input, value_start);
            line_start = false;
            continue;
        }

        // 2) Bearer <token>
        if starts_with_ignore_case(&input[i..], "bearer ") {
            out.push_str("Bearer ");
            out.push_str(REDACTED);
            i = skip_value(input, i + 7);
            line_start = false;
            continue;
        }

        // 4) 长十六进制串（≥32 位）
        if b[i].is_ascii_hexdigit() {
            let mut j = i;
            while j < b.len() && b[j].is_ascii_hexdigit() {
                j += 1;
            }
            if j - i >= 32 {
                out.push_str(REDACTED);
            } else {
                out.push_str(&input[i..j]);
            }
            i = j;
            line_start = false;
            continue;
        }

        // 5) 普通字符：按完整 UTF-8 字符拷贝（保证不跨字符边界切片）
        let ch_len = utf8_char_len(b[i]).min(b.len() - i);
        out.push_str(&input[i..i + ch_len]);
        i += ch_len;
        line_start = b[i - 1] == b'\n';
    }

    out
}

// ============================================
// log facade 追加层
// ============================================

/// 追加层 Logger：stdout 透传（保持可见性）+ 脱敏入缓冲。
pub struct FaultReportLogger;

impl log::Log for FaultReportLogger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Debug
    }

    fn log(&self, record: &log::Record) {
        // 1) stdout 透传（与既有 println! 输出形态一致，不改语义）
        let line = format!("[{}] {}", record.level(), record.args());
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{}", line);
        let _ = out.flush();
        // 2) 脱敏后入缓冲（写入前脱敏 —— 红线）
        let at = now_ms();
        let text = sanitize_for_fault_log(&line);
        BUFFER.lock().push(FaultLogEntry { at, level: record.level().to_string(), text });
    }

    fn flush(&self) {}
}

/// 安装追加层（幂等；App 启动时调用一次）。
/// 注意：`log::set_boxed_logger` 仅首次成功，重复安装安全忽略。
pub fn init() {
    let _ = log::set_boxed_logger(Box::new(FaultReportLogger));
    log::set_max_level(log::LevelFilter::Info);
}

// ============================================
// 机器码哈希 / 设备信息
// ============================================

/// 机器码哈希：SHA-256(MAC 地址) hex 小写；MAC 不可用时退化 SHA-256(主机名+OS+arch)。
/// 只输出哈希，绝不输出原始机器码。
pub fn machine_code_hash() -> String {
    let raw = best_effort_machine_id();
    let digest = Sha256::digest(raw.as_bytes());
    digest.iter().map(|b| format!("{:02x}", b)).collect()
}

fn best_effort_machine_id() -> String {
    #[cfg(not(target_os = "ios"))]
    {
        if let Ok(Some(mac)) = mac_address::get_mac_address() {
            return format!("mac:{}", mac);
        }
    }
    let host = std::env::var("HOSTNAME").unwrap_or_else(|_| "unknown-host".to_string());
    format!("fallback:{}:{}:{}", host, std::env::consts::OS, std::env::consts::ARCH)
}

#[derive(Serialize)]
pub struct FaultDeviceInfo {
    pub platform: String,
    pub os_version: String,
    pub arch: String,
    pub model: String,
    pub app_version: String,
}

// ============================================
// Tauri 命令
// ============================================

#[tauri::command]
pub fn fault_report_get_rust_logs(since_ms: Option<i64>) -> Vec<FaultLogEntry> {
    BUFFER.lock().since(since_ms.unwrap_or(0))
}

#[tauri::command]
pub fn fault_report_device_info(app: tauri::AppHandle) -> FaultDeviceInfo {
    let os_version = os_info();
    FaultDeviceInfo {
        platform: std::env::consts::OS.to_string(),
        os_version,
        arch: std::env::consts::ARCH.to_string(),
        model: device_model(),
        app_version: app
            .package_info()
            .version
            .to_string(),
    }
}

#[tauri::command]
pub fn fault_report_machine_code_hash() -> String {
    machine_code_hash()
}

fn os_info() -> String {
    #[cfg(target_os = "android")]
    {
        // Android: /system/build.prop 的 ro.build.version.release
        std::fs::read_to_string("/proc/version")
            .ok()
            .and_then(|s| s.lines().next().map(|l| l.trim().to_string()))
            .unwrap_or_else(|| "android".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        std::fs::read_to_string("/etc/os-release")
            .ok()
            .and_then(|s| {
                s.lines().find(|l| l.starts_with("PRETTY_NAME=")).map(|l| {
                    l.trim_start_matches("PRETTY_NAME=").trim_matches('"').to_string()
                })
            })
            .unwrap_or_else(|| std::env::consts::OS.to_string())
    }
}

fn device_model() -> String {
    #[cfg(target_os = "android")]
    {
        std::fs::read_to_string("/sys/devices/soc0/machine")
            .or_else(|_| std::fs::read_to_string("/proc/device-tree/model"))
            .map(|s| s.trim().trim_end_matches('\0').to_string())
            .unwrap_or_else(|_| "android-device".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        hostname().unwrap_or_else(|| "unknown".to_string())
    }
}

fn hostname() -> Option<String> {
    std::fs::read_to_string("/etc/hostname").ok().map(|s| s.trim().to_string())
}

// ============================================
// 单测（脱敏 / 环形缓冲滚动丢弃 / 机器码哈希格式）
// ============================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_bearer_token() {
        let out = sanitize_for_fault_log("请求头已带 Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig");
        assert!(!out.contains("eyJhbGciOiJIUzI1NiJ9"), "raw bearer leaked: {}", out);
        assert!(out.contains(&format!("Bearer {}", REDACTED)));
    }

    #[test]
    fn sanitize_authorization_header_line() {
        let out = sanitize_for_fault_log("authorization: Bearer abc");
        assert!(!out.contains("abc"), "out={}", out);
        assert!(out.contains("authorization:"));
        assert!(out.contains(REDACTED));
    }

    #[test]
    fn sanitize_kv_forms() {
        for src in [
            "token=abc123",
            "token: abc123",
            "password=hunter2",
            "secret=my-secret-val",
            "refresh_token=xyz",
            "api_key=AKIA123",
            "access_token=qwe",
        ] {
            let out = sanitize_for_fault_log(src);
            assert!(!out.contains("abc123"), "src={} out={}", src, out);
            assert!(!out.contains("hunter2"), "src={} out={}", src, out);
            assert!(!out.contains("my-secret-val"), "src={} out={}", src, out);
            assert!(out.contains(REDACTED), "src={} out={}", src, out);
        }
    }

    #[test]
    fn sanitize_json_fields() {
        let src = r#"{"user_id":"u1","token":"s3cr3t","password":"pw12345","note":"ok"}"#;
        let out = sanitize_for_fault_log(src);
        assert!(!out.contains("s3cr3t"), "out={}", out);
        assert!(!out.contains("pw12345"), "out={}", out);
        assert!(out.contains("\"token\":"));
        assert!(out.contains("u1"), "非敏感字段不应被误伤: {}", out);
    }

    #[test]
    fn sanitize_long_hex_and_idempotent() {
        let hex = "a".repeat(40);
        let out1 = sanitize_for_fault_log(&format!("resp body sig={}", hex));
        assert!(!out1.contains(&hex), "out={}", out1);
        let out2 = sanitize_for_fault_log(&out1);
        assert_eq!(out1, out2, "脱敏应幂等");
    }

    #[test]
    fn sanitize_keeps_normal_text() {
        let src = "GET /api/messages?since=123 ok 200";
        assert_eq!(sanitize_for_fault_log(src), src);
    }

    #[test]
    fn ring_buffer_evicts_oldest_on_overflow() {
        let mut rb = RingBuffer::default();
        // 灌入超过 10MB 的短条目
        let n = (BUFFER_MAX_BYTES / 128) + 100;
        for k in 0..n {
            rb.push(FaultLogEntry { at: k as i64, level: "info".into(), text: "x".repeat(64) });
        }
        assert!(rb.bytes <= BUFFER_MAX_BYTES, "bytes={} 超上限", rb.bytes);
        assert!(rb.dropped > 0, "应有滚动丢弃");
        assert!(rb.entries.len() < n);
        // 最旧的已被丢弃：since(0) 里不存在 at=0
        assert!(rb.since(0).first().map(|e| e.at).unwrap_or(i64::MAX) > 0);
    }

    #[test]
    fn machine_code_hash_format() {
        let h = machine_code_hash();
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[tokio::test]
    async fn tauri_command_get_rust_logs_since() {
        let at = now_ms();
        BUFFER.lock().push(FaultLogEntry { at, level: "info".into(), text: "标记条目".into() });
        let all = fault_report_get_rust_logs(None);
        assert!(all.iter().any(|e| e.text == "标记条目"));
        let future = fault_report_get_rust_logs(Some(at + 1_000_000));
        assert!(future.is_empty() || future.iter().all(|e| e.at >= at + 1_000_000));
    }
}
