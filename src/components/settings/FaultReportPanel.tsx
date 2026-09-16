/**
 * 故障记录检测面板
 *
 * 用户流程：遇 bug → 开启记录（自动附带开启前最近 ~5 分钟日志）→ 复现 → 停止 →
 * 附加多张截图（压缩）+ 文字描述 → 提交（整体加密上传）→ 展示工单号。
 * 上传失败 → 本地暂存（密文形态）→ 提供可见重试入口。
 *
 * @module components/settings/FaultReportPanel
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useSession } from '../../contexts/SessionContext';
import {
  startFaultRecording,
  stopFaultRecording,
  isFaultRecording,
  compressScreenshot,
  buildAndSealFaultReport,
  submitSealedEnvelope,
  retryStagedReports,
  getFaultReportUiState,
} from '../../services/faultReport';
import { listStagedReports, clearStagedReports } from '../../services/faultReport/staging';
import type { FaultScreenshot } from '../../services/faultReport/service';
import type { StagedFaultReport } from '../../services/faultReport/staging';
import { FAULT_REPORT_MAX_SCREENSHOTS } from '../../services/faultReport/config';
import './fault-report.css';

type PanelPhase = 'idle' | 'recording' | 'stopped' | 'submitting' | 'submitted' | 'error';

interface FaultReportPanelProps {
  onBack: () => void;
}

const BackIcon: React.FC = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const FaultReportPanel: React.FC<FaultReportPanelProps> = ({ onBack }) => {
  const { api } = useSession();
  const [phase, setPhase] = useState<PanelPhase>(() => (isFaultRecording() ? 'recording' : 'idle'));
  const [recordingSince, setRecordingSince] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [bufferStats, setBufferStats] = useState(getFaultReportUiState().bufferStats);
  const [publicKeyConfigured, setPublicKeyConfigured] = useState(getFaultReportUiState().publicKeyConfigured);

  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<FaultScreenshot[]>([]);
  const [compressing, setCompressing] = useState(false);

  const [ticketId, setTicketId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [staged, setStaged] = useState<StagedFaultReport[]>([]);
  const [retrying, setRetrying] = useState(false);

  const recordingRef = useRef<{ started_at: number; stopped_at: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 暂存队列
  const refreshStaged = useCallback(() => {
    setStaged(listStagedReports());
    setPublicKeyConfigured(getFaultReportUiState().publicKeyConfigured);
  }, []);

  useEffect(() => {
    refreshStaged();
  }, [refreshStaged]);

  // 记录中计时器
  useEffect(() => {
    if (phase !== 'recording' || recordingSince === null) {
      return;
    }
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - recordingSince) / 1000));
      setBufferStats(getFaultReportUiState().bufferStats);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, recordingSince]);

  const handleStart = useCallback(() => {
    try {
      const since = startFaultRecording();
      setRecordingSince(since);
      setElapsed(0);
      setPhase('recording');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  const handleStop = useCallback(() => {
    recordingRef.current = stopFaultRecording();
    setPhase('stopped');
  }, []);

  const handleFilesPicked = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }
    setCompressing(true);
    try {
      const room = FAULT_REPORT_MAX_SCREENSHOTS - screenshots.length;
      const picked = Array.from(files).slice(0, Math.max(0, room));
      const compressed = await Promise.all(picked.map((f) => compressScreenshot(f)));
      setScreenshots((prev) => [...prev, ...compressed].slice(0, FAULT_REPORT_MAX_SCREENSHOTS));
    } catch (err) {
      setErrorMsg(`截图压缩失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCompressing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [screenshots.length]);

  const handleSubmit = useCallback(async () => {
    if (!recordingRef.current) {
      return;
    }
    setPhase('submitting');
    setErrorMsg(null);
    if (!api) {
      setErrorMsg('未登录，无法上报（需用户鉴权）');
      refreshStaged();
      setPhase('error');
      return;
    }
    try {
      const { envelope } = await buildAndSealFaultReport({
        description,
        screenshots,
        recording: recordingRef.current,
      });
      const hint = description.slice(0, 80) || '(无描述)';
      const ticket = await submitSealedEnvelope(api, envelope, hint);
      setTicketId(ticket);
      setPhase('submitted');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      refreshStaged();
      setPhase('error');
    }
  }, [api, description, screenshots, refreshStaged]);

  const handleRetryStaged = useCallback(async () => {
    if (!api) {
      setErrorMsg('未登录，无法重试（需用户鉴权）');
      return;
    }
    setRetrying(true);
    setErrorMsg(null);
    try {
      const result = await retryStagedReports(api);
      refreshStaged();
      if (result.succeeded.length > 0) {
        setTicketId(result.succeeded[0]);
        setPhase('submitted');
      } else if (result.failed.length > 0) {
        setErrorMsg(`重试仍失败：${result.failed[0].reason}`);
      }
    } finally {
      setRetrying(false);
    }
  }, [api, refreshStaged]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <motion.div
      className="fault-report-panel"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="fault-report-header">
        <button className="settings-back-btn" onClick={onBack}>
          <BackIcon />
          <span>返回</span>
        </button>
        <h2 className="fault-report-title">故障记录检测</h2>
      </div>

      <div className="fault-report-content">
        {!publicKeyConfigured && (
          <div className="fault-report-note fault-report-note--warn">
            上报通道尚未配置正式公钥（服务器密钥事务交付后接入）。开启/记录可用，
            提交将被 fail-closed 拒绝；失败报告不会含明文。
          </div>
        )}

        {phase === 'idle' && (
          <>
            <div className="fault-report-section">
              <h3>遇到 bug？</h3>
              <p className="fault-report-desc">
                点击「开启记录」后正常复现问题。开启时会自动附带最近 5 分钟的日志；
                停止后可附加截图与文字描述一并加密上报，上传成功会给出工单号供跟进。
              </p>
              <ul className="fault-report-list">
                <li>采集：应用日志（脱敏后）、未捕获异常、网络错误摘要（仅 URL+状态码）、设备信息</li>
                <li>不采集：聊天正文、请求头、任何密钥/令牌（写入前强制脱敏）</li>
                <li>日志与截图整体加密后上传，本地与服务器均不存明文日志</li>
              </ul>
            </div>
            <button className="fault-report-btn fault-report-btn--primary" onClick={handleStart}>
              开启记录
            </button>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="fault-report-recording">
              <span className="fault-report-rec-dot" />
              <span className="fault-report-rec-time">{mmss}</span>
              <span className="fault-report-rec-hint">正在记录，请去复现问题…</span>
            </div>
            <div className="fault-report-stats">
              缓冲 {bufferStats.count} 条 / {(bufferStats.bytes / 1024 / 1024).toFixed(2)} MB
              {bufferStats.dropped > 0 && `（已滚动丢弃最旧 ${bufferStats.dropped} 条）`}
            </div>
            <button className="fault-report-btn fault-report-btn--danger" onClick={handleStop}>
              停止记录
            </button>
          </>
        )}

        {phase === 'stopped' && (
          <>
            <div className="fault-report-section">
              <h3>补充描述</h3>
              <textarea
                className="fault-report-textarea"
                placeholder="描述你遇到的问题（做了什么、期望什么、实际发生什么）"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
              />
            </div>
            <div className="fault-report-section">
              <h3>附加截图（可选，最多 {FAULT_REPORT_MAX_SCREENSHOTS} 张，自动压缩）</h3>
              <div className="fault-report-shots">
                {screenshots.map((s, i) => (
                  <div key={`${s.name}-${i}`} className="fault-report-shot">
                    <img src={`data:${s.mime};base64,${s.data}`} alt={`截图 ${i + 1}`} />
                    <button
                      className="fault-report-shot-remove"
                      onClick={() => setScreenshots((prev) => prev.filter((_, idx) => idx !== i))}
                      aria-label={`移除截图 ${i + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {screenshots.length < FAULT_REPORT_MAX_SCREENSHOTS && (
                  <button
                    className="fault-report-shot-add"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={compressing}
                  >
                    {compressing ? '压缩中…' : '+'}
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { void handleFilesPicked(e.target.files); }}
              />
            </div>
            <button
              className="fault-report-btn fault-report-btn--primary"
              onClick={handleSubmit}
              disabled={description.trim().length === 0 || compressing}
            >
              加密并提交
            </button>
          </>
        )}

        {phase === 'submitting' && (
          <div className="fault-report-center">
            <div className="fault-report-spinner" />
            <p>正在加密并上传…</p>
          </div>
        )}

        {phase === 'submitted' && ticketId && (
          <div className="fault-report-center">
            <div className="fault-report-ticket-icon">✓</div>
            <h3>上报成功</h3>
            <p className="fault-report-desc">工单号（请留存，供跟进查询）：</p>
            <div className="fault-report-ticket">{ticketId}</div>
          </div>
        )}

        {phase === 'error' && (
          <>
            <div className="fault-report-note fault-report-note--error">
              提交失败：{errorMsg}
            </div>
            {staged.length > 0 && (
              <div className="fault-report-section">
                <h3>已本地暂存（密文形态，{staged.length} 条）</h3>
                <ul className="fault-report-staged">
                  {staged.map((s) => (
                    <li key={s.id}>
                      <span>{new Date(s.stagedAt).toLocaleString()} · {s.hint}</span>
                    </li>
                  ))}
                </ul>
                <div className="fault-report-actions">
                  <button className="fault-report-btn fault-report-btn--primary" onClick={handleRetryStaged} disabled={retrying}>
                    {retrying ? '重试中…' : '重试上传'}
                  </button>
                  <button
                    className="fault-report-btn"
                    onClick={() => { clearStagedReports(); refreshStaged(); }}
                    disabled={retrying}
                  >
                    放弃暂存
                  </button>
                </div>
              </div>
            )}
            <button className="fault-report-btn" onClick={() => setPhase('stopped')}>
              返回编辑
            </button>
            <button
              className="fault-report-btn"
              onClick={() => { setPhase('idle'); setErrorMsg(null); setScreenshots([]); setDescription(''); }}
            >
              结束本次
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
};

export default FaultReportPanel;
