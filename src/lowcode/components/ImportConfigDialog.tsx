/**
 * 配置文件导入对话框
 *
 * 支持导入 JSON 格式的流程配置文件
 *
 * @module lowcode/components/ImportConfigDialog
 * @created 2026-02-02
 */

import { memo, useState, useCallback, useRef } from 'react';
import type { WorkflowConfig, ConfigValidationResult } from '../types/lowcode';

// ============================================================================
// 类型定义
// ============================================================================

interface ImportConfigDialogProps {
  /** 是否打开 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 验证配置 */
  onValidate: (config: WorkflowConfig) => Promise<ConfigValidationResult>;
  /** 导入配置 */
  onImport: (config: WorkflowConfig, overwrite: boolean) => Promise<void>;
}

// ============================================================================
// 主组件
// ============================================================================

function ImportConfigDialogComponent({
  isOpen,
  onClose,
  onValidate,
  onImport,
}: ImportConfigDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<WorkflowConfig | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<ConfigValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [overwrite, setOverwrite] = useState(false);

  // 重置状态
  const resetState = useCallback(() => {
    setConfig(null);
    setFileName('');
    setError(null);
    setValidation(null);
    setIsValidating(false);
    setIsImporting(false);
    setOverwrite(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // 处理关闭
  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // 处理文件选择
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setValidation(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      // 检查是否是有效的配置格式
      if (!parsed.name || !parsed.definition) {
        // 尝试检查是否是导出格式（包含 config 字段）
        if (parsed.config?.name && parsed.config?.definition) {
          setConfig(parsed.config);
        } else {
          throw new Error('无效的配置文件格式');
        }
      } else {
        setConfig(parsed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析文件失败');
      setConfig(null);
    }
  }, []);

  // 处理验证
  const handleValidate = useCallback(async () => {
    if (!config) return;

    setIsValidating(true);
    setError(null);

    try {
      const result = await onValidate(config);
      setValidation(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证失败');
    } finally {
      setIsValidating(false);
    }
  }, [config, onValidate]);

  // 处理导入
  const handleImport = useCallback(async () => {
    if (!config) return;

    setIsImporting(true);
    setError(null);

    try {
      await onImport(config, overwrite);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败');
    } finally {
      setIsImporting(false);
    }
  }, [config, overwrite, onImport, handleClose]);

  if (!isOpen) return null;

  return (
    <div className="dialog-overlay" onClick={handleClose}>
      <div className="dialog import-config-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>导入配置文件</h2>
          <button className="dialog-close" onClick={handleClose}>×</button>
        </div>

        <div className="dialog-content">
          {/* 文件选择 */}
          <div className="import-file-section">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <button
              className="import-file-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              选择配置文件 (.json)
            </button>
            {fileName && <span className="import-file-name">{fileName}</span>}
          </div>

          {/* 错误显示 */}
          {error && (
            <div className="import-error">
              <strong>错误:</strong> {error}
            </div>
          )}

          {/* 配置预览 */}
          {config && (
            <div className="import-preview">
              <h3>配置预览</h3>
              <div className="import-preview-info">
                <div className="preview-row">
                  <span className="preview-label">名称:</span>
                  <span className="preview-value">{config.name}</span>
                </div>
                {config.description && (
                  <div className="preview-row">
                    <span className="preview-label">描述:</span>
                    <span className="preview-value">{config.description}</span>
                  </div>
                )}
                <div className="preview-row">
                  <span className="preview-label">节点数:</span>
                  <span className="preview-value">{config.definition.nodes.length}</span>
                </div>
                <div className="preview-row">
                  <span className="preview-label">连接数:</span>
                  <span className="preview-value">{config.definition.edges.length}</span>
                </div>
              </div>

              {/* 验证按钮 */}
              <button
                className="import-validate-btn"
                onClick={handleValidate}
                disabled={isValidating}
              >
                {isValidating ? '验证中...' : '验证配置'}
              </button>
            </div>
          )}

          {/* 验证结果 */}
          {validation && (
            <div className={`import-validation ${validation.is_valid ? 'valid' : 'invalid'}`}>
              <h3>验证结果: {validation.is_valid ? '✓ 有效' : '✗ 无效'}</h3>

              {validation.errors.length > 0 && (
                <div className="validation-section errors">
                  <h4>错误 ({validation.errors.length})</h4>
                  <ul>
                    {validation.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.warnings.length > 0 && (
                <div className="validation-section warnings">
                  <h4>警告 ({validation.warnings.length})</h4>
                  <ul>
                    {validation.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validation.missing_operators.length > 0 && (
                <div className="validation-section missing">
                  <h4>缺失算子 ({validation.missing_operators.length})</h4>
                  <ul>
                    {validation.missing_operators.map((op, i) => (
                      <li key={i}>{op}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* 导入选项 */}
          {config && validation?.is_valid && (
            <div className="import-options">
              <label className="import-option-checkbox">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                />
                <span>覆盖同名流程</span>
              </label>
            </div>
          )}
        </div>

        <div className="dialog-footer">
          <button className="dialog-btn secondary" onClick={handleClose}>
            取消
          </button>
          <button
            className="dialog-btn primary"
            onClick={handleImport}
            disabled={!config || !validation?.is_valid || isImporting}
          >
            {isImporting ? '导入中...' : '导入'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ImportConfigDialog = memo(ImportConfigDialogComponent);
export default ImportConfigDialog;
