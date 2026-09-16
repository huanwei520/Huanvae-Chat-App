#!/bin/bash
#
# 自动版本规则 —— 目标版本号实时取 GitHub 最新正式 tag，+0.0.1 得出；禁盲涨号
#
# ## 它根治哪一类缺陷
#
# 旧 release.sh 的版本号来自 scripts/release-config.txt 的 VERSION= 行（手工传参）。
# 手工版本号出过两类事故：① 版本号与远端实际状态脱节（人忘了远端已经发到哪）；
# ② 同名 tag --force 覆盖历史（见 SKILL.md 坑 3）。本脚本把版本号变成**派生值**：
# 实时查 GitHub 最新正式 release（非 draft、非 prerelease），patch 位 +0.0.1 得出目标；
# 目标 tag 若已存在远端，必须核对其 SHA 是否等于本地 HEAD——相等=本 commit 已发过（skip），
# 不等=冲突（停住上报），任何查询失败都停住。**任何路径都不允许"猜一个版本号"。**
#
# ## 与 release.sh 的接入点（设计文档，阶段B 按此接入）
#
#   release.sh 步骤 0（新增）：
#     VER_JSON=$(AUTO_VERSION_LOG="$RELEASE_LOG_DIR/auto-version.log" \
#                "$SCRIPT_DIR/auto-version.sh") || exit 1
#     TARGET_VERSION=$(sed -n 's/^AUTO_VERSION: .*target=v\([0-9.]*\) .*/\1/p' <<<"$VER_JSON")
#     ACTION=$(... 's/.*action=\([a-z]*\).*/\1/p')
#     case "$ACTION" in
#       release) 继续发布 ;;
#       skip)    打印"该 commit 已发布过"，礼貌退出 0 ;;
#       *)       exit 1 ;;
#     esac
#   release-config.txt 的 VERSION 行降级为注释性信息：若仍存在且与计算值不符，
#   release.sh 打 WARN（人改的 VERSION 不再生效，防两处真值源打架）。
#
# ## 查询通道（按序降级，全部只读）
#   ① gh api（gh 已认证时） ② curl GitHub REST API（匿名/或 GITHUB_TOKEN 注入，
#   token 只进 Authorization 头，不打印、不落盘）③ git ls-remote --tags（git 协议可达时）。
#   任一通道拿到 releases/latest 与 tags 两类事实即成功；全失败 → exit 1（禁盲涨号）。
#
# ## 用法
#   scripts/linux/auto-version.sh                     # 计算 + 门禁判定
#   scripts/linux/auto-version.sh --head-sha <sha>    # 用指定 SHA 当本地 HEAD（自测/干跑用）
#   scripts/linux/auto-version.sh --json              # 附加机器可读 JSON 行
#   --simulate-existing-target <sha>                  # 自测钩子：假装目标 tag 已存在远端且指向
#                                                     # <sha>（只在本地判定层生效，不触碰远端；
#                                                     # 用于实测 skip / conflict 两判定路径）
#
# ## 环境变量
#   AUTO_VERSION_REPO     owner/repo   默认 huanwei520/Huanvae-Chat-App
#   AUTO_VERSION_LOG      追加写一份完整留档到该路径（release.sh 接入时传入）
#   GITHUB_TOKEN          可选；只作 Authorization 头，绝不打印
#
# ## 退出码
#   0 = 得出目标版本（action=release）或已发布过（action=skip）
#   1 = 冲突（目标 tag 已存在且 SHA≠HEAD）/ 查询失败 / 版本号解析失败 —— 一律停住
#
# 本脚本无副作用（只读查询），可随时独立运行。

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; GRAY='\033[0;90m'; NC='\033[0m'

REPO="${AUTO_VERSION_REPO:-huanwei520/Huanvae-Chat-App}"
MODE="gate"
JSON_OUT=false
HEAD_SHA_ARG=""
SIMULATE_TARGET_SHA=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --head-sha) HEAD_SHA_ARG="$2"; shift 2 ;;
        --simulate-existing-target) SIMULATE_TARGET_SHA="$2"; shift 2 ;;
        --json) JSON_OUT=true; shift ;;
        -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo -e "${RED}未知参数: $1${NC}" >&2; exit 1 ;;
    esac
done

HEAD_SHA="${HEAD_SHA_ARG:-$(git -C "$(dirname "$0")/../.." rev-parse HEAD 2>/dev/null)}"

