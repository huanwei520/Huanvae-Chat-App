/**
 * real-e2e(L2.5-web) 后端 API 直调 helper —— 仅测试 setup 用（注册/登录/加好友/发消息）。
 * 直打本地集群 nginx 钉实例口（18801=实例A / 18802=实例B），响应统一包裹
 * `{ success, code, data, message, error }`，此处手动解包并对 success=false fail-loud。
 * 测试账号每次运行随机生成，非真实凭据；不做清理（集群 reset 由 gate 层负责）。
 */

import { createHash } from 'node:crypto';

export const INSTANCE_A = 'http://127.0.0.1:18801';
export const INSTANCE_B = 'http://127.0.0.1:18802';

interface ApiEnvelope<T> {
  success: boolean;
  code: number;
  data: T;
  message: string | null;
  error: string | null;
}

async function post<T>(
  base: string,
  path: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // 实测：/api/friends/requests/approve 成功时返回 HTTP 200 + 空 body（无统一包裹），
  // 空 body 的 2xx 按成功处理；非 2xx 空 body 仍 fail-loud。
  if (text === '') {
    if (!res.ok) {
      throw new Error(`[backend-api] POST ${base}${path} failed: http=${res.status} (empty body)`);
    }
    return undefined as T;
  }
  let json: ApiEnvelope<T>;
  try {
    json = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    // 非 JSON（如 nginx 502 HTML 错误页）→ 带上状态码与 body 摘录，便于区分集群故障 vs 代码问题
    throw new Error(
      `[backend-api] POST ${base}${path} returned non-JSON: http=${res.status} body=${text.slice(0, 200)}`,
    );
  }
  if (!json.success) {
    throw new Error(
      `[backend-api] POST ${base}${path} failed: http=${res.status} code=${json.code} message=${json.message} error=${json.error}`,
    );
  }
  return json.data;
}

/**
 * GET 请求，与 post 同款 envelope 解包 + fail-loud（空 body 的 2xx 按成功处理）。
 */
async function get<T>(
  base: string,
  path: string,
  token?: string,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  if (text === '') {
    if (!res.ok) {
      throw new Error(`[backend-api] GET ${base}${path} failed: http=${res.status} (empty body)`);
    }
    return undefined as T;
  }
  let json: ApiEnvelope<T>;
  try {
    json = JSON.parse(text) as ApiEnvelope<T>;
  } catch {
    throw new Error(
      `[backend-api] GET ${base}${path} returned non-JSON: http=${res.status} body=${text.slice(0, 200)}`,
    );
  }
  if (!json.success) {
    throw new Error(
      `[backend-api] GET ${base}${path} failed: http=${res.status} code=${json.code} message=${json.message} error=${json.error}`,
    );
  }
  return json.data;
}

/** 注册新用户（password >= 6 位） */
export async function registerUser(
  base: string,
  userId: string,
  nickname: string,
  password: string,
): Promise<void> {
  await post(base, '/api/auth/register', {
    user_id: userId,
    nickname,
    password,
  });
}

/** 登录，返回 access_token */
export async function loginUser(
  base: string,
  userId: string,
  password: string,
): Promise<string> {
  const data = await post<{ access_token: string }>(base, '/api/auth/login', {
    user_id: userId,
    password,
    device_info: 'real-e2e setup client',
  });
  return data.access_token;
}

/** 发起好友请求（发起者 token / 发起者所钉实例） */
export async function sendFriendRequest(
  base: string,
  token: string,
  userId: string,
  targetUserId: string,
): Promise<void> {
  await post(
    base,
    '/api/friends/requests',
    {
      user_id: userId,
      target_user_id: targetUserId,
      reason: '',
      request_time: new Date().toISOString(),
    },
    token,
  );
}

/** 同意好友请求（接收者 token / 接收者所钉实例） */
export async function approveFriendRequest(
  base: string,
  token: string,
  userId: string,
  applicantUserId: string,
): Promise<void> {
  await post(
    base,
    '/api/friends/requests/approve',
    {
      user_id: userId,
      applicant_user_id: applicantUserId,
    },
    token,
  );
}

