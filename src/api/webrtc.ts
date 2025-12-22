/**
 * WebRTC API 接口
 *
 * 视频会议功能的 API 接口定义：
 * - 创建会议房间
 * - 加入会议房间
 * - 获取 ICE 服务器配置
 * - WebSocket 信令消息类型
 *
 * @see backend-docs/webrtc/WebRTC房间.md
 * @see backend-docs/webrtc/ICE服务器配置.md
 */

import type { ApiClient } from './client';

// ============================================
// ICE 服务器配置相关类型
// ============================================

/** ICE 服务器配置 */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
  credentialType?: string;
}

/** ICE 配置响应 */
export interface IceConfigResponse {
  ice_servers: IceServer[];
  expires_at: string;
}

// ============================================
// 房间管理相关类型
// ============================================

/** 用户信息（用于显示头像等） */
export interface UserInfo {
  /** 用户ID（登录用户有值，访客为null） */
  user_id: string | null;
  /** 昵称 */
  nickname: string;
  /** 头像URL（登录用户有值，访客可能为null） */
  avatar_url: string | null;
  /** 是否已登录 */
  is_authenticated: boolean;
}

/** 创建房间请求 */
export interface CreateRoomRequest {
  /** 房间名称（可选） */
  name?: string;
  /** 创建者显示名称（可选，用于信令中显示） */
  display_name?: string;
  /** 创建者头像URL（可选） */
  avatar_url?: string;
  /** 6位密码（可选，不填自动生成） */
  password?: string;
  /** 最大人数（默认10，最大50） */
  max_participants?: number;
  /** 过期时间分钟（默认120，最大1440） */
  expires_minutes?: number;
}

/** 创建房间响应 */
export interface CreateRoomResponse {
  room_id: string;
  password: string;
  name: string;
  max_participants: number;
  expires_at: string;
  /** 创建者的参与者 ID */
  participant_id: string;
  /** 创建者的 WebSocket Token */
  ws_token: string;
  /** Token 过期时间 */
  token_expires_at: string;
  /** 创建者的用户信息 */
  user_info: UserInfo;
}

/** 加入房间请求 */
export interface JoinRoomRequest {
  password: string;
  display_name: string;
  /** 头像URL（可选） */
  avatar_url?: string;
}

/** 加入房间响应 */
export interface JoinRoomResponse {
  participant_id: string;
  ws_token: string;
  room_name: string;
  ice_servers: IceServer[];
  token_expires_at: string;
  /** 用户信息 */
  user_info: UserInfo;
}

/** 参与者信息 */
export interface Participant {
  id: string;
  name: string;
  is_creator: boolean;
  /** 用户详细信息（包含头像等） */
  user_info?: UserInfo;
}

// ============================================
// WebSocket 信令消息类型
// ============================================

/** 加入成功消息（服务器→客户端） */
export interface JoinedMessage {
  type: 'joined';
  participant_id: string;
  participants: Participant[];
}

/** 新参与者加入消息（服务器→客户端） */
export interface PeerJoinedMessage {
  type: 'peer_joined';
  participant: Participant;
}

/** 参与者离开消息（服务器→客户端） */
export interface PeerLeftMessage {
  type: 'peer_left';
  participant_id: string;
}

/** SDP Offer 消息 */
export interface OfferMessage {
  type: 'offer';
  from: string;
  sdp: string;
}

/** SDP Answer 消息 */
export interface AnswerMessage {
  type: 'answer';
  from: string;
  sdp: string;
}

/** ICE Candidate 消息 */
export interface CandidateMessage {
  type: 'candidate';
  from: string;
  candidate: {
    candidate: string;
    sdpMLineIndex: number;
    sdpMid: string;
  };
}

/** 房间关闭消息（服务器→客户端） */
export interface RoomClosedMessage {
  type: 'room_closed';
  reason: string;
}

/** 错误消息（服务器→客户端） */
export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

/** 心跳响应消息（服务器→客户端） */
export interface PongMessage {
  type: 'pong';
  timestamp: string;
}

/** 所有服务器→客户端消息类型 */
export type ServerMessage =
  | JoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | OfferMessage
  | AnswerMessage
  | CandidateMessage
  | RoomClosedMessage
  | ErrorMessage
  | PongMessage;

