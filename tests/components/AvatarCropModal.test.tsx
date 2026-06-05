/**
 * AvatarCropModal 组件测试
 *
 * 验证：渲染裁剪对话框、取消回调、确定时用裁剪区域导出 blob 并回调 onConfirm。
 * - react-easy-crop 依赖真实尺寸测量，mock 成占位并在挂载后回传裁剪区域（启用"确定"）。
 * - getCroppedBlob 依赖真实 canvas，mock 掉只验证调用参数与回调链路。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, waitFor } from '@testing-library/react';
import { render, screen } from '../utils/test-utils';

// mock react-easy-crop：挂载后回传一个裁剪区域，渲染占位
vi.mock('react-easy-crop', async () => {
  const react = await import('react');
  return {
    default: ({ onCropComplete }: { onCropComplete: (a: unknown, px: unknown) => void }) => {
      react.useEffect(() => {
        onCropComplete({}, { x: 10, y: 20, width: 200, height: 200 });
      }, [onCropComplete]);
      return react.createElement('div', { 'data-testid': 'cropper' });
    },
  };
});

// mock canvas 裁剪导出（jsdom 无真实 canvas.toBlob）
const getCroppedBlob = vi.hoisted(() => vi.fn());
vi.mock('../../src/utils/cropImage', () => ({ getCroppedBlob }));

import { AvatarCropModal } from '../../src/components/common/AvatarCropModal';

describe('AvatarCropModal', () => {
  beforeEach(() => {
    getCroppedBlob.mockReset().mockResolvedValue(new Blob(['x'], { type: 'image/jpeg' }));
  });

  it('渲染裁剪对话框与按钮', () => {
    render(<AvatarCropModal imageSrc="blob:test" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '裁剪头像' })).toBeInTheDocument();
    expect(screen.getByTestId('cropper')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确定' })).toBeInTheDocument();
  });

  it('点取消触发 onCancel', () => {
    const onCancel = vi.fn();
    render(<AvatarCropModal imageSrc="blob:test" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('点确定用裁剪区域导出 blob 并回调 onConfirm', async () => {
    const onConfirm = vi.fn();
    render(<AvatarCropModal imageSrc="blob:test" onConfirm={onConfirm} onCancel={vi.fn()} />);
    // 等挂载 effect 回传裁剪区域，"确定"启用
    await waitFor(() => expect(screen.getByRole('button', { name: '确定' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(getCroppedBlob).toHaveBeenCalledWith('blob:test', { x: 10, y: 20, width: 200, height: 200 });
    expect(onConfirm.mock.calls[0][0]).toBeInstanceOf(Blob);
  });
});
