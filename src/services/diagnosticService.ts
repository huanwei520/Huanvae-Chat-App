/**
 * 诊断日志上报服务
 *
 * 用于向后端上报严重错误，便于问题追踪和调试。
 * 目前支持：
 * - 好友文件权限错误（403）
 */

// ============================================
// 类型定义
// ============================================

/** 好友文件权限错误上报参数 */
export interface FriendPermissionErrorReport {
  /** 文件 UUID */
  file_uuid: string;
  /** 操作类型 */
  operation?: 'preview' | 'download';
  /** 原始错误信息 */
  error_message: string;
  /** 客户端时间戳（RFC3339 格式） */
  client_timestamp?: string;
  /** 对方用户 ID */
  other_user_id?: string;
  /** 额外上下文 */
  context?: {
    /** 当前页面 */
    screen?: string;
    /** 用户操作 */
    action?: string;
    /** 其他信息 */
    [key: string]: unknown;
  };
}

/** 上报响应 */
export interface DiagnosticReportResponse {
  success: boolean;
  report_id?: string;
  message?: string;
}

// ============================================
// 上报函数
// ============================================

/**
 * 上报好友文件权限错误
 *
 * 当用户访问好友文件时收到403错误，调用此函数上报到后端。
 * 后端会记录详细的诊断信息，便于排查问题。
 *
 * @param serverUrl - API 服务器地址
 * @param accessToken - 用户访问令牌
 * @param report - 错误报告内容
 * @returns 上报结果
 */
export async function reportFriendPermissionError(
  serverUrl: string,
  accessToken: string,
  report: FriendPermissionErrorReport,
): Promise<DiagnosticReportResponse> {
  // 确保有客户端时间戳
  const reportWithTimestamp: FriendPermissionErrorReport = {
    ...report,
    client_timestamp: report.client_timestamp || new Date().toISOString(),
  };

  try {
    const response = await fetch(
      `${serverUrl}/api/diagnostic/report/friend-permission`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportWithTimestamp),
      },
    );

    if (!response.ok) {
      // 上报失败不应影响用户体验，静默处理
      console.warn('[Diagnostic] 上报失败:', response.status);
      return { success: false, message: `HTTP ${response.status}` };
    }

    const data = await response.json();
    console.warn('[Diagnostic] 错误已上报:', data.report_id);
    return {
      success: true,
      report_id: data.report_id,
      message: data.message,
    };
  } catch (err) {
    // 网络错误等，静默处理
    console.warn('[Diagnostic] 上报异常:', err);
    return { success: false, message: String(err) };
  }
}

// ============================================
// 便捷上报函数
// ============================================

/**
 * 创建预签名URL错误上报上下文
 *
 * 用于在获取预签名URL失败时构建上报数据
 */
export function createPresignedUrlErrorContext(
  fileUuid: string,
  errorMessage: string,
  options?: {
    operation?: 'preview' | 'download';
    urlType?: 'user' | 'friend' | 'group';
    friendId?: string;
    /** 文件类型（图片/视频/文件） */
    fileType?: 'image' | 'video' | 'document';
    screen?: string;
    action?: string;
  },
): FriendPermissionErrorReport {
  return {
    file_uuid: fileUuid,
    operation: options?.operation || 'preview',
    error_message: errorMessage,
    other_user_id: options?.friendId,
    context: {
      screen: options?.screen || 'chat_detail',
      action: options?.action || 'view_file',
      url_type: options?.urlType,
      file_type: options?.fileType,
    },
  };
}