/** 发文本消息 */
export async function sendTextMessage(
  base: string,
  token: string,
  receiverId: string,
  content: string,
): Promise<void> {
  await post(
    base,
    '/api/messages',
    {
      receiver_id: receiverId,
      message_content: content,
      message_type: 'text',
      file_uuid: null,
      file_url: null,
      file_size: null,
    },
    token,
  );
}

// ============================================================================
// 群组 helper（建群 / 邀请 / 邀请列表 / 接受 / 群消息）
// ============================================================================

/**
 * 从 access_token(JWT) 的 payload 解出用户 ID（sub claim）。
 * 后端 AccessTokenClaims.sub = user_id（见 Huanvae-Chat-Rust/src/auth/models/claims.rs）。
 * createGroupWithMembers 只拿到成员的 {base, token}，借此推出 user_id 以调 inviteToGroup。
 */
function userIdFromToken(token: string): string {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error(`[backend-api] userIdFromToken: 非法 JWT（parts=${parts.length}）`);
  }
  let payload: { sub?: unknown };
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as { sub?: unknown };
  } catch (e) {
    throw new Error(`[backend-api] userIdFromToken: JWT payload 解析失败: ${String(e)}`);
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('[backend-api] userIdFromToken: JWT payload 缺少 sub(user_id)');
  }
  return payload.sub;
}

/** 创建群组（创建者 token / 创建者所钉实例），返回 group_id */
export async function createGroup(
  base: string,
  token: string,
  groupName: string,
): Promise<string> {
  const data = await post<{ group_id: string; group_name: string; created_at: string }>(
    base,
    '/api/groups',
    { group_name: groupName, group_description: '' },
    token,
  );
  return data.group_id;
}

/** 邀请成员入群（群主 token / 群主所钉实例） */
export async function inviteToGroup(
  base: string,
  token: string,
  groupId: string,
  userIds: string[],
): Promise<void> {
  await post(
    base,
    `/api/groups/${groupId}/invite`,
    { user_ids: userIds, message: '' },
    token,
  );
}

/** 群邀请（含 request_id、group_id、group_name、inviter_id 等） */
export interface GroupInvitation {
  request_id: string;
  group_id: string;
  group_name: string;
  inviter_id: string;
}

/** 列出当前用户收到的群邀请（被邀请者 token / 被邀请者所钉实例） */
export async function listGroupInvitations(
  base: string,
  token: string,
): Promise<GroupInvitation[]> {
  const data = await get<{ invitations: GroupInvitation[] }>(
    base,
    '/api/groups/invitations',
    token,
  );
  return data.invitations;
}

/** 接受群邀请（被邀请者 token / 被邀请者所钉实例） */
export async function acceptGroupInvitation(
  base: string,
  token: string,
  requestId: string,
): Promise<void> {
  await post(
    base,
    `/api/groups/invitations/${requestId}/accept`,
    {},
    token,
  );
}

/** 发群文本消息（发送者 token / 发送者所钉实例） */
export async function sendGroupMessage(
  base: string,
  token: string,
  groupId: string,
  content: string,
): Promise<void> {
  await post(
    base,
    '/api/group_messages',
    {
      group_id: groupId,
      message_content: content,
      message_type: 'text',
    },
    token,
  );
}

/**
 * 便捷组合：群主建群 → 邀请全部成员 → 每个成员各自接受自己的邀请，返回 group_id。
 * 成员 user_id 由其 token(JWT sub) 推出；某成员未收到该群邀请即 fail-loud。
 */
export async function createGroupWithMembers(
  base: string,
  ownerToken: string,
  groupName: string,
  members: Array<{ base: string; token: string }>,
): Promise<string> {
  const groupId = await createGroup(base, ownerToken, groupName);
  const memberIds = members.map((m) => userIdFromToken(m.token));
  await inviteToGroup(base, ownerToken, groupId, memberIds);
  for (const member of members) {
    const invitations = await listGroupInvitations(member.base, member.token);
    const invitation = invitations.find((inv) => inv.group_id === groupId);
    if (!invitation) {
      throw new Error(
        `[backend-api] createGroupWithMembers: 成员 ${userIdFromToken(member.token)} 未收到群 ${groupId} 的邀请（invitations=${invitations.length}）`,
      );
    }
    await acceptGroupInvitation(member.base, member.token, invitation.request_id);
  }
  return groupId;
}

