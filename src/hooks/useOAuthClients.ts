/**
 * OAuth client management Hook
 *
 * CRUD operations for developer-created OAuth clients.
 * Follows the withOp pattern from useMiniApps.
 */

import { useState, useCallback, useEffect } from 'react';
import { useApi } from '../contexts/SessionContext';
import {
  listClients,
  createClient,
  deleteClient,
  resetClientSecret,
  type OAuthClient,
  type CreateClientRequest,
  type CreateClientResponse,
} from '../api/oauth';

interface UseOAuthClientsReturn {
  clients: OAuthClient[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (data: CreateClientRequest) => Promise<CreateClientResponse | null>;
  remove: (clientId: string) => Promise<boolean>;
  resetSecret: (clientId: string) => Promise<string | null>;
  operatingId: string | null;
}

export function useOAuthClients(): UseOAuthClientsReturn {
  const api = useApi();

  const [clients, setClients] = useState<OAuthClient[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operatingId, setOperatingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listClients(api);
      setClients(Array.isArray(list) ? list : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载 OAuth 客户端失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withOp = useCallback(
    async <T>(id: string, fn: () => Promise<T>): Promise<T | null> => {
      setOperatingId(id);
      try {
        const result = await fn();
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : '操作失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (data: CreateClientRequest) => {
      setOperatingId('__creating__');
      try {
        const result = await createClient(api, data);
        await refresh();
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : '创建客户端失败');
        return null;
      } finally {
        setOperatingId(null);
      }
    },
    [api, refresh],
  );

  const remove = useCallback(
    async (clientId: string) => {
      const r = await withOp(clientId, () => deleteClient(api, clientId));
      return r !== null;
    },
    [api, withOp],
  );

  const resetSecretFn = useCallback(
    async (clientId: string) => {
      const r = await withOp(clientId, () => resetClientSecret(api, clientId));
      return r ? r.client_secret : null;
    },
    [api, withOp],
  );

  return {
    clients,
    loading,
    error,
    refresh,
    create,
    remove,
    resetSecret: resetSecretFn,
    operatingId,
  };
}

export type { OAuthClient, CreateClientRequest, CreateClientResponse };
