# Deploy Workflow — READ BEFORE EVERY DEPLOY

## ALWAYS push to preview first, then production.

### Push to PREVIEW (required before every production deploy):
```
git checkout preview && git merge main --no-edit && git push origin preview && git commit --allow-empty -m "chore: trigger Railway preview" && git push origin preview && git checkout main
```

### Push to PRODUCTION (only after preview is verified):
```
LIVE_MAIN=$(git ls-remote origin refs/heads/main | awk '{print $1}')
ROLLBACK_TAG=pre-production-$(date -u +%Y%m%d-%H%M%S)
DRY_RUN=1 ./scripts/push-main-safe.sh "$LIVE_MAIN" "$ROLLBACK_TAG"
./scripts/push-main-safe.sh "$LIVE_MAIN" "$ROLLBACK_TAG"
```

The guarded release command refuses to push when the working tree is dirty, the live SHA changed, the release is not a strict descendant of live `main`, GitHub protection is missing, or the rollback tag already exists. It reads the live SHA with `git ls-remote` rather than trusting a potentially stale remote-tracking ref.

## Branch state
- `main` → Production (https://quote.maidinblack.com) — Railway auto-deploys
- `preview` → Preview environment — Railway auto-deploys
- Feature branches → NOT tracked by Railway

## IMPORTANT
- `preview` branch exists on remote but was NOT tracked locally after clone.
- If `git checkout preview` fails, run: `git fetch --all && git checkout --track origin/preview`
- Never push feature branches directly expecting Railway to pick them up.
- Never run a bare `git push origin main`. Use `scripts/push-main-safe.sh` so production can only advance from the exact live SHA and receives a named rollback tag first.
- Local clones must track both production and preview:
  ```
  git config --add remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
  git config --add remote.origin.fetch '+refs/heads/preview:refs/remotes/origin/preview'
  git fetch origin
  ```
- GitHub `main` protection must remain enabled with admin enforcement and linear history, while force pushes and branch deletion remain disabled.
