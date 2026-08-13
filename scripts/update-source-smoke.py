#!/usr/bin/env python3
"""
Update-source smoke gate — probe the REAL update source before shipping.

Why this exists
---------------
The desktop self-update path was broken for 7 consecutive releases and nobody
noticed, because **no automated check ever touched the update source**. Unit
tests mock `invoke`, e2e mocks Tauri, CI never leaves the runner. This script is
the cheapest possible guard: it talks to the real `latest.json` and the real
artifact behind it, and turns red when the source stops honouring the contract
that `src-tauri/src/updater_download.rs` depends on.

Three assertions, each independently able to turn the gate red:

  1. HEAD <url>  ->  the **Content-Length response header** exists and is > 0.
     This is the exact bug that killed 7 releases: `updater_download.rs:347-354`
     documents that `reqwest::Response::content_length()` is hyper's *body size
     hint*, which is 0 for a HEAD response regardless of the real length. So this
     check MUST read the header map, never a body-derived length. The mutation
     test for this assertion swaps it for the body-size-hint reading and shows
     the gate turning red.

  2. `Accept-Ranges` contains `bytes` (substring, not equality) — mirrors
     `updater_download.rs:355-360`, which uses `.contains("bytes")` because the
     header may be a composite value such as `bytes, foo`.

  3. GET with `Range: bytes=0-N` -> status is exactly **206**, the body really is
     N+1 bytes, and the total in `Content-Range` equals assertion 1's length.
     A source that answers 200 here would silently hand the sharded downloader
     the whole file for every shard.

Scope / non-goals
-----------------
* It probes the **desktop** manifest (`latest.json`) entry for the *current*
  platform, as wired into `scripts/linux/test-all.sh`. The Android manifest is
  not probed here (see the delivery notes: `android-latest.json` grows a
  `sha256` field only from the next release onward, so probing it today would
  fail against a manifest that legitimately predates the field).
* It does NOT verify signatures — that is minisign's job inside the app.

Failure policy (deliberate, do not "fix" this into a skip)
----------------------------------------------------------
Any failure — including DNS / TLS / timeout — exits non-zero. There is **no**
skip path and **no** retry. Reasons:

* If the update source is unreachable at release time, every user's update path
  is unreachable too. Calling that "an environment problem" is exactly the
  "disguise not-run as environment-not-available" pattern this repo bans.
* Retries would trade a real signal for a green light.

The *wording* separates transport-level failure ("network / TLS / DNS") from
contract-level failure ("the source answered, but broke the contract") so the
operator can triage, but both are FAIL.

Exit codes
----------
  0  all three assertions passed
  1  at least one assertion failed, or the source could not be reached

Usage
-----
  python3 scripts/update-source-smoke.py
"""

from __future__ import annotations

import platform
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

# The update-source base URL has exactly one source of truth: src/update/config.ts.
# Parse it instead of duplicating the literal, so moving the source moves this gate too.
CONFIG_TS = Path(__file__).resolve().parent.parent / "src" / "update" / "config.ts"

TIMEOUT_SECONDS = 30
# First-shard probe size. Small on purpose: the point is "does the source answer
# 206 with the right total", not a throughput measurement.
RANGE_BYTES = 1024

USER_AGENT = "huanvae-update-source-smoke/1"


class SmokeFailure(Exception):
    """A contract violation or an unreachable source. Both are FAIL."""


def read_self_hosted_base() -> str:
    """Extract SELF_HOSTED_BASE from src/update/config.ts."""
    if not CONFIG_TS.is_file():
        raise SmokeFailure(f"找不到更新源配置真值源: {CONFIG_TS}")
    source = CONFIG_TS.read_text(encoding="utf-8")
    match = re.search(
        r"export\s+const\s+SELF_HOSTED_BASE\s*=\s*['\"]([^'\"]+)['\"]", source
    )
    if not match:
        raise SmokeFailure(
            f"{CONFIG_TS} 里解析不出 SELF_HOSTED_BASE —— 更新源真值源变了，本闸需同步"
        )
    return match.group(1).rstrip("/")


