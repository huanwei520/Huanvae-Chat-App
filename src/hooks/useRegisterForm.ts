/**
 * 注册表单状态管理 Hook
 *
 * 从 Register.tsx 中提取的表单状态和验证逻辑。
 * 服务器地址不再由用户输入（由发现服务确定），故注册仅两步：① 账号信息 ② 密码。
 */

import { useState, useCallback } from 'react';

export type RegisterStep = 1 | 2;

export interface RegisterFormState {
  // 步骤
  step: RegisterStep;
  direction: number;

  // 用户信息
  userId: string;
  nickname: string;
  email: string;

  // 密码
  password: string;
  confirmPassword: string;

  // 错误
  localError: string | null;
}

export interface RegisterFormActions {
  setUserId: (id: string) => void;
  setNickname: (name: string) => void;
  setEmail: (email: string) => void;
  setPassword: (pwd: string) => void;
  setConfirmPassword: (pwd: string) => void;
  setLocalError: (error: string | null) => void;
  goToStep: (step: RegisterStep) => void;
  goBack: () => void;
  validateStep1: () => boolean;
  validateStep2: () => boolean;
}

export function useRegisterForm(): RegisterFormState & RegisterFormActions {
  const [step, setStep] = useState<RegisterStep>(1);
  const [direction, setDirection] = useState(1);

  const [userId, setUserId] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [localError, setLocalError] = useState<string | null>(null);

  const goToStep = useCallback((newStep: RegisterStep) => {
    setDirection(newStep > step ? 1 : -1);
    setLocalError(null);
    setStep(newStep);
  }, [step]);

  const goBack = useCallback(() => {
    if (step > 1) {
      goToStep((step - 1) as RegisterStep);
    }
  }, [step, goToStep]);

  // 步骤 1：账号信息
  const validateStep1 = useCallback(() => {
    if (!userId.trim()) {
      setLocalError('请输入账号');
      return false;
    }
    if (!nickname.trim()) {
      setLocalError('请输入昵称');
      return false;
    }
    return true;
  }, [userId, nickname]);

  // 步骤 2：密码
  const validateStep2 = useCallback(() => {
    if (password.length < 6) {
      setLocalError('密码至少需要6个字符');
      return false;
    }
    if (password !== confirmPassword) {
      setLocalError('两次输入的密码不一致');
      return false;
    }
    return true;
  }, [password, confirmPassword]);

  return {
    // State
    step,
    direction,
    userId,
    nickname,
    email,
    password,
    confirmPassword,
    localError,

    // Actions
    setUserId,
    setNickname,
    setEmail,
    setPassword,
    setConfirmPassword,
    setLocalError,
    goToStep,
    goBack,
    validateStep1,
    validateStep2,
  };
}
