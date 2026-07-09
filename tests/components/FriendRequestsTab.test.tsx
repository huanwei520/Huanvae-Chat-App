/**
 * 好友申请卡测试：消费后端 requester_nickname / requester_avatar_url 真身份 + 缺省回退
 *
 * FriendRequestsTab 为纯 props 组件（无 context），可直接 render。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FriendRequestsTab } from '../../src/components/modals/add/FriendRequestsTab';
import type { PendingRequest } from '../../src/api/friends';

function makeRequest(overrides: Partial<PendingRequest> = {}): PendingRequest {
  return {
    request_id: 'r1',
    request_user_id: 'alice001',
    request_message: null,
    request_time: '2026-07-08T09:00:00Z',
    requester_nickname: null,
    requester_avatar_url: null,
    ...overrides,
  };
}

beforeEach(() => cleanup());

describe('FriendRequestsTab — 申请人真身份', () => {
  it('有 requester_nickname 时展示昵称作名字，@ 行仍是用户 ID', () => {
    render(
      <FriendRequestsTab
        loading={false}
        requests={[makeRequest({ requester_nickname: '爱丽丝' })]}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.getByText('爱丽丝')).toBeInTheDocument();
    expect(screen.getByText('@alice001')).toBeInTheDocument();
  });

  it('缺省回退：requester_nickname 为空时名字回退到用户 ID', () => {
    render(
      <FriendRequestsTab
        loading={false}
        requests={[makeRequest({ requester_nickname: null })]}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    // 名字行 + @ 行都是 id（名字回退），@行始终是 id
    expect(screen.getByText('alice001')).toBeInTheDocument();
    expect(screen.getByText('@alice001')).toBeInTheDocument();
  });

  it('有 requester_avatar_url（绝对 URL）时渲染 img，alt=展示名', () => {
    render(
      <FriendRequestsTab
        loading={false}
        requests={[makeRequest({ requester_nickname: '爱丽丝', requester_avatar_url: 'http://cdn/avatars/a.jpg' })]}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    const img = screen.getByAltText('爱丽丝') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
  });

  it('无头像时回退首字母占位（非 img）', () => {
    render(
      <FriendRequestsTab
        loading={false}
        requests={[makeRequest({ requester_nickname: '爱丽丝', requester_avatar_url: null })]}
        onApprove={() => {}}
        onReject={() => {}}
      />,
    );
    expect(screen.queryByAltText('爱丽丝')).toBeNull();
    // 占位显示首字母 爱
    expect(screen.getByText('爱')).toBeInTheDocument();
  });

  it('点击同意/拒绝回调携带该申请', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const req = makeRequest({ requester_nickname: '爱丽丝' });
    render(
      <FriendRequestsTab loading={false} requests={[req]} onApprove={onApprove} onReject={onReject} />,
    );
    fireEvent.click(screen.getByTitle('同意'));
    fireEvent.click(screen.getByTitle('拒绝'));
    expect(onApprove).toHaveBeenCalledWith(req);
    expect(onReject).toHaveBeenCalledWith(req);
  });
});
