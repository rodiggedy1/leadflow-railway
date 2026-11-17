import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

// serveStatic lives next to the Vite dev server; the dev config is not needed to serve a build.
vi.mock("../vite.config", () => ({ default: {} }));
const { serveStatic } = await import("./_core/vite");

const INDEX = "<!doctype html><html><body><div id=\"root\"></div></body></html>";

function builtApp() {
  const dist = mkdtempSync(join(tmpdir(), "leadflow-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "assets", "index-NEW.js"), "console.log('current build');");
  const app = express();
  serveStatic(app, dist);
  return app;
}

describe("serveStatic — missing bundles", () => {
  it("serves a bundle that exists as JavaScript", async () => {
    const res = await request(builtApp()).get("/assets/index-NEW.js").expect(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
  });

  it("answers a missing bundle with an uncacheable plain-text 404, never index.html", async () => {
    const app = builtApp();
    for (const path of ["/assets/index-OLD.js", "/assets/nested/chunk-OLD.css", "/assets/"]) {
      const res = await request(app).get(path).expect(404);
      expect(res.headers["content-type"]).toMatch(/^text\/plain/);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.text).not.toContain("<");
    }
    await request(app).head("/assets/index-OLD.js").expect(404);
  });

  it.each(["/", "/book?x=1", "/book/QF-123", "/admin/leads", "/track/abc", "/assets-old.js"])(
    "still falls back to index.html for %s",
    async path => {
      const res = await request(builtApp()).get(path).expect(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toBe(INDEX);
    }
  );
});

const html = readFileSync(resolve(import.meta.dirname, "..", "client", "index.html"), "utf8");
const recoveryScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

type BootOptions = { storage?: Map<string, string> | "blocked"; rendered?: boolean; now?: number; readyState?: string };

/** Runs the inline recovery script against a minimal fake browser. */
function boot(options: BootOptions = {}) {
  const listeners: Record<string, Array<(event?: unknown) => void>> = {};
  const root = { innerHTML: "", hasChildNodes: () => options.rendered ?? false };
  const reload = vi.fn();
  const storage = options.storage ?? new Map<string, string>();
  const sessionStorage =
    storage === "blocked"
      ? { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } }
      : { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) };
  const now = options.now ?? 1_000_000;
  vm.runInNewContext(recoveryScript, {
    URL,
    Date: { now: () => now },
    window: { addEventListener: (type: string, fn: (event?: unknown) => void) => (listeners[type] ??= []).push(fn) },
    location: { href: "https://book.maidsinblack.com/?x=1", origin: "https://book.maidsinblack.com", reload },
    document: { readyState: options.readyState ?? "complete", getElementById: () => root, body: root },
    sessionStorage,
    setTimeout: (fn: () => void) => fn(),
  });
  const fail = (tagName: string, url: string) =>
    listeners.error?.forEach(fn => fn({ target: { tagName, src: tagName === "SCRIPT" ? url : undefined, href: tagName === "LINK" ? url : undefined } }));
  const load = () => listeners.load?.forEach(fn => fn());
  return { fail, load, reload, root, storage };
}

describe("index.html startup recovery", () => {
  it("is inline and runs before any other script", () => {
    expect(recoveryScript).toContain("leadflow-asset-reload-at");
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<script src="));
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('<script type="module"'));
  });

  it("reloads once when our entry bundle fails and nothing rendered", () => {
    const page = boot();
    page.fail("SCRIPT", "https://book.maidsinblack.com/assets/index-OLD.js");
    page.fail("SCRIPT", "https://book.maidsinblack.com/assets/vendor-OLD.js");
    expect(page.reload).toHaveBeenCalledTimes(1);
    expect(page.storage).toBeInstanceOf(Map);
    expect((page.storage as Map<string, string>).get("leadflow-asset-reload-at")).toBe("1000000");
    expect(page.root.innerHTML).toBe("");
  });

  it("reloads for a failed modulepreload or stylesheet link under /assets/", () => {
    const page = boot();
    page.fail("LINK", "https://book.maidsinblack.com/assets/react-vendor-OLD.js");
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it("never loops: within a minute of the last reload it shows a message instead", () => {
    const storage = new Map([["leadflow-asset-reload-at", String(1_000_000)]]);
    const page = boot({ storage, now: 1_005_000 });
    page.fail("SCRIPT", "https://book.maidsinblack.com/assets/index-OLD.js");
    expect(page.reload).not.toHaveBeenCalled();
    expect(page.root.innerHTML).toContain("This page did not finish loading");
    expect(page.root.innerHTML).toContain("tel:+12028885362");
    expect(page.root.innerHTML).toContain("Reload page");
  });

  it("reloads again for a later deploy once a minute has passed", () => {
    const storage = new Map([["leadflow-asset-reload-at", String(1_000_000)]]);
    const page = boot({ storage, now: 1_061_000 });
    page.fail("SCRIPT", "https://book.maidsinblack.com/assets/index-OLD.js");
    expect(page.reload).toHaveBeenCalledTimes(1);
  });

  it("shows the message without reloading when session storage is unavailable", () => {
    const page = boot({ storage: "blocked" });
    page.fail("SCRIPT", "https://book.maidsinblack.com/assets/index-OLD.js");
    expect(page.reload).not.toHaveBeenCalled();
    expect(page.root.innerHTML).toContain("This page did not finish loading");
  });

  it("leaves a page alone once the app has rendered", () => {
    const page = boot({ rendered: true });
    page.fail("LINK", "https://book.maidsinblack.com/assets/BookNow-OLD.css");
    expect(page.reload).not.toHaveBeenCalled();
    expect(page.root.innerHTML).toBe("");
  });

  it.each([
    ["third-party script", "SCRIPT", "https://fast.wistia.com/embed/bzlt49ipk1.js"],
    ["same-origin non-bundle script", "SCRIPT", "https://book.maidsinblack.com/%VITE_ANALYTICS_ENDPOINT%/umami"],
    ["other-origin /assets/ path", "SCRIPT", "https://cdn.example.com/assets/index-OLD.js"],
    ["image", "IMG", "https://book.maidsinblack.com/assets/logo-OLD.svg"],
  ])("ignores a failed %s", (_label, tagName, url) => {
    const page = boot();
    page.fail(tagName, url);
    expect(page.reload).not.toHaveBeenCalled();
    expect(page.root.innerHTML).toBe("");
  });

  it("waits for the page to finish loading before deciding", () => {
    const page = boot({ readyState: "loading" });
    page.fail("SCRIPT", "https://book.maidsinblack.com/assets/index-OLD.js");
    expect(page.reload).not.toHaveBeenCalled();
    page.load();
    expect(page.reload).toHaveBeenCalledTimes(1);
  });
});
