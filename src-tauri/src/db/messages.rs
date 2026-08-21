//! 消息操作模块
//!
//! 处理本地消息的增删改查，包括：
//! - `get_messages`: 分页获取会话消息（支持 before_seq 游标）
//! - `save_message`: 保存单条消息
//! - `save_messages`: 批量保存消息（使用事务，INSERT OR REPLACE — 以服务器为准）
//! - `save_messages_skip_existing`: 批量插入消息（缺失行整行插入；已存在行只回填空的引用/相册列，
//!   其余列一律不覆盖本地状态）
//! - `mark_message_recalled`: 标记消息为已撤回
//! - `mark_message_deleted`: 标记消息为已删除（软删除）
//! - `search_messages`: 搜消息内容（FTS5 主路径 + LIKE fallback；可按会话 + content_type 过滤）
//! - `list_conversation_messages`: 会话内按分类浏览（关键词可选）+ LIMIT/OFFSET 分页
//!
//! ## 消息排序
//!
//! 消息按 seq DESC 排序返回，seq=0 的消息（未同步）优先按 send_time 排序。
//! 前端使用 `flex-direction: column-reverse` 容器正确显示消息顺序。

use rusqlite::{params, Connection, Row};

use super::types::{LocalMessage, MessageSearchFilter, SearchMessageResult};
use super::{with_db, DB};

/// `messages` 表的完整列清单（顺序即 [`map_message_row`] 里 `row.get(i)` 的索引顺序）
///
/// 抽成常量的理由写在 [`get_messages_with_conn`] 的注释里：这块最容易出错的就是
/// 「SELECT 列顺序与 `row.get(i)` 索引的配对漂移」。原先两处查询各抄一份列清单，
/// 窗口化又要再加两处 ⇒ 四份副本任一处改错都只会在运行时静默取错列。
/// 常量 + 单一映射函数让「加一列」只需改两个地方，且两处必然同步。
const MSG_SELECT_COLUMNS: &str = "message_uuid, conversation_id, conversation_type, sender_id,
     sender_name, sender_avatar, content, content_type, file_uuid, file_url,
     file_size, image_width, image_height, seq, reply_to,
     is_recalled, is_deleted, send_time, created_at,
     media_group_id, media_group_index, media_group_count";

/// 把 [`MSG_SELECT_COLUMNS`] 顺序取出的一行映射成 [`LocalMessage`]
fn map_message_row(row: &Row<'_>) -> rusqlite::Result<LocalMessage> {
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
        image_width: row.get(11)?,
        image_height: row.get(12)?,
        seq: row.get(13)?,
        reply_to: row.get(14)?,
        is_recalled: row.get::<_, i64>(15)? != 0,
        is_deleted: row.get::<_, i64>(16)? != 0,
        send_time: row.get(17)?,
        created_at: row.get(18)?,
        media_group_id: row.get(19)?,
        media_group_index: row.get(20)?,
        media_group_count: row.get(21)?,
    })
}

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
        let (query, params): (String, Vec<Box<dyn rusqlite::ToSql>>) = match before_seq {
            Some(seq) => (
                format!(
                    "SELECT {MSG_SELECT_COLUMNS}
                 FROM messages
                 WHERE conversation_id = ? AND is_deleted = 0 AND (seq < ? OR seq = 0)
                 ORDER BY CASE WHEN seq = 0 THEN 0 ELSE 1 END,
                          CASE WHEN seq = 0 THEN send_time ELSE NULL END DESC,
                          seq DESC
                 LIMIT ?"
                ),
                vec![
                    Box::new(conversation_id.to_string()),
                    Box::new(seq),
                    Box::new(limit),
                ],
            ),
            None => (
                format!(
                    "SELECT {MSG_SELECT_COLUMNS}
                 FROM messages
                 WHERE conversation_id = ? AND is_deleted = 0
                 ORDER BY CASE WHEN seq = 0 THEN 0 ELSE 1 END,
                          CASE WHEN seq = 0 THEN send_time ELSE NULL END DESC,
                          seq DESC
                 LIMIT ?"
                ),
                vec![
                    Box::new(conversation_id.to_string()),
                    Box::new(limit),
                ],
            ),
        };

        let mut stmt = db.prepare(&query).map_err(|e| e.to_string())?;

        let params_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt
            .query_map(params_refs.as_slice(), map_message_row)
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

