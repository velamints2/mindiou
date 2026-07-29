// @ts-nocheck
import { describe, expect, it } from "vitest";
import { validateEnv } from "../env-validation.js";

const SECRET_VALUE = "unit-test-secret-value-0123456789abcdef";

describe("validateEnv", () => {
  it("accepts an empty environment with warnings only", () => {
    const result = validateEnv({});
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("flags a non-numeric PORT as an error", () => {
    const result = validateEnv({ PORT: "abc" });
    expect(result.errors.some((line: string) => line.includes("PORT"))).toBe(true);
  });

  it("flags an out-of-range PORT as an error", () => {
    const result = validateEnv({ PORT: "70000" });
    expect(result.errors.some((line: string) => line.includes("1-65535"))).toBe(true);
  });

  it("flags malformed provider URLs as errors", () => {
    const result = validateEnv({ AI_BASE_URL: "ftp://example.com" });
    expect(result.errors.some((line: string) => line.includes("AI_BASE_URL"))).toBe(true);
  });

  it("accepts valid https provider URLs", () => {
    const result = validateEnv({
      AI_BASE_URL: "https://api.deepseek.com",
      AI_API_KEY: SECRET_VALUE
    });
    expect(result.errors).toEqual([]);
  });

  it("requires a 32-byte session secret when early access codes are configured", () => {
    const weak = validateEnv({
      MINDIOU_EARLY_ACCESS_CODES: "alice:code-1",
      MINDIOU_SESSION_SECRET: "short"
    });
    expect(weak.errors.some((line: string) => line.includes("MINDIOU_SESSION_SECRET"))).toBe(true);
    const strong = validateEnv({
      MINDIOU_EARLY_ACCESS_CODES: "alice:code-1",
      MINDIOU_SESSION_SECRET: "a".repeat(32)
    });
    expect(strong.errors).toEqual([]);
  });

  it("warns about demo fallback in production", () => {
    const result = validateEnv({ NODE_ENV: "production", MVP1_DEMO_FALLBACK: "1" });
    expect(result.warnings.some((line: string) => line.includes("MVP1_DEMO_FALLBACK"))).toBe(true);
  });

  it("escalates warnings to errors in strict mode", () => {
    const result = validateEnv({}, { strict: true });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.every((line: string) => line.startsWith("[strict]"))).toBe(true);
  });

  it("never includes secret values in messages", () => {
    const env = {
      MINDIOU_EARLY_ACCESS_CODES: "alice:code-1",
      MINDIOU_SESSION_SECRET: SECRET_VALUE,
      AI_API_KEY: SECRET_VALUE,
      LEARNING_API_TOKEN: SECRET_VALUE
    };
    const result = validateEnv(env, { strict: true });
    const all = [...result.errors, ...result.warnings].join("\n");
    expect(all.includes(SECRET_VALUE)).toBe(false);
    expect(all.includes("code-1")).toBe(false);
  });
});
