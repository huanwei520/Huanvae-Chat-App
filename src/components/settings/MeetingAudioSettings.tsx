/**
 * 会议音频设备选择器（桌面端专用）
 *
 * 「设置 → 会议音频」段的内容组件：麦克风 / 扬声器两个下拉，枚举真实设备 label。
 * - 仅桌面端渲染：SettingsPanel 为双端共享组件（MobileSettingsPage 也包裹渲染），
 *   段级 isDesktop() 门控保证移动端零渲染；组件内部再门控一层（双保险），
 *   移动端不挂 devicechange/storage 监听、不读设备。
 * - 选择即时持久化（localStorage，src/meeting/audioDevices.ts）：
 *   麦克风选择下次入会/会议中（经 storage 事件触发热切换）生效；
 *   扬声器选择经 setSinkId 应用到会议远端 <audio>（主窗改动跨窗口生效）。
 * - 输出能力 feature-detect：不支持 setSinkId 的内核（如 Linux WebKitGTK）输出下拉
 *   禁用并标注「当前内核不支持输出设备选择」，替代方案为系统级默认输出切换。
 * - 未授权时设备 label 为空 → 序号化名（麦克风 N / 扬声器 N），不做主动授权弹框。
 *
 * @module components/settings/MeetingAudioSettings
 */

import React, { useCallback, useEffect, useState } from 'react';
import { isDesktop, isMobile } from '../../utils/platform';
import {
  deviceDisplayLabel,
  enumerateMeetingAudioDevicesLabeled,
  getSelectedAudioInputId,
  getSelectedAudioOutputId,
  setSelectedAudioInputId,
  setSelectedAudioOutputId,
  subscribeMeetingAudioDevices,
  supportsAudioOutputSelection,
} from '../../meeting/audioDevices';

export const MeetingAudioSettings: React.FC = () => {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [inputId, setInputId] = useState<string | null>(null);
  const [outputId, setOutputId] = useState<string | null>(null);

  // 输出能力只随内核变，进程内恒定，不必入 state
  const outputSupported = supportsAudioOutputSelection();

  /** 枚举设备 + 回读当前选择（devicechange 插拔 / storage 跨窗口改动 / 授权后 label 补齐，统一走这里刷新）
   *  用带标签补齐版：Chromium 系未授权时 label 为空甚至枚举为空（见 audioDevices.ts），
   *  首次刷新做一次瞬时取流触发授权并立即停轨，让下拉能列出真实设备名。 */
  const refresh = useCallback(async () => {
    const { inputs: nextInputs, outputs: nextOutputs } = await enumerateMeetingAudioDevicesLabeled();
    setInputs(nextInputs);
    setOutputs(nextOutputs);
    setInputId(getSelectedAudioInputId());
    setOutputId(getSelectedAudioOutputId());
  }, []);

  useEffect(() => {
    // 平台门控：移动端零渲染零监听（外层 SettingsPanel 段级 isDesktop() 已挡一层）
    if (isMobile()) {
      return undefined;
    }
    void refresh();
    return subscribeMeetingAudioDevices(() => {
      void refresh();
    });
  }, [refresh]);

  // 双保险：即便被误挂在移动端，也不渲染任何 DOM
  if (!isDesktop()) {
    return null;
  }

  const handleInputChange = (value: string) => {
    const next = value === '' ? null : value;
    setInputId(next);
    setSelectedAudioInputId(next);
  };

  const handleOutputChange = (value: string) => {
    const next = value === '' ? null : value;
    setOutputId(next);
    setSelectedAudioOutputId(next);
  };

  return (
    <div className="settings-audio-devices">
      <div className="settings-audio-device-row">
        <span className="settings-audio-device-label">麦克风</span>
        <select
          className="settings-audio-device-select"
          value={inputId ?? ''}
          onChange={(e) => handleInputChange(e.target.value)}
          aria-label="会议麦克风设备"
        >
          <option value="">系统默认</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId || `input-${i}`} value={d.deviceId}>
              {deviceDisplayLabel(d, i)}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-audio-device-row">
        <span className="settings-audio-device-label">扬声器</span>
        <select
          className="settings-audio-device-select"
          value={outputId ?? ''}
          onChange={(e) => handleOutputChange(e.target.value)}
          disabled={!outputSupported}
          aria-label="会议扬声器设备"
          title={outputSupported ? undefined : '当前内核不支持输出设备选择'}
        >
          <option value="">系统默认</option>
          {outputs.map((d, i) => (
            <option key={d.deviceId || `output-${i}`} value={d.deviceId}>
              {deviceDisplayLabel(d, i)}
            </option>
          ))}
        </select>
      </div>

      {!outputSupported && (
        <span className="settings-audio-device-hint">
          当前内核不支持输出设备选择，请使用系统级默认输出切换
        </span>
      )}
    </div>
  );
};

export default MeetingAudioSettings;
