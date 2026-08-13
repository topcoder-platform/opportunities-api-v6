import {
  createChallengePrismaClient,
  type PrismaClient as ChallengePrismaClient,
} from "@topcoder/challenge-api-v6";
import {
  createEngagementsPrismaClient,
  type PrismaClient as EngagementsPrismaClient,
} from "@topcoder/engagements-api-v6";
import {
  createProjectsPrismaClient,
  type PrismaClient as ProjectsPrismaClient,
} from "@topcoder/projects-api-v6";
import {
  createReviewPrismaClient,
  type PrismaClient as ReviewPrismaClient,
} from "@topcoder/review-api-v6-prisma-client";
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
} from "@nestjs/common";

import { RuntimeConfiguration } from "../config/runtime.config";
import { DatabaseConfiguration } from "./database.config";

/** Injection token for validated owning-database connection configuration. */
export const DATABASE_CONFIGURATION = Symbol("DATABASE_CONFIGURATION");

/** Injection token that makes the four external factories testable. */
export const DATABASE_CLIENT_FACTORIES = Symbol("DATABASE_CLIENT_FACTORIES");

/** Injection token for validated cache, throttle, and shutdown settings. */
export const RUNTIME_CONFIGURATION = Symbol("RUNTIME_CONFIGURATION");

/** Factory contract supplied by the owning API Prisma packages. */
export interface DatabaseClientFactories {
  /** Creates a caller-owned client for the Challenge API database. */
  createChallengeClient(connectionString: string): ChallengePrismaClient;

  /** Creates a caller-owned client for the Engagements API database. */
  createEngagementsClient(connectionString: string): EngagementsPrismaClient;

  /** Creates a caller-owned client for the Projects API database. */
  createProjectsClient(connectionString: string): ProjectsPrismaClient;

  /** Creates a caller-owned client for the Review API database. */
  createReviewClient(connectionString: string): ReviewPrismaClient;
}

interface DisconnectableClient {
  $disconnect(): Promise<void>;
}

/**
 * Resolves a promise or rejects after a bounded interval.
 *
 * @param promise Operation that must not block shutdown indefinitely.
 * @param timeoutMs Maximum duration in milliseconds.
 * @returns The original promise result when it settles in time.
 * @throws Error when the timeout expires first, or the original rejection.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Database disconnect timed out.")),
      timeoutMs,
    );
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(
          error instanceof Error ? error : new Error("Disconnect failed."),
        );
      },
    );
  });
}

/**
 * Best-effort cleanup used when construction fails after earlier clients exist.
 *
 * @param clients Clients successfully created before a later factory failed.
 * @param timeoutMs Per-client cleanup deadline in milliseconds.
 * @returns Nothing; cleanup runs in the background because constructors cannot
 * await asynchronous disposal.
 * @throws Does not throw or leak rejection state.
 */
function rollbackConstructedClients(
  clients: readonly DisconnectableClient[],
  timeoutMs: number,
): void {
  void Promise.allSettled(
    clients.map((client) =>
      withTimeout(
        Promise.resolve().then(() => client.$disconnect()),
        timeoutMs,
      ),
    ),
  );
}

/** Production factory implementations exported by the four owning APIs. */
export const defaultDatabaseClientFactories: DatabaseClientFactories = {
  createChallengeClient: createChallengePrismaClient,
  createEngagementsClient: createEngagementsPrismaClient,
  createProjectsClient: createProjectsPrismaClient,
  createReviewClient: createReviewPrismaClient,
};

/**
 * Owns the process-wide Prisma clients used for read-only aggregation.
 *
 * Each generated client is created once and connects lazily on its first query.
 * Nest shutdown hooks invoke this service so every connection pool is closed.
 */
@Injectable()
export class DatabaseClientsService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseClientsService.name);

  readonly challenge: ChallengePrismaClient;
  readonly engagements: EngagementsPrismaClient;
  readonly projects: ProjectsPrismaClient;
  readonly review: ReviewPrismaClient;

  /**
   * Creates one caller-owned client for each domain database.
   *
   * @param configuration Validated database connection strings.
   * @param factories Stable factories exported by the owning API packages.
   * @param runtimeConfiguration Validated disconnect timeout and runtime
   * settings shared by the process.
   * @throws Propagates client-factory configuration errors during application
   * startup.
   */
  constructor(
    @Inject(DATABASE_CONFIGURATION)
    configuration: DatabaseConfiguration,
    @Inject(DATABASE_CLIENT_FACTORIES)
    factories: DatabaseClientFactories,
    @Inject(RUNTIME_CONFIGURATION)
    private readonly runtimeConfiguration: RuntimeConfiguration,
  ) {
    const constructedClients: DisconnectableClient[] = [];
    try {
      this.challenge = factories.createChallengeClient(
        configuration.challengeDatabaseUrl,
      );
      constructedClients.push(this.challenge);
      this.engagements = factories.createEngagementsClient(
        configuration.engagementsDatabaseUrl,
      );
      constructedClients.push(this.engagements);
      this.projects = factories.createProjectsClient(
        configuration.projectsDatabaseUrl,
      );
      constructedClients.push(this.projects);
      this.review = factories.createReviewClient(
        configuration.reviewDatabaseUrl,
      );
    } catch (error) {
      rollbackConstructedClients(
        constructedClients,
        runtimeConfiguration.databaseDisconnectTimeoutMs,
      );
      throw error;
    }
  }

  /**
   * Closes every owning-database connection pool in parallel during shutdown.
   *
   * A failure from one client is logged without preventing the remaining
   * clients from disconnecting or blocking process shutdown indefinitely.
   *
   * @param signal Optional process signal supplied by Nest.
   * @returns A promise that settles after every disconnect attempt completes.
   * @throws Does not throw; individual disconnect errors are logged safely.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    const clients = [
      {
        disconnect: (): Promise<void> => this.challenge.$disconnect(),
        name: "challenge",
      },
      {
        disconnect: (): Promise<void> => this.engagements.$disconnect(),
        name: "engagements",
      },
      {
        disconnect: (): Promise<void> => this.projects.$disconnect(),
        name: "projects",
      },
      {
        disconnect: (): Promise<void> => this.review.$disconnect(),
        name: "review",
      },
    ];
    const results = await Promise.allSettled(
      clients.map((client) =>
        withTimeout(
          Promise.resolve().then(client.disconnect),
          this.runtimeConfiguration.databaseDisconnectTimeoutMs,
        ),
      ),
    );

    results.forEach((result, index) => {
      if (result.status === "rejected") {
        const errorType =
          result.reason instanceof Error ? result.reason.name : "UnknownError";
        this.logger.error(
          `Failed to disconnect ${clients[index].name} database client during ${signal ?? "application shutdown"} (${errorType})`,
        );
      }
    });
  }
}
