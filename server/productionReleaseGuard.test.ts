import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guardSource = readFileSync(new URL("../scripts/push-main-safe.sh", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../DEPLOY_WORKFLOW.md", import.meta.url), "utf8");

describe("production release safety contract", () => {
  it("reads the live remote branch instead of trusting a remote-tracking ref", () => {
    expect(guardSource).toContain('git ls-remote --heads "$REMOTE" "refs/heads/$TARGET_BRANCH"');
    expect(guardSource).toContain('[[ "$LIVE_SHA" == "$EXPECTED_LIVE_SHA" ]]');
    expect(guardSource).toContain('git fetch "$REMOTE" "refs/heads/$TARGET_BRANCH:refs/remotes/$REMOTE/$TARGET_BRANCH"');
    expect(guardSource).toContain('[[ "$TRACKED_SHA" == "$LIVE_SHA" ]]');
    expect(workflowSource).toContain("git ls-remote origin refs/heads/main");
    expect(workflowSource).toContain("potentially stale remote-tracking ref");
  });

  it("refuses dirty, stale, divergent, or unprotected production releases", () => {
    expect(guardSource).toContain('git status --porcelain');
    expect(guardSource).toContain('git merge-base --is-ancestor "$LIVE_SHA" "$LOCAL_SHA"');
    expect(guardSource).toContain('branches/$TARGET_BRANCH/protection');
    expect(guardSource).toContain("true\\ttrue\\tfalse\\tfalse");
    expect(guardSource).not.toContain("push --force");
    expect(guardSource).not.toContain("push -f");
  });

  it("creates and pushes a unique rollback tag before advancing main", () => {
    expect(guardSource).toContain('ROLLBACK_TAG="${2:-}"');
    expect(guardSource).toContain('git tag -a "$ROLLBACK_TAG" "$LIVE_SHA"');
    expect(guardSource).toContain('git push "$REMOTE" "refs/tags/$ROLLBACK_TAG"');
    expect(guardSource).toContain('git push "$REMOTE" "HEAD:refs/heads/$TARGET_BRANCH"');
    expect(guardSource.indexOf('refs/tags/$ROLLBACK_TAG')).toBeLessThan(
      guardSource.indexOf('HEAD:refs/heads/$TARGET_BRANCH'),
    );
  });
});
