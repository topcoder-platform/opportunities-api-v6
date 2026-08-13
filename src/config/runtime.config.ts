/** Defaults used to bound summary load and database-client shutdown. */
export const RUNTIME_DEFAULTS = {
  databaseDisconnectTimeoutMs: 5000,
  summaryCacheTtlMs: 15000,
  summaryJoinRowLimit: 10000,
  summaryRateLimit: 60,
  summaryRateTtlMs: 60000,
} as const;

/** Validated non-secret process settings used by the API at runtime. */
export interface RuntimeConfiguration {
  databaseDisconnectTimeoutMs: number;
  summaryCacheTtlMs: number;
  summaryJoinRowLimit: number;
  summaryRateLimit: number;
  summaryRateTtlMs: number;
}

/**
 * Parses a positive integer environment setting with a stable default.
 *
 * @param value Optional process environment value.
 * @param fallback Value used when the setting is absent.
 * @param name Environment variable name used in validation errors.
 * @returns A positive safe integer.
 * @throws TypeError when a provided value is not a positive safe integer.
 */
function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return parsed;
}

/**
 * Loads bounded cache, throttling, and disconnect settings from the environment.
 *
 * @param environment Process-like environment map to validate.
 * @returns Validated runtime settings with documented defaults.
 * @throws TypeError when a provided setting is not a positive safe integer.
 */
export function loadRuntimeConfiguration(
  environment: NodeJS.ProcessEnv,
): RuntimeConfiguration {
  return {
    databaseDisconnectTimeoutMs: parsePositiveInteger(
      environment.DATABASE_DISCONNECT_TIMEOUT_MS,
      RUNTIME_DEFAULTS.databaseDisconnectTimeoutMs,
      "DATABASE_DISCONNECT_TIMEOUT_MS",
    ),
    summaryCacheTtlMs: parsePositiveInteger(
      environment.SUMMARY_CACHE_TTL_MS,
      RUNTIME_DEFAULTS.summaryCacheTtlMs,
      "SUMMARY_CACHE_TTL_MS",
    ),
    summaryJoinRowLimit: parsePositiveInteger(
      environment.SUMMARY_JOIN_ROW_LIMIT,
      RUNTIME_DEFAULTS.summaryJoinRowLimit,
      "SUMMARY_JOIN_ROW_LIMIT",
    ),
    summaryRateLimit: parsePositiveInteger(
      environment.SUMMARY_RATE_LIMIT,
      RUNTIME_DEFAULTS.summaryRateLimit,
      "SUMMARY_RATE_LIMIT",
    ),
    summaryRateTtlMs: parsePositiveInteger(
      environment.SUMMARY_RATE_TTL_MS,
      RUNTIME_DEFAULTS.summaryRateTtlMs,
      "SUMMARY_RATE_TTL_MS",
    ),
  };
}