/// 以某条消息为锚点，取它**前后各一段**（定位跳转用）
///
/// ## 为什么需要它
///
/// 定位一条很早的消息，原先只能靠「从最新一路 `get_messages(before_seq=游标)` 往回翻」，
/// 中间每一页都会进 state 并渲染 —— 目标越早读得越多，卡顿即由此而来；
/// 且翻页有轮次上限，超出范围的目标会**翻不到**而报「定位失败」，尽管它就在库里。
/// 本函数一次取回 `before + 1 + after` 条，与目标有多早**无关**。
///
/// ## 语义
///
/// - 锚点按 `message_uuid` 找，必须属于该会话且未软删除；找不到返回 `Ok(None)`，
///   由调用方决定降级（不吞成空数组 —— 空数组会被误读成「这段真的没有消息」）。
///   **「找不到」与「查询出错」是两条出口**：前者 `Ok(None)`，后者 `Err`。
///   压成同一个出口会让真实 DB 故障对上层完全不可见（UI 一律只报「找不到这条消息」）。
/// - **锚点 `seq <= 0` 同样走 `Ok(None)`**（本地未同步的新消息不参与 seq 窗口，
///   成因与后果见函数体内那段注释）。
/// - 窗口**只按 seq 取，且排除 `seq = 0`**：`seq = 0` 是本地未同步的新消息，
///   概念上恒属"最新那一端"，把它混进一段历史窗口会让顺序错乱。
/// - 返回顺序与 [`get_messages`] 一致：**[新→旧]**（`seq DESC`），
///   前端 `flex-direction: column-reverse` 容器据此正确显示。
pub fn get_messages_around_with_conn(
    db: &Connection,
    conversation_id: &str,
    anchor_uuid: &str,
    before: i64,
    after: i64,
) -> Result<Option<Vec<LocalMessage>>, String> {
    // 🔴 「锚点不存在」与「查询出错」必须走**两条**出口。
    // 原先这里是 `.ok()`：任何 rusqlite 错误（表损坏 / schema 漂移 / 列类型不符）都被
    // 压成 `None`，与「本地库里真没这条」同一个返回值 ⇒ 上层 `locateMessage` 返回 false
    // ⇒ UI 只报「找不到这条消息」，真实的 DB 故障在**任何地方都看不出来**。
    let anchor_seq: i64 = match db.query_row(
        "SELECT seq FROM messages
         WHERE message_uuid = ? AND conversation_id = ? AND is_deleted = 0",
        params![anchor_uuid, conversation_id],
        |row| row.get(0),
    ) {
        Ok(seq) => seq,
        // 锚点真的不在本地库里（或不属于该会话 / 已软删除）—— 既有语义不变：返回 None，
        // 由调用方降级成「定位失败」提示，而不是空数组（见本函数「语义」段）。
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        // 其余一律往上抛，与本函数其它查询的 `.map_err(|e| e.to_string())` 口径一致。
        Err(e) => return Err(e.to_string()),
    };

    // 🔴 `seq <= 0` 的锚点不参与 seq 窗口（2026-08-21，外部审计 idx=90/91）
    //
    // 上面这条锚点查询**不带** `seq > 0`，而下面两条窗口查询都带。于是 `seq = 0`
    // （本地未同步的新消息：待发区上传落库的媒体、乐观发送中的消息）会走出一条
    // 谁都没想到的路：
    //   - 较新那段 `seq >= 0 AND seq > 0` 被后半句吞掉 ⇒ 退化成「**全会话最旧的 after+1 条**」
    //   - 较旧那段 `seq < 0 AND seq > 0` 恒空
    // 结果既不是 `None` 也不是「锚点前后那一段」：前端 `locateMessage` 拿到一段
    // 与锚点毫无关系的最旧消息、`setMessages` 整段替换、还 `return true` 说定位成功
    // ⇒ 用户点一下引用块，聊天记录直接跳到会话最开头；若该会话一条 `seq > 0` 的消息
    // 都没有，那段就是空数组 ⇒ 列表被清空成「暂无消息」。
    //
    // 本函数的语义是「围绕锚点的一段 seq 窗口」，而 `seq = 0` 的消息**概念上恒属最新那一端**、
    // 不在任何历史窗口里 —— 所以正确出口是既有的那条「找不到」出口 `Ok(None)`，
    // 由调用方降级（同「锚点不在本地库」）。**不要**在这里返回空数组：
    // 空数组会被上层读成「这段真的没有消息」，正是本函数「语义」段一开始就禁止的那件事。
    if anchor_seq <= 0 {
        return Ok(None);
    }

    // 较新的一段 + 锚点自身：seq >= anchor，升序取 after+1 条，再翻成 [新→旧]
    let newer_sql = format!(
        "SELECT {MSG_SELECT_COLUMNS}
         FROM messages
         WHERE conversation_id = ? AND is_deleted = 0 AND seq >= ? AND seq > 0
         ORDER BY seq ASC
         LIMIT ?"
    );
    let mut stmt = db.prepare(&newer_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id, anchor_seq, after + 1], map_message_row)
        .map_err(|e| e.to_string())?;
    let mut newer: Vec<LocalMessage> = Vec::new();
    for row in rows {
        newer.push(row.map_err(|e| e.to_string())?);
    }
    newer.reverse();

    // 较旧的一段：seq < anchor，降序取 before 条（本身即 [新→旧]）
    let older_sql = format!(
        "SELECT {MSG_SELECT_COLUMNS}
         FROM messages
         WHERE conversation_id = ? AND is_deleted = 0 AND seq < ? AND seq > 0
         ORDER BY seq DESC
         LIMIT ?"
    );
    let mut stmt = db.prepare(&older_sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id, anchor_seq, before], map_message_row)
        .map_err(|e| e.to_string())?;
    for row in rows {
        newer.push(row.map_err(|e| e.to_string())?);
    }

    Ok(Some(newer))
}

