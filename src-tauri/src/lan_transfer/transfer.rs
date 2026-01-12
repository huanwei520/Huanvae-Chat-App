/*!
 * 文件传输模块
 *
 * 实现文件发送逻辑
 *
 * 功能：
 * - 发送连接请求
 * - 响应连接请求
 * - 发送文件（分块 + 校验）
 * - 取消传输
 */

use super::discovery::get_event_sender;
use super::protocol::*;
use super::get_lan_transfer_state;
use chrono::Utc;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

// ============================================================================
// 错误类型
// ============================================================================

#[derive(Error, Debug)]
pub enum TransferError {
    #[error("设备未找到: {0}")]
    DeviceNotFound(String),
    #[error("请求未找到: {0}")]
    RequestNotFound(String),
    #[error("连接失败: {0}")]
    ConnectionFailed(String),
    #[error("文件读取失败: {0}")]
    FileReadFailed(String),
    #[error("传输失败: {0}")]
    TransferFailed(String),
    #[error("任务未找到: {0}")]
    TaskNotFound(String),
}

// ============================================================================
// 连接管理
// ============================================================================

/// 发送连接请求
pub async fn send_connection_request(device_id: &str) -> Result<String, TransferError> {
    let state = get_lan_transfer_state();

    // 获取目标设备信息
    let target_device = {
        let devices = state.devices.read();
        devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| TransferError::DeviceNotFound(device_id.to_string()))?
    };

    // 获取本机设备信息
    let local_device = {
        let local = state.local_device.read();
        local
            .clone()
            .ok_or_else(|| TransferError::ConnectionFailed("本地服务未启动".to_string()))?
    };

    // 构建请求数据
    let request_device = DiscoveredDevice {
        device_id: local_device.device_id.clone(),
        device_name: local_device.device_name.clone(),
        user_id: local_device.user_id.clone(),
        user_nickname: local_device.user_nickname.clone(),
        ip_address: local_device.ip_address.clone(),
        port: local_device.port,
        discovered_at: Utc::now().to_rfc3339(),
        last_seen: Utc::now().to_rfc3339(),
    };

    // 发送 HTTP 请求
    let url = format!("http://{}:{}/api/connect", target_device.ip_address, target_device.port);

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&request_device)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| TransferError::ConnectionFailed(e.to_string()))?;

    if !response.status().is_success() {
        return Err(TransferError::ConnectionFailed(format!(
            "服务器返回错误: {}",
            response.status()
        )));
    }

    #[derive(serde::Deserialize)]
    struct ConnectResponse {
        request_id: String,
    }

    let resp: ConnectResponse = response
        .json()
        .await
        .map_err(|e| TransferError::ConnectionFailed(e.to_string()))?;

    println!(
        "[LanTransfer] 连接请求已发送到 {} ({})",
        target_device.device_name, target_device.ip_address
    );

    Ok(resp.request_id)
}

/// 响应连接请求
pub async fn respond_to_request(request_id: &str, accept: bool) -> Result<(), TransferError> {
    let state = get_lan_transfer_state();

    // 获取请求
    let request = {
        let mut pending = state.pending_requests.write();
        pending
            .remove(request_id)
            .ok_or_else(|| TransferError::RequestNotFound(request_id.to_string()))?
    };

    // 发送事件
    let _ = get_event_sender().send(LanTransferEvent::ConnectionResponse {
        request_id: request_id.to_string(),
        accepted: accept,
    });

    println!(
        "[LanTransfer] 连接请求 {} 已{}: {} ({})",
        request_id,
        if accept { "接受" } else { "拒绝" },
        request.from_device.device_name,
        request.from_device.ip_address
    );

    Ok(())
}

// ============================================================================
// 文件传输
// ============================================================================

/// 发送文件
pub async fn send_file(
    device_id: &str,
    file_path: &str,
    app_handle: tauri::AppHandle,
) -> Result<String, TransferError> {
    let state = get_lan_transfer_state();

    // 获取目标设备
    let target_device = {
        let devices = state.devices.read();
        devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| TransferError::DeviceNotFound(device_id.to_string()))?
    };

    // 读取文件信息
    let path = Path::new(file_path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    let metadata = std::fs::metadata(path)
        .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

    let file_size = metadata.len();

    // 计算文件哈希
    let mut file = std::fs::File::open(path)
        .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; CHUNK_SIZE];

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

        if bytes_read == 0 {
            break;
        }

        hasher.update(&buffer[..bytes_read]);
    }

    let file_hash = hex::encode(hasher.finalize());

    // 获取 MIME 类型
    let mime_type = mime_guess::from_path(path)
        .first_or_octet_stream()
        .to_string();

    // 生成 ID
    let file_id = Uuid::new_v4().to_string();
    let session_id = Uuid::new_v4().to_string();
    let task_id = Uuid::new_v4().to_string();

    let file_meta = FileMetadata {
        file_id: file_id.clone(),
        file_name: file_name.clone(),
        file_size,
        mime_type,
        sha256: file_hash,
    };

    // 创建传输任务
    let task = TransferTask {
        task_id: task_id.clone(),
        session_id: session_id.clone(),
        file: file_meta.clone(),
        direction: TransferDirection::Send,
        target_device: target_device.clone(),
        status: TransferStatus::Pending,
        transferred_bytes: 0,
        speed: 0,
        started_at: Utc::now().to_rfc3339(),
        eta_seconds: None,
    };

    // 保存任务
    {
        let mut transfers = state.active_transfers.write();
        transfers.insert(task_id.clone(), task.clone());
    }

    // 发送事件
    let _ = get_event_sender().send(LanTransferEvent::TransferProgress { task: task.clone() });

    // 在后台线程中执行传输
    let task_id_clone = task_id.clone();
    let file_path = file_path.to_string();

    tokio::spawn(async move {
        let result = do_file_transfer(
            &target_device,
            &session_id,
            &file_meta,
            &file_path,
            &task_id_clone,
            app_handle,
        )
        .await;

        let state = get_lan_transfer_state();
        let mut transfers = state.active_transfers.write();

        if let Some(task) = transfers.get_mut(&task_id_clone) {
            match result {
                Ok(_) => {
                    task.status = TransferStatus::Completed;
                    task.transferred_bytes = task.file.file_size;
                    let _ = get_event_sender().send(LanTransferEvent::TransferCompleted {
                        task_id: task_id_clone.clone(),
                        saved_path: file_path.clone(),
                    });
                }
                Err(e) => {
                    task.status = TransferStatus::Failed;
                    let _ = get_event_sender().send(LanTransferEvent::TransferFailed {
                        task_id: task_id_clone.clone(),
                        error: e.to_string(),
                    });
                }
            }
        }
    });

    Ok(task_id)
}

