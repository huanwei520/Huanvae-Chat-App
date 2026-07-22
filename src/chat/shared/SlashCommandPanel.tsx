import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import type { BotCommand } from '../../api/bots';
import './SlashCommandPanel.css';

interface SlashCommandPanelProps {
  open: boolean;
  commands: BotCommand[];
  activeIndex: number;
  position: { left: number; bottom: number };
  onSelect: (command: BotCommand) => void;
  onHoverIndex: (index: number) => void;
}

export function SlashCommandPanel({
  open,
  commands,
  activeIndex,
  position,
  onSelect,
  onHoverIndex,
}: SlashCommandPanelProps) {
  return createPortal(
    <AnimatePresence>
      {open && commands.length > 0 && (
        <motion.div
          className="slash-command-panel"
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          style={{ position: 'fixed', left: position.left, bottom: position.bottom }}
          role="listbox"
        >
          {commands.map((cmd, i) => (
            <button
              key={cmd.command}
              type="button"
              role="option"
              aria-selected={i === activeIndex}
              className={`slash-command-item${i === activeIndex ? ' slash-command-item--active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onSelect(cmd); }}
              onMouseEnter={() => onHoverIndex(i)}
            >
              <span className="slash-command-name">/{cmd.command}</span>
              {cmd.description && <span className="slash-command-desc">{cmd.description}</span>}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
