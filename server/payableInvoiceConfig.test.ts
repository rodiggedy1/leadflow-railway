import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { InvoiceError } from "../shared/payableInvoice";
import {
  INVOICE_PRODUCTION_ORIGIN,
  invoiceConfiguration,
  invoiceRuntimeOrigin,
} from "./payableInvoiceConfig";

// TEST ONLY: the entire data path is injected env -> pure configuration result.
// Fail before any real provider or application storage module can initialize.
vi.mock("stripe", () => {
  throw new Error("Configuration must not import a payment provider");
});
vi.mock("mysql2", () => {
  throw new Error("Configuration must not import a database driver");
});
vi.mock("mysql2/promise", () => {
  throw new Error("Configuration must not import a database driver");
});
vi.mock("./db", () => {
  throw new Error("Configuration must not import application storage");
});
vi.mock("./payableInvoiceRepository", () => {
  throw new Error("Configuration must not import an invoice repository");
});
vi.mock("./payableInvoiceRoutes", () => {
  throw new Error("Configuration must not initialize HTTP routes");
});
vi.mock("./payableInvoiceDelivery", () => {
  throw new Error("Configuration must not initialize delivery providers");
});

const PRODUCTION_ORIGIN = "https://quote.maidinblack.com";
const STALE_QUOTE_ORIGIN = "https://maidsquotes-b55s3sg4.manus.space";
const PREVIEW_DOMAIN = "invoice-preview-test.up.railway.app";
const TEST_ONLY_STRIPE_KEY = "sk_test_config_fixture_not_a_real_key";
const TEST_ONLY_TOKEN_SECRET = "test-only-dedicated-invoice-token-secret-2026";
const TEST_ONLY_WEBHOOK_SECRET = "whsec_test_only_dedicated_invoice_fixture";
const TEST_ONLY_LEGACY_JWT = "test-only-legacy-jwt-secret-not-for-invoices-2026";
const TEST_ONLY_GLOBAL_WEBHOOK = "whsec_test_only_global_fixture_not_for_invoices";
const DERIVED_TOKEN_SECRET = createHmac("sha256", TEST_ONLY_STRIPE_KEY)
  .update("leadflow:invoice-token-key:v1").digest("hex");
const REQUIRED_SETTINGS = [
  "STRIPE_SECRET_KEY",
  "INVOICE_TOKEN_SECRET",
  "INVOICE_STRIPE_WEBHOOK_SECRET",
] as const;

function readyEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    QUOTE_APP_URL: STALE_QUOTE_ORIGIN,
    STRIPE_SECRET_KEY: TEST_ONLY_STRIPE_KEY,
    INVOICE_TOKEN_SECRET: TEST_ONLY_TOKEN_SECRET,
    INVOICE_STRIPE_WEBHOOK_SECRET: TEST_ONLY_WEBHOOK_SECRET,
    ...overrides,
  };
}

function missingSetting(missing: string[], name: string): boolean {
  // Reasons may be appended, so do not bind tests to exact diagnostic prose.
  return missing.some(setting => setting.includes(name));
}

function expectSafeDiagnostics(
  config: ReturnType<typeof invoiceConfiguration>,
  env: NodeJS.ProcessEnv,
) {
  expect(typeof config.message).toBe("string");
  const diagnostics = JSON.stringify({ message: config.message, missing: config.missing });
  expect(diagnostics).not.toContain(DERIVED_TOKEN_SECRET);
  for (const name of [
    ...REQUIRED_SETTINGS,
    "JWT_SECRET",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    const value = env[name];
    if (value) expect(diagnostics).not.toContain(value);
  }
}

describe("invoice configuration confirmed production regression", () => {
  it("uses the canonical origin and is ready for the confirmed stale-URL/short-JWT environment without new secrets or mutation", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      QUOTE_APP_URL: STALE_QUOTE_ORIGIN,
      JWT_SECRET: "short-test-only-jwt",
      STRIPE_SECRET_KEY: TEST_ONLY_STRIPE_KEY,
    };
    const before = { ...env };
    const ambientBefore = { ...process.env };
    Object.freeze(env);

    expect(INVOICE_PRODUCTION_ORIGIN).toBe(PRODUCTION_ORIGIN);
    expect(invoiceRuntimeOrigin(env)).toBe(PRODUCTION_ORIGIN);
    const config = invoiceConfiguration(env);
    expect(config.origin).toBe(PRODUCTION_ORIGIN);
    expect(config.paymentsReady).toBe(true);
    expect(config.stripeSecretKey).toBe(TEST_ONLY_STRIPE_KEY);
    expect(config.tokenSecret).toBe(DERIVED_TOKEN_SECRET);
    expect(config.tokenSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(config.webhookSecret).toBe("");
    expect(config.missing).toEqual([]);
    expect(config.message).toBe("");
    expectSafeDiagnostics(config, env);
    expect(env).toEqual(before);
    expect(process.env).toEqual(ambientBefore);
  });

  it("preserves existing dedicated secrets exactly when supplied with the Stripe key", () => {
    const env = readyEnv({
      JWT_SECRET: TEST_ONLY_LEGACY_JWT,
      STRIPE_WEBHOOK_SECRET: TEST_ONLY_GLOBAL_WEBHOOK,
    });
    const before = { ...env };
    Object.freeze(env);
    const config = invoiceConfiguration(env);

    expect(config).toMatchObject({
      origin: PRODUCTION_ORIGIN,
      tokenSecret: TEST_ONLY_TOKEN_SECRET,
      webhookSecret: TEST_ONLY_WEBHOOK_SECRET,
      stripeSecretKey: TEST_ONLY_STRIPE_KEY,
      paymentsReady: true,
      missing: [],
    });
    expectSafeDiagnostics(config, env);
    expect(env).toEqual(before);
  });
});