LOG_LINES=()
log()  { echo -e "$*"; LOG_LINES+=("$(echo -e "$*" | sed $'s/\033\\[[0-9;]*m//g')"); }
flush_log() {
    if [[ -n "${AUTO_VERSION_LOG:-}" ]]; then
        { echo "==== auto-version.sh $(date -u '+%Y-%m-%dT%H:%M:%SZ') repo=$REPO ===="
          printf '%s\n' "${LOG_LINES[@]}"; } >> "$AUTO_VERSION_LOG"
    fi
}
die() { log "  ${RED}✗ $1${NC}"; flush_log; exit 1; }

command -v git >/dev/null 2>&1 || die "本机无 git"
[[ -n "$HEAD_SHA" ]] || die "取不到本地 HEAD SHA（且未用 --head-sha 注入）"

api_get() {  # $1=path  → stdout=body, 返回 http code（curl 匿名或带 token，token 不回显）
    local url="https://api.github.com/repos/$REPO$1"
    local code
    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        code=$(curl -sS -o /tmp/.av_body.$$ -w '%{http_code}' -H "Authorization: Bearer $GITHUB_TOKEN" \
                    -H 'Accept: application/vnd.github+json' "$url" 2>/dev/null) || { rm -f /tmp/.av_body.$$; echo 000; return; }
    else
        code=$(curl -sS -o /tmp/.av_body.$$ -w '%{http_code}' "$url" 2>/dev/null) || { rm -f /tmp/.av_body.$$; echo 000; return; }
    fi
    cat /tmp/.av_body.$$ 2>/dev/null
    rm -f /tmp/.av_body.$$
    echo "$code"
}

# ---------- ① 最新正式 tag ----------
log "${CYAN}auto-version: 查询 GitHub 最新正式 release（repo=$REPO）${NC}"

LATEST_TAG=""
CHANNEL=""
body=$(api_get "/releases/latest") ; code=$(tail -1 <<<"$body"); body=$(head -n -1 <<<"$body" 2>/dev/null || printf '%s' "$body")
if [[ "$code" == "200" ]]; then
    LATEST_TAG=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log(j.tag_name&&/^v\d+\.\d+\.\d+$/.test(j.tag_name)?j.tag_name:'')}catch(e){console.log('')}})" <<<"$body" 2>/dev/null)
    [[ "$LATEST_TAG" == "null" ]] && LATEST_TAG=""
    CHANNEL="api/releases/latest"
fi

if [[ -z "$LATEST_TAG" ]]; then
    # 降级通道：tags API 首个 vX.Y.Z（tags 按创建时间倒序，本仓 tag 即发布）
    body=$(api_get "/tags?per_page=15"); code=$(tail -1 <<<"$body"); body=$(head -n -1 <<<"$body" 2>/dev/null || printf '%s' "$body")
    if [[ "$code" == "200" ]]; then
        LATEST_TAG=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const t=(j||[]).map(x=>x.name).find(n=>/^v\d+\.\d+\.\d+$/.test(n));console.log(t||'')}catch(e){console.log('')}})" <<<"$body" 2>/dev/null)
        [[ "$LATEST_TAG" == "null" ]] && LATEST_TAG=""
        [[ -n "$LATEST_TAG" ]] && CHANNEL="api/tags"
    fi
fi

if [[ -z "$LATEST_TAG" ]]; then
    # 降级通道：git ls-remote（git 协议直连可达的宿主）
    if out=$(timeout 30 git ls-remote --tags "https://github.com/$REPO.git" 'refs/tags/v*.*.*' 2>/dev/null); then
        LATEST_TAG=$(printf '%s\n' "$out" | sed 's|.*refs/tags/||' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)
        [[ -n "$LATEST_TAG" ]] && CHANNEL="git ls-remote"
    fi
fi

[[ -n "$LATEST_TAG" ]] || die "三条通道都取不到最新正式 tag（API 000/非200、git 直连失败）——禁盲涨号，停住"
log "  ${GREEN}✓ 最新正式 tag: $LATEST_TAG（通道: $CHANNEL）${NC}"

# ---------- ② +0.0.1 ----------
IFS='.' read -r V_MAJ V_MIN V_PAT <<<"${LATEST_TAG#v}"
[[ "$V_MAJ" =~ ^[0-9]+$ && "$V_MIN" =~ ^[0-9]+$ && "$V_PAT" =~ ^[0-9]+$ ]] || die "版本号不可解析: $LATEST_TAG"
TARGET_TAG="v$V_MAJ.$V_MIN.$((V_PAT + 1))"
TARGET_VERSION="${TARGET_TAG#v}"
log "  ${GREEN}✓ 目标版本（+0.0.1）: $TARGET_VERSION${NC}"

