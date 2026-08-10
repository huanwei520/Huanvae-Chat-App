//! 消息操作模块
//!
//! 处理本地消息的增删改查，包括：
//! - `get_messages`: 分页获取会话消息（支持 before_seq 游标）
//! - `save_message`: 保存单条消息
//! - `save_messages`: 批量保存消息（使用事务，INSERT OR REPLACE — 以服务器为准）
//! - `save_messages_skip_existing`: 批量插入消息（INSERT OR IGNORE — 仅补本地缺失，不覆盖本地状态）
//! - `mark_message_recalled`: 标记消息为已撤回
//! - `mark_message_deleted`: 标记消息为已删除（软删除）
//! - `search_messages`: 搜消息内容（FTS5 主路径 + LIKE fallback；可按会话 + content_type 过滤）
//! - `list_conversation_messages`: 会话内按分类浏览（关键词可选）+ LIMIT/OFFSET 分页
//!
//! ## 消息排序
//!
//! 消息按 seq DESC 排序返回，seq=0 的消息（未同步）优先按 send_time 排序。
//! 前端使用 `flex-direction: column-reverse` 容器正确显示消息顺序。

use rusqlite::{params, Connection};

use super::types::{LocalMessage, MessageSearchFilter, SearchMessageResult};
use super::{with_db, DB};

/// 获取会话的消息列表
pub fn get_messages(
    conversation_id: &str,
    limit: i64,
    before_seq: Option<i64>,
) -> Result<Vec<LocalMessage>, String> {
    with_db!(db, { get_messages_with_conn(db, conversation_id, limit, before_seq) })
}