describe("dedicated invoice payment settings", () => {
  it("never falls back to a sufficiently long legacy JWT or a global webhook secret", () => {
    const env: NodeJS.ProcessEnv = {
      STRIPE_SECRET_KEY: TEST_ONLY_STRIPE_KEY,
      JWT_SECRET: TEST_ONLY_LEGACY_JWT,
      STRIPE_WEBHOOK_SECRET: TEST_ONLY_GLOBAL_WEBHOOK,
    };
    const config = invoiceConfiguration(env);

    expect(config.paymentsReady).toBe(true);
    expect(config.tokenSecret).toBe(DERIVED_TOKEN_SECRET);
    expect(config.tokenSecret).not.toBe(TEST_ONLY_LEGACY_JWT);
    expect(config.webhookSecret).toBe("");
    expect(config.missing).toEqual([]);
    expectSafeDiagnostics(config, env);
  });

  it.each([undefined, ""])("derives a deterministic server-only key for absent or empty token secret: %j", tokenSecret => {
    const env = readyEnv({ INVOICE_TOKEN_SECRET: tokenSecret, JWT_SECRET: TEST_ONLY_LEGACY_JWT });
    const config = invoiceConfiguration(env);
    expect(config.paymentsReady).toBe(true);
    expect(config.tokenSecret).toBe(DERIVED_TOKEN_SECRET);
    expect(invoiceConfiguration(env).tokenSecret).toBe(config.tokenSecret);
    expect(invoiceConfiguration({ ...env, STRIPE_SECRET_KEY: `${TEST_ONLY_STRIPE_KEY}_other` }).tokenSecret)
      .not.toBe(config.tokenSecret);
    expectSafeDiagnostics(config, env);
  });

  it.each(["test-only-short-token", "t".repeat(31)])(
    "rejects a provided too-short dedicated token secret without replacing it: %j",
    tokenSecret => {
      const env = readyEnv({
        INVOICE_TOKEN_SECRET: tokenSecret,
        JWT_SECRET: TEST_ONLY_LEGACY_JWT,
      });
      const config = invoiceConfiguration(env);
      expect(config.paymentsReady).toBe(false);
      expect(missingSetting(config.missing, "INVOICE_TOKEN_SECRET")).toBe(true);
      expect(config.tokenSecret).toBe(tokenSecret);
      expect(config.tokenSecret).not.toBe(TEST_ONLY_LEGACY_JWT);
      expectSafeDiagnostics(config, env);
    },
  );

  it.each([32, 33, 64])("accepts a dedicated token secret of %i characters", length => {
    const secret = "t".repeat(length);
    const config = invoiceConfiguration(readyEnv({ INVOICE_TOKEN_SECRET: secret }));
    expect(config.paymentsReady).toBe(true);
    expect(config.tokenSecret).toBe(secret);
    expect(config.missing).toEqual([]);
  });

  it.each([undefined, ""])("does not require the optional signed-webhook secret for checkout: %j", webhookSecret => {
    const env = readyEnv({
      INVOICE_STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_WEBHOOK_SECRET: TEST_ONLY_GLOBAL_WEBHOOK,
    });
    const config = invoiceConfiguration(env);
    expect(config.paymentsReady).toBe(true);
    expect(config.missing).toEqual([]);
    expect(config.webhookSecret).toBe("");
    expectSafeDiagnostics(config, env);
  });

  it.each([undefined, ""])("requires the reused Stripe secret key: %j", stripeSecretKey => {
    const config = invoiceConfiguration(readyEnv({ STRIPE_SECRET_KEY: stripeSecretKey }));
    expect(config.paymentsReady).toBe(false);
    expect(missingSetting(config.missing, "STRIPE_SECRET_KEY")).toBe(true);
  });

  it("leaves the derived key empty without Stripe and never substitutes JWT", () => {
    const config = invoiceConfiguration({ JWT_SECRET: TEST_ONLY_LEGACY_JWT });
    expect(config.tokenSecret).toBe("");
    expect(config.paymentsReady).toBe(false);
    expect(missingSetting(config.missing, "STRIPE_SECRET_KEY")).toBe(true);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7])(
    "is ready iff Stripe exists with a valid supplied or derived key, regardless of webhook (mask %i)",
    mask => {
      const env: NodeJS.ProcessEnv = {
        JWT_SECRET: TEST_ONLY_LEGACY_JWT,
        STRIPE_WEBHOOK_SECRET: TEST_ONLY_GLOBAL_WEBHOOK,
      };
      const values = [TEST_ONLY_STRIPE_KEY, TEST_ONLY_TOKEN_SECRET, TEST_ONLY_WEBHOOK_SECRET];
      REQUIRED_SETTINGS.forEach((name, index) => {
        if (mask & (1 << index)) env[name] = values[index];
      });
      const before = { ...env };
      Object.freeze(env);
      const config = invoiceConfiguration(env);
      const hasStripe = Boolean(mask & 1);
      const hasDedicatedToken = Boolean(mask & 2);
      expect(config.paymentsReady).toBe(hasStripe);
      expect(missingSetting(config.missing, "STRIPE_SECRET_KEY")).toBe(!hasStripe);
      expect(missingSetting(config.missing, "INVOICE_TOKEN_SECRET")).toBe(!hasStripe && !hasDedicatedToken);
      expect(missingSetting(config.missing, "INVOICE_STRIPE_WEBHOOK_SECRET")).toBe(false);
      expect(config.tokenSecret).toBe(hasDedicatedToken ? TEST_ONLY_TOKEN_SECRET : hasStripe ? DERIVED_TOKEN_SECRET : "");
      expect(config.webhookSecret).toBe(mask & 4 ? TEST_ONLY_WEBHOOK_SECRET : "");
      expect(Boolean(config.message.trim().length)).toBe(!hasStripe);
      expectSafeDiagnostics(config, env);
      expect(env).toEqual(before);
    },
  );
});

