/** Names of the owning-database connection variables required by this API. */
export const DATABASE_ENVIRONMENT_VARIABLES = [
  "CHALLENGE_DATABASE_URL",
  "ENGAGEMENTS_DATABASE_URL",
  "PROJECTS_DATABASE_URL",
  "REVIEW_DATABASE_URL",
] as const;

type DatabaseEnvironmentVariable =
  (typeof DATABASE_ENVIRONMENT_VARIABLES)[number];

/** Validated connection strings used to construct the four Prisma clients. */
export interface DatabaseConfiguration {
  challengeDatabaseUrl: string;
  engagementsDatabaseUrl: string;
  projectsDatabaseUrl: string;
  reviewDatabaseUrl: string;
}

/**
 * Reports invalid startup configuration without including credential values.
 *
 * The Nest provider factory raises this error before the HTTP server binds, so
 * an incorrectly configured instance cannot serve misleading zero summaries.
 */
export class OpportunityConfigurationError extends Error {
  /**
   * Creates a safe startup error for invalid database environment variables.
   *
   * @param invalidVariables Environment-variable names that are absent or are
   * not valid PostgreSQL URLs.
   * @throws Does not throw beyond constructing this error instance.
   */
  constructor(invalidVariables: readonly DatabaseEnvironmentVariable[]) {
    super(
      `Invalid Opportunities API database configuration: ${invalidVariables.join(", ")}`,
    );
    this.name = OpportunityConfigurationError.name;
  }
}

/**
 * Determines whether a value is a supported PostgreSQL connection URL.
 *
 * @param value Candidate environment value after trimming.
 * @returns True for a parseable postgres/postgresql URL with a host and
 * database path.
 * @throws Does not throw; malformed URL parsing is converted to false.
 */
function isPostgresConnectionUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      Boolean(parsed.hostname) &&
      parsed.pathname.length > 1
    );
  } catch {
    return false;
  }
}

/**
 * Loads and validates all owning-database URLs used by the aggregator.
 *
 * This function is called once by the root Nest module. Values are trimmed,
 * but credentials are never copied into validation messages or logs.
 *
 * @param environment Process-like environment map to validate.
 * @returns Validated connection strings for all four Prisma factories.
 * @throws OpportunityConfigurationError when any required value is missing or
 * is not a PostgreSQL URL containing a host and database name.
 */
export function loadDatabaseConfiguration(
  environment: NodeJS.ProcessEnv,
): DatabaseConfiguration {
  const values = Object.fromEntries(
    DATABASE_ENVIRONMENT_VARIABLES.map((name) => [
      name,
      environment[name]?.trim() ?? "",
    ]),
  ) as Record<DatabaseEnvironmentVariable, string>;
  const invalidVariables = DATABASE_ENVIRONMENT_VARIABLES.filter(
    (name) => !isPostgresConnectionUrl(values[name]),
  );

  if (invalidVariables.length > 0) {
    throw new OpportunityConfigurationError(invalidVariables);
  }

  return {
    challengeDatabaseUrl: values.CHALLENGE_DATABASE_URL,
    engagementsDatabaseUrl: values.ENGAGEMENTS_DATABASE_URL,
    projectsDatabaseUrl: values.PROJECTS_DATABASE_URL,
    reviewDatabaseUrl: values.REVIEW_DATABASE_URL,
  };
}