/** 客户端发送的 Offer 消息 */
export interface ClientOfferMessage {
  type: 'offer';
  to: string;
  sdp: string;
}

/** 客户端发送的 Answer 消息 */
export interface ClientAnswerMessage {
  type: 'answer';
  to: string;
  sdp: string;
}

/** 客户端发送的 Candidate 消息 */
export interface ClientCandidateMessage {
  type: 'candidate';
  to: string;
  candidate: RTCIceCandidate;
}

/** 离开房间消息 */
export interface LeaveMessage {
  type: 'leave';
}

/** 所有客户端→服务器消息类型 */
export type ClientMessage =
  | ClientOfferMessage
  | ClientAnswerMessage
  | ClientCandidateMessage
  | LeaveMessage;

// ============================================
// API 响应包装类型
// ============================================

/** 标准 API 响应格式 */
interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// ============================================
// API 函数
// ============================================

/**
 * 获取 ICE 服务器配置
 * @param api - API 客户端
 * @param region - 可选，客户端区域用于就近分配
 */
export async function getIceServers(
  api: ApiClient,
  region?: string,
): Promise<IceConfigResponse> {
  const response = await api.get<ApiResponse<IceConfigResponse>>(
    region ? `/api/webrtc/ice_servers?region=${encodeURIComponent(region)}` : '/api/webrtc/ice_servers',
  );
  return response.data;
}

/**
 * 创建会议房间
 * @param api - API 客户端
 * @param options - 创建选项
 */
export async function createRoom(
  api: ApiClient,
  options: CreateRoomRequest = {},
): Promise<CreateRoomResponse> {
  const response = await api.post<ApiResponse<CreateRoomResponse>>('/api/webrtc/rooms', options as unknown as Record<string, unknown>);
  return response.data;
}

/**
 * 加入会议房间（无需登录）
 * @param api - API 客户端
 * @param roomId - 房间号
 * @param password - 密码
 * @param displayName - 显示名称
 */
export async function joinRoom(
  api: ApiClient,
  roomId: string,
  password: string,
  displayName: string,
  avatarUrl?: string,
): Promise<JoinRoomResponse> {
  const body: JoinRoomRequest = {
    password,
    display_name: displayName,
  };
  if (avatarUrl) {
    body.avatar_url = avatarUrl;
  }
  const response = await api.post<ApiResponse<JoinRoomResponse>>(
    `/api/webrtc/rooms/${roomId}/join`,
    body as unknown as Record<string, unknown>,
  );
  return response.data;
}

/**
 * 获取 WebSocket 信令 URL
 * @param roomId - 房间号
 * @param token - access_token 或 ws_token
 */
export function getSignalingUrl(roomId: string, token: string): string {
  const apiBase = import.meta.env.VITE_API_BASE_URL || 'https://api.huanvae.cn';
  const wsBase = apiBase.replace(/^http/, 'ws');
  return `${wsBase}/ws/webrtc/rooms/${roomId}?token=${token}`;
}

// ============================================
// 会议窗口数据传递
// ============================================

/** 存储在 localStorage 中的会议信息 */
export interface MeetingWindowData {
  role: 'creator' | 'participant';
  roomId: string;
  password: string;
  roomName: string;
  displayName: string;
  /** WebSocket Token（创建者和参与者都使用 ws_token） */
  token: string;
  /** ICE 服务器配置（参与者加入时返回，创建者需要单独获取） */
  iceServers?: IceServer[];
  /** 用户信息（包含头像等） */
  userInfo?: UserInfo;
}

const MEETING_DATA_KEY = 'huanvae_meeting_data';

/** 保存会议数据到 localStorage */
export function saveMeetingData(data: MeetingWindowData): void {
  localStorage.setItem(MEETING_DATA_KEY, JSON.stringify(data));
}

/** 从 localStorage 读取会议数据 */
export function loadMeetingData(): MeetingWindowData | null {
  const data = localStorage.getItem(MEETING_DATA_KEY);
  if (!data) {
    return null;
  }
  try {
    return JSON.parse(data) as MeetingWindowData;
  } catch {
    return null;
  }
}

/** 清除会议数据 */
export function clearMeetingData(): void {
  localStorage.removeItem(MEETING_DATA_KEY);
}
