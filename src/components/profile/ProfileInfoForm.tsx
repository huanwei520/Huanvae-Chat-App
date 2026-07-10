/**
 * 个人信息表单组件
 *
 * 功能：
 * - 修改邮箱 / 个性签名
 * - 修改性别 / 生日 / 地区（富字段）
 * - 展示注册时间（只读）
 *
 * 桌面 ProfileModal 与移动 MobileProfilePage 共用。
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MotionAppButton } from '../common/AppButton';
import { useSession, useApi } from '../../contexts/SessionContext';
import { updateProfile, type Gender, type UpdateProfileRequest } from '../../api/profile';
import { formatDate } from '../../utils/time';

interface ProfileInfoFormProps {
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  /** 是否在表单内展示只读注册时间；桌面弹窗把它移到左侧身份栏，故传 false（移动端默认 true） */
  showRegisterTime?: boolean;
  /** 隐藏内部提交按钮（移动端把保存动作提到页面顶部 header）。默认 false（桌面照旧展示按钮） */
  hideSubmit?: boolean;
  /** 上报提交态给外部（移动端顶部 header 保存键用）：canSave=有改动且可存，saving=提交中，submit=触发保存 */
  onSubmitStateChange?: (s: { canSave: boolean; saving: boolean; submit: () => void }) => void;
}

// 校验合法 email 格式（与后端 zod email() 行为对齐）
// 用于过滤 DB 中可能存在的脏数据（如曾把"未填写邮箱"等中文当邮箱保存）
// 这种值若直接放进 input 会被当作真实 value 提交，触发后端"Invalid email format"
function isValidEmail(s: string | null | undefined): s is string {
  if (!s) { return false; }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** 收窄为合法 Gender，否则 undefined（不发送该字段，避免后端 400） */
function toGender(value: string): Gender | undefined {
  if (value === 'male' || value === 'female' || value === 'other') {
    return value;
  }
  return undefined;
}

export function ProfileInfoForm({ onSuccess, onError, showRegisterTime = true, hideSubmit = false, onSubmitStateChange }: ProfileInfoFormProps) {
  const { session, setSession } = useSession();
  const api = useApi();

  // 只有当 user_email 是合法邮箱时才作为 input 初值；否则 input 为空，由 placeholder "未填写邮箱" 提示
  const storedEmail = session?.profile.user_email;
  const [email, setEmail] = useState(isValidEmail(storedEmail) ? storedEmail : '');
  const [signature, setSignature] = useState(session?.profile.user_signature || '');
  const [gender, setGender] = useState(session?.profile.gender ?? '');
  const [birthday, setBirthday] = useState(session?.profile.birthday ?? '');
  const [region, setRegion] = useState(session?.profile.region ?? '');
  const [loading, setLoading] = useState(false);

  const registerTime = formatDate(session?.profile.created_at);

  // 有改动检测（供移动端 header 保存键置灰/高亮）：与进入时的初值快照比对；保存成功后基线归位。
  // 桌面内部按钮 disabled 逻辑不受此影响（仍只按 loading），故既有测试"未改动即可保存"不变。
  const baseline = useRef({
    email: isValidEmail(storedEmail) ? storedEmail : '',
    signature: session?.profile.user_signature || '',
    gender: session?.profile.gender ?? '',
    birthday: session?.profile.birthday ?? '',
    region: session?.profile.region ?? '',
  });
  const isDirty =
    email !== baseline.current.email ||
    signature !== baseline.current.signature ||
    gender !== baseline.current.gender ||
    birthday !== baseline.current.birthday ||
    region !== baseline.current.region;

  const handleSubmit = async () => {
    if (!session) { return; }

    setLoading(true);

    try {
      // 空字段视为"未填"，不发送对应字段（让后端 optional 跳过校验）
      const genderValue = toGender(gender);
      const payload: UpdateProfileRequest = {
        email: email.trim() || undefined,
        signature: signature || undefined,
        gender: genderValue,
        birthday: birthday || undefined,
        region: region.trim() || undefined,
      };
      await updateProfile(api, payload);
      onSuccess('个人信息已更新');
      // 保存成功：基线归位为当前值，isDirty 复位（header 保存键回到置灰态）
      baseline.current = { email, signature, gender, birthday, region };

      setSession({
        ...session,
        profile: {
          ...session.profile,
          user_email: email || null,
          user_signature: signature || null,
          gender: genderValue ?? session.profile.gender ?? null,
          birthday: birthday || null,
          region: region.trim() || null,
        },
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setLoading(false);
    }
  };

  // 稳定的 submit 包装（内部 ref 取最新闭包），供外部 header 保存键调用，避免函数身份每帧变导致的上报抖动
  const submitRef = useRef(handleSubmit);
  submitRef.current = handleSubmit;
  const stableSubmit = useCallback(() => { void submitRef.current(); }, []);
  useEffect(() => {
    onSubmitStateChange?.({ canSave: isDirty && !loading, saving: loading, submit: stableSubmit });
  }, [onSubmitStateChange, isDirty, loading, stableSubmit]);

  return (
    <>
      <div className="profile-info-fields">
        <div className="form-group">
          <label>性别</label>
          <select
            className="glass-input"
            value={gender}
            onChange={(e) => setGender(e.target.value)}
          >
            <option value="">未设置</option>
            <option value="male">男</option>
            <option value="female">女</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div className="form-group">
          <label>生日</label>
          <input
            type="date"
            className="glass-input"
            value={birthday}
            onChange={(e) => setBirthday(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label>地区</label>
          <input
            type="text"
            className="glass-input"
            value={region}
            onChange={(e) => setRegion(e.target.value)}
            placeholder="如：上海"
            maxLength={100}
          />
        </div>
        <div className="form-group">
          <label>邮箱</label>
          <input
            type="email"
            className="glass-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="未填写邮箱"
          />
        </div>
        <div className="form-group form-group--full">
          <label>个性签名</label>
          <textarea
            className="glass-input"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="介绍一下自己吧..."
            maxLength={200}
            rows={3}
          />
          <span className="char-count">{signature.length}/200</span>
        </div>
        {showRegisterTime && registerTime && (
          <div className="form-group form-group--full">
            <label>注册时间</label>
            <div style={{ padding: '8px 2px', color: 'var(--text-secondary, rgba(255, 255, 255, 0.6))', fontSize: '14px' }}>
              {registerTime}
            </div>
          </div>
        )}
      </div>
      {!hideSubmit && (
        <MotionAppButton
          variant="primary"
          size="md"
          block
          onClick={handleSubmit}
          disabled={loading}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          {loading ? '保存中...' : '保存修改'}
        </MotionAppButton>
      )}
    </>
  );
}