def current_platform_key() -> str:
    """Map the host to a latest.json `platforms` key (Tauri updater naming)."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    arch = {
        "x86_64": "x86_64",
        "amd64": "x86_64",
        "arm64": "aarch64",
        "aarch64": "aarch64",
    }.get(machine)
    os_key = {"darwin": "darwin", "linux": "linux", "windows": "windows"}.get(system)
    if os_key is None or arch is None:
        raise SmokeFailure(f"无法把本机映射到 latest.json 平台键: system={system} machine={machine}")
    return f"{os_key}-{arch}"


def http(url: str, *, method: str, extra_headers: dict[str, str] | None = None):
    """Issue one request. Transport-level problems are raised as SmokeFailure."""
    headers = {"User-Agent": USER_AGENT}
    if extra_headers:
        headers.update(extra_headers)
    request = urllib.request.Request(url, method=method, headers=headers)
    try:
        return urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS)  # noqa: S310
    except urllib.error.HTTPError as exc:
        # An HTTP error status IS an answer: the source is reachable but broke the contract.
        raise SmokeFailure(f"{method} {url} 返回 HTTP {exc.code} {exc.reason}") from exc
    except Exception as exc:  # noqa: BLE001 - DNS / TLS / timeout / reset all land here
        raise SmokeFailure(
            f"{method} {url} 连不上（网络 / DNS / TLS 层失败，非更新源契约问题）: {exc}"
        ) from exc


def fetch_manifest(manifest_url: str) -> dict:
    import json

    with http(manifest_url, method="GET") as response:
        body = response.read()
    try:
        return json.loads(body)
    except ValueError as exc:
        raise SmokeFailure(f"{manifest_url} 不是合法 JSON: {exc}") from exc


def resolve_artifact_url(manifest: dict, platform_key: str, manifest_url: str) -> str:
    platforms = manifest.get("platforms")
    if not isinstance(platforms, dict):
        raise SmokeFailure(f"{manifest_url} 缺少 platforms 对象")
    entry = platforms.get(platform_key)
    if not isinstance(entry, dict):
        raise SmokeFailure(
            f"{manifest_url} 的 platforms 里没有本平台条目 {platform_key}"
            f"（现有: {', '.join(sorted(platforms))}）—— 该平台无法自更新"
        )
    url = entry.get("url")
    if not isinstance(url, str) or not url:
        raise SmokeFailure(f"{manifest_url} 的 {platform_key}.url 为空")
    return url


# ---------------------------------------------------------------------------
# The three assertions
# ---------------------------------------------------------------------------


def assert_content_length(url: str) -> int:
    """[1/3] HEAD -> Content-Length **response header** present and > 0."""
    with http(url, method="HEAD") as response:
        # 🔴 MUTATION TARGET 1 / 真值必须来自响应头。
        #    绝不能改成任何"从 body 推算长度"的写法（Python 里的等价物是
        #    `len(response.read())`，HEAD 无 body ⇒ 恒 0）—— 那正是
        #    updater_download.rs:347-354 记录的、死了 7 个版本的那个 bug。
        raw = response.headers.get("Content-Length")
    if raw is None:
        raise SmokeFailure("[1/3] 响应头里没有 Content-Length —— 更新器拿不到总长度，下载必中止")
    try:
        length = int(raw.strip())
    except ValueError as exc:
        raise SmokeFailure(f"[1/3] Content-Length 不是整数: {raw!r}") from exc
    if length <= 0:
        raise SmokeFailure(f"[1/3] Content-Length = {length}（应 > 0）")
    print(f"  [1/3] PASS  Content-Length 响应头 = {length} 字节")
    return length


def assert_accept_ranges(url: str) -> None:
    """[2/3] Accept-Ranges contains `bytes` (substring, per updater_download.rs:355-360)."""
    with http(url, method="HEAD") as response:
        raw = response.headers.get("Accept-Ranges")
    if raw is None:
        raise SmokeFailure("[2/3] 响应头里没有 Accept-Ranges —— 分片/续传下载不可用")
    if "bytes" not in raw.lower():
        raise SmokeFailure(f"[2/3] Accept-Ranges 不含 bytes: {raw!r}")
    print(f"  [2/3] PASS  Accept-Ranges = {raw!r}（含 bytes）")


def assert_first_shard_206(url: str, expected_total: int) -> None:
    """[3/3] Range GET -> 206, body length matches, Content-Range total matches [1/3]."""
    last = RANGE_BYTES - 1
    with http(url, method="GET", extra_headers={"Range": f"bytes=0-{last}"}) as response:
        status = response.status
        content_range = response.headers.get("Content-Range")
        body = response.read()

    # 🔴 MUTATION TARGET 2 / 必须是恰好 206。接受 200 = 接受"服务端忽略了 Range 直接吐全文件"，
    #    那样每个分片都会拉一整份文件，下载器彻底失去分片与续传语义。
    if status != 206:
        raise SmokeFailure(
            f"[3/3] Range 请求返回 {status}，应为 206"
            "（200 = 服务端忽略 Range 吐了整个文件，分片/续传全废）"
        )
    if len(body) != RANGE_BYTES:
        raise SmokeFailure(f"[3/3] 206 响应实际收到 {len(body)} 字节，应为 {RANGE_BYTES}")
    if content_range is None:
        raise SmokeFailure("[3/3] 206 响应没有 Content-Range 头")
    match = re.fullmatch(r"bytes\s+(\d+)-(\d+)/(\d+)", content_range.strip())
    if not match:
        raise SmokeFailure(f"[3/3] Content-Range 格式非法: {content_range!r}")
    start, end, total = (int(g) for g in match.groups())
    if (start, end) != (0, last):
        raise SmokeFailure(f"[3/3] Content-Range 区间 {start}-{end}，应为 0-{last}")
    if total != expected_total:
        raise SmokeFailure(
            f"[3/3] Content-Range 总长 {total} ≠ HEAD 的 Content-Length {expected_total}"
        )
    print(f"  [3/3] PASS  Range 首片 206，Content-Range = {content_range!r}")


def main() -> int:
    print("更新源冒烟闸：对真实更新源做 HEAD + Accept-Ranges + 首片 206")
    try:
        base = read_self_hosted_base()
        manifest_url = f"{base}/latest.json"
        platform_key = current_platform_key()
        print(f"  源: {manifest_url}")
        print(f"  本机平台键: {platform_key}")

        manifest = fetch_manifest(manifest_url)
        artifact_url = resolve_artifact_url(manifest, platform_key, manifest_url)
        print(f"  清单版本: {manifest.get('version')!r}")
        print(f"  被测产物: {artifact_url}")

        total = assert_content_length(artifact_url)
        assert_accept_ranges(artifact_url)
        assert_first_shard_206(artifact_url, total)
    except SmokeFailure as exc:
        print(f"更新源冒烟闸 FAIL: {exc}", file=sys.stderr)
        return 1

    print("更新源冒烟闸：3/3 通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())