/// [`get_messages_around_with_conn`] 的全局 DB 版本
pub fn get_messages_around(
    conversation_id: &str,
    anchor_uuid: &str,
    before: i64,
    after: i64,
) -> Result<Option<Vec<LocalMessage>>, String> {
    with_db!(db, {
        get_messages_around_with_conn(db, conversation_id, anchor_uuid, before, after)
    })
}

/// 向**更新**方向分页（窗口化之后必须有的另一半）
///
/// [`get_messages`] 的 `before_seq` 只能往更旧的方向翻。定位落在历史中段后，
/// 用户往下滚要能接着加载更新的消息，没有这条查询就只能重新从最新整段拉回来
/// —— 那正是本次要消灭的行为。
///
/// 返回顺序同样是 **[新→旧]**，与 [`get_messages`] 一致，调用方无需分辨来源。
/// 同样排除 `seq = 0`（本地未同步消息不参与历史分页，它们恒在最新端由内存态持有）。
pub fn get_messages_after_with_conn(
    db: &Connection,
    conversation_id: &str,
    after_seq: i64,
    limit: i64,
) -> Result<Vec<LocalMessage>, String> {
    let sql = format!(
        "SELECT {MSG_SELECT_COLUMNS}
         FROM messages
         WHERE conversation_id = ? AND is_deleted = 0 AND seq > ? AND seq > 0
         ORDER BY seq ASC
         LIMIT ?"
    );
    let mut stmt = db.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![conversation_id, after_seq, limit], map_message_row)
        .map_err(|e| e.to_string())?;
    let mut messages: Vec<LocalMessage> = Vec::new();
    for row in rows {
        messages.push(row.map_err(|e| e.to_string())?);
    }
    messages.reverse();
    Ok(messages)
}

/// [`get_messages_after_with_conn`] 的全局 DB 版本
pub fn get_messages_after(
    conversation_id: &str,
    after_seq: i64,
    limit: i64,
) -> Result<Vec<LocalMessage>, String> {
    with_db!(db, { get_messages_after_with_conn(db, conversation_id, after_seq, limit) })
}

