/**
 * WebRTC perfect-negotiation core helpers (DOM-free, unit-testable)
 *
 * These pure functions hold the decision logic for the mesh signaling client so
 * it can be verified in isolation, away from the RTCPeerConnection lifecycle:
 * - `computePolarity`      — deterministic polite/impolite role per peer pair
 * - `shouldIgnoreOffer`    — glare handling (MDN "Perfect Negotiation")
 * - `classifyMediaTracks`  — map received video tracks to camera/screen by mid
 * - `nextBackoffDelay`     — exponential backoff for signaling reconnect
 * - `isPongExpired`        — heartbeat liveness check
 * - `PendingCandidates`    — FIFO buffer for ICE candidates that arrive before
 *                            the remote description has been applied
 */

import type { MediaKind } from './api';

// DOM 纯类型名（RTCSignalingState / RTCIceCandidateInit）不是运行时全局，直接引用会被
// eslint no-undef 误报。这里经运行时全局构造器（RTCPeerConnection / RTCIceCandidate）间接
// 取到等价类型，保持与 DOM 单一真值源一致。
type SignalingState = RTCPeerConnection['signalingState'];
type IceCandidateInit = NonNullable<ConstructorParameters<typeof RTCIceCandidate>[0]>;

/**
 * Perfect-negotiation polarity, decided purely from the two participant ids.
 *
 * The larger id (lexicographic) is `polite`; the smaller id is `impolite` and
 * acts as the offerer. Ids are globally unique, so for any pair exactly one side
 * is polite and the other impolite — no coordination round-trip needed.
 */
export function computePolarity(myId: string, peerId: string): { polite: boolean } {
  return { polite: myId > peerId };
}

/**
 * Whether an incoming offer must be ignored to resolve a glare (both sides
 * offering at once). The polite side never ignores — it rolls back implicitly
 * and accepts the remote offer. The impolite side ignores an offer that arrives
 * while it is mid-negotiation.
 */
export function shouldIgnoreOffer(
  polite: boolean,
  makingOffer: boolean,
  signalingState: SignalingState,
  isSettingRemoteAnswerPending: boolean,
): boolean {
  const readyForOffer =
    !makingOffer && (signalingState === 'stable' || isSettingRemoteAnswerPending);
  const collision = !readyForOffer;
  return !polite && collision;
}

/** Minimal transceiver view used by {@link classifyMediaTracks}. */
export interface TransceiverView {
  /** m-line id assigned after setLocalDescription; null before it is ready. */
  mid: string | null;
  /** Received track, or null if it has not arrived yet. */
  track: { id: string; kind: string } | null;
}

/**
 * Classify a peer's received video tracks into camera vs screen using the
 * per-peer `mid -> kind` map. Tracks whose mid has no mapping (or that have not
 * arrived yet) stay unclassified, so this is safe to call both when a media_type
 * hint arrives early (track still null) and again once `ontrack` fires.
 */
export function classifyMediaTracks(
  transceivers: readonly TransceiverView[],
  mediaTypeMap: ReadonlyMap<string, MediaKind>,
): { cameraTrackId: string | null; screenTrackId: string | null } {
  let cameraTrackId: string | null = null;
  let screenTrackId: string | null = null;

  for (const t of transceivers) {
    if (!t.mid || !t.track || t.track.kind !== 'video') {
      continue;
    }
    const kind = mediaTypeMap.get(t.mid);
    if (kind === 'camera') {
      cameraTrackId = t.track.id;
    } else if (kind === 'screen') {
      screenTrackId = t.track.id;
    }
  }

  return { cameraTrackId, screenTrackId };
}

/** Upper bound for a single reconnect backoff step (ms). */
export const MAX_BACKOFF_DELAY = 30_000;

/**
 * Exponential backoff for signaling reconnect: 1s, 2s, 4s, 8s … capped at
 * {@link MAX_BACKOFF_DELAY}. `attempt` is zero-based.
 */
export function nextBackoffDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_DELAY);
}

/**
 * Heartbeat liveness: true once no pong has been seen within `timeoutMs`.
 * `lastPongAt` / `now` are epoch milliseconds.
 */
export function isPongExpired(lastPongAt: number, now: number, timeoutMs: number): boolean {
  return now - lastPongAt > timeoutMs;
}

/**
 * Whether an abnormal WebSocket close should trigger a reconnect.
 * - `suppressed` (user disconnect / room closed / unmount): never reconnect
 * - `pongTimedOut` (we closed the socket ourselves because the peer stopped
 *   answering pings): always reconnect — a self-initiated close surfaces as a
 *   clean 1000 code, so we must not fall through to the "normal close" branch
 * - server-initiated normal close (1000 / 1001): no reconnect
 * - anything else (e.g. 1006 transport drop): reconnect
 */
export function shouldReconnectOnClose(
  code: number,
  suppressed: boolean,
  pongTimedOut: boolean,
): boolean {
  if (suppressed) {
    return false;
  }
  if (pongTimedOut) {
    return true;
  }
  return code !== 1000 && code !== 1001;
}

/**
 * FIFO buffer for ICE candidates received before a peer's remote description is
 * applied. `add` buffers, `drain` returns everything in arrival order and empties
 * that peer's buffer so it can be flushed exactly once.
 */
export class PendingCandidates {
  private readonly buffers = new Map<string, IceCandidateInit[]>();

  /** Buffer one candidate for a peer (preserves arrival order). */
  add(peerId: string, candidate: IceCandidateInit): void {
    const queue = this.buffers.get(peerId);
    if (queue) {
      queue.push(candidate);
    } else {
      this.buffers.set(peerId, [candidate]);
    }
  }

  /** Return and clear all buffered candidates for a peer (FIFO). */
  drain(peerId: string): IceCandidateInit[] {
    const queue = this.buffers.get(peerId);
    if (!queue || queue.length === 0) {
      return [];
    }
    this.buffers.set(peerId, []);
    return queue;
  }

  /** Number of candidates currently buffered for a peer. */
  count(peerId: string): number {
    return this.buffers.get(peerId)?.length ?? 0;
  }

  /** Forget a peer entirely (on peer leave / connection close). */
  remove(peerId: string): void {
    this.buffers.delete(peerId);
  }

  /** Drop all buffered candidates (on full teardown / reconnect). */
  clear(): void {
    this.buffers.clear();
  }
}
