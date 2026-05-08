/**
 * OAuth authorized apps Hook
 *
 * Manages the list of third-party apps the user has granted access to.
 * Provides listing and revocation.
 */

import { useState, useCallback, useEffect } from 'react';
import { useApi } from '../contexts/SessionContext';
import {
  listGrants,
  revokeGrant,
  type OAuthGrant,
} from '../api/oauth';

interface UseOAuthGrantsReturn {
  grants: OAuthGrant[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  revoke: (grantId: string) => Promise<boolean>;
  revoking: string | null;
}

export function useOAuthGrants(): UseOAuthGrantsReturn {
  const api = useApi();

  const [grants, setGrants] = useState<OAuthGrant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listGrants(api);
      setGrants(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载已授权应用失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const revoke = useCallback(
    async (grantId: string) => {
      setRevoking(grantId);
      try {
        await revokeGrant(api, grantId);
        await refresh();
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : '撤销授权失败');
        return false;
      } finally {
        setRevoking(null);
      }
    },
    [api, refresh],
  );

  return { grants, loading, error, refresh, revoke, revoking };
}

export type { OAuthGrant };
