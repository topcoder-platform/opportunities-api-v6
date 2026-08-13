import {
  loadDatabaseConfiguration,
  OpportunityConfigurationError,
} from "./database.config";

describe("loadDatabaseConfiguration", () => {
  const validEnvironment: NodeJS.ProcessEnv = {
    CHALLENGE_DATABASE_URL:
      "postgresql://challenge:secret@challenge-db:5432/challenge?schema=public",
    ENGAGEMENTS_DATABASE_URL:
      "postgresql://engagements:secret@engagements-db:5432/engagements",
    PROJECTS_DATABASE_URL:
      "postgres://projects:secret@projects-db:5432/projects",
    REVIEW_DATABASE_URL:
      "postgresql://review:secret@review-db:5432/review?schema=review",
  };

  it("returns trimmed, validated PostgreSQL connection URLs", () => {
    const configuration = loadDatabaseConfiguration({
      ...validEnvironment,
      CHALLENGE_DATABASE_URL: ` ${validEnvironment.CHALLENGE_DATABASE_URL} `,
    });

    expect(configuration).toEqual({
      challengeDatabaseUrl: validEnvironment.CHALLENGE_DATABASE_URL,
      engagementsDatabaseUrl: validEnvironment.ENGAGEMENTS_DATABASE_URL,
      projectsDatabaseUrl: validEnvironment.PROJECTS_DATABASE_URL,
      reviewDatabaseUrl: validEnvironment.REVIEW_DATABASE_URL,
    });
  });

  it("rejects every missing or malformed URL without leaking credentials", () => {
    const environment = {
      ...validEnvironment,
      CHALLENGE_DATABASE_URL: "mysql://challenge:do-not-log@host/database",
      ENGAGEMENTS_DATABASE_URL: "",
      PROJECTS_DATABASE_URL: "not-a-url-with-password=do-not-log",
    };

    expect(() => loadDatabaseConfiguration(environment)).toThrow(
      OpportunityConfigurationError,
    );

    try {
      loadDatabaseConfiguration(environment);
      throw new Error("Expected configuration validation to fail");
    } catch (error) {
      expect(error).toHaveProperty(
        "message",
        "Invalid Opportunities API database configuration: CHALLENGE_DATABASE_URL, ENGAGEMENTS_DATABASE_URL, PROJECTS_DATABASE_URL",
      );
      expect(String(error)).not.toContain("do-not-log");
    }
  });

  it("requires a hostname and database name", () => {
    expect(() =>
      loadDatabaseConfiguration({
        ...validEnvironment,
        REVIEW_DATABASE_URL: "postgresql://review:secret@review-db",
      }),
    ).toThrow(
      "Invalid Opportunities API database configuration: REVIEW_DATABASE_URL",
    );
  });
});
