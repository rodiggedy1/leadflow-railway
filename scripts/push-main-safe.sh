#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-origin}"
TARGET_BRANCH="${TARGET_BRANCH:-main}"
REPO_SLUG="${REPO_SLUG:-rodiggedy1/leadflow-railway}"
DRY_RUN="${DRY_RUN:-0}"
EXPECTED_LIVE_SHA="${1:-}"
ROLLBACK_TAG="${2:-}"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

if [[ ! "$EXPECTED_LIVE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  fail "usage: $0 <expected-live-main-full-sha> <pre-production-tag>"
fi

if [[ ! "$ROLLBACK_TAG" =~ ^pre-production-[A-Za-z0-9._-]+$ ]]; then
  fail "rollback tag must start with pre-production- and contain only letters, numbers, dot, underscore, or hyphen"
fi

command -v git >/dev/null || fail "git is required"
command -v gh >/dev/null || fail "GitHub CLI is required to verify main protection"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "run this command inside the LeadFlow repository"

if [[ -n "$(git status --porcelain)" ]]; then
  fail "working tree must be clean before a production release"
fi

LIVE_REF="$(git ls-remote --heads "$REMOTE" "refs/heads/$TARGET_BRANCH")"
LIVE_SHA="$(printf '%s' "$LIVE_REF" | awk '{print $1}')"
[[ "$LIVE_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "could not read live $REMOTE/$TARGET_BRANCH"
[[ "$LIVE_SHA" == "$EXPECTED_LIVE_SHA" ]] || fail "live $TARGET_BRANCH changed: expected $EXPECTED_LIVE_SHA, found $LIVE_SHA"

LOCAL_SHA="$(git rev-parse HEAD)"
[[ "$LOCAL_SHA" != "$LIVE_SHA" ]] || fail "HEAD already matches live $TARGET_BRANCH; there is nothing to release"
git merge-base --is-ancestor "$LIVE_SHA" "$LOCAL_SHA" || fail "HEAD is not a descendant of live $TARGET_BRANCH; refusing a rollback or divergent push"

git fetch "$REMOTE" "refs/heads/$TARGET_BRANCH:refs/remotes/$REMOTE/$TARGET_BRANCH"
TRACKED_SHA="$(git rev-parse "refs/remotes/$REMOTE/$TARGET_BRANCH")"
[[ "$TRACKED_SHA" == "$LIVE_SHA" ]] || fail "tracked $REMOTE/$TARGET_BRANCH does not match the live remote SHA"

PROTECTION="$(gh api "repos/$REPO_SLUG/branches/$TARGET_BRANCH/protection" --jq '[.enforce_admins.enabled,.required_linear_history.enabled,.allow_force_pushes.enabled,.allow_deletions.enabled] | @tsv')"
[[ "$PROTECTION" == $'true\ttrue\tfalse\tfalse' ]] || fail "main protection must enforce admins and linear history while blocking force pushes and deletion"

git show-ref --verify --quiet "refs/tags/$ROLLBACK_TAG" && fail "rollback tag already exists locally: $ROLLBACK_TAG"
[[ -z "$(git ls-remote --tags "$REMOTE" "refs/tags/$ROLLBACK_TAG")" ]] || fail "rollback tag already exists remotely: $ROLLBACK_TAG"

printf 'Live %s: %s\n' "$TARGET_BRANCH" "$LIVE_SHA"
printf 'Release HEAD: %s\n' "$LOCAL_SHA"
printf 'Rollback tag: %s\n' "$ROLLBACK_TAG"
git diff --stat "$LIVE_SHA..$LOCAL_SHA"

if [[ "$DRY_RUN" == "1" ]]; then
  printf 'SAFE DRY RUN: release is a protected fast-forward descendant of live %s.\n' "$TARGET_BRANCH"
  exit 0
fi

git tag -a "$ROLLBACK_TAG" "$LIVE_SHA" -m "Production rollback point before $LOCAL_SHA"
git push "$REMOTE" "refs/tags/$ROLLBACK_TAG"
git push "$REMOTE" "HEAD:refs/heads/$TARGET_BRANCH"

AFTER_SHA="$(git ls-remote --heads "$REMOTE" "refs/heads/$TARGET_BRANCH" | awk '{print $1}')"
[[ "$AFTER_SHA" == "$LOCAL_SHA" ]] || fail "push returned but live $TARGET_BRANCH is $AFTER_SHA instead of $LOCAL_SHA"
printf 'Production %s advanced safely to %s.\n' "$TARGET_BRANCH" "$LOCAL_SHA"
