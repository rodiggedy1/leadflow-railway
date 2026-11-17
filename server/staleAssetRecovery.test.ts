import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import vm from "node:vm";
import express from "express";
import * as React from "react";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary, { isStaleDynamicImport } from "../client/src/components/ErrorBoundary";

// serveStatic lives next to the Vite dev server; the dev config is not needed to serve a build.
vi.mock("../vite.config", () => ({ default: {} }));
const { serveStatic } = await import("./_core/vite");

const INDEX = "<!doctype html><html><body><div id=\"root\"></div></body></html>";

function builtApp() {
  const dist = mkdtempSync(join(tmpdir(), "leadflow-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), INDEX);
  writeFileSync(join(dist, "assets", "index-NEW.js"), "console.log('current build');");
  writeFileSync(join(dist, "guide.html"), "<!doctype html><p>standalone page</p>");
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
      expect(res.headers["cache-control"]).toBe("no-cache");
      expect(res.text).toBe(INDEX);
    }
  );
});

describe("serveStatic — HTML is always revalidated", () => {
  it.each(["/index.html", "/guide.html"])("sends no-cache for the static HTML file %s", async path => {
    const res = await request(builtApp()).get(path).expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("still lets an unchanged page revalidate to a 304", async () => {
    const app = builtApp();
    const first = await request(app).get("/").expect(200);
    expect(first.headers.etag).toBeTruthy();
    await request(app).get("/").set("If-None-Match", first.headers.etag).expect(304);
  });

  it("leaves bundle caching unchanged", async () => {
    const res = await request(builtApp()).get("/assets/index-NEW.js").expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=0");
  });
});

const html = readFileSync(resolve(import.meta.dirname, "..", "client", "index.html"), "utf8");
const recoveryScript = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";

type BootOptions = { url?: string; rendered?: boolean; readyState?: string };

/** Runs the inline recovery script against a minimal fake browser with manually driven timers. */
function boot(options: BootOptions = {}) {
  const listeners: Record<string, Array<(event?: unknown) => void>> = {};
  let rendered = options.rendered ?? false;
  const root = { innerHTML: "", hasChildNodes: () => rendered || root.innerHTML !== "" };
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const replace = vi.fn();
  const reload = vi.fn();
  const replaceState = vi.fn();
  let mutation: (() => void) | undefined;
  const fakeWindow: Record<string, unknown> = {
    addEventListener: (type: string, fn: (event?: unknown) => void) => (listeners[type] ??= []).push(fn),
  };
  vm.runInNewContext(recoveryScript, {
    URL,
    window: fakeWindow,
    location: { href: options.url ?? "https://book.maidsinblack.com/?x=1", origin: "https://book.maidsinblack.com", replace, reload },
    history: { state: null, replaceState },
    document: {
      readyState: options.readyState ?? "complete",
      getElementById: () => root,
      body: root,
      addEventListener: (type: string, fn: () => void) => (listeners[`document:${type}`] ??= []).push(fn),
    },
    MutationObserver: class {
      constructor(callback: () => void) { mutation = callback; }
      observe() {}
    },
    setTimeout: (fn: () => void, ms = 0) => void timers.push({ fn, ms }),
  });
  /** Runs every queued timer in order (including ones they queue) and returns their delays. */
  const flush = () => {
    const delays: number[] = [];
    for (let timer = timers.shift(); timer; timer = timers.shift()) {
      delays.push(timer.ms);
      timer.fn();
    }
    return delays;
  };
  const fail = (tagName: string, url: string) =>
    listeners.error?.forEach(fn => fn({ target: { tagName, src: tagName === "SCRIPT" ? url : undefined, href: tagName === "LINK" ? url : undefined } }));
  const load = () => listeners.load?.forEach(fn => fn());
  /** The app renders into #root (what the MutationObserver would report). */
  const appRenders = () => {
    rendered = true;
    mutation?.();
  };
  return { fail, load, flush, appRenders, replace, reload, replaceState, root, window: fakeWindow };
}

const ENTRY = "https://book.maidsinblack.com/assets/index-OLD.js";

describe("index.html startup recovery", () => {
  it("is inline and runs before any other script", () => {
    expect(recoveryScript).toContain("lf_retry");
    expect(recoveryScript).toContain("__leadflowRetryLoad");
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf("<script src="));
    expect(html.indexOf("<script>")).toBeLessThan(html.indexOf('<script type="module"'));
  });

  it("has no reload button or failure message", () => {
    expect(recoveryScript).not.toMatch(/<button|Reload page|did not finish loading/i);
  });

  it("shows a spinner and fetches a fresh copy of the page right away on the first failure", () => {
    const page = boot();
    page.fail("SCRIPT", ENTRY);
    page.fail("SCRIPT", "https://book.maidsinblack.com/assets/vendor-OLD.js");
    expect(page.flush()).toEqual([1000, 0]);
    expect(page.replace).toHaveBeenCalledTimes(1);
    expect(page.replace).toHaveBeenCalledWith("https://book.maidsinblack.com/?x=1&lf_retry=1");
    expect(page.root.innerHTML).toContain("aria-label='Loading'");
    expect(page.root.innerHTML).not.toContain("tel:");
  });

  it("keeps the page path and every existing query parameter", () => {
    const page = boot({ url: "https://book.maidsinblack.com/book/QF-1?cashapp_return=tok&utm_source=g" });
    page.fail("SCRIPT", ENTRY);
    page.flush();
    expect(page.replace).toHaveBeenCalledWith("https://book.maidsinblack.com/book/QF-1?cashapp_return=tok&utm_source=g&lf_retry=1");
  });

  it.each([
    [1, 2000],
    [2, 5000],
    [3, 10000],
    [4, 30000],
    [25, 30000],
  ])("after %i attempts waits %ims, then keeps trying", (attempts, delay) => {
    const page = boot({ url: `https://book.maidsinblack.com/?x=1&lf_retry=${attempts}` });
    page.fail("SCRIPT", ENTRY);
    expect(page.flush()).toEqual([1000, delay]);
    expect(page.replace).toHaveBeenCalledWith(`https://book.maidsinblack.com/?x=1&lf_retry=${attempts + 1}`);
  });

  it("adds the phone number from the third attempt, still without a button", () => {
    const page = boot({ url: "https://book.maidsinblack.com/?lf_retry=2" });
    page.fail("SCRIPT", ENTRY);
    page.flush();
    expect(page.root.innerHTML).toContain("tel:+12028885362");
    expect(page.root.innerHTML).not.toContain("<button");
  });

  it("reacts to a failed modulepreload or stylesheet link under /assets/", () => {
    const page = boot();
    page.fail("LINK", "https://book.maidsinblack.com/assets/react-vendor-OLD.js");
    page.flush();
    expect(page.replace).toHaveBeenCalledTimes(1);
  });

  it("leaves a page alone once the app has rendered", () => {
    const page = boot({ rendered: true });
    page.fail("LINK", "https://book.maidsinblack.com/assets/BookNow-OLD.css");
    page.flush();
    expect(page.replace).not.toHaveBeenCalled();
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
    page.flush();
    expect(page.replace).not.toHaveBeenCalled();
    expect(page.root.innerHTML).toBe("");
  });

  it("waits for the page to finish loading before deciding", () => {
    const page = boot({ readyState: "loading" });
    page.fail("SCRIPT", ENTRY);
    page.flush();
    expect(page.replace).not.toHaveBeenCalled();
    page.load();
    page.flush();
    expect(page.replace).toHaveBeenCalledTimes(1);
  });

  it("lets ErrorBoundary ask for a retry without touching the React-owned page", () => {
    const page = boot({ rendered: true });
    (page.window.__leadflowRetryLoad as () => void)();
    (page.window.__leadflowRetryLoad as () => void)();
    expect(page.flush()).toEqual([0]);
    expect(page.replace).toHaveBeenCalledWith("https://book.maidsinblack.com/?x=1&lf_retry=1");
    expect(page.root.innerHTML).toBe("");
  });

  it("drops the retry marker once the page has opened and stayed up for 10 seconds", () => {
    const page = boot({ url: "https://book.maidsinblack.com/?x=1&lf_retry=3" });
    page.appRenders();
    expect(page.flush()).toEqual([10000]);
    expect(page.replaceState).toHaveBeenCalledWith(null, "", "https://book.maidsinblack.com/?x=1");
  });

  it("keeps the marker while another retry is still pending", () => {
    const page = boot({ url: "https://book.maidsinblack.com/?x=1&lf_retry=3" });
    page.fail("SCRIPT", ENTRY);
    page.flush();
    page.appRenders();
    page.flush();
    expect(page.replace).toHaveBeenCalledWith("https://book.maidsinblack.com/?x=1&lf_retry=4");
    expect(page.replaceState).not.toHaveBeenCalled();
  });

  it("does not touch the URL on a normal first load", () => {
    const page = boot();
    page.appRenders();
    expect(page.flush()).toEqual([]);
    expect(page.replaceState).not.toHaveBeenCalled();
  });
});

describe("ErrorBoundary — failed route chunk", () => {
  // Vitest compiles client JSX to React.createElement, which looks React up when rendering.
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "TypeError: Failed to fetch dynamically imported module: https://book.maidsinblack.com/assets/Book-OLD.js",
    "TypeError: Importing a module script failed.",
    "TypeError: error loading dynamically imported module: https://book.maidsinblack.com/assets/Book-OLD.js",
    "Error: Unable to preload CSS for /assets/Book-OLD.css",
  ])("recognises %s", message => {
    const [name, ...rest] = message.split(": ");
    const error = Object.assign(new Error(rest.join(": ")), { name });
    expect(isStaleDynamicImport(error)).toBe(true);
  });

  it("does not treat ordinary errors as a failed download", () => {
    expect(isStaleDynamicImport(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isStaleDynamicImport(null)).toBe(false);
  });

  it("hands a failed chunk to the startup script and shows a spinner, not the error screen", () => {
    const retryLoad = vi.fn();
    vi.stubGlobal("window", { __leadflowRetryLoad: retryLoad, location: { search: "" } });
    const boundary = new ErrorBoundary({ children: null });
    const error = new TypeError("Failed to fetch dynamically imported module: https://book.maidsinblack.com/assets/Book-OLD.js");
    boundary.componentDidCatch(error);
    expect(retryLoad).toHaveBeenCalledTimes(1);
    boundary.state = ErrorBoundary.getDerivedStateFromError(error);
    const markup = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(markup).toContain('aria-label="Loading"');
    expect(markup).not.toMatch(/<button|unexpected error/i);
  });

  it("adds the phone number from the third attempt", () => {
    vi.stubGlobal("window", { __leadflowRetryLoad: vi.fn(), location: { search: "?lf_retry=2" } });
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = ErrorBoundary.getDerivedStateFromError(new TypeError("Importing a module script failed."));
    expect(renderToStaticMarkup(boundary.render() as ReactElement)).toContain("tel:+12028885362");
  });

  it("keeps the existing error screen for ordinary errors", () => {
    const retryLoad = vi.fn();
    vi.stubGlobal("window", { __leadflowRetryLoad: retryLoad, location: { search: "" } });
    const boundary = new ErrorBoundary({ children: null });
    const error = new TypeError("Cannot read properties of undefined (reading 'id')");
    boundary.componentDidCatch(error);
    expect(retryLoad).not.toHaveBeenCalled();
    boundary.state = ErrorBoundary.getDerivedStateFromError(error);
    expect(renderToStaticMarkup(boundary.render() as ReactElement)).toContain("An unexpected error occurred.");
  });
});