// ============================================================================
// 文件 helper（上传好友文件即自动发出好友文件消息 / 取预签名 URL / 下载字节）
// ============================================================================

/** 上传好友文件的结果 */
export interface UploadedFriendFile {
  fileUuid: string;
  fileUrl: string;
  fileSize: number;
  sha256: string;
  filename: string;
}

/**
 * 上传好友文件（多步：request → [分片 part_url + PUT + confirm] 或秒传），
 * storage_location=friend_messages 时后端会自动发出好友文件消息。
 * 所有步骤打 `base`（上传者所钉实例）；分片 PUT 直传 MinIO-through-nginx 预签名 URL，用原生 fetch。
 */
export async function uploadFriendFile(
  base: string,
  token: string,
  receiverId: string,
  filename: string,
  bytes: Uint8Array,
): Promise<UploadedFriendFile> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // 1) 申请上传
  const reqData = await post<{
    mode: string;
    multipart_upload_id: string | null;
    file_key: string;
    instant_upload: boolean;
    existing_file_url: string | null;
  }>(
    base,
    '/api/storage/upload/request',
    {
      file_type: 'friend_document',
      storage_location: 'friend_messages',
      related_id: receiverId,
      filename,
      file_size: bytes.length,
      content_type: 'text/plain',
      file_hash: sha256,
      force_upload: false,
      image_width: null,
      image_height: null,
    },
    token,
  );

  let fileUrl: string;
  let fileSize: number;

  if (reqData.instant_upload) {
    // 秒传：后端已有同 hash 文件，直接复用 existing_file_url
    if (!reqData.existing_file_url) {
      throw new Error(
        `[backend-api] uploadFriendFile: instant_upload=true 但 existing_file_url 为空（file_key=${reqData.file_key}）`,
      );
    }
    fileUrl = reqData.existing_file_url;
    fileSize = bytes.length;
  } else {
    if (!reqData.multipart_upload_id) {
      throw new Error(
        `[backend-api] uploadFriendFile: 非秒传但缺 multipart_upload_id（file_key=${reqData.file_key}）`,
      );
    }
    // 2a) 取分片预签名 URL（part_url 为相对路径，无前导斜杠）
    const partData = await get<{ part_url: string }>(
      base,
      `/api/storage/multipart/part_url?file_key=${encodeURIComponent(reqData.file_key)}&upload_id=${encodeURIComponent(reqData.multipart_upload_id)}&part_number=1`,
      token,
    );
    // 2b) 原始字节 PUT 到 `${base}/${part_url}`（原生 fetch，非 envelope helper）
    // body 用 new Uint8Array(bytes) 复制出 ArrayBuffer 背衬视图：DOM lib 的 BodyInit
    // 不接受 Uint8Array<ArrayBufferLike>（含 SharedArrayBuffer 分支），复制后为 Uint8Array<ArrayBuffer>。
    const putRes = await fetch(`${base}/${partData.part_url}`, {
      method: 'PUT',
      body: new Uint8Array(bytes),
    });
    if (!putRes.ok) {
      const errText = (await putRes.text()).slice(0, 200);
      throw new Error(
        `[backend-api] uploadFriendFile: 分片 PUT 失败 http=${putRes.status} body=${errText}`,
      );
    }
    // 2c) 确认上传完成
    const confirmData = await post<{ file_url: string; file_size: number }>(
      base,
      '/api/storage/upload/confirm',
      { file_key: reqData.file_key },
      token,
    );
    fileUrl = confirmData.file_url;
    fileSize = confirmData.file_size;
  }

  // file_url 形如 'api/storage/file/<uuid>'，末段即 fileUuid
  const fileUuid = fileUrl.split('/').pop();
  if (!fileUuid) {
    throw new Error(
      `[backend-api] uploadFriendFile: 无法从 file_url 解析 fileUuid（file_url=${fileUrl}）`,
    );
  }

  return { fileUuid, fileUrl, fileSize, sha256, filename };
}

