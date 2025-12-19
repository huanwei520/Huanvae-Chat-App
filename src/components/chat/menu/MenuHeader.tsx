/**
 * 菜单头部组件
 */

interface MenuHeaderProps {
  title: string;
  onBack?: () => void;
}

export function MenuHeader({ title, onBack }: MenuHeaderProps) {
  return (
    <div className="menu-header">
      {onBack && (
        <button className="back-btn" onClick={onBack}>←</button>
      )}
      {title}
    </div>
  );
}