/// 执行文件传输
async fn do_file_transfer(
    target_device: &DiscoveredDevice,
    session_id: &str,
    file_meta: &FileMetadata,
    file_path: &str,
    task_id: &str,
    _app_handle: tauri::AppHandle,
) -> Result<(), TransferError> {
    let base_url = format!("http://{}:{}", target_device.ip_address, target_device.port);
    let client = reqwest::Client::new();

    // 1. 发送准备上传请求
    let prepare_request = PrepareUploadRequest {
        session_id: session_id.to_string(),
        files: vec![file_meta.clone()],
    };

    let prepare_response = client
        .post(format!("{}/api/prepare-upload", base_url))
        .json(&prepare_request)
        .send()
        .await
        .map_err(|e| TransferError::TransferFailed(e.to_string()))?;

    let prepare_resp: PrepareUploadResponse = prepare_response
        .json()
        .await
        .map_err(|e| TransferError::TransferFailed(e.to_string()))?;

    if !prepare_resp.accepted {
        return Err(TransferError::TransferFailed(
            prepare_resp.reject_reason.unwrap_or_else(|| "对方拒绝接收".to_string()),
        ));
    }

    // 2. 分块上传文件
    let mut file = std::fs::File::open(file_path)
        .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

    let mut buffer = vec![0u8; CHUNK_SIZE];
    let mut offset: u64 = 0;
    let state = get_lan_transfer_state();

    loop {
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| TransferError::FileReadFailed(e.to_string()))?;

        if bytes_read == 0 {
            break;
        }

        let chunk_data = &buffer[..bytes_read];

        // 发送块
        let upload_url = format!(
            "{}/api/upload?sessionId={}&fileId={}",
            base_url, session_id, file_meta.file_id
        );

        let response = client
            .post(&upload_url)
            .body(chunk_data.to_vec())
            .send()
            .await
            .map_err(|e| TransferError::TransferFailed(e.to_string()))?;

        let chunk_resp: ChunkResponse = response
            .json()
            .await
            .map_err(|e| TransferError::TransferFailed(e.to_string()))?;

        if !chunk_resp.success {
            return Err(TransferError::TransferFailed(
                chunk_resp.error.unwrap_or_else(|| "块传输失败".to_string()),
            ));
        }

        offset += bytes_read as u64;

        // 更新进度
        {
            let mut transfers = state.active_transfers.write();
            if let Some(task) = transfers.get_mut(task_id) {
                task.transferred_bytes = offset;
                task.status = TransferStatus::Transferring;

                let _ = get_event_sender().send(LanTransferEvent::TransferProgress {
                    task: task.clone(),
                });
            }
        }
    }

    // 3. 发送完成请求
    let finish_url = format!(
        "{}/api/finish?sessionId={}&fileId={}",
        base_url, session_id, file_meta.file_id
    );

    let finish_response = client
        .post(&finish_url)
        .send()
        .await
        .map_err(|e| TransferError::TransferFailed(e.to_string()))?;

    let finish_resp: FinishUploadResponse = finish_response
        .json()
        .await
        .map_err(|e| TransferError::TransferFailed(e.to_string()))?;

    if !finish_resp.success {
        return Err(TransferError::TransferFailed(
            finish_resp.error.unwrap_or_else(|| "传输完成验证失败".to_string()),
        ));
    }

    println!(
        "[LanTransfer] 文件传输完成: {} -> {}",
        file_meta.file_name, target_device.device_name
    );

    Ok(())
}

/// 取消传输
pub async fn cancel_transfer(transfer_id: &str) -> Result<(), TransferError> {
    let state = get_lan_transfer_state();

    let mut transfers = state.active_transfers.write();
    let task = transfers
        .get_mut(transfer_id)
        .ok_or_else(|| TransferError::TaskNotFound(transfer_id.to_string()))?;

    task.status = TransferStatus::Cancelled;

    let _ = get_event_sender().send(LanTransferEvent::TransferFailed {
        task_id: transfer_id.to_string(),
        error: "用户取消".to_string(),
    });

    println!("[LanTransfer] 传输已取消: {}", transfer_id);

    Ok(())
}

