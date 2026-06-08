/**
 * OAuth authorization consent modal
 *
 * Shown when an external app requests user authorization.
 * Flow: mount → authorize(no consent) → consent_required? → show UI → user clicks allow → authorize(consent=true) → return code.
 * Internal clients auto-approve without showing UI.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useApi } from '../../contexts/SessionContext';
import { authorize, isConsentRequired, type AuthorizeResponse } from '../../api/oauth';
import { resolveDisplayUrl } from '../../services/secureProxy';
import '../../styles/oauth.css';

const SCOPE_LABELS: Record<string, { name: string; desc: string }> = {
  profile: { name: '个人资料', desc: '昵称和头像' },
  email: { name: '邮箱地址', desc: '您的注册邮箱' },
  friends: { name: '好友信息', desc: '好友数量' },
  groups: { name: '群组信息', desc: '群组数量' },
};

const ScopeIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

interface OAuthConsentModalProps {
  clientId: string;
  redirectUri: string;
  scope: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  onComplete: (code: string, state?: string) => void;
  onCancel: () => void;
}

export const OAuthConsentModal: React.FC<OAuthConsentModalProps> = ({
  clientId,
  redirectUri,
  scope,
  state,
  codeChallenge,
  codeChallengeMethod,
  onComplete,
  onCancel,
}) => {
  const api = useApi();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consentData, setConsentData] = useState<{
    app_name: string;
    app_logo_url: string | null;
    scopes: string[];
  } | null>(null);

  function makeRequest(consent?: boolean) {
    return {
      client_id: clientId,
      redirect_uri: redirectUri,
      scope,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallengeMethod,
      ...(consent ? { consent: true } : {}),
    };
  }

  const handleResponse = useCallback((resp: AuthorizeResponse) => {
    if (isConsentRequired(resp)) {
      setConsentData({
        app_name: resp.app_name,
        app_logo_url: resp.app_logo_url,
        scopes: resp.scopes,
      });
    } else {
      onComplete(resp.code, resp.state ?? undefined);
    }
  }, [onComplete]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    authorize(api, makeRequest())
      .then((resp) => {
        if (!cancelled) {
          handleResponse(resp);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '授权请求失败');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConsent = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await authorize(api, makeRequest(true));
      handleResponse(resp);
    } catch (e) {
      setError(e instanceof Error ? e.message : '授权失败');
    } finally {
      setSubmitting(false);
    }
  };

  const content = (
    <motion.div
      className="oauth-consent-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
    >
      <motion.div
        className="oauth-consent-dialog"
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading && (
          <div className="oauth-consent-loading">
            <div className="oauth-loading-spinner" />
            <span>正在加载应用信息...</span>
          </div>
        )}

        {error && !loading && (
          <div className="oauth-consent-error">
            <span>{error}</span>
            <button
              className="oauth-consent-btn secondary"
              onClick={onCancel}
              style={{ marginTop: 8, flex: 'none', padding: '8px 24px' }}
            >
                关闭
            </button>
          </div>
        )}

        {consentData && !loading && !error && (
          <>
            <div className="oauth-consent-header">
              <div className="oauth-consent-logo">
                {consentData.app_logo_url ? (
                  <img src={resolveDisplayUrl(consentData.app_logo_url) || ''} alt={consentData.app_name} />
                ) : (
                  consentData.app_name.charAt(0).toUpperCase()
                )}
              </div>
              <div className="oauth-consent-app-name">{consentData.app_name}</div>
              <div className="oauth-consent-description">
                  请求访问以下权限：
              </div>
            </div>

            <div className="oauth-consent-scopes">
              {consentData.scopes.map((s) => {
                const label = SCOPE_LABELS[s];
                return (
                  <div key={s} className="oauth-scope-item">
                    <div className="oauth-scope-icon">
                      <ScopeIcon />
                    </div>
                    <div className="oauth-scope-text">
                      <div className="oauth-scope-name">{label?.name || s}</div>
                      {label?.desc && <div className="oauth-scope-desc">{label.desc}</div>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="oauth-consent-actions">
              <button
                className="oauth-consent-btn secondary"
                onClick={onCancel}
                disabled={submitting}
              >
                  拒绝
              </button>
              <button
                className="oauth-consent-btn primary"
                onClick={handleConsent}
                disabled={submitting}
              >
                {submitting ? '授权中...' : '允许'}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );

  return createPortal(content, document.body);
};

export default OAuthConsentModal;
