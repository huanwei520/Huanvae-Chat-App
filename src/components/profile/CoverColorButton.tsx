/**
 * 纯色背景选择按钮（封面浮层用）
 *
 * @location src/components/profile/CoverColorButton.tsx
 *
 * 个人资料背景支持图片或纯色。本组件是封面操作区的「纯色」药丸按钮：点击打开系统原生
 * 取色器，选定后回调 onPick(hex)。桌面 ProfileModal 与移动 MobileProfilePage 共用。
 * 用原生 <input type="color">（透明铺满药丸）而非弹出式 HexColorPicker，零额外弹层/动画。
 */

interface CoverColorButtonProps {
  /** 当前背景色（用于初始化取色器；非纯色背景时传 null） */
  value: string | null;
  /** 选色回调（hex，如 #3b82f6） */
  onPick: (hex: string) => void;
}

export function CoverColorButton({ value, onPick }: CoverColorButtonProps) {
  return (
    <label className="qq-hero-btn qq-hero-color-btn" title="纯色背景">
      纯色
      <input
        type="color"
        className="qq-hero-color-input"
        value={value ?? '#3b82f6'}
        onChange={(e) => onPick(e.target.value)}
        aria-label="选择纯色背景"
      />
    </label>
  );
}