describe("invoice runtime origin", () => {
  it("defaults to production for an empty injected environment", () => {
    expect(invoiceRuntimeOrigin({})).toBe(PRODUCTION_ORIGIN);
    expect(invoiceConfiguration({}).origin).toBe(PRODUCTION_ORIGIN);
  });

  it.each([undefined, "false", "TRUE", "1", ""])(
    "ignores stale quote and Railway origins unless preview is explicitly true: %j",
    previewMode => {
      const env = readyEnv({
        PREVIEW_MODE: previewMode,
        RAILWAY_PUBLIC_DOMAIN: PREVIEW_DOMAIN,
      });
      expect(invoiceRuntimeOrigin(env)).toBe(PRODUCTION_ORIGIN);
      expect(invoiceConfiguration(env).origin).toBe(PRODUCTION_ORIGIN);
    },
  );

  it("does not validate or adopt ignored production origin overrides", () => {
    const env = readyEnv({
      QUOTE_APP_URL: "javascript:alert(1)",
      RAILWAY_PUBLIC_DOMAIN: "not a valid domain",
    });
    expect(invoiceRuntimeOrigin(env)).toBe(PRODUCTION_ORIGIN);
    expect(invoiceConfiguration(env).paymentsReady).toBe(true);
  });

  it("uses the Railway public domain as an HTTPS origin only in explicit preview mode", () => {
    const env = readyEnv({ PREVIEW_MODE: "true", RAILWAY_PUBLIC_DOMAIN: PREVIEW_DOMAIN });
    const before = { ...env };
    Object.freeze(env);
    expect(invoiceRuntimeOrigin(env)).toBe(`https://${PREVIEW_DOMAIN}`);
    expect(invoiceConfiguration(env)).toMatchObject({
      origin: `https://${PREVIEW_DOMAIN}`,
      paymentsReady: true,
    });
    expect(env).toEqual(before);
  });

  it.each([undefined, ""])(
    "falls back to canonical production in preview without a Railway domain: %j",
    domain => {
      const env = readyEnv({ PREVIEW_MODE: "true", RAILWAY_PUBLIC_DOMAIN: domain });
      expect(invoiceRuntimeOrigin(env)).toBe(PRODUCTION_ORIGIN);
      expect(invoiceConfiguration(env).origin).toBe(PRODUCTION_ORIGIN);
    },
  );

  it.each([
    "not a valid domain",
    "https://",
    "http://preview.example.test",
    "javascript:alert(1)",
    "file:///tmp/invoice",
    "https://test-only-user:test-only-password@preview.example.test",
    "https://preview.example.test/invoice/unsafe-path",
    "https://preview.example.test?redirect=unsafe",
    "https://preview.example.test#unsafe",
  ])("rejects a malformed or unsafe preview origin with InvoiceError: %s", domain => {
    const env = readyEnv({ PREVIEW_MODE: "true", RAILWAY_PUBLIC_DOMAIN: domain });
    const before = { ...env };
    Object.freeze(env);
    for (const action of [() => invoiceRuntimeOrigin(env), () => invoiceConfiguration(env)]) {
      expect(action).toThrow(InvoiceError);
      try {
        action();
      } catch (error) {
        expect(error).toBeInstanceOf(InvoiceError);
        const message = (error as InvoiceError).message;
        for (const secret of [TEST_ONLY_STRIPE_KEY, TEST_ONLY_TOKEN_SECRET, TEST_ONLY_WEBHOOK_SECRET]) {
          expect(message).not.toContain(secret);
        }
        expect(message).not.toContain("test-only-password");
      }
    }
    expect(env).toEqual(before);
  });
});

