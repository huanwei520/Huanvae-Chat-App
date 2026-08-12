//! 断点续传的 sidecar 清单 + 「远端未变」判定（桌面与安卓**共用同一份**）
//!
//! # 为什么是共用而不是各写一份
//!
//! 桌面 `updater_download.rs` 与安卓 `android_update.rs` 是两条独立的下载实现，
//! 但「怎么判断远端还是同一份字节」「清单长什么样」必须是**同一套语义**。
//! 本仓有过教训：同一份字段映射在两处各抄一遍，正是历史上反复丢字段的成因
//! （见 `.claude/CLAUDE.md` 契约链一节）。所以这里只留一份，两端 `use` 它。
//!
//! # 清单的语义（🔴 别和「完成品标记」混）
//!
//! - **清单在** ⇒ 落盘的那个文件是**半截的**，只能接着下；
//! - **完成品标记在**（安卓 `huanvae-chat-update.pending.json`）⇒ 文件**已完整**、可以装。
//!
//! 续传起点只能来自清单。拿完成品标记当续传起点，会把一个已经下完的包重新当半截的写。
//!
//! # 续传的正确性前提
//!
//! 沿用旧字节的唯一合法理由是「远端还是同一份字节」。本模块把这件事收敛成一个
//! **强校验标识**（[`remote_validator`]）：拿不到就 [`can_resume`] 判 false，一律重下。
//! 这不是保守，是正确性 —— 更新源换了内容而沿用旧字节 = 拼出一个坏包。

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

/// 单个分片在落盘文件里的区间与已完成字节数。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ShardProgress {
    pub start: u64,
    pub end: u64,
    pub done: u64,
}

/// sidecar 断点清单。它在盘上就代表「落盘文件是半截的」。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ResumeMeta {
    pub url: String,
    pub total: u64,
    /// 强校验标识，形如 `etag:"abc"` / `lm:Tue, 12 Aug 2026 …`，见 [`remote_validator`]。
    pub validator: String,
    pub shards: Vec<ShardProgress>,
}

/// 把 HEAD 的两个校验头收敛成一个「能证明远端还是同一份字节」的标识。
///
/// - **强 ETag 优先**；
/// - 🔴 **弱 ETag（`W/"…"`）一律不收**：它只保证语义等价、不保证字节相同，
///   RFC 9110 §13.1.3 明确禁止把它用于 `If-Range`，对续传毫无价值；
/// - 没有强 ETag 时退到 `Last-Modified`；
/// - 两者皆无 ⇒ `None` ⇒ 调用方**必须重下**（见 [`can_resume`]）。
pub fn remote_validator(etag: Option<&str>, last_modified: Option<&str>) -> Option<String> {
    if let Some(tag) = etag {
        let t = tag.trim();
        if !t.is_empty() && !t.starts_with("W/") && !t.starts_with("w/") {
            return Some(format!("etag:{t}"));
        }
    }
    last_modified
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| format!("lm:{v}"))
}

/// 从 [`remote_validator`] 的带前缀值还原出能直接放进 `If-Range` 的原值。
pub fn if_range_value(validator: &str) -> &str {
    validator.split_once(':').map(|(_, v)| v).unwrap_or(validator)
}

/// 清单里的分片必须首尾相接、恰好覆盖 `[0,total)`，且每片 `done` 不超过片长。
///
/// 清单是**磁盘上的东西**：可能被截断、被手改、或是上一个版本写的。不校验就会按错误偏移
/// 续写 ⇒ 拼出一个坏包。
pub fn shards_tile_exactly(shards: &[ShardProgress], total: u64) -> bool {
    if shards.is_empty() {
        return false;
    }
    let mut expect = 0u64;
    for s in shards {
        if s.start != expect || s.end < s.start || s.end >= total {
            return false;
        }
        if s.done > s.end - s.start + 1 {
            return false;
        }
        expect = s.end + 1;
    }
    expect == total
}

