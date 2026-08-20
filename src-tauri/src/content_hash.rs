//! 文件内容身份哈希（采样 SHA-256）—— 与上传侧 TS 实现**同一套算法**
//!
//! ## 它是什么、为什么在这里
//!
//! 两层键里的**第二层**：`file_uuid` 是对象身份（快路径的键），本模块算的是**内容身份**
//! （去重的键、`file_mappings` 的主键）。后端接收面已不再下发 `file_hash`，所以
//! **接收方必须在下载完成后自己算一次**，否则同一份内容会被当成两份各存一遍。
//!
//! ## 算法必须与 `src/hooks/useFileUpload.ts` 的 `calculateSHA256` 逐字节一致
//!
//! 上传侧算出来的值会随上传请求发给后端并落库；个人文件面（`GET /api/storage/files`）
//! 至今仍下发它。两边算法一旦漂移，**同一份文件在"我上传的"与"我收到的"两条路径下会得到
//! 两个不同的键** ⇒ 去重失效、缓存互不命中。所以这里不是"另写一个哈希"，是**移植**：
//!
//! ```text
//! prefix = "|size:{字节数}|"                                   （ASCII，先喂进 digest）
//! size <= 30MiB : digest(prefix ‖ 整个文件)
//! size >  30MiB : digest(prefix ‖ 开头 10MiB ‖ 中间 10MiB ‖ 结尾 10MiB)
//!                 中间起点 = floor((size - 10MiB) / 2)
//! 输出            = 小写十六进制
//! ```
//!
//! 对应 TS：`SAMPLE_SIZE = 10 * 1024 * 1024`、`file.size <= SAMPLE_SIZE * 3` 走完整哈希、
//! `middleStart = Math.floor((file.size - SAMPLE_SIZE) / 2)`。
//!
//! ## 为什么流式喂而不是先拼成一个大 buffer
//!
//! TS 侧受 `crypto.subtle.digest` 只吃整块 buffer 的限制，必须先把 30MiB 拼出来；
//! Rust 侧 `Sha256` 是增量的，**按同样的顺序**喂进去结果完全相同，却不用一次占 30MiB 内存
//! （下载线程上跑，视频动辄几百 MB）。**顺序即契约**，改动顺序 = 改动哈希。

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use sha2::{Digest, Sha256};

/// 采样块大小（10 MiB），与 TS `SAMPLE_SIZE` 同值。
const SAMPLE_SIZE: u64 = 10 * 1024 * 1024;

/// 小于等于该值走"完整哈希"，与 TS `SAMPLE_SIZE * 3` 同值（30 MiB）。
const FULL_HASH_LIMIT: u64 = SAMPLE_SIZE * 3;

/// 单次读盘的缓冲（1 MiB）——只影响 IO 次数，不影响结果。
const READ_CHUNK: usize = 1024 * 1024;

/// 从 `reader` 的当前位置起，把恰好 `len` 字节喂进 `hasher`。
///
/// 读不满 `len` 直接报错：宁可失败也不能悄悄少喂几个字节 —— 那会算出一个
/// "看着正常但和上传侧对不上"的哈希，而这种错**没有任何地方会报**。
fn feed_exact<R: Read>(hasher: &mut Sha256, reader: &mut R, len: u64) -> Result<(), String> {
    let mut remaining = len;
    let mut buf = vec![0u8; READ_CHUNK];
    while remaining > 0 {
        let want = std::cmp::min(remaining, READ_CHUNK as u64) as usize;
        let got = reader
            .read(&mut buf[..want])
            .map_err(|e| format!("读取文件失败: {}", e))?;
        if got == 0 {
            return Err(format!("文件提前结束：还差 {} 字节", remaining));
        }
        hasher.update(&buf[..got]);
        remaining -= got as u64;
    }
    Ok(())
}

