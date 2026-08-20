//! 视频封面本地持久化（截一次帧 → 落盘 → 索引 → 之后走本地图片）
//!
//! ## 为什么需要它
//!
//! 视频缩略图此前的全部机制就是 `<video src="…#t=0.1" preload="metadata">`：靠引擎现拉元数据、
//! seek 到 0.1s、把那一帧画出来。那一帧只存在于该 `<video>` 元素里 —— 元素一销毁就没了。
//! 于是**每次挂载都要重来一遍**（切回会话、进「查找记录 → 视频」、杀掉 App 重开），
//! 表现就是用户说的「先黑再显示 / 每次都重新加载」。全仓此前**没有任何封面产物**：
//! 没有 `poster` 属性、服务端不下发缩略图字段、本地也不存帧。
//!
//! 本模块补上缺的那一环：前端在**首次**画出首帧时把它截成 JPEG 交给这里落盘，
//! 之后缩略图直接渲染 `<img>` 读本地文件，`<video>` 元素连建都不用建。
//!
//! ## 与图片本地缓存严格同款（「和图片的加载一样」是硬约束）
//!
//! | 环节 | 图片（既有） | 封面（本模块） |
//! |------|-------------|---------------|
//! | 落盘根 | `data/{user}_{server}/file/pictures/` | `…/file/posters/`（同一个缓存根的平级目录） |
//! | 索引 | `file_mappings` 表（`file_hash -> local_path`，**未改**） | `video_posters` 表（`file_key -> local_path`） |
//! | 读取 | `download::get_cached_file_path`：查库 → `stat` 实际文件 → 不在就删映射返 `None` | `get_video_poster_path`：同款三步 |
//! | 显示 | `convertFileSrc(local_path)`（asset 协议） | 同一个 `localPathToDisplaySrc`（`src/services/assetUrl.ts`） |
//! | 登出清理 | `clear_all_data` DELETE | 同批 DELETE |
//!
//! 键（`file_key`）是什么、2026-08-16 为什么从内容哈希改成「文件身份键」：
//! 见 `db::video_posters` 模块头。一句话：封面要在**下载之前**就出得来，
//! 而内容哈希只有下载完才算得出，所以消息面必须用 `file_uuid` 当键。

use crate::db;
use crate::user_data;

/// 封面统一编码成 JPEG（前端 canvas 出的就是 JPEG，扩展名固定，不从文件名猜）
const POSTER_EXTENSION: &str = "jpg";

/// 单张封面允许的最大字节数（前端已把长边压到 480px、质量 0.7，实测十几 KB；
/// 这个上限只用来挡住"显然不是缩略图"的输入，不是调优参数）。
const MAX_POSTER_BYTES: usize = 4 * 1024 * 1024;

/// 由 `file_key` 推出封面文件名；`file_key` 不是纯 `[0-9A-Za-z_-]` 时返回 `None`。
///
/// 🔴 这个校验不是装饰：`file_key` 来自本地消息行（其值最终源自服务端下发），
/// 直接 `join` 进目录就是**路径穿越**（`../../…`）。两种合法形态（64 位十六进制哈希、
/// 带连字符的 `file_uuid`）本来就只可能是这几类字符，所以这里用**白名单拒绝**而不是替换
/// —— 替换会把两个不同的输入折叠成同一个文件名。
pub fn poster_file_name(file_key: &str) -> Option<String> {
    if file_key.is_empty() || file_key.len() > 128 {
        return None;
    }
    if !file_key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some(format!("{}.{}", file_key, POSTER_EXTENSION))
}

/// 获取视频封面的本地路径（本地优先加载的读侧）
///
/// 三步与 `download::get_cached_file_path` 一一对应：
/// 1. 查 `video_posters` 表
/// 2. `stat` 实际文件（用户手动清过缓存目录 / 换过机器时，库里那行是陈的）
/// 3. 文件不在 → 删掉该行并返回 `None`，让前端重新截一次
#[tauri::command(rename_all = "camelCase")]
pub fn get_video_poster_path(file_key: String) -> Result<Option<String>, String> {
    match db::get_video_poster(&file_key) {
        Ok(Some(path)) => {
            if std::path::Path::new(&path).exists() {
                return Ok(Some(path));
            }
            let _ = db::delete_video_poster(&file_key);
            Ok(None)
        }
        Ok(None) => Ok(None),
        Err(e) => Err(e),
    }
}