/**
 * 取好友文件的预签名 URL（preview）。返回值为相对路径
 * （'friends-file/....?x-id=GetObject&X-Amz-...'），原样返回。
 */
export async function getFriendFilePresignedUrl(
  base: string,
  token: string,
  fileUuid: string,
): Promise<string> {
  const data = await post<{ presigned_url: string }>(
    base,
    `/api/storage/friends_file/${fileUuid}/presigned_url`,
    { operation: 'preview' },
    token,
  );
  return data.presigned_url;
}

/**
 * 下载字节：presignedUrl 为相对路径时前置 base（原生 fetch，期望 http 200）。
 */
export async function downloadBytes(
  base: string,
  presignedUrl: string,
): Promise<Uint8Array> {
  const url = /^https?:\/\//i.test(presignedUrl)
    ? presignedUrl
    : `${base}/${presignedUrl.replace(/^\//, '')}`;
  const res = await fetch(url, { method: 'GET' });
  if (res.status !== 200) {
    const errText = (await res.text()).slice(0, 200);
    throw new Error(
      `[backend-api] downloadBytes 失败 http=${res.status} url=${url} body=${errText}`,
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

// ============================================================================
// 杂项（好友会话 ID / 消息同步）
// ============================================================================

/**
 * 好友会话 ID = 'conv-' + [a,b] 字典序排序后 join('-')。
 * 与 src/utils/conversationId.ts:19 保持一致。
 */
export function friendConversationId(userA: string, userB: string): string {
  return `conv-${[userA, userB].sort().join('-')}`;
}

/** 同步返回的单条消息 */
export interface SyncedMessage {
  message_uuid: string;
  sender_id: string;
  message_content: string;
  message_type: string;
  seq: number;
  file_uuid?: string | null;
  file_size?: number | null;
}

/** 同步返回的单个会话 */
export interface SyncedConversation {
  conversation_id: string;
  conversation_type: string;
  messages: SyncedMessage[];
  latest_seq: number;
  has_more: boolean;
}

/**
 * 增量同步会话消息（POST /api/messages/sync），返回 data.conversations。
 * 调用方自行断言消息内容/seq。
 */
export async function syncConversations(
  base: string,
  token: string,
  items: Array<{ conversation_id: string; conversation_type: 'friend' | 'group'; last_seq: number }>,
): Promise<SyncedConversation[]> {
  const data = await post<{ conversations: SyncedConversation[] }>(
    base,
    '/api/messages/sync',
    {
      conversations: items.map((it) => ({
        conversation_id: it.conversation_id,
        conversation_type: it.conversation_type,
        last_seq: it.last_seq,
      })),
    },
    token,
  );
  return data.conversations;
}

// ============================================================================
// WebRTC 房间 + HG 设备 helper（W4b 流程8/9 setup 用）
// ============================================================================

/** 创建 WebRTC 房间（创建者 token / 创建者所钉实例），返回 room_id/password/创建者 ws_token */
export async function createWebrtcRoom(
  base: string,
  token: string,
): Promise<{ room_id: string; password: string; ws_token: string }> {
  return post<{ room_id: string; password: string; ws_token: string }>(
    base,
    '/api/webrtc/rooms',
    {},
    token,
  );
}

/** 加入 WebRTC 房间（加入者 token / 加入者所钉实例），返回加入者 ws_token */
export async function joinWebrtcRoom(
  base: string,
  token: string,
  roomId: string,
  password: string,
  displayName: string,
): Promise<{ ws_token: string }> {
  return post<{ ws_token: string }>(
    base,
    `/api/webrtc/rooms/${roomId}/join`,
    { password, display_name: displayName },
    token,
  );
}

/** 注册 HuanvaeGuard 设备（用户 token / 所钉实例），返回 device_id/virtual_ip（裸 IPv4） */
export async function registerHgDevice(
  base: string,
  token: string,
  deviceName: string,
): Promise<{ device_id: string; virtual_ip: string }> {
  return post<{ device_id: string; virtual_ip: string }>(
    base,
    '/api/hg/devices/register',
    { device_name: deviceName, os: 'e2e-web' },
    token,
  );
}
