import React from 'react';
import { motion } from 'framer-motion';
import '../../styles/oauth.css';

export interface SecretField {
  label: string;
  value: string;
}

interface SecretDisplayProps {
  title: string;
  warningText?: string;
  fields: SecretField[];
  onClose: () => void;
  closeLabel?: string;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

export const SecretDisplay: React.FC<SecretDisplayProps> = ({
  title,
  warningText,
  fields,
  onClose,
  closeLabel = '已保存，关闭',
}) => (
  <motion.div
    className="oauth-create-overlay"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    onClick={onClose}
  >
    <motion.div
      className="oauth-secret-dialog"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 className="oauth-create-title">{title}</h3>

      {warningText && (
        <div className="oauth-secret-warning">
          <span>&#9888;</span>
          <span>{warningText}</span>
        </div>
      )}

      {fields.map((f) => (
        <div key={f.label} className="oauth-secret-field">
          <div className="oauth-secret-label">{f.label}</div>
          <div className="oauth-secret-value">
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{f.value}</span>
            <button className="copy-btn" onClick={() => copyToClipboard(f.value)}>复制</button>
          </div>
        </div>
      ))}

      <button className="oauth-secret-close-btn" onClick={onClose}>
        {closeLabel}
      </button>
    </motion.div>
  </motion.div>
);

export default SecretDisplay;
