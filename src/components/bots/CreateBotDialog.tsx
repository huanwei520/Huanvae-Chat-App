/**
 * 创建机器人表单（共享，BotFather 式）
 *
 * 从 BotsModal 抽出为独立导出组件，供两处复用：
 * - BotsModal 右上角「+ 创建」
 * - 侧边栏「+」AddMenu（req-23）
 *
 * bot username 体验层校验（前端）：
 * - 即时校验（onChange）：仅 3-32 位字母/数字/下划线，且必须以 "bot" 结尾（大小写不敏感）
 * - 内联提示：用户输入了非法值时给出一行提示，说明规则
 * - 推荐名 chip：当输入的基础字符集/长度合规、仅缺 "bot" 后缀时，给出「推荐：xxxbot」按钮，
 *   点了才把补全值写进输入框（点了才填，绝不静默改用户输入）
 * - 提交按钮不合规禁用
 *
 * 校验只是前端体验层；后端 POST /api/bots 才是权威校验（不合规 400）。
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '../common/Icons';
import { BOT_USERNAME_RE, isValidBotUsername, type CreateBotRequest } from '../../api/bots';

export function CreateBotDialog({
  onClose,
  onCreate,
  creating,
  error,
}: {
  onClose: () => void;
  onCreate: (data: CreateBotRequest) => void;
  creating: boolean;
  error: string | null;
}) {
  const [username, setUsername] = useState('');
  const [nickname, setNickname] = useState('');
  const [description, setDescription] = useState('');

  const trimmedU = username.trim();
  const usernameValid = isValidBotUsername(username);
  const canSubmit = usernameValid && nickname.trim() !== '' && !creating;

  // 基础字符集/长度合规但只差 "bot" 后缀 → 给推荐 chip
  const baseOk = BOT_USERNAME_RE.test(trimmedU);
  const missingSuffix = baseOk && !/bot$/i.test(trimmedU);
  const suggested = `${trimmedU}bot`;
  // 仅当补全值本身也合规（如补全后长度 ≤32）才展示 chip
  const showSuggest = trimmedU !== '' && missingSuffix && isValidBotUsername(suggested);

  const handleSubmit = () => {
    if (!canSubmit) {
      return;
    }
    onCreate({
      username: username.trim(),
      nickname: nickname.trim(),
      description: description.trim() || undefined,
    });
  };

  return createPortal(
    <div className="modal-overlay miniapp-create-overlay" onClick={onClose}>
      <div className="miniapp-create-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="miniapp-create-header">
          <h3>创建机器人</h3>
          <button className="close-btn" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="miniapp-create-body">
          <label className="miniapp-field">
            <span className="miniapp-field-label">
              用户名 <span className="miniapp-required">*</span>
            </span>
            <input
              type="text"
              placeholder="3-32 位字母 / 数字 / 下划线，且以 bot 结尾"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={32}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          {trimmedU !== '' && !usernameValid && (
            <p className="miniapp-field-hint bots-username-hint">
              机器人用户名需以 bot 结尾（如 weatherbot），仅字母/数字/下划线，3-32 位
            </p>
          )}
          {showSuggest && (
            <button
              type="button"
              className="bots-username-suggest-chip"
              onClick={() => setUsername(suggested)}
            >
              推荐：{suggested}
            </button>
          )}
          <label className="miniapp-field">
            <span className="miniapp-field-label">
              昵称 <span className="miniapp-required">*</span>
            </span>
            <input
              type="text"
              placeholder="机器人显示昵称"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={100}
            />
          </label>
          <label className="miniapp-field">
            <span className="miniapp-field-label">描述</span>
            <textarea
              placeholder="可选，简要描述机器人用途"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </label>
          <p className="miniapp-field-hint">
            创建成功后 Token 仅明文展示一次；每人最多创建 10 个机器人。
          </p>
          {error && <p className="miniapp-card-reject-reason">{error}</p>}
        </div>
        <div className="miniapp-create-footer">
          <button className="miniapp-btn secondary" onClick={onClose}>
            取消
          </button>
          <button className="miniapp-btn primary" onClick={handleSubmit} disabled={!canSubmit}>
            {creating ? '创建中...' : '创建'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
