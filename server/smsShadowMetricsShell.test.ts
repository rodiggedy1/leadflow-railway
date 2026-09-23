import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("SMS shadow metrics route", () => {
  it("uses a dedicated read-only page rather than adding metrics controls to the SMS workspace", () => {
    const page = read("client/src/pages/SmsShadowMetrics.tsx");
    const css = read("client/src/pages/sms-shadow-metrics.css");
    const app = read("client/src/App.tsx");
    const smsPage = read("client/src/pages/SmsExactLive.tsx");
    const navigation = read("client/src/components/ReviewWorkspaceNav.tsx");

    expect(page).toContain('fetch("/api/sms-shadow-evaluations/metrics"');
    expect(page).toContain('href="/admin/sms"');
    expect(page).toContain("SMS Shadow Metrics");
    expect(page).toContain("Read-only learning data");
    expect(page).toContain("No messages can be sent from this page.");
    expect(page).toContain("Draft-to-send pairs");
    expect(page).toContain("Generated draft compared with the text a human actually sent.");
    expect(page).toContain("describeShadowEdit");
    expect(page).not.toContain("sendMessage");
    expect(page).not.toContain("sendSms(");
    expect(css).toContain(".sms-shadow-metrics-page");
    expect(css).toContain(".sms-shadow-metrics-text");
    expect(app).toContain('const SmsShadowMetrics = lazy(() => import("./pages/SmsShadowMetrics"));');
    expect(app).toContain('path={"/admin/sms-shadow-metrics"} component={AdminSmsShadowMetricsRoute}');
    expect(app).toContain('isSmsShadowMetricsWorkspace');
    expect(navigation).toContain('{ label: "Shadow Metrics", href: "/admin/sms-shadow-metrics", icon: ShieldAlert }');
    expect(smsPage).not.toContain("ShadowMetricsPanel");
    expect(smsPage).not.toContain("showShadowMetrics");
  });
});