/// 计算本地文件的内容身份哈希（采样 SHA-256，小写十六进制）。
///
/// 与 `src/hooks/useFileUpload.ts` 的 `calculateSHA256` 同算法（见模块头）。
pub fn sampled_sha256_of_file(path: &Path) -> Result<String, String> {
    let size = std::fs::metadata(path)
        .map_err(|e| format!("读取文件元信息失败: {}", e))?
        .len();
    let mut file = File::open(path).map_err(|e| format!("打开文件失败: {}", e))?;

    let mut hasher = Sha256::new();
    // 文件大小前缀（TS: `new TextEncoder().encode(\`|size:${file.size}|\`)`）
    hasher.update(format!("|size:{}|", size).as_bytes());

    if size <= FULL_HASH_LIMIT {
        feed_exact(&mut hasher, &mut file, size)?;
    } else {
        // 开头 10MiB
        feed_exact(&mut hasher, &mut file, SAMPLE_SIZE)?;
        // 中间 10MiB（起点与 TS 的 Math.floor((size - SAMPLE)/2) 逐字对齐）
        let middle_start = (size - SAMPLE_SIZE) / 2;
        file.seek(SeekFrom::Start(middle_start))
            .map_err(|e| format!("定位文件失败: {}", e))?;
        feed_exact(&mut hasher, &mut file, SAMPLE_SIZE)?;
        // 结尾 10MiB
        file.seek(SeekFrom::Start(size - SAMPLE_SIZE))
            .map_err(|e| format!("定位文件失败: {}", e))?;
        feed_exact(&mut hasher, &mut file, SAMPLE_SIZE)?;
    }

    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// 把 TS 那套算法在测试里**独立重算一遍**（先拼 buffer，与 TS 的写法同构），
    /// 用来证明上面的"流式喂"没有改变结果 —— 不是拿实现去证明实现。
    fn reference_hash(bytes: &[u8]) -> String {
        let size = bytes.len() as u64;
        let mut data: Vec<u8> = format!("|size:{}|", size).into_bytes();
        if size <= FULL_HASH_LIMIT {
            data.extend_from_slice(bytes);
        } else {
            let s = SAMPLE_SIZE as usize;
            let middle_start = ((size - SAMPLE_SIZE) / 2) as usize;
            data.extend_from_slice(&bytes[..s]);
            data.extend_from_slice(&bytes[middle_start..middle_start + s]);
            data.extend_from_slice(&bytes[bytes.len() - s..]);
        }
        let mut h = Sha256::new();
        h.update(&data);
        hex::encode(h.finalize())
    }

    fn write_temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("hv-content-hash-{}-{}", std::process::id(), name));
        let mut f = File::create(&p).expect("建临时文件失败");
        f.write_all(bytes).expect("写临时文件失败");
        f.sync_all().expect("落盘失败");
        p
    }

    #[test]
    fn small_file_matches_reference_full_hash() {
        let bytes: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let p = write_temp("small", &bytes);
        assert_eq!(sampled_sha256_of_file(&p).unwrap(), reference_hash(&bytes));
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn empty_file_is_prefix_only() {
        let p = write_temp("empty", &[]);
        let mut h = Sha256::new();
        h.update(b"|size:0|");
        assert_eq!(sampled_sha256_of_file(&p).unwrap(), hex::encode(h.finalize()));
        let _ = std::fs::remove_file(&p);
    }

    /// 大小是哈希的一部分 —— 内容相同但长度不同必须给出不同的键。
    #[test]
    fn size_prefix_makes_different_lengths_differ() {
        let a = write_temp("len-a", &[7u8; 16]);
        let b = write_temp("len-b", &[7u8; 17]);
        assert_ne!(
            sampled_sha256_of_file(&a).unwrap(),
            sampled_sha256_of_file(&b).unwrap()
        );
        let _ = std::fs::remove_file(&a);
        let _ = std::fs::remove_file(&b);
    }

    /// 走采样分支（> 30MiB）：与"先拼 buffer"的参考实现逐字符相同，
    /// 且**中段字节确实参与了哈希**（改中段必须变值）——排除"只哈希了头尾"的假实现。
    #[test]
    fn large_file_samples_head_middle_tail() {
        let size = (FULL_HASH_LIMIT + 4096) as usize;
        let mut bytes: Vec<u8> = (0..size).map(|i| (i % 253) as u8).collect();
        let p = write_temp("large", &bytes);
        assert_eq!(sampled_sha256_of_file(&p).unwrap(), reference_hash(&bytes));
        let before = sampled_sha256_of_file(&p).unwrap();
        let _ = std::fs::remove_file(&p);

        // 改动中段采样窗口内的一个字节
        let middle_start = ((size as u64 - SAMPLE_SIZE) / 2) as usize;
        bytes[middle_start + 5] ^= 0xFF;
        let p2 = write_temp("large-mut", &bytes);
        assert_ne!(sampled_sha256_of_file(&p2).unwrap(), before);
        let _ = std::fs::remove_file(&p2);
    }

    /// 负对照：不存在的路径必须报错，而不是给出某个"看着像哈希"的值。
    #[test]
    fn missing_file_errors() {
        let p = std::env::temp_dir().join("hv-content-hash-definitely-not-here");
        assert!(sampled_sha256_of_file(&p).is_err());
    }
}