/// 作废一条封面缓存（自愈侧）：删文件 + 删索引
///
/// 🔴 为什么需要它：封面是**永久缓存**，一张黑帧一旦落盘就会每次命中 —— 用户此后每次都错，
/// 而且系统自己不会恢复。前端在**读**到封面时会解码回像素判一次「是不是（近）全黑」，
/// 判黑就调本命令把那条作废，下次挂载即退回「重新截一帧」。
///
/// 只堵写入口是不够的：用户设备上可能已经存着旧版本 / 别的构建写进去的黑帧。
///
/// 文件删除失败**不当作错误**（可能已被用户手工清掉）；真正要保证的是**索引一定被删掉** ——
/// 索引还在而文件没了，`get_video_poster_path` 那一步也会把它清掉，两条路径收敛到同一结果。
#[tauri::command(rename_all = "camelCase")]
pub fn invalidate_video_poster(file_key: String) -> Result<(), String> {
    if let Ok(Some(path)) = db::get_video_poster(&file_key)
        && let Err(e) = std::fs::remove_file(&path)
    {
        println!("[VideoPoster] 删除黑帧封面文件失败（继续删索引）: {} ({})", path, e);
    }
    db::delete_video_poster(&file_key)?;
    println!("[VideoPoster] 已作废封面（黑帧自愈）: {}", file_key);
    Ok(())
}

/// 保存前端截出来的封面帧（写侧），返回落盘路径
///
/// `bytes` 是前端 `canvas.toBlob('image/jpeg')` 的原始字节。走 `Vec<u8>` 而不是 base64
/// data URL：少一次 33% 膨胀 + 少一层解码，也不必为此给移动端引入 base64 依赖。
#[tauri::command(rename_all = "camelCase")]
pub fn save_video_poster(file_key: String, bytes: Vec<u8>) -> Result<String, String> {
    let file_name = poster_file_name(&file_key)
        .ok_or_else(|| format!("非法的 file_key，拒绝落盘: {}", file_key))?;

    if bytes.is_empty() {
        return Err("封面数据为空".to_string());
    }
    if bytes.len() > MAX_POSTER_BYTES {
        return Err(format!("封面数据过大: {} 字节", bytes.len()));
    }

    let user_ctx =
        user_data::get_current_user().ok_or_else(|| "未登录，无法保存视频封面".to_string())?;
    let dir = user_data::get_user_posters_dir(&user_ctx.user_id, &user_ctx.server_url);
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建封面目录失败: {}", e))?;

    let path = dir.join(file_name);
    std::fs::write(&path, &bytes).map_err(|e| format!("写入封面失败: {}", e))?;

    let path_str = path.to_string_lossy().to_string();
    db::save_video_poster(&file_key, &path_str)?;

    println!(
        "[VideoPoster] 已保存封面: {} ({} 字节)",
        path_str,
        bytes.len()
    );
    Ok(path_str)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_hash_becomes_jpg_file_name() {
        assert_eq!(
            poster_file_name("a1b2c3d4e5f6"),
            Some("a1b2c3d4e5f6.jpg".to_string())
        );
        // 真实形态：64 位十六进制 sha256
        let sha = "e".repeat(64);
        assert_eq!(poster_file_name(&sha), Some(format!("{}.jpg", sha)));
        // 允许的另外两个字符
        assert_eq!(poster_file_name("A_b-9"), Some("A_b-9.jpg".to_string()));
        // 另一种真实形态（2026-08-16 起消息面用的就是它）：带连字符的 file_uuid
        let uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
        assert_eq!(poster_file_name(uuid), Some(format!("{}.jpg", uuid)));
    }

    #[test]
    fn path_traversal_and_separators_are_rejected() {
        // 这几条是本函数存在的唯一理由：任何一条被放行都能写到缓存目录之外
        assert_eq!(poster_file_name("../../etc/passwd"), None);
        assert_eq!(poster_file_name("a/b"), None);
        assert_eq!(poster_file_name("a\\b"), None);
        assert_eq!(poster_file_name(".."), None);
        assert_eq!(poster_file_name("a.b"), None); // 点号也不在白名单里
        assert_eq!(poster_file_name("C:name"), None);
    }

    #[test]
    fn empty_and_overlong_hashes_are_rejected() {
        assert_eq!(poster_file_name(""), None);
        assert_eq!(poster_file_name(&"a".repeat(129)), None);
        // 边界内仍接受
        assert!(poster_file_name(&"a".repeat(128)).is_some());
    }
}