/// `get_messages` 的可注入连接版本
///
/// 拆出来是为了让单测能对 in-memory 连接跑**同一条真实查询** ——
/// 这块最容易出错的是 SELECT 列顺序与 row.get(i) 索引的配对，
/// 测试里另抄一份 SQL 就正好测不到那种漂移（与本文件既有的
/// `search_messages_with_conn` / `list_conversation_messages_with_conn` 同一手法）。
pub fn get_messages_with_conn(
    db: &Connection,
    conversation_id: &str,
    limit: i64,
    before_seq: Option<i64>,
) -> Result<Vec<LocalMessage>, String> {
    {
        // 排序逻辑：seq=0 的消息（未同步的新消息）排在最前面，按 send_time 排序
        // 其他消息按 seq DESC 排序
        let (query, params): (&str, Vec<Box<dyn rusqlite::ToSql>>) = match before_seq {
            Some(seq) => (
                "SELECT message_uuid, conversation_id, conversation_type, sender_id,
                 sender_name, sender_avatar, content, content_type, file_uuid, file_url,
                 file_size, file_hash, image_width, image_height, seq, reply_to,
                 is_recalled, is_deleted, send_time, created_at,
                 media_group_id, media_group_index, media_group_count
                 FROM messages
                 WHERE conversation_id = ? AND is_deleted = 0 AND (seq < ? OR seq = 0)
                 ORDER BY CASE WHEN seq = 0 THEN 0 ELSE 1 END,
                          CASE WHEN seq = 0 THEN send_time ELSE NULL END DESC,
                          seq DESC
                 LIMIT ?",
                vec![
                    Box::new(conversation_id.to_string()),
                    Box::new(seq),
                    Box::new(limit),
                ],
            ),
            None => (
                "SELECT message_uuid, conversation_id, conversation_type, sender_id,
                 sender_name, sender_avatar, content, content_type, file_uuid, file_url,
                 file_size, file_hash, image_width, image_height, seq, reply_to,
                 is_recalled, is_deleted, send_time, created_at,
                 media_group_id, media_group_index, media_group_count
                 FROM messages
                 WHERE conversation_id = ? AND is_deleted = 0
                 ORDER BY CASE WHEN seq = 0 THEN 0 ELSE 1 END,
                          CASE WHEN seq = 0 THEN send_time ELSE NULL END DESC,
                          seq DESC
                 LIMIT ?",
                vec![
                    Box::new(conversation_id.to_string()),
                    Box::new(limit),
                ],
            ),
        };

        let mut stmt = db.prepare(query).map_err(|e| e.to_string())?;

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(params_refs.as_slice(), |row| {
                Ok(LocalMessage {
                    message_uuid: row.get(0)?,
                    conversation_id: row.get(1)?,
                    conversation_type: row.get(2)?,
                    sender_id: row.get(3)?,
                    sender_name: row.get(4)?,
                    sender_avatar: row.get(5)?,
                    content: row.get(6)?,
                    content_type: row.get(7)?,
                    file_uuid: row.get(8)?,
                    file_url: row.get(9)?,
                    file_size: row.get(10)?,
                    file_hash: row.get(11)?,
                    image_width: row.get(12)?,
                    image_height: row.get(13)?,
                    seq: row.get(14)?,
                    reply_to: row.get(15)?,
                    is_recalled: row.get::<_, i64>(16)? != 0,
                    is_deleted: row.get::<_, i64>(17)? != 0,
                    send_time: row.get(18)?,
                    created_at: row.get(19)?,
                    media_group_id: row.get(20)?,
                    media_group_index: row.get(21)?,
                    media_group_count: row.get(22)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut messages: Vec<LocalMessage> = Vec::new();
        for row in rows {
            messages.push(row.map_err(|e| e.to_string())?);
        }

        // 保持倒序返回 [新→旧]，与群聊 API 一致
        // flex-direction: column-reverse 容器会正确显示为：旧(顶部) → 新(底部)

        Ok(messages)
    }
}

/// 保存消息
pub fn save_message(msg: LocalMessage) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO messages
             (message_uuid, conversation_id, conversation_type, sender_id, sender_name,
              sender_avatar, content, content_type, file_uuid, file_url, file_size,
              file_hash, image_width, image_height, seq, reply_to,
              media_group_id, media_group_index, media_group_count,
              is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                msg.message_uuid,
                msg.conversation_id,
                msg.conversation_type,
                msg.sender_id,
                msg.sender_name,
                msg.sender_avatar,
                msg.content,
                msg.content_type,
                msg.file_uuid,
                msg.file_url,
                msg.file_size,
                msg.file_hash,
                msg.image_width,
                msg.image_height,
                msg.seq,
                msg.reply_to,
                msg.media_group_id,
                msg.media_group_index,
                msg.media_group_count,
                if msg.is_recalled { 1 } else { 0 },
                if msg.is_deleted { 1 } else { 0 },
                msg.send_time,
            ],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 批量保存消息
pub fn save_messages(messages: Vec<LocalMessage>) -> Result<(), String> {
    let mut guard = DB.lock();
    let db = guard
        .as_mut()
        .ok_or_else(|| "数据库未初始化".to_string())?;

    let tx = db.transaction().map_err(|e| e.to_string())?;

    for msg in messages {
        tx.execute(
            "INSERT OR REPLACE INTO messages
             (message_uuid, conversation_id, conversation_type, sender_id, sender_name,
              sender_avatar, content, content_type, file_uuid, file_url, file_size,
              file_hash, image_width, image_height, seq, reply_to,
              media_group_id, media_group_index, media_group_count,
              is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                msg.message_uuid,
                msg.conversation_id,
                msg.conversation_type,
                msg.sender_id,
                msg.sender_name,
                msg.sender_avatar,
                msg.content,
                msg.content_type,
                msg.file_uuid,
                msg.file_url,
                msg.file_size,
                msg.file_hash,
                msg.image_width,
                msg.image_height,
                msg.seq,
                msg.reply_to,
                msg.media_group_id,
                msg.media_group_index,
                msg.media_group_count,
                if msg.is_recalled { 1 } else { 0 },
                if msg.is_deleted { 1 } else { 0 },
                msg.send_time,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

/// 批量插入消息：仅对本地不存在的 message_uuid 写入（INSERT OR IGNORE）
///
/// 用途：历史消息加载（loadAllHistoryMessages）—— 服务器返回的历史响应可能不带
/// is_recalled / is_deleted 等本地状态字段，若用 INSERT OR REPLACE 直接覆盖，会把
/// 本地已撤回的消息（is_recalled=1）误覆盖回 0，UI 退化为"普通对方消息形态"。
///
/// 与 save_messages 的区别：
/// - save_messages: INSERT OR REPLACE，用于 sync 增量 / WS 新消息（语义是"以服务器为准"）
/// - save_messages_skip_existing: INSERT OR IGNORE，用于历史补缺（语义是"只补本地缺失的"）
pub fn save_messages_skip_existing(messages: Vec<LocalMessage>) -> Result<(), String> {
    let mut guard = DB.lock();
    let db = guard
        .as_mut()
        .ok_or_else(|| "数据库未初始化".to_string())?;

    let tx = db.transaction().map_err(|e| e.to_string())?;

    for msg in messages {
        tx.execute(
            "INSERT OR IGNORE INTO messages
             (message_uuid, conversation_id, conversation_type, sender_id, sender_name,
              sender_avatar, content, content_type, file_uuid, file_url, file_size,
              file_hash, image_width, image_height, seq, reply_to,
              media_group_id, media_group_index, media_group_count,
              is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                msg.message_uuid,
                msg.conversation_id,
                msg.conversation_type,
                msg.sender_id,
                msg.sender_name,
                msg.sender_avatar,
                msg.content,
                msg.content_type,
                msg.file_uuid,
                msg.file_url,
                msg.file_size,
                msg.file_hash,
                msg.image_width,
                msg.image_height,
                msg.seq,
                msg.reply_to,
                msg.media_group_id,
                msg.media_group_index,
                msg.media_group_count,
                if msg.is_recalled { 1 } else { 0 },
                if msg.is_deleted { 1 } else { 0 },
                msg.send_time,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(())
}

/// 标记消息为已撤回
pub fn mark_message_recalled(message_uuid: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE messages SET is_recalled = 1, content = '[消息已撤回]' WHERE message_uuid = ?",
            params![message_uuid],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

/// 搜索消息内容（含前后上下文）
///
/// 双轨制：
/// - 主路径 FTS5 MATCH 短语：性能最佳，处理大部分常规查询
/// - Fallback LIKE %query%：当 FTS 返空时兜底（处理 unicode61 边界、FTS 索引同步延迟等场景）
///
/// 行为：
/// - JOIN conversations 拿会话名 + 头像
/// - 对每条命中，按 conversation_id + seq 取前后各 1 条作为上下文预览
/// - 排除 is_deleted 和 is_recalled
/// - 按 filter 限定会话 / content_type（见 `MessageSearchFilter`）
/// - 按 send_time DESC 排序，限 limit 条
pub fn search_messages(
    query: &str,
    limit: i64,
    filter: &MessageSearchFilter,
) -> Result<Vec<SearchMessageResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    with_db!(db, { search_messages_with_conn(db, trimmed, limit, filter) })
}

/// search_messages 的内部实现（接受 Connection 引用，便于单测使用 in-memory DB）
///
/// query 已 trim 且非空（调用方保证）。仅 crate 内可见（搜索测试 + 公共入口）。
pub(crate) fn search_messages_with_conn(
    conn: &Connection,
    query: &str,
    limit: i64,
    filter: &MessageSearchFilter,
) -> Result<Vec<SearchMessageResult>, String> {
    // include 显式给了空集 = "只要这 0 种类型" → 结果必然为空，直接短路
    // （不短路会拼出 `content_type IN ()`，SQLite 语法错误）
    if filter
        .include_content_types
        .as_ref()
        .is_some_and(|t| t.is_empty())
    {
        return Ok(Vec::new());
    }

    // 主路径：FTS5 MATCH 短语查询
    let fts_results = fts_search(conn, query, limit, filter)?;
    if !fts_results.is_empty() {
        return enrich_with_context(conn, fts_results);
    }

    // Fallback：LIKE 子串匹配（处理 FTS 索引未同步 / unicode61 分词边界等场景）
    let like_results = like_search(conn, query, limit, filter)?;
    enrich_with_context(conn, like_results)
}

/// 把过滤条件编译成 SQL 片段（每条以 ` AND ` 起头）+ 顺序一致的绑定值
///
/// 调用方保证 `include_content_types` 非 Some(空)（`search_messages_with_conn` 已短路）。
fn compile_filter(filter: &MessageSearchFilter) -> (String, Vec<Box<dyn rusqlite::ToSql>>) {
    let mut sql = String::new();
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(conversation_id) = &filter.conversation_id {
        sql.push_str(" AND m.conversation_id = ?");
        binds.push(Box::new(conversation_id.clone()));
    }

    if let Some(types) = &filter.include_content_types {
        sql.push_str(" AND m.content_type IN (");
        sql.push_str(&placeholders(types.len()));
        sql.push(')');
        for t in types {
            binds.push(Box::new(t.clone()));
        }
    }

    if let Some(types) = &filter.exclude_content_types {
        // 空排除集 = 不排除任何东西，跳过（拼 `NOT IN ()` 是语法错误）
        if !types.is_empty() {
            sql.push_str(" AND m.content_type NOT IN (");
            sql.push_str(&placeholders(types.len()));
            sql.push(')');
            for t in types {
                binds.push(Box::new(t.clone()));
            }
        }
    }

    (sql, binds)
}

/// 生成 `?,?,?` 形式的占位符串（n >= 1）
fn placeholders(n: usize) -> String {
    let mut s = String::with_capacity(n * 2);
    for i in 0..n {
        if i > 0 {
            s.push(',');
        }
        s.push('?');
    }
    s
}

/// FTS5 MATCH 短语查询；返回 (LocalMessage, conv_name, conv_avatar) 列表
fn fts_search(
    conn: &Connection,
    query: &str,
    limit: i64,
    filter: &MessageSearchFilter,
) -> Result<Vec<(LocalMessage, String, Option<String>)>, String> {
    // 转义查询里的双引号（FTS5 短语用 "" 表示一个 "）
    let escaped = query.replace('"', "\"\"");
    let fts_query = format!("\"{}\"", escaped);

    let (filter_sql, filter_binds) = compile_filter(filter);
    let sql = format!(
        "SELECT m.message_uuid, m.conversation_id, m.conversation_type, m.sender_id,
                m.sender_name, m.sender_avatar, m.content, m.content_type, m.file_uuid,
                m.file_url, m.file_size, m.file_hash, m.image_width, m.image_height,
                m.seq, m.reply_to, m.is_recalled, m.is_deleted, m.send_time, m.created_at,
                m.media_group_id, m.media_group_index, m.media_group_count,
                c.name, c.avatar_url
         FROM messages_fts
         JOIN messages m ON m.rowid = messages_fts.rowid
         LEFT JOIN conversations c ON c.id = m.conversation_id
         WHERE messages_fts MATCH ?
           AND m.is_deleted = 0
           AND m.is_recalled = 0{}
         ORDER BY m.send_time DESC
         LIMIT ?",
        filter_sql
    );

    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(fts_query)];
    binds.extend(filter_binds);
    binds.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    collect_hits(&mut stmt, bind_refs.as_slice())
}

/// 把关键词编译成 `%…%` LIKE 模式（转义 SQLite 通配符，配 `ESCAPE '\'` 使用）
fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{}%", escaped)
}

/// LIKE %query% 兜底查询
fn like_search(
    conn: &Connection,
    query: &str,
    limit: i64,
    filter: &MessageSearchFilter,
) -> Result<Vec<(LocalMessage, String, Option<String>)>, String> {
    let pattern = like_pattern(query);

    let (filter_sql, filter_binds) = compile_filter(filter);
    let sql = format!(
        "SELECT m.message_uuid, m.conversation_id, m.conversation_type, m.sender_id,
                m.sender_name, m.sender_avatar, m.content, m.content_type, m.file_uuid,
                m.file_url, m.file_size, m.file_hash, m.image_width, m.image_height,
                m.seq, m.reply_to, m.is_recalled, m.is_deleted, m.send_time, m.created_at,
                m.media_group_id, m.media_group_index, m.media_group_count,
                c.name, c.avatar_url
         FROM messages m
         LEFT JOIN conversations c ON c.id = m.conversation_id
         WHERE m.content LIKE ? ESCAPE '\\'
           AND m.is_deleted = 0
           AND m.is_recalled = 0{}
         ORDER BY m.send_time DESC
         LIMIT ?",
        filter_sql
    );

    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = vec![Box::new(pattern)];
    binds.extend(filter_binds);
    binds.push(Box::new(limit));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    collect_hits(&mut stmt, bind_refs.as_slice())
}

/// 把查询行的前 20 列映射成 LocalMessage（列序 = 本文件各查询 SELECT 的固定列序）
fn row_to_local_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalMessage> {
    Ok(LocalMessage {
        message_uuid: row.get(0)?,
        conversation_id: row.get(1)?,
        conversation_type: row.get(2)?,
        sender_id: row.get(3)?,
        sender_name: row.get(4)?,
        sender_avatar: row.get(5)?,
        content: row.get(6)?,
        content_type: row.get(7)?,
        file_uuid: row.get(8)?,
        file_url: row.get(9)?,
        file_size: row.get(10)?,
        file_hash: row.get(11)?,
        image_width: row.get(12)?,
        image_height: row.get(13)?,
        seq: row.get(14)?,
        reply_to: row.get(15)?,
        is_recalled: row.get::<_, i64>(16)? != 0,
        is_deleted: row.get::<_, i64>(17)? != 0,
        send_time: row.get(18)?,
        created_at: row.get(19)?,
        media_group_id: row.get(20)?,
        media_group_index: row.get(21)?,
        media_group_count: row.get(22)?,
    })
}

/// 把 prepare 好的 stmt 执行并收集为 hits 列表
fn collect_hits(
    stmt: &mut rusqlite::Statement,
    parameters: impl rusqlite::Params,
) -> Result<Vec<(LocalMessage, String, Option<String>)>, String> {
    let rows = stmt
        .query_map(parameters, |row| {
            Ok((
                row_to_local_message(row)?,
                row.get::<_, Option<String>>(23)?.unwrap_or_default(),
                row.get::<_, Option<String>>(24)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut hits: Vec<(LocalMessage, String, Option<String>)> = Vec::new();
    for row in rows {
        hits.push(row.map_err(|e| e.to_string())?);
    }
    Ok(hits)
}

/// 对每条命中查前后 1 条上下文（仅 seq > 0 的同步消息参与）
fn enrich_with_context(
    conn: &Connection,
    hits: Vec<(LocalMessage, String, Option<String>)>,
) -> Result<Vec<SearchMessageResult>, String> {
    let mut results: Vec<SearchMessageResult> = Vec::with_capacity(hits.len());
    for (msg, conv_name, conv_avatar) in hits {
        let context_before: Option<String> = if msg.seq > 0 {
            conn.query_row(
                "SELECT content FROM messages
                 WHERE conversation_id = ? AND seq < ? AND seq > 0 AND is_deleted = 0
                 ORDER BY seq DESC LIMIT 1",
                params![msg.conversation_id, msg.seq],
                |r| r.get::<_, String>(0),
            )
            .ok()
        } else {
            None
        };
        let context_after: Option<String> = if msg.seq > 0 {
            conn.query_row(
                "SELECT content FROM messages
                 WHERE conversation_id = ? AND seq > ? AND is_deleted = 0
                 ORDER BY seq ASC LIMIT 1",
                params![msg.conversation_id, msg.seq],
                |r| r.get::<_, String>(0),
            )
            .ok()
        } else {
            None
        };

        results.push(SearchMessageResult {
            message: msg,
            conversation_name: conv_name,
            conversation_avatar: conv_avatar,
            context_before,
            context_after,
        });
    }
    Ok(results)
}

/// 会话内「按分类浏览 + 可选关键词过滤」的分页列表（Telegram 式查找）
///
/// 与 [`search_messages`] 的分工：
/// - `search_messages`：**跨会话全局**搜索，关键词**必填**，FTS5 短语为主路径
/// - 本函数：**单会话**内浏览，关键词**可选** —— 不给关键词就按分类按时间倒序列出全部
///   （产品要求：点「图片/视频/文件/全部」立刻出列表，不必先输入关键词），
///   给了关键词就在同一分类结果里再过滤
///
/// ## 为什么关键词走 `LIKE %kw%` 而不是 FTS5
///
/// 1. **分页必须自洽**。`search_messages` 是「FTS 命中为空则回落 LIKE」的双轨制；
///    同一组条件在不同 offset 上可能落到不同轨道，翻页会重复/漏条。单轨 LIKE 的
///    LIMIT/OFFSET 才是确定的。
/// 2. **中文子串**。FTS5 `unicode61` 不切分 CJK，一整段中文是一个 token，短语查询
///    匹配不到句中片段 —— `search_messages` 挂 LIKE 兜底正是为此。会话内查找几乎
///    全是「记得其中几个字」，LIKE 才是对的语义。
/// 3. 扫描量有界：`conversation_id` 把范围钉死在单个会话内。
///
/// ## 排序三元组
///
/// `send_time DESC, seq DESC, message_uuid DESC` —— 只按 send_time 排序时，同一秒
/// 发出的多条消息在两次分页查询里可能顺序不同，翻页就会重复/丢条。三元组唯一。
pub fn list_conversation_messages(
    conversation_id: &str,
    query: Option<&str>,
    limit: i64,
    offset: i64,
    filter: &MessageSearchFilter,
) -> Result<Vec<LocalMessage>, String> {
    // 会话范围由参数强制注入，不接受调用方经 filter 传 —— 漏传会静默变成"全库列表"
    let scoped = MessageSearchFilter {
        conversation_id: Some(conversation_id.to_string()),
        ..filter.clone()
    };
    with_db!(db, {
        list_conversation_messages_with_conn(db, query, limit, offset, &scoped)
    })
}

/// `list_conversation_messages` 的内部实现（接受 Connection 引用，便于单测用 in-memory DB）
///
/// `filter.conversation_id` 由公共入口保证已填。仅 crate 内可见。
pub(crate) fn list_conversation_messages_with_conn(
    conn: &Connection,
    query: Option<&str>,
    limit: i64,
    offset: i64,
    filter: &MessageSearchFilter,
) -> Result<Vec<LocalMessage>, String> {
    // include 显式给了空集 = "只要这 0 种类型" → 结果必然为空，直接短路
    // （不短路会拼出 `content_type IN ()`，SQLite 语法错误；同 search_messages_with_conn）
    if filter
        .include_content_types
        .as_ref()
        .is_some_and(|t| t.is_empty())
    {
        return Ok(Vec::new());
    }

    let keyword = query.map(str::trim).filter(|q| !q.is_empty());

    let (filter_sql, filter_binds) = compile_filter(filter);
    let keyword_sql = if keyword.is_some() {
        " AND m.content LIKE ? ESCAPE '\\'"
    } else {
        ""
    };

    let sql = format!(
        "SELECT m.message_uuid, m.conversation_id, m.conversation_type, m.sender_id,
                m.sender_name, m.sender_avatar, m.content, m.content_type, m.file_uuid,
                m.file_url, m.file_size, m.file_hash, m.image_width, m.image_height,
                m.seq, m.reply_to, m.is_recalled, m.is_deleted, m.send_time, m.created_at,
                m.media_group_id, m.media_group_index, m.media_group_count
         FROM messages m
         WHERE m.is_deleted = 0
           AND m.is_recalled = 0{}{}
         ORDER BY m.send_time DESC, m.seq DESC, m.message_uuid DESC
         LIMIT ? OFFSET ?",
        filter_sql, keyword_sql
    );

    // 绑定顺序必须与 SQL 中 `?` 的出现顺序一致：filter → keyword → limit → offset
    let mut binds: Vec<Box<dyn rusqlite::ToSql>> = filter_binds;
    if let Some(kw) = keyword {
        binds.push(Box::new(like_pattern(kw)));
    }
    binds.push(Box::new(limit));
    binds.push(Box::new(offset));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let bind_refs: Vec<&dyn rusqlite::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
    let rows = stmt
        .query_map(bind_refs.as_slice(), row_to_local_message)
        .map_err(|e| e.to_string())?;

    let mut out: Vec<LocalMessage> = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// 标记消息为已删除
pub fn mark_message_deleted(message_uuid: &str) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "UPDATE messages SET is_deleted = 1 WHERE message_uuid = ?",
            params![message_uuid],
        )
        .map_err(|e| e.to_string())?;

        Ok(())
    })
}

// ============================================================================
// 单元测试
// ============================================================================
//
// 使用 SQLite in-memory DB 隔离全局 DB 状态。
// schema 通过本地辅助函数构建（与 db/mod.rs::init_database 保持一致）。

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// 在 in-memory DB 上建立与生产环境一致的 messages + messages_fts schema
    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");

        conn.execute(
            "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar_url TEXT,
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE messages (
                message_uuid TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                conversation_type TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                sender_name TEXT,
                sender_avatar TEXT,
                content TEXT NOT NULL,
                content_type TEXT NOT NULL,
                file_uuid TEXT,
                file_url TEXT,
                file_size INTEGER,
                file_hash TEXT,
                image_width INTEGER,
                image_height INTEGER,
                seq INTEGER NOT NULL,
                reply_to TEXT,
                media_group_id TEXT,
                media_group_index INTEGER,
                media_group_count INTEGER,
                is_recalled INTEGER NOT NULL DEFAULT 0,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                send_time TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE VIRTUAL TABLE messages_fts USING fts5(
                content,
                content='messages',
                content_rowid='rowid',
                tokenize='unicode61'
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
            END",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
            END",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
                INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
            END",
            [],
        )
        .unwrap();

        conn
    }

    /// 插入测试消息
    fn insert_msg(
        conn: &Connection,
        uuid: &str,
        conv_id: &str,
        content: &str,
        content_type: &str,
        seq: i64,
        send_time: &str,
    ) {
        conn.execute(
            "INSERT INTO messages (message_uuid, conversation_id, conversation_type, sender_id,
             content, content_type, seq, send_time)
             VALUES (?, ?, 'friend', 'u1', ?, ?, ?, ?)",
            params![uuid, conv_id, content, content_type, seq, send_time],
        )
        .unwrap();
    }

    /// 相册三件套必须能**存进去再读回来**。
    ///
    /// 这条是整块本地持久化的意义所在：消息列表是 DB-first 的，
    /// 三列不落库的话，网络上收到的相册在内存里能渲染，一旦重启 / 切会话 / 离线加载
    /// 就散成 N 条独立图片 —— 而且**不报任何错**，只是分组静默消失。
    #[test]
    fn media_group_survives_save_and_load() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO messages (message_uuid, conversation_id, conversation_type, sender_id,
             content, content_type, seq, send_time,
             media_group_id, media_group_index, media_group_count)
             VALUES ('mg1', 'c1', 'friend', 'u1', '整组配文', 'image', 1, '2026-05-11T01:00:00Z',
                     'grp-1', 0, 3)",
            [],
        )
        .unwrap();

        let msgs = get_messages_with_conn(&conn, "c1", 50, None).unwrap();
        let hit = msgs
            .iter()
            .find(|m| m.message_uuid == "mg1")
            .expect("刚插入的消息应当读得回来");

        assert_eq!(hit.media_group_id.as_deref(), Some("grp-1"));
        assert_eq!(hit.media_group_index, Some(0));
        assert_eq!(hit.media_group_count, Some(3));
        // 同时确认相邻列没有因为新增列而错位（位置索引是这块最容易出错的地方）
        assert_eq!(hit.content, "整组配文");
        assert_eq!(hit.seq, 1);
        assert!(!hit.is_recalled);
    }

    #[test]
    fn fts_hit_text_message() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "hello world", "text", 1, "2026-05-11T01:00:00Z");
        let results = search_messages_with_conn(&conn, "hello", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message.message_uuid, "m1");
    }

    #[test]
    fn single_char_hit() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "1", "text", 1, "2026-05-11T01:00:00Z");
        let results = search_messages_with_conn(&conn, "1", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 1, "单字符 '1' 应命中（FTS 或 LIKE fallback）");
    }

    #[test]
    fn file_name_match() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "photo.png", "image", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "video.mp4", "video", 2, "2026-05-11T02:00:00Z");
        let results = search_messages_with_conn(&conn, "photo", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message.content_type, "image");
    }

    #[test]
    fn excludes_recalled_and_deleted() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "hello normal", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "hello deleted", "text", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "hello recalled", "text", 3, "2026-05-11T03:00:00Z");
        conn.execute("UPDATE messages SET is_deleted=1 WHERE message_uuid='m2'", []).unwrap();
        conn.execute("UPDATE messages SET is_recalled=1 WHERE message_uuid='m3'", []).unwrap();

        let results = search_messages_with_conn(&conn, "hello", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 1, "已撤回 + 已删除的消息应排除");
        assert_eq!(results[0].message.message_uuid, "m1");
    }

    #[test]
    fn like_fallback_when_fts_empty() {
        // 模拟"FTS 索引为空但 messages 有数据"的场景：删掉 trigger 然后手工插入
        let conn = Connection::open_in_memory().unwrap();
        // 仅建 messages + conversations + FTS（无 trigger）
        conn.execute(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL,
             avatar_url TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))",
            [],
        ).unwrap();
        conn.execute(
            "CREATE TABLE messages (
                message_uuid TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
                conversation_type TEXT NOT NULL, sender_id TEXT NOT NULL,
                sender_name TEXT, sender_avatar TEXT,
                content TEXT NOT NULL, content_type TEXT NOT NULL,
                file_uuid TEXT, file_url TEXT, file_size INTEGER, file_hash TEXT,
                image_width INTEGER, image_height INTEGER,
                seq INTEGER NOT NULL, reply_to TEXT,
                media_group_id TEXT, media_group_index INTEGER, media_group_count INTEGER,
                is_recalled INTEGER NOT NULL DEFAULT 0, is_deleted INTEGER NOT NULL DEFAULT 0,
                send_time TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
            [],
        ).unwrap();
        conn.execute(
            "CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid', tokenize='unicode61')",
            [],
        ).unwrap();
        // 插入消息但不灌 FTS（trigger 缺失）
        insert_msg(&conn, "m1", "c1", "lonely message", "text", 1, "2026-05-11T01:00:00Z");

        let results = search_messages_with_conn(&conn, "lonely", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 1, "FTS 空时 LIKE fallback 应命中");
    }

    #[test]
    fn no_match_returns_empty() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "anything", "text", 1, "2026-05-11T01:00:00Z");

        // FTS 主路径与 LIKE 兜底都搜不到时，返回空 Vec（非 None / 非 Error）
        let results = search_messages_with_conn(&conn, "nonexistent", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 0, "无命中的 query 应返回空 Vec");
    }

    #[test]
    fn context_before_after() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "first message", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "hello middle", "text", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "last message", "text", 3, "2026-05-11T03:00:00Z");

        let results = search_messages_with_conn(&conn, "middle", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].context_before.as_deref(), Some("first message"));
        assert_eq!(results[0].context_after.as_deref(), Some("last message"));
    }

    #[test]
    fn results_ordered_by_send_time_desc() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "hello A", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "hello B", "text", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "hello C", "text", 3, "2026-05-11T03:00:00Z");

        let results = search_messages_with_conn(&conn, "hello", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(results.len(), 3);
        // 最新的在前
        assert_eq!(results[0].message.message_uuid, "m3");
        assert_eq!(results[2].message.message_uuid, "m1");
    }

    // ========================================================================
    // 会话内搜索 + 分类过滤（MessageSearchFilter）
    // ========================================================================

    /// 便捷构造：只限会话
    fn in_conversation(conversation_id: &str) -> MessageSearchFilter {
        MessageSearchFilter {
            conversation_id: Some(conversation_id.to_string()),
            ..Default::default()
        }
    }

    /// 便捷构造：content_type 白名单
    fn include_types(types: &[&str]) -> MessageSearchFilter {
        MessageSearchFilter {
            include_content_types: Some(types.iter().map(|t| (*t).to_string()).collect()),
            ..Default::default()
        }
    }

    #[test]
    fn filter_limits_results_to_one_conversation() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "hello here", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c2", "hello there", "text", 1, "2026-05-11T02:00:00Z");

        // 不过滤：两个会话都命中
        let all = search_messages_with_conn(&conn, "hello", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(all.len(), 2, "无过滤时应跨会话命中");

        let scoped = search_messages_with_conn(&conn, "hello", 50, &in_conversation("c1")).unwrap();
        assert_eq!(scoped.len(), 1);
        assert_eq!(scoped[0].message.message_uuid, "m1");
        assert_eq!(scoped[0].message.conversation_id, "c1");
    }

    #[test]
    fn filter_include_content_types_keeps_only_listed() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "target text", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "target.png", "image", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "target.mp4", "video", 3, "2026-05-11T03:00:00Z");
        insert_msg(&conn, "m4", "c1", "target.zip", "file", 4, "2026-05-11T04:00:00Z");

        let images = search_messages_with_conn(&conn, "target", 50, &include_types(&["image"])).unwrap();
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].message.message_uuid, "m2");

        let videos = search_messages_with_conn(&conn, "target", 50, &include_types(&["video"])).unwrap();
        assert_eq!(videos.len(), 1);
        assert_eq!(videos[0].message.message_uuid, "m3");

        // 多值 IN：文件类可包含多个 content_type
        let files = search_messages_with_conn(&conn, "target", 50, &include_types(&["file", "audio"])).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].message.message_uuid, "m4");
    }

    #[test]
    fn filter_exclude_content_types_keeps_unknown_types_as_text() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "target text", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "target.png", "image", 2, "2026-05-11T02:00:00Z");
        // 服务端未来新增的未知类型：不在文件类白名单里 → 必须仍归入「文字」，不能凭空消失
        insert_msg(&conn, "m3", "c1", "target card", "card", 3, "2026-05-11T03:00:00Z");
        insert_msg(&conn, "m4", "c1", "target future", "brand_new_type", 4, "2026-05-11T04:00:00Z");

        let filter = MessageSearchFilter {
            exclude_content_types: Some(
                ["image", "video", "file", "audio"].iter().map(|t| (*t).to_string()).collect(),
            ),
            ..Default::default()
        };
        let texts = search_messages_with_conn(&conn, "target", 50, &filter).unwrap();
        let uuids: Vec<&str> = texts.iter().map(|r| r.message.message_uuid.as_str()).collect();
        assert_eq!(texts.len(), 3, "文字类 = 非文件类（含 card 与未知类型）");
        assert!(uuids.contains(&"m1"));
        assert!(uuids.contains(&"m3"));
        assert!(uuids.contains(&"m4"));
        assert!(!uuids.contains(&"m2"), "image 应被排除");
    }

    #[test]
    fn filter_empty_include_returns_empty_not_error() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "hello", "text", 1, "2026-05-11T01:00:00Z");

        // Some(空集) = "只要这 0 种类型"：必须返回空 Vec 而不是 SQL 语法错误
        let filter = MessageSearchFilter {
            include_content_types: Some(Vec::new()),
            ..Default::default()
        };
        let results = search_messages_with_conn(&conn, "hello", 50, &filter).unwrap();
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn filter_also_applies_on_like_fallback_path() {
        let conn = setup_test_db();
        // unicode61 把 "prefixbcdesuffix" 切成单个 token，短语 "bcde" 匹配不到 →
        // 走 LIKE fallback。此处验证 fallback 路径同样受 filter 约束。
        insert_msg(&conn, "m1", "c1", "prefixbcdesuffix", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c2", "prefixbcdesuffix", "text", 1, "2026-05-11T02:00:00Z");

        let unfiltered = search_messages_with_conn(&conn, "bcde", 50, &MessageSearchFilter::default()).unwrap();
        assert_eq!(unfiltered.len(), 2, "前置条件：该 query 只能由 LIKE fallback 命中");

        let scoped = search_messages_with_conn(&conn, "bcde", 50, &in_conversation("c2")).unwrap();
        assert_eq!(scoped.len(), 1, "LIKE fallback 路径也必须应用会话过滤");
        assert_eq!(scoped[0].message.message_uuid, "m2");
    }

    #[test]
    fn filter_combines_conversation_and_content_type() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "target.png", "image", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c2", "target.png", "image", 1, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "target text", "text", 2, "2026-05-11T03:00:00Z");

        let filter = MessageSearchFilter {
            conversation_id: Some("c1".to_string()),
            include_content_types: Some(vec!["image".to_string()]),
            exclude_content_types: None,
        };
        let results = search_messages_with_conn(&conn, "target", 50, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].message.message_uuid, "m1");
    }

    // ------------------------------------------------------------------
    // list_conversation_messages —— 会话内分类浏览（关键词可选）+ 分页
    // ------------------------------------------------------------------

    /// 会话 c1 的浏览过滤器（会话范围由 with_conn 的调用方显式给出，
    /// 与公共入口 `list_conversation_messages` 强制注入的形态一致）
    fn browse_c1(include: Option<Vec<&str>>, exclude: Option<Vec<&str>>) -> MessageSearchFilter {
        MessageSearchFilter {
            conversation_id: Some("c1".to_string()),
            include_content_types: include
                .map(|v| v.into_iter().map(str::to_string).collect()),
            exclude_content_types: exclude
                .map(|v| v.into_iter().map(str::to_string).collect()),
        }
    }

    fn browse_uuids(rows: &[LocalMessage]) -> Vec<&str> {
        rows.iter().map(|m| m.message_uuid.as_str()).collect()
    }

    #[test]
    fn browse_without_keyword_lists_whole_category_time_desc() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "a.png", "image", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "b.png", "image", 2, "2026-05-11T03:00:00Z");
        insert_msg(&conn, "m3", "c1", "c.png", "image", 3, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m4", "c1", "只是文字", "text", 4, "2026-05-11T09:00:00Z");
        insert_msg(&conn, "m5", "c2", "别的会话.png", "image", 1, "2026-05-11T09:00:00Z");

        // 关键词为 None —— 这是本次需求的核心：不输入也要按分类列出全部
        let rows = list_conversation_messages_with_conn(
            &conn,
            None,
            50,
            0,
            &browse_c1(Some(vec!["image"]), None),
        )
        .unwrap();

        assert_eq!(
            browse_uuids(&rows),
            vec!["m2", "m3", "m1"],
            "无关键词时按 send_time 倒序列出该分类全部，且不跨会话"
        );
    }

    #[test]
    fn browse_all_category_without_keyword_lists_every_type() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "文字", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "a.png", "image", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "a.zip", "file", 3, "2026-05-11T03:00:00Z");

        let rows =
            list_conversation_messages_with_conn(&conn, None, 50, 0, &browse_c1(None, None))
                .unwrap();
        assert_eq!(browse_uuids(&rows), vec!["m3", "m2", "m1"]);
    }

    #[test]
    fn browse_keyword_filters_inside_category() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "holiday.png", "image", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "invoice.png", "image", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "holiday.txt", "file", 3, "2026-05-11T03:00:00Z");

        let rows = list_conversation_messages_with_conn(
            &conn,
            Some("holiday"),
            50,
            0,
            &browse_c1(Some(vec!["image"]), None),
        )
        .unwrap();
        assert_eq!(
            browse_uuids(&rows),
            vec!["m1"],
            "关键词只在当前分类内过滤，不把别的分类捞回来"
        );
    }

    #[test]
    fn browse_keyword_matches_cjk_substring() {
        let conn = setup_test_db();
        // FTS5 unicode61 不切分 CJK，短语查询匹配不到句中片段；LIKE 子串可以。
        // 这正是本函数不走 FTS 的理由之一，缺了它中文查找会一条都搜不到。
        insert_msg(&conn, "m1", "c1", "明天下午三点开会", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "晚上去吃饭", "text", 2, "2026-05-11T02:00:00Z");

        let rows = list_conversation_messages_with_conn(
            &conn,
            Some("下午"),
            50,
            0,
            &browse_c1(None, None),
        )
        .unwrap();
        assert_eq!(browse_uuids(&rows), vec!["m1"]);
    }

    #[test]
    fn browse_paginates_by_limit_offset_without_overlap() {
        let conn = setup_test_db();
        for i in 0..5 {
            insert_msg(
                &conn,
                &format!("m{}", i),
                "c1",
                "文字",
                "text",
                i + 1,
                &format!("2026-05-11T0{}:00:00Z", i),
            );
        }

        let page1 =
            list_conversation_messages_with_conn(&conn, None, 2, 0, &browse_c1(None, None))
                .unwrap();
        let page2 =
            list_conversation_messages_with_conn(&conn, None, 2, 2, &browse_c1(None, None))
                .unwrap();
        let page3 =
            list_conversation_messages_with_conn(&conn, None, 2, 4, &browse_c1(None, None))
                .unwrap();

        assert_eq!(browse_uuids(&page1), vec!["m4", "m3"]);
        assert_eq!(browse_uuids(&page2), vec!["m2", "m1"]);
        assert_eq!(browse_uuids(&page3), vec!["m0"], "最后一页不足 limit → 前端据此判无更多");
        assert!(page3.len() < 2);
    }

    #[test]
    fn browse_pagination_is_stable_when_send_time_ties() {
        let conn = setup_test_db();
        // 同一 send_time 的三条：只按 send_time 排序时顺序不定 → 翻页会重复/丢条。
        // 排序三元组（send_time, seq, message_uuid）必须让分页结果两两不相交且并集完整。
        insert_msg(&conn, "ma", "c1", "同秒 A", "text", 1, "2026-05-11T05:00:00Z");
        insert_msg(&conn, "mb", "c1", "同秒 B", "text", 2, "2026-05-11T05:00:00Z");
        insert_msg(&conn, "mc", "c1", "同秒 C", "text", 3, "2026-05-11T05:00:00Z");

        let page1 =
            list_conversation_messages_with_conn(&conn, None, 2, 0, &browse_c1(None, None))
                .unwrap();
        let page2 =
            list_conversation_messages_with_conn(&conn, None, 2, 2, &browse_c1(None, None))
                .unwrap();

        let mut all: Vec<&str> = browse_uuids(&page1);
        all.extend(browse_uuids(&page2));
        all.sort_unstable();
        assert_eq!(all, vec!["ma", "mb", "mc"], "分页并集完整、无重复");
    }

    #[test]
    fn browse_excludes_recalled_and_deleted() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "正常", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "已删", "text", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "已撤回", "text", 3, "2026-05-11T03:00:00Z");
        conn.execute("UPDATE messages SET is_deleted=1 WHERE message_uuid='m2'", []).unwrap();
        conn.execute("UPDATE messages SET is_recalled=1 WHERE message_uuid='m3'", []).unwrap();

        let rows =
            list_conversation_messages_with_conn(&conn, None, 50, 0, &browse_c1(None, None))
                .unwrap();
        assert_eq!(browse_uuids(&rows), vec!["m1"]);
    }

    #[test]
    fn browse_text_category_excludes_file_types() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "文字", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "a.png", "image", 2, "2026-05-11T02:00:00Z");
        insert_msg(&conn, "m3", "c1", "卡片", "card", 3, "2026-05-11T03:00:00Z");

        let rows = list_conversation_messages_with_conn(
            &conn,
            None,
            50,
            0,
            &browse_c1(None, Some(vec!["image", "video", "file", "audio"])),
        )
        .unwrap();
        assert_eq!(
            browse_uuids(&rows),
            vec!["m3", "m1"],
            "文字类用 exclude → 未知/特殊类型（card）仍归文字，不凭空消失"
        );
    }

    #[test]
    fn browse_empty_include_returns_empty_not_error() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "文字", "text", 1, "2026-05-11T01:00:00Z");

        let rows = list_conversation_messages_with_conn(
            &conn,
            None,
            50,
            0,
            &browse_c1(Some(vec![]), None),
        )
        .unwrap();
        assert_eq!(rows.len(), 0);
    }

    #[test]
    fn browse_blank_keyword_is_treated_as_no_keyword() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "文字", "text", 1, "2026-05-11T01:00:00Z");

        let rows = list_conversation_messages_with_conn(
            &conn,
            Some("   "),
            50,
            0,
            &browse_c1(None, None),
        )
        .unwrap();
        assert_eq!(browse_uuids(&rows), vec!["m1"], "全空白关键词等同于不过滤");
    }

    #[test]
    fn browse_keyword_wildcards_are_escaped() {
        let conn = setup_test_db();
        insert_msg(&conn, "m1", "c1", "100% 完成", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg(&conn, "m2", "c1", "毫不相干", "text", 2, "2026-05-11T02:00:00Z");

        // 未转义时 `%` 是 LIKE 通配符，会把 m2 也捞出来
        let rows = list_conversation_messages_with_conn(
            &conn,
            Some("100%"),
            50,
            0,
            &browse_c1(None, None),
        )
        .unwrap();
        assert_eq!(browse_uuids(&rows), vec!["m1"]);
    }
}