describe("configuration helper isolation", () => {
  it("has no runtime provider, database or application bootstrap imports", () => {
    const source = readFileSync(new URL("./payableInvoiceConfig.ts", import.meta.url), "utf8");
    const file = ts.createSourceFile("payableInvoiceConfig.ts", source, ts.ScriptTarget.Latest, true);
    const runtimeImports: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
        const bindings = node.importClause?.namedBindings;
        const onlyTypeSpecifiers = bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0
          && bindings.elements.every(element => element.isTypeOnly)
          && !node.importClause?.name;
        if (!onlyTypeSpecifiers && ts.isStringLiteral(node.moduleSpecifier)) {
          runtimeImports.push(node.moduleSpecifier.text);
        }
      }
      if (ts.isExportDeclaration(node) && !node.isTypeOnly
        && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        runtimeImports.push(node.moduleSpecifier.text);
      }
      if (ts.isCallExpression(node)
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        const argument = node.arguments[0];
        expect(argument && ts.isStringLiteral(argument)).toBe(true);
        if (argument && ts.isStringLiteral(argument)) runtimeImports.push(argument.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    for (const specifier of runtimeImports) {
      expect(specifier).not.toMatch(
        /(?:^|\/)(?:db|stripe|mysql2|drizzle-orm|twilio|axios|express|dotenv|googleapis|_core)(?:$|\/)|payableInvoice(?:Repository|Routes|Delivery)|(?:^|:)https?$|(?:^|:)net$/i,
      );
    }
  });

  it("is inert and deterministic when called repeatedly with frozen synthetic settings", () => {
    const env = readyEnv();
    Object.freeze(env);
    const ambientBefore = { ...process.env };
    const fetchStub = vi.fn(() => { throw new Error("Configuration must not use the network"); });
    const logSpies = ["log", "info", "warn", "error", "debug"].map(method =>
      vi.spyOn(console, method as "log").mockImplementation(() => undefined),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      const first = invoiceConfiguration(env);
      expect(invoiceConfiguration(env)).toEqual(first);
      expect(invoiceRuntimeOrigin(env)).toBe(first.origin);
      expect(fetchStub).not.toHaveBeenCalled();
      for (const spy of logSpies) expect(spy).not.toHaveBeenCalled();
      expect(process.env).toEqual(ambientBefore);
      expectSafeDiagnostics(first, env);
    } finally {
      vi.unstubAllGlobals();
      for (const spy of logSpies) spy.mockRestore();
    }
  });
});
