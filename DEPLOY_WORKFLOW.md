# Deploy Workflow — READ BEFORE EVERY DEPLOY

## ALWAYS push to preview first, then production.

### Push to PREVIEW (required before every production deploy):
```
git checkout preview && git merge main --no-edit && git push origin preview && git commit --allow-empty -m "chore: trigger Railway preview" && git push origin preview && git checkout main
```

### Push to PRODUCTION (only after preview is verified):
```
git push origin main
```

## Branch state
- `main` → Production (https://quote.maidinblack.com) — Railway auto-deploys
- `preview` → Preview environment — Railway auto-deploys
- Feature branches → NOT tracked by Railway

## IMPORTANT
- `preview` branch exists on remote but was NOT tracked locally after clone.
- If `git checkout preview` fails, run: `git fetch --all && git checkout --track origin/preview`
- Never push feature branches directly expecting Railway to pick them up.
