/**
 * OAuth API
 *
 * createApiClient auto-unwraps ApiResponse.data
 *
 * Endpoints:
 * - POST /api/oauth/authorize (auth_guard)
 * - POST /api/oauth/token (public)
 * - POST /api/oauth/revoke (public)
 * - GET  /api/oauth/userinfo (oauth_guard)
 * - GET  /api/oauth/clients (auth_guard)
 * - POST /api/oauth/clients (auth_guard)
 * - DELETE /api/oauth/clients/{client_id} (auth_guard)
 * - POST /api/oauth/clients/{client_id}/reset-secret (auth_guard)
 * - GET  /api/oauth/grants (auth_guard)
 * - DELETE /api/oauth/grants/{grant_id} (auth_guard)
 */

import type { ApiClient } from './client';

// ============================================
// Authorize
// ============================================

export interface AuthorizeRequest {
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  consent?: boolean;
}

export interface AuthorizeCodeResponse {
  code: string;
  state: string | null;
  redirect_uri: string;
}

export interface AuthorizeConsentResponse {
  consent_required: true;
  app_name: string;
  app_logo_url: string | null;
  scopes: string[];
}

export type AuthorizeResponse = AuthorizeCodeResponse | AuthorizeConsentResponse;

export function isConsentRequired(resp: AuthorizeResponse): resp is AuthorizeConsentResponse {
  return 'consent_required' in resp;
}

// ============================================
// Token
// ============================================

export interface TokenRequest {
  grant_type: 'authorization_code' | 'refresh_token';
  code?: string;
  redirect_uri?: string;
  client_id: string;
  client_secret?: string;
  code_verifier?: string;
  refresh_token?: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string | null;
  scope: string;
  openid: string;
}

// ============================================
// UserInfo
// ============================================

export interface UserInfoResponse {
  sub: string;
  nickname?: string;
  avatar_url?: string;
  email?: string;
  friend_count?: number;
  group_count?: number;
}

// ============================================
// Revoke
// ============================================

export interface RevokeRequest {
  token: string;
  client_id: string;
  client_secret: string;
}

// ============================================
// Client
// ============================================

export interface OAuthClient {
  client_id: string;
  client_type: string;
  app_name: string;
  app_description: string;
  app_homepage_url: string | null;
  app_logo_url: string | null;
  redirect_uris: string[];
  allowed_scopes: string[];
  is_active: boolean;
  created_at: string;
}

export interface CreateClientRequest {
  app_name: string;
  app_description?: string;
  app_homepage_url?: string;
  redirect_uris: string[];
  scopes?: string[];
}

export interface CreateClientResponse {
  client_id: string;
  client_secret: string;
  app_name: string;
}

export interface ResetSecretResponse {
  client_secret: string;
}

// ============================================
// Grant
// ============================================

export interface OAuthGrant {
  id: string;
  client_id: string;
  app_name: string;
  app_logo_url: string | null;
  scope: string;
  created_at: string;
}

// ============================================
// API functions
// ============================================

export function authorize(api: ApiClient, data: AuthorizeRequest): Promise<AuthorizeResponse> {
  return api.post<AuthorizeResponse>('/api/oauth/authorize', data as unknown as Record<string, unknown>);
}

export function exchangeToken(api: ApiClient, data: TokenRequest): Promise<TokenResponse> {
  return api.post<TokenResponse>('/api/oauth/token', data as unknown as Record<string, unknown>);
}

export function getUserInfo(api: ApiClient): Promise<UserInfoResponse> {
  return api.get<UserInfoResponse>('/api/oauth/userinfo');
}

export function revokeToken(api: ApiClient, data: RevokeRequest): Promise<{ message: string }> {
  return api.post<{ message: string }>('/api/oauth/revoke', data as unknown as Record<string, unknown>);
}

export function listClients(api: ApiClient): Promise<OAuthClient[]> {
  return api.get<OAuthClient[]>('/api/oauth/clients');
}

export function createClient(api: ApiClient, data: CreateClientRequest): Promise<CreateClientResponse> {
  return api.post<CreateClientResponse>('/api/oauth/clients', data as unknown as Record<string, unknown>);
}

export function deleteClient(api: ApiClient, clientId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/oauth/clients/${clientId}`);
}

export function resetClientSecret(api: ApiClient, clientId: string): Promise<ResetSecretResponse> {
  return api.post<ResetSecretResponse>(`/api/oauth/clients/${clientId}/reset-secret`, {});
}

export function listGrants(api: ApiClient): Promise<OAuthGrant[]> {
  return api.get<OAuthGrant[]>('/api/oauth/grants');
}

export function revokeGrant(api: ApiClient, grantId: string): Promise<{ message: string }> {
  return api.delete<{ message: string }>(`/api/oauth/grants/${grantId}`);
}
