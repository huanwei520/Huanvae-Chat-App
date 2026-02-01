/**
 * 模板选择对话框
 *
 * 显示可用的流程模板列表，支持从模板创建新流程
 *
 * @module lowcode/components/TemplateDialog
 */

import { memo, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WorkflowTemplate } from '../types/lowcode';
import type { TemplateService } from '../services/templateService';

// ============================================================================
// 图标组件
// ============================================================================

function CloseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TemplateIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="9" y1="21" x2="9" y2="9" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="23,4 23,10 17,10" />
      <polyline points="1,20 1,14 7,14" />
      <path d="M3.51,9a9,9,0,0,1,14.85-3.36L23,10M1,14l4.64,4.36A9,9,0,0,0,20.49,15" />
    </svg>
  );
}

function CreateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ============================================================================
// 类型定义
// ============================================================================

interface TemplateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  templateService: TemplateService | null;
  onCreateFromTemplate: (templateId: string, name: string, description?: string) => Promise<void>;
}

// ============================================================================
// 模板卡片组件
// ============================================================================

interface TemplateCardProps {
  template: WorkflowTemplate;
  isSelected: boolean;
  onSelect: () => void;
}

function TemplateCard({ template, isSelected, onSelect }: TemplateCardProps) {
  return (
    <motion.div
      className={`template-card ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <div className="template-card-icon">
        <TemplateIcon />
      </div>
      <div className="template-card-content">
        <div className="template-card-name">{template.name}</div>
        {template.description && (
          <div className="template-card-desc">{template.description}</div>
        )}
        <div className="template-card-meta">
          <span className="template-category">{template.category}</span>
          <span className="template-date">
            {new Date(template.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>
    </motion.div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

function TemplateDialogComponent({
  isOpen,
  onClose,
  templateService,
  onCreateFromTemplate,
}: TemplateDialogProps) {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<WorkflowTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // 加载模板列表
  const loadTemplates = useCallback(async () => {
    if (!templateService) { return; }

    setLoading(true);
    setError(null);

    try {
      const response = await templateService.getTemplates();
      setTemplates(response.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [templateService]);

  // 打开时加载
  useEffect(() => {
    if (isOpen && templateService) {
      loadTemplates();
      setSelectedTemplate(null);
      setShowCreateForm(false);
      setNewName('');
      setNewDescription('');
    }
  }, [isOpen, templateService, loadTemplates]);

  // 选择模板
  const handleSelect = useCallback((template: WorkflowTemplate) => {
    setSelectedTemplate(template);
    setNewName(`${template.name} - 副本`);
    setNewDescription(template.description || '');
  }, []);

  // 开始创建
  const handleStartCreate = useCallback(() => {
    if (!selectedTemplate) { return; }
    setShowCreateForm(true);
  }, [selectedTemplate]);

  // 确认创建
  const handleConfirmCreate = useCallback(async () => {
    if (!selectedTemplate || !newName.trim()) { return; }

    setCreating(true);
    setError(null);

    try {
      await onCreateFromTemplate(
        selectedTemplate.id,
        newName.trim(),
        newDescription.trim() || undefined,
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }, [selectedTemplate, newName, newDescription, onCreateFromTemplate, onClose]);

  // 取消创建
  const handleCancelCreate = useCallback(() => {
    setShowCreateForm(false);
  }, []);

  if (!isOpen) { return null; }

  return (
    <AnimatePresence>
      <motion.div
        className="dialog-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="dialog-content template-dialog"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 头部 */}
          <div className="dialog-header">
            <h2 className="dialog-title">选择模板</h2>
            <div className="dialog-header-actions">
              <button
                className="dialog-refresh-btn"
                onClick={loadTemplates}
                disabled={loading}
                title="刷新"
              >
                <RefreshIcon />
              </button>
              <button className="dialog-close-btn" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* 内容区 */}
          <div className="dialog-body">
            {loading && (
              <div className="template-loading">加载中...</div>
            )}

            {error && (
              <div className="template-error">{error}</div>
            )}

            {!loading && !error && templates.length === 0 && (
              <div className="template-empty">
                暂无可用模板
              </div>
            )}

            {!loading && !showCreateForm && templates.length > 0 && (
              <div className="template-grid">
                {templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    isSelected={selectedTemplate?.id === template.id}
                    onSelect={() => handleSelect(template)}
                  />
                ))}
              </div>
            )}

            {showCreateForm && selectedTemplate && (
              <div className="template-create-form">
                <div className="form-group">
                  <label>流程名称</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="输入新流程名称"
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label>流程描述</label>
                  <textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="输入流程描述（可选）"
                    rows={3}
                  />
                </div>
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="dialog-footer">
            {!showCreateForm ? (
              <>
                <button className="dialog-btn secondary" onClick={onClose}>
                  取消
                </button>
                <button
                  className="dialog-btn primary"
                  onClick={handleStartCreate}
                  disabled={!selectedTemplate}
                >
                  <CreateIcon />
                  <span>使用此模板</span>
                </button>
              </>
            ) : (
              <>
                <button className="dialog-btn secondary" onClick={handleCancelCreate}>
                  返回
                </button>
                <button
                  className="dialog-btn primary"
                  onClick={handleConfirmCreate}
                  disabled={creating || !newName.trim()}
                >
                  {creating ? '创建中...' : '创建流程'}
                </button>
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

export const TemplateDialog = memo(TemplateDialogComponent);
