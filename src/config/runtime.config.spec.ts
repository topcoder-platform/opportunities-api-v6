import { loadRuntimeConfiguration, RUNTIME_DEFAULTS } from "./runtime.config";

describe("loadRuntimeConfiguration", () => {
  it("uses documented defaults when settings are absent", () => {
    expect(loadRuntimeConfiguration({})).toEqual({
      databaseDisconnectTimeoutMs: RUNTIME_DEFAULTS.databaseDisconnectTimeoutMs,
      summaryCacheTtlMs: RUNTIME_DEFAULTS.summaryCacheTtlMs,
      summaryJoinRowLimit: RUNTIME_DEFAULTS.summaryJoinRowLimit,
      summaryRateLimit: RUNTIME_DEFAULTS.summaryRateLimit,
      summaryRateTtlMs: RUNTIME_DEFAULTS.summaryRateTtlMs,
    });
  });

  it("parses explicit positive integer settings", () => {
    expect(
      loadRuntimeConfiguration({
        DATABASE_DISCONNECT_TIMEOUT_MS: "2500",
        SUMMARY_CACHE_TTL_MS: "10000",
        SUMMARY_JOIN_ROW_LIMIT: "5000",
        SUMMARY_RATE_LIMIT: "30",
        SUMMARY_RATE_TTL_MS: "45000",
      }),
    ).toEqual({
      databaseDisconnectTimeoutMs: 2500,
      summaryCacheTtlMs: 10000,
      summaryJoinRowLimit: 5000,
      summaryRateLimit: 30,
      summaryRateTtlMs: 45000,
    });
  });

  it.each(["0", "-1", "1.5", "not-a-number"])(
    "rejects an invalid value of %s",
    (value) => {
      expect(() =>
        loadRuntimeConfiguration({ SUMMARY_CACHE_TTL_MS: value }),
      ).toThrow("SUMMARY_CACHE_TTL_MS must be a positive integer.");
    },
  );
});