/// 保存消息
pub fn save_message(msg: LocalMessage) -> Result<(), String> {
    with_db!(db, {
        db.execute(
            "INSERT OR REPLACE INTO messages
             (message_uuid, conversation_id, conversation_type, sender_id, sender_name,
              sender_avatar, content, content_type, file_uuid, file_url, file_size,
              image_width, image_height, seq, reply_to,
              media_group_id, media_group_index, media_group_count,
              is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
              image_width, image_height, seq, reply_to,
              media_group_id, media_group_index, media_group_count,
              is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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

/// 批量插入消息：本地缺失的整行写入；本地已存在的**只回填"从未写过"的引用/相册四列**
///
/// 用途：历史消息加载（loadAllHistoryMessages）与 sync 的存量回填窗口
/// （syncService.ts `BACKFILL_WINDOW`）。
///
/// ## 为什么不能整行覆盖（INSERT OR REPLACE）
/// 服务器返回的历史响应可能不带 is_recalled / is_deleted 等本地状态字段，整行覆盖会把
/// 本地已撤回的消息（is_recalled=1）误覆盖回 0，UI 退化为"普通对方消息形态"。
///
/// ## 为什么也不能纯 INSERT OR IGNORE（本函数 2026-08-12 之前的行为，是一条真缺陷）
/// `reply_to` 与相册三件套曾在多条写入路径上被写死 null（wsHandlers / historyService /
/// syncService，2026-08-10 才逐条修好）。修好的只是"以后写进来的"——**已经躺在库里的那些行
/// 永远是 NULL**：sync 只拉 `seq > last_seq` 不会回头，历史加载又 IGNORE 掉已存在行。
/// 结果就是"别人回复你的历史消息，引用块永远不显示"（自己发的因为走 save_message 本地直写，
/// 一直带着 reply_to ⇒ 用户看到的现象正是「只看得到自己的」）。
///
/// 所以已存在行走 `ON CONFLICT DO UPDATE`，且**只碰这四列、只补空**：
/// `COALESCE(messages.x, excluded.x)` 保证本地已有值不被服务端值覆盖（撤回后服务端会把
/// 内容抹成占位，但这四列本身不参与撤回语义），本地为 NULL 时才吃进服务端的值。
/// content / seq / is_recalled / is_deleted 等其余列一律不动，原「只补本地缺失」的保护不变。
///
/// 与 save_messages 的区别：
/// - save_messages: INSERT OR REPLACE，用于 sync 增量 / WS 新消息（语义是"以服务器为准"）
/// - save_messages_skip_existing: 插入缺失行 + 回填空的引用/相册列，其余列不动
pub fn save_messages_skip_existing(messages: Vec<LocalMessage>) -> Result<(), String> {
    let mut guard = DB.lock();
    let db = guard
        .as_mut()
        .ok_or_else(|| "数据库未初始化".to_string())?;

    save_messages_skip_existing_with_conn(db, messages)
}

/// [`save_messages_skip_existing`] 的可注入连接版本
///
/// 拆出来的理由与 [`get_messages_with_conn`] 同款：单测要对 in-memory 连接跑**同一条真实 SQL**，
/// 在测试里另抄一份 SQL 就正好测不到 `ON CONFLICT DO UPDATE` 子句本身写错/写漏。
fn save_messages_skip_existing_with_conn(
    conn: &mut Connection,
    messages: Vec<LocalMessage>,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for msg in messages {
        tx.execute(
            "INSERT INTO messages
             (message_uuid, conversation_id, conversation_type, sender_id, sender_name,
              sender_avatar, content, content_type, file_uuid, file_url, file_size,
              image_width, image_height, seq, reply_to,
              media_group_id, media_group_index, media_group_count,
              is_recalled, is_deleted, send_time)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(message_uuid) DO UPDATE SET
               reply_to = COALESCE(messages.reply_to, excluded.reply_to),
               media_group_id = COALESCE(messages.media_group_id, excluded.media_group_id),
               media_group_index = COALESCE(messages.media_group_index, excluded.media_group_index),
               media_group_count = COALESCE(messages.media_group_count, excluded.media_group_count)",
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

    if let Some(sender_id) = &filter.sender_id {
        sql.push_str(" AND m.sender_id = ?");
        binds.push(Box::new(sender_id.clone()));
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
                m.file_url, m.file_size, m.image_width, m.image_height,
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
                m.file_url, m.file_size, m.image_width, m.image_height,
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
        image_width: row.get(11)?,
        image_height: row.get(12)?,
        seq: row.get(13)?,
        reply_to: row.get(14)?,
        is_recalled: row.get::<_, i64>(15)? != 0,
        is_deleted: row.get::<_, i64>(16)? != 0,
        send_time: row.get(17)?,
        created_at: row.get(18)?,
        media_group_id: row.get(19)?,
        media_group_index: row.get(20)?,
        media_group_count: row.get(21)?,
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
                row.get::<_, Option<String>>(22)?.unwrap_or_default(),
                row.get::<_, Option<String>>(23)?,
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
                m.file_url, m.file_size, m.image_width, m.image_height,
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
    /// 与 insert_msg 相同，但可指定发送者（按成员过滤的用例需要）
    #[allow(clippy::too_many_arguments)]
    fn insert_msg_from(
        conn: &Connection,
        uuid: &str,
        conv_id: &str,
        sender: &str,
        content: &str,
        content_type: &str,
        seq: i64,
        send_time: &str,
    ) {
        conn.execute(
            "INSERT INTO messages (message_uuid, conversation_id, conversation_type, sender_id,
             content, content_type, seq, send_time)
             VALUES (?, ?, 'group', ?, ?, ?, ?, ?)",
            params![uuid, conv_id, sender, content, content_type, seq, send_time],
        )
        .unwrap();
    }

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

    /// 构造一条"服务端下发形态"的 LocalMessage（带 reply_to / 相册三件套）
    fn server_message(uuid: &str, reply_to: Option<&str>) -> LocalMessage {
        LocalMessage {
            message_uuid: uuid.to_string(),
            conversation_id: "c1".to_string(),
            conversation_type: "group".to_string(),
            sender_id: "peer".to_string(),
            sender_name: Some("对方".to_string()),
            sender_avatar: None,
            content: "服务端内容".to_string(),
            content_type: "text".to_string(),
            file_uuid: None,
            file_url: None,
            file_size: None,
            image_width: None,
            image_height: None,
            seq: 1,
            reply_to: reply_to.map(str::to_string),
            media_group_id: Some("grp-9".to_string()),
            media_group_index: Some(0),
            media_group_count: Some(2),
            is_recalled: false,
            is_deleted: false,
            send_time: "2026-05-11T01:00:00Z".to_string(),
            created_at: None,
        }
    }

    /// 存量脏行（reply_to 为 NULL）必须能被历史/回填这条路补回来。
    ///
    /// 这正是"别人回复你的历史群消息看不到引用块、自己发的却看得到"的成因：
    /// 写入路径 2026-08-10 才修好，**已经躺在库里的行没有任何路径会回来重写**
    /// （sync 只拉 seq > last_seq；本函数修前是 INSERT OR IGNORE 直接跳过已存在行）。
    #[test]
    fn backfills_null_reply_to_on_existing_row() {
        let mut conn = setup_test_db();
        // 存量行：修复前的写入路径把 reply_to / 相册三件套写死成 NULL
        insert_msg_from(&conn, "m1", "c1", "peer", "别人的回复", "text", 1, "2026-05-11T01:00:00Z");

        save_messages_skip_existing_with_conn(&mut conn, vec![server_message("m1", Some("orig-uuid"))])
            .unwrap();

        let msgs = get_messages_with_conn(&conn, "c1", 50, None).unwrap();
        let hit = msgs.iter().find(|m| m.message_uuid == "m1").expect("行应仍在");
        assert_eq!(hit.reply_to.as_deref(), Some("orig-uuid"), "存量行的空 reply_to 必须被回填");
        assert_eq!(hit.media_group_id.as_deref(), Some("grp-9"), "相册三件套同理回填");
        assert_eq!(hit.media_group_index, Some(0));
        assert_eq!(hit.media_group_count, Some(2));
    }

    /// 回填**只碰那四列**：本地状态列（撤回/删除/内容）绝不能被服务端响应覆盖。
    /// 这条守的是本函数原有的存在理由（见 2026-05-10 切 skip-existing 的动机）。
    #[test]
    fn backfill_never_overwrites_local_state_columns() {
        let mut conn = setup_test_db();
        insert_msg_from(&conn, "m1", "c1", "peer", "本地内容", "text", 7, "2026-05-11T01:00:00Z");
        conn.execute("UPDATE messages SET is_recalled=1 WHERE message_uuid='m1'", [])
            .unwrap();

        save_messages_skip_existing_with_conn(&mut conn, vec![server_message("m1", Some("orig-uuid"))])
            .unwrap();

        // is_recalled=1 的消息不进 get_messages 的过滤？—— get_messages 不过滤撤回，直接读回来核对
        let (content, seq, recalled): (String, i64, i64) = conn
            .query_row(
                "SELECT content, seq, is_recalled FROM messages WHERE message_uuid='m1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(content, "本地内容", "content 不得被服务端响应覆盖");
        assert_eq!(seq, 7, "seq 不得被覆盖");
        assert_eq!(recalled, 1, "本地撤回状态不得被覆盖回 0");
    }

    /// 本地已有的非空 reply_to 不得被服务端值改写（COALESCE 的方向必须是"本地优先"）。
    #[test]
    fn backfill_keeps_existing_non_null_reply_to() {
        let mut conn = setup_test_db();
        insert_msg_from(&conn, "m1", "c1", "peer", "已有引用", "text", 1, "2026-05-11T01:00:00Z");
        conn.execute("UPDATE messages SET reply_to='local-orig' WHERE message_uuid='m1'", [])
            .unwrap();

        save_messages_skip_existing_with_conn(&mut conn, vec![server_message("m1", Some("server-orig"))])
            .unwrap();

        let msgs = get_messages_with_conn(&conn, "c1", 50, None).unwrap();
        let hit = msgs.iter().find(|m| m.message_uuid == "m1").unwrap();
        assert_eq!(hit.reply_to.as_deref(), Some("local-orig"), "本地已有值优先");
    }

    /// 本地缺失的消息仍然整行插入（原 INSERT 语义不能因为加 ON CONFLICT 而丢失）。
    #[test]
    fn inserts_missing_row_as_whole() {
        let mut conn = setup_test_db();
        save_messages_skip_existing_with_conn(&mut conn, vec![server_message("new1", Some("orig-uuid"))])
            .unwrap();

        let msgs = get_messages_with_conn(&conn, "c1", 50, None).unwrap();
        let hit = msgs.iter().find(|m| m.message_uuid == "new1").expect("缺失行应被整行插入");
        assert_eq!(hit.content, "服务端内容");
        assert_eq!(hit.reply_to.as_deref(), Some("orig-uuid"));
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
                file_uuid TEXT, file_url TEXT, file_size INTEGER,
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
            sender_id: None,
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
            sender_id: None,
        }
    }

    fn browse_uuids(rows: &[LocalMessage]) -> Vec<&str> {
        rows.iter().map(|m| m.message_uuid.as_str()).collect()
    }

    /// 按群成员过滤：只出该成员在本会话内的消息
    ///
    /// 与内容类型过滤**正交** —— 单独一条用例钉「只看某人发的图片」，
    /// 因为两个条件拼在同一段 WHERE 里，漏掉 AND 会让其中一个静默失效。
    #[test]
    fn browse_filters_by_sender_within_conversation() {
        let conn = setup_test_db();
        insert_msg_from(&conn, "a1", "c1", "u1", "张三说的", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg_from(&conn, "a2", "c1", "u2", "李四说的", "text", 2, "2026-05-11T02:00:00Z");
        insert_msg_from(&conn, "a3", "c1", "u1", "张三又说", "text", 3, "2026-05-11T03:00:00Z");
        // 别的会话里的同一个人：不能串会话
        insert_msg_from(&conn, "b1", "c2", "u1", "张三在别处", "text", 1, "2026-05-11T04:00:00Z");

        let filter = MessageSearchFilter {
            conversation_id: Some("c1".into()),
            sender_id: Some("u1".into()),
            ..Default::default()
        };
        let got = list_conversation_messages_with_conn(&conn, None, 50, 0, &filter).unwrap();
        let ids: Vec<&str> = got.iter().map(|m| m.message_uuid.as_str()).collect();
        // 时间倒序，且只有 c1 里 u1 的两条
        assert_eq!(ids, vec!["a3", "a1"], "只应出本会话内该成员的消息，且按时间倒序");
    }

    /// 成员过滤与类型过滤正交：只看某人发的图片
    #[test]
    fn browse_sender_and_content_type_filters_combine() {
        let conn = setup_test_db();
        insert_msg_from(&conn, "t1", "c1", "u1", "张三的字", "text", 1, "2026-05-11T01:00:00Z");
        insert_msg_from(&conn, "i1", "c1", "u1", "张三的图", "image", 2, "2026-05-11T02:00:00Z");
        insert_msg_from(&conn, "i2", "c1", "u2", "李四的图", "image", 3, "2026-05-11T03:00:00Z");

        let filter = MessageSearchFilter {
            conversation_id: Some("c1".into()),
            sender_id: Some("u1".into()),
            include_content_types: Some(vec!["image".into()]),
            ..Default::default()
        };
        let got = list_conversation_messages_with_conn(&conn, None, 50, 0, &filter).unwrap();
        let ids: Vec<&str> = got.iter().map(|m| m.message_uuid.as_str()).collect();
        assert_eq!(ids, vec!["i1"], "两个条件必须同时生效");
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

    // ========================================================================
    // 定位窗口化（get_messages_around / get_messages_after）
    // ========================================================================

    /// 播种一个「有 n 条消息」的会话，seq 从 1 递增到 n（seq 越大越新）
    fn seed_conversation(conn: &Connection, conv_id: &str, n: i64) {
        let tx = conn.unchecked_transaction().unwrap();
        for seq in 1..=n {
            insert_msg(
                conn,
                &format!("m{seq}"),
                conv_id,
                &format!("消息 {seq}"),
                "text",
                seq,
                &format!("2026-05-11T00:00:{:02}Z", seq % 60),
            );
        }
        tx.commit().unwrap();
    }

    fn uuids(rows: &[LocalMessage]) -> Vec<&str> {
        rows.iter().map(|m| m.message_uuid.as_str()).collect()
    }

    /// 窗口必须是「锚点前后各一段」，且整体保持 [新→旧]
    #[test]
    fn around_returns_window_newest_first() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 100);

        let win = get_messages_around_with_conn(&conn, "c1", "m50", 3, 2)
            .unwrap()
            .expect("锚点存在");

        // after=2 → m52, m51；锚点 m50；before=3 → m49, m48, m47
        assert_eq!(uuids(&win), vec!["m52", "m51", "m50", "m49", "m48", "m47"]);
    }

    /// 锚点在最边界时不许越界，也不许少给另一侧
    #[test]
    fn around_clamps_at_both_ends() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 10);

        let newest = get_messages_around_with_conn(&conn, "c1", "m10", 2, 5)
            .unwrap()
            .unwrap();
        assert_eq!(uuids(&newest), vec!["m10", "m9", "m8"], "最新端：没有更新的了");

        let oldest = get_messages_around_with_conn(&conn, "c1", "m1", 5, 2)
            .unwrap()
            .unwrap();
        assert_eq!(uuids(&oldest), vec!["m3", "m2", "m1"], "最旧端：没有更旧的了");
    }

    /// 锚点不存在 → `Ok(None)`，**不是**空数组
    ///
    /// 空数组会被调用方误读成「这段真的没有消息」而静默展示空白；
    /// `None` 才能让它走「定位失败」的显式提示。
    #[test]
    fn around_missing_anchor_is_none_not_empty() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 10);

        assert!(get_messages_around_with_conn(&conn, "c1", "不存在", 5, 5)
            .unwrap()
            .is_none());

        // 锚点存在但属于别的会话 → 同样是 None（不许跨会话取窗口）
        assert!(get_messages_around_with_conn(&conn, "c2", "m5", 5, 5)
            .unwrap()
            .is_none());
    }

    /// DB 出错 → `Err`，**不许**被吞成 `Ok(None)`
    ///
    /// 上一条用例钉的是「锚点不存在 = `Ok(None)`」；这条钉的是它的**另一半**：
    /// 锚点 seq 查询原先以 `.ok()` 收尾，任何 rusqlite 错误都会掉进同一个 `None` 出口，
    /// 于是「本地真没这条」和「库炸了」对调用方**完全不可区分** —— UI 一律报「找不到」，
    /// 真故障永远无人看见。两条用例必须成对存在，只有一条时改坏另一半不会翻红。
    #[test]
    fn around_db_error_is_err_not_silent_none() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 10);

        // 制造一个货真价实的 rusqlite 错误：把锚点查询依赖的表撤掉（触发器随表一起没）
        conn.execute("DROP TABLE messages", []).unwrap();

        let res = get_messages_around_with_conn(&conn, "c1", "m5", 5, 5);
        assert!(
            res.is_err(),
            "DB 错误必须向上抛；吞成 Ok(None) 会与「锚点不存在」混为一谈，实得 {res:?}"
        );
    }

    /// `seq = 0`（本地未同步的新消息）不许混进历史窗口
    #[test]
    fn around_excludes_unsynced_seq_zero() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 20);
        insert_msg(&conn, "pending", "c1", "还没同步", "text", 0, "2026-05-11T09:00:00Z");

        let win = get_messages_around_with_conn(&conn, "c1", "m10", 3, 3)
            .unwrap()
            .unwrap();
        assert!(
            !uuids(&win).contains(&"pending"),
            "seq=0 恒属最新端，混进历史窗口会让顺序错乱"
        );
    }

    /// 向更新方向分页：顺序仍是 [新→旧]，且不含起点自身
    #[test]
    fn after_paginates_forward_newest_first() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 100);

        let rows = get_messages_after_with_conn(&conn, "c1", 50, 3).unwrap();
        assert_eq!(uuids(&rows), vec!["m53", "m52", "m51"]);
    }

    /// 🔴 先量后改的「前」：当前实现（从最新逐页往回翻）到底读了多少行
    ///
    /// 复刻 `useLocalFriendMessages.ts:481 loadUntilMessage` 的算法：
    /// 每轮 `get_messages(limit=50, before_seq=游标)`，最多 20 轮。
    /// 断言的是**行为差**，不是耗时（耗时随机器波动，不能进断言，只打印）。
    #[test]
    fn locate_paging_reads_whole_prefix_window_reads_constant() {
        let conn = setup_test_db();
        const TOTAL: i64 = 5000;
        const PAGE: i64 = 50;
        const MAX_ITER: i64 = 20;
        seed_conversation(&conn, "c1", TOTAL);

        // 目标：第 4900 条之前（离最新 ~600 条），仍在 20×50=1000 的可达范围内
        let anchor = "m4400";

        // —— 前：逐页翻到命中
        let mut paged_rows = 0i64;
        let mut cursor: Option<i64> = None;
        let mut hit = false;
        for _ in 0..MAX_ITER {
            let page = get_messages_with_conn(&conn, "c1", PAGE, cursor).unwrap();
            paged_rows += page.len() as i64;
            if page.iter().any(|m| m.message_uuid == anchor) {
                hit = true;
                break;
            }
            match page.last() {
                Some(last) => cursor = Some(last.seq),
                None => break,
            }
        }
        assert!(hit, "该锚点应在翻页可达范围内");

        // —— 后：一次窗口
        let window = get_messages_around_with_conn(&conn, "c1", anchor, 30, 30)
            .unwrap()
            .unwrap();
        let window_rows = window.len() as i64;

        println!("[MEASURE] 逐页翻到 {anchor}: 读 {paged_rows} 行；窗口(±30): 读 {window_rows} 行");

        assert_eq!(window_rows, 61, "窗口恒为 before+1+after 条，与目标多早无关");
        assert!(
            paged_rows > window_rows * 9,
            "逐页读的行数应远大于窗口（实测 {paged_rows} vs {window_rows}）"
        );
    }

    /// 🔴 顺带修掉的**静默失败**：超出 20×50 轮次上限的目标，逐页翻**根本翻不到**
    ///
    /// 用户看到的是「定位失败」提示，但那条消息就在本地库里 —— 只是翻页够不着。
    /// 窗口查询与目标有多早无关，因此天然没有这个上限。
    #[test]
    fn locate_paging_cannot_reach_beyond_iteration_cap_but_window_can() {
        let conn = setup_test_db();
        const TOTAL: i64 = 5000;
        const PAGE: i64 = 50;
        const MAX_ITER: i64 = 20;
        seed_conversation(&conn, "c1", TOTAL);

        // 离最新 ~4000 条，远超 20×50=1000 的可达上限
        let anchor = "m1000";

        let mut cursor: Option<i64> = None;
        let mut hit = false;
        for _ in 0..MAX_ITER {
            let page = get_messages_with_conn(&conn, "c1", PAGE, cursor).unwrap();
            if page.iter().any(|m| m.message_uuid == anchor) {
                hit = true;
                break;
            }
            match page.last() {
                Some(last) => cursor = Some(last.seq),
                None => break,
            }
        }
        assert!(!hit, "前提：该锚点确实超出翻页可达范围（否则这条测试没在测它要测的东西）");

        let window = get_messages_around_with_conn(&conn, "c1", anchor, 30, 30)
            .unwrap()
            .expect("窗口查询与目标多早无关，必须命中");
        assert!(window.iter().any(|m| m.message_uuid == anchor));
    }

    // ========================================================================
    // 锚点 seq <= 0（本地未同步的新消息）—— 外部审计 idx=90 / idx=91
    // ========================================================================

    /// 🔴 `seq = 0` 的锚点必须走「找不到」这条出口，**不能**返回一段与它无关的消息。
    ///
    /// 修复前的真实行为（不是推的，是这两条 SQL 直接推出来的）：
    ///
    /// - 较新段 `seq >= 0 AND seq > 0` 被后半句吞掉 ⇒ 退化成「全会话最旧的 after+1 条」
    /// - 较旧段 `seq < 0 AND seq > 0` 恒空
    ///
    /// 于是前端整段替换成一段最旧消息、并 `return true` 报告定位成功
    /// ⇒ 用户点一下引用块，聊天记录跳到会话最开头。
    #[test]
    fn around_seq_zero_anchor_is_not_found_not_a_bogus_window() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 100);
        // 待发区上传落库的媒体消息：seq 恒 0（src/chat/shared/uploadPersist.ts）
        insert_msg(&conn, "local0", "c1", "[图片] a.png", "image", 0, "2026-05-11T00:01:00Z");

        let got = get_messages_around_with_conn(&conn, "c1", "local0", 30, 30).unwrap();

        assert!(
            got.is_none(),
            "seq=0 的锚点必须返回 None；修复前它返回的是 Some(会话最旧的 31 条)，实测拿到 {:?}",
            got.map(|rows| uuids(&rows).len()),
        );
    }

    /// 同一条判据的**空会话变体**：会话里一条 `seq > 0` 的消息都没有时，
    /// 修复前返回的是 `Some(vec![])` ⇒ 前端 `setMessages([])` 把整条会话清屏成「暂无消息」。
    #[test]
    fn around_seq_zero_anchor_in_all_local_conversation_is_not_empty_success() {
        let conn = setup_test_db();
        insert_msg(&conn, "local0", "c2", "[图片] a.png", "image", 0, "2026-05-11T00:01:00Z");
        insert_msg(&conn, "local1", "c2", "[图片] b.png", "image", 0, "2026-05-11T00:02:00Z");

        let got = get_messages_around_with_conn(&conn, "c2", "local0", 30, 30).unwrap();

        assert!(
            got.is_none(),
            "必须是 None（找不到），不能是 Some(空数组)——后者会被上层读成「这段真的没有消息」",
        );
    }

    /// 正对照：**同一条查询**对正常锚点仍然给出正确窗口（证明上面那两个 None 不是恒 None）
    #[test]
    fn around_normal_anchor_still_returns_window_after_seq_zero_guard() {
        let conn = setup_test_db();
        seed_conversation(&conn, "c1", 100);
        insert_msg(&conn, "local0", "c1", "[图片] a.png", "image", 0, "2026-05-11T00:01:00Z");

        let win = get_messages_around_with_conn(&conn, "c1", "m50", 3, 2)
            .unwrap()
            .expect("正常锚点必须命中");
        assert_eq!(uuids(&win), vec!["m52", "m51", "m50", "m49", "m48", "m47"]);
        // 顺带钉住：窗口里绝不会混进 seq=0 的本地消息
        assert!(!win.iter().any(|m| m.seq == 0));
    }
}