/// 能不能拿这份清单接着下。
///
/// 🔴 `validator` 为 `None`（服务端既没给强 ETag 也没给 Last-Modified）⇒ **一律不续**。
pub fn can_resume(meta: &ResumeMeta, url: &str, total: u64, validator: Option<&str>) -> bool {
    let Some(v) = validator else {
        return false;
    };
    meta.validator == v
        && meta.url == url
        && meta.total == total
        && shards_tile_exactly(&meta.shards, total)
}

/// 读清单。读不到 / 解析不了一律 `None`（等价于「没有断点」，下次从头下）。
pub fn load_meta(path: &Path) -> Option<ResumeMeta> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// 落一次清单。失败只记日志不中断：清单没写成最多是「下次从头下」，
/// 而中断下载是实打实的功能损失。
pub fn save_meta(path: &Path, meta: &ResumeMeta) {
    match serde_json::to_string(meta) {
        Ok(json) => {
            if let Err(e) = std::fs::write(path, json) {
                eprintln!("[Resume] 写断点清单失败（下次将从头下）: {e}");
            }
        }
        Err(e) => eprintln!("[Resume] 序列化断点清单失败: {e}"),
    }
}

/// 把当前各分片计数器快照成一份可落盘的清单。
///
/// 🔴 读的必须是**活的计数器**而不是 `layout` 里的初始 `done` —— 读错了断点会永远
/// 钉在起点上，下载多久都白搭。
pub fn snapshot_meta(
    url: &str,
    total: u64,
    validator: &str,
    layout: &[ShardProgress],
    counters: &[Arc<AtomicU64>],
) -> ResumeMeta {
    ResumeMeta {
        url: url.to_string(),
        total,
        validator: validator.to_string(),
        shards: layout
            .iter()
            .zip(counters)
            .map(|(s, c)| ShardProgress {
                start: s.start,
                end: s.end,
                done: c.load(Ordering::Relaxed),
            })
            .collect(),
    }
}

/// 把落盘文件与清单一起删掉（丢弃重下 / 完整性校验失败时用）。
pub fn discard_part(part_path: &Path, meta_path: &Path) {
    let _ = std::fs::remove_file(part_path);
    let _ = std::fs::remove_file(meta_path);
}