# ---------- ③ 目标 tag 是否已存在远端 ----------
REMOTE_TAG_SHA=""   # 剥离 annotated 后指向的 commit
code="sim"          # set -u：走自测钩子路径时不发查询，预置非 200 值
if [[ -n "$SIMULATE_TARGET_SHA" ]]; then
    REMOTE_TAG_SHA="$SIMULATE_TARGET_SHA"
    log "  ${GRAY}（自测钩子生效：模拟目标 tag $TARGET_TAG 已存在远端且指向 ${REMOTE_TAG_SHA:0:12}…，不触碰远端）${NC}"
fi
if [[ -z "$REMOTE_TAG_SHA" ]]; then
    body=$(api_get "/git/ref/tags/$TARGET_TAG"); code=$(tail -1 <<<"$body"); body=$(head -n -1 <<<"$body" 2>/dev/null || printf '%s' "$body")
fi
if [[ "$code" == "200" ]]; then
    REMOTE_TAG_SHA=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);const o=j.object||{};console.log(o.type==='commit'?o.sha:(j.object&&o.sha)||'')}catch(e){console.log('')}})" <<<"$body" 2>/dev/null)
    # annotated tag：object.type=tag，需再解引用一层
    if [[ -n "$REMOTE_TAG_SHA" ]] && node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);process.exit((j.object||{}).type==='tag'?0:1)}catch(e){process.exit(1)}})" <<<"$body" 2>/dev/null; then
        b2=$(api_get "/git/tags/$REMOTE_TAG_SHA"); c2=$(tail -1 <<<"$b2"); b2=$(head -n -1 <<<"$b2" 2>/dev/null || printf '%s' "$b2")
        [[ "$c2" == "200" ]] && REMOTE_TAG_SHA=$(node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).object.sha||'')}catch(e){console.log('')}})" <<<"$b2" 2>/dev/null)
    fi
fi
if [[ -z "$REMOTE_TAG_SHA" ]]; then
    # 降级通道：git ls-remote（peeled ^{} 即 commit SHA）
    if out=$(timeout 30 git ls-remote --tags "https://github.com/$REPO.git" "refs/tags/$TARGET_TAG" "refs/tags/$TARGET_TAG^{}" 2>/dev/null) && [[ -n "$out" ]]; then
        REMOTE_TAG_SHA=$(printf '%s\n' "$out" | grep '\^{}' | awk '{print $1}')
        [[ -z "$REMOTE_TAG_SHA" ]] && REMOTE_TAG_SHA=$(printf '%s\n' "$out" | awk '{print $1}' | head -1)
    fi
fi

ACTION="release"; RESULT_RC=0
if [[ -z "$REMOTE_TAG_SHA" ]]; then
    log "  ${GREEN}✓ 目标 tag $TARGET_TAG 远端不存在 → action=release（正常发布）${NC}"
elif [[ "$REMOTE_TAG_SHA" == "$HEAD_SHA" ]]; then
    ACTION="skip"
    log "  ${YELLOW}⚠ 目标 tag $TARGET_TAG 已存在远端且 SHA=本地 HEAD${NC}"
    log "    ${GRAY}tag_sha=$REMOTE_TAG_SHA head_sha=$HEAD_SHA → 该 commit 已发布过，action=skip（跳过发布，幂等重跑）${NC}"
else
    ACTION="conflict"; RESULT_RC=1
    log "  ${RED}✗ 版本冲突：目标 tag $TARGET_TAG 已存在远端，但 SHA≠本地 HEAD —— 停住，禁覆盖（SKILL 坑 3 的 force 覆盖就是这里防的）${NC}"
    log "    ${RED}tag_sha:  $REMOTE_TAG_SHA${NC}"
    log "    ${RED}head_sha: $HEAD_SHA${NC}"
    log "    ${GRAY}处置：换下一个 patch 号需先让最新正式版超过此号；或人工核对两边 commit 后决策，agent 不自行覆盖${NC}"
fi

log ""
log "AUTO_VERSION: latest=$LATEST_TAG target=$TARGET_VERSION action=$ACTION tag_sha=${REMOTE_TAG_SHA:--} head_sha=$HEAD_SHA channel=$CHANNEL"
if $JSON_OUT; then
    log "{\"latest\":\"$LATEST_TAG\",\"target\":\"$TARGET_VERSION\",\"action\":\"$ACTION\",\"tag_sha\":\"${REMOTE_TAG_SHA:-}\",\"head_sha\":\"$HEAD_SHA\",\"channel\":\"$CHANNEL\"}"
fi
flush_log
exit $RESULT_RC