/// 把分片区间表铺成初始清单（各片 `done = 0`）。
pub fn fresh_layout(ranges: Vec<(u64, u64)>) -> Vec<ShardProgress> {
    ranges
        .into_iter()
        .map(|(start, end)| ShardProgress { start, end, done: 0 })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiled(total: u64, parts: usize, done: &[u64]) -> Vec<ShardProgress> {
        let chunk = total.div_ceil(parts as u64);
        (0..parts as u64)
            .map(|i| i * chunk)
            .take_while(|s| *s < total)
            .enumerate()
            .map(|(i, start)| ShardProgress {
                start,
                end: (start + chunk - 1).min(total - 1),
                done: done[i],
            })
            .collect()
    }

    fn meta_of(total: u64, validator: &str, done: &[u64]) -> ResumeMeta {
        ResumeMeta {
            url: "https://example.invalid/pkg".to_string(),
            total,
            validator: validator.to_string(),
            shards: tiled(total, done.len(), done),
        }
    }

    /// 强 ETag 优先；弱 ETag（`W/`）**必须**被拒 —— 它不保证字节相同，
    /// RFC 9110 §13.1.3 禁止把它用于 `If-Range`，拿它续传就是在赌。
    #[test]
    fn remote_validator_prefers_strong_etag_and_rejects_weak() {
        assert_eq!(
            remote_validator(Some("\"abc\""), Some("Tue, 12 Aug 2026 00:00:00 GMT")),
            Some("etag:\"abc\"".to_string())
        );
        // 弱 ETag ⇒ 退到 Last-Modified，而不是拿弱值凑数
        assert_eq!(
            remote_validator(Some("W/\"abc\""), Some("Tue, 12 Aug 2026 00:00:00 GMT")),
            Some("lm:Tue, 12 Aug 2026 00:00:00 GMT".to_string())
        );
        assert_eq!(remote_validator(Some("w/\"abc\""), None), None);
        // 两者皆无 ⇒ None ⇒ 上层必须重下
        assert_eq!(remote_validator(None, None), None);
        assert_eq!(remote_validator(Some("  "), Some("  ")), None);
    }

    /// `If-Range` 要发的是**原值**，不是我们加的前缀。
    #[test]
    fn if_range_value_strips_our_prefix() {
        assert_eq!(if_range_value("etag:\"abc\""), "\"abc\"");
        assert_eq!(
            if_range_value("lm:Tue, 12 Aug 2026 00:00:00 GMT"),
            "Tue, 12 Aug 2026 00:00:00 GMT"
        );
    }

    /// 🔴 服务端没给任何强校验标识 ⇒ 无法证明远端还是同一份字节 ⇒ **一律不续**。
    /// 谁把这条改成"没有标识就当没变"，就等于允许拼出一个坏包，本测试立刻翻红。
    #[test]
    fn can_resume_refuses_without_validator() {
        let meta = meta_of(8000, "etag:\"v1\"", &[1000; 8]);
        assert!(
            !can_resume(&meta, "https://example.invalid/pkg", 8000, None),
            "拿不到 ETag / Last-Modified 时绝不能续传"
        );
    }

    /// 远端换了内容（validator 变）/ 换了地址 / 长度变了 ⇒ 全部丢弃重下。
    #[test]
    fn can_resume_refuses_when_remote_changed() {
        let meta = meta_of(8000, "etag:\"v1\"", &[1000; 8]);
        let url = "https://example.invalid/pkg";
        assert!(
            !can_resume(&meta, url, 8000, Some("etag:\"v2\"")),
            "ETag 变了必须重下"
        );
        assert!(
            !can_resume(&meta, "https://example.invalid/other", 8000, Some("etag:\"v1\"")),
            "URL 变了必须重下"
        );
        assert!(
            !can_resume(&meta, url, 9000, Some("etag:\"v1\"")),
            "总长变了必须重下"
        );
    }

    /// 正对照：三者全等且清单自洽 ⇒ 必须放行续传。
    /// 否则上面几条"恒 false"也全绿，而线上表现是**断点续传根本没生效**。
    #[test]
    fn can_resume_accepts_identical_remote() {
        let meta = meta_of(8000, "etag:\"v1\"", &[1000, 500, 0, 1000, 1000, 1000, 1000, 1000]);
        assert!(can_resume(
            &meta,
            "https://example.invalid/pkg",
            8000,
            Some("etag:\"v1\"")
        ));
    }

    /// 清单是磁盘上的东西（可能被截断 / 手改 / 是旧版本写的）。
    /// 有空洞、有重叠、越界、或某片 done 超过片长 ⇒ 一律不认，否则会按错误偏移续写。
    #[test]
    fn shards_tile_exactly_rejects_malformed_manifest() {
        let ok = vec![
            ShardProgress { start: 0, end: 99, done: 10 },
            ShardProgress { start: 100, end: 199, done: 100 },
        ];
        assert!(shards_tile_exactly(&ok, 200), "自洽清单必须被接受（正对照）");

        assert!(!shards_tile_exactly(&[], 200), "空清单不认");
        assert!(
            !shards_tile_exactly(
                &[
                    ShardProgress { start: 0, end: 99, done: 0 },
                    ShardProgress { start: 101, end: 199, done: 0 },
                ],
                200
            ),
            "有空洞不认"
        );
        assert!(
            !shards_tile_exactly(
                &[
                    ShardProgress { start: 0, end: 99, done: 0 },
                    ShardProgress { start: 90, end: 199, done: 0 },
                ],
                200
            ),
            "有重叠不认"
        );
        assert!(
            !shards_tile_exactly(&[ShardProgress { start: 0, end: 99, done: 0 }], 200),
            "没覆盖到末字节不认"
        );
        assert!(
            !shards_tile_exactly(&[ShardProgress { start: 0, end: 299, done: 0 }], 200),
            "越过末字节不认"
        );
        assert!(
            !shards_tile_exactly(&[ShardProgress { start: 0, end: 199, done: 201 }], 200),
            "done 超过片长不认（会按错误偏移续写）"
        );
    }

    /// 清单要能原样读回来 —— 它是跨进程的唯一状态，字段名一改就等于所有人的断点作废。
    #[test]
    fn resume_meta_round_trips_through_json() {
        let meta = meta_of(13_766_023, "etag:\"abc-2\"", &[1, 2, 3, 4, 5, 6, 7, 8]);
        let json = serde_json::to_string(&meta).expect("清单必须能序列化");
        let back: ResumeMeta = serde_json::from_str(&json).expect("清单必须能反序列化");
        assert_eq!(meta, back);
        // 字段名钉死：换名字 = 存量断点全部失效
        for key in ["url", "total", "validator", "shards", "start", "end", "done"] {
            assert!(json.contains(&format!("\"{key}\"")), "清单缺字段 {key}: {json}");
        }
    }

    /// [`snapshot_meta`] 必须读**当前计数器**，不是布局里的初始 done。
    #[test]
    fn snapshot_meta_reads_live_counters() {
        let layout = vec![
            ShardProgress { start: 0, end: 99, done: 0 },
            ShardProgress { start: 100, end: 199, done: 0 },
        ];
        let counters = vec![Arc::new(AtomicU64::new(30)), Arc::new(AtomicU64::new(70))];
        let snap = snapshot_meta("u", 200, "etag:\"v\"", &layout, &counters);
        assert_eq!(
            snap.shards.iter().map(|s| s.done).collect::<Vec<_>>(),
            vec![30, 70]
        );
    }

    /// 清单落盘 → 读回 → 判定可续，走一遍真实文件路径（不是只测内存结构）。
    /// 顺带覆盖 [`discard_part`]：丢弃后必须真的读不到了。
    #[test]
    fn manifest_survives_a_disk_round_trip_and_discard_clears_it() {
        let dir = std::env::temp_dir().join(format!(
            "hv-resume-meta-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        let part = dir.join("pkg.part");
        let meta_path = dir.join("pkg.part.json");
        std::fs::write(&part, b"half").expect("写 .part");

        let meta = meta_of(8000, "etag:\"v1\"", &[1000; 8]);
        save_meta(&meta_path, &meta);
        let loaded = load_meta(&meta_path).expect("落盘后必须读得回来");
        assert_eq!(loaded, meta);
        assert!(can_resume(
            &loaded,
            "https://example.invalid/pkg",
            8000,
            Some("etag:\"v1\"")
        ));

        discard_part(&part, &meta_path);
        assert!(load_meta(&meta_path).is_none(), "丢弃后清单必须不在了");
        assert!(!part.exists(), "丢弃后 .part 必须不在了");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 损坏 / 半截的清单文件必须当作「没有断点」，而不是 panic 或读出半个结构。
    #[test]
    fn corrupt_manifest_is_treated_as_no_resume_point() {
        let dir = std::env::temp_dir().join(format!("hv-resume-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("建临时目录");
        let meta_path = dir.join("bad.part.json");
        std::fs::write(&meta_path, b"{\"url\":\"x\",\"total\":").expect("写半截 JSON");
        assert!(load_meta(&meta_path).is_none(), "半截 JSON 必须读成 None");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fresh_layout_starts_every_shard_at_zero() {
        let layout = fresh_layout(vec![(0, 99), (100, 199)]);
        assert_eq!(layout.iter().map(|s| s.done).sum::<u64>(), 0);
        assert!(shards_tile_exactly(&layout, 200));
    }
}
