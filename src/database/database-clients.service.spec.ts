import { Logger } from "@nestjs/common";

import { DatabaseConfiguration } from "./database.config";
import { RuntimeConfiguration } from "../config/runtime.config";
import {
  DatabaseClientFactories,
  DatabaseClientsService,
} from "./database-clients.service";

describe("DatabaseClientsService", () => {
  const configuration: DatabaseConfiguration = {
    challengeDatabaseUrl: "postgresql://u:p@challenge:5432/db",
    engagementsDatabaseUrl: "postgresql://u:p@engagements:5432/db",
    projectsDatabaseUrl: "postgresql://u:p@projects:5432/db",
    reviewDatabaseUrl: "postgresql://u:p@review:5432/db",
  };
  const runtimeConfiguration: RuntimeConfiguration = {
    databaseConnectTimeoutMs: 2000,
    databaseDisconnectTimeoutMs: 50,
    databaseQueryTimeoutMs: 4000,
    summaryCacheTtlMs: 15000,
    summaryJoinRowLimit: 10000,
    summaryRateLimit: 60,
    summaryRateTtlMs: 60000,
    summaryTimeoutMs: 12000,
  };
  const driverFactoryOptions = {
    driverOptions: {
      connectionTimeoutMillis: 2000,
      query_timeout: 4000,
      statement_timeout: 4000,
    },
  };

  it("constructs each external client once with its owning URL", () => {
    const clients = [
      { $disconnect: jest.fn() },
      { $disconnect: jest.fn() },
      { $disconnect: jest.fn() },
      { $disconnect: jest.fn() },
    ];
    const factoryMocks = {
      createChallengeClient: jest.fn().mockReturnValue(clients[0]),
      createEngagementsClient: jest.fn().mockReturnValue(clients[1]),
      createProjectsClient: jest.fn().mockReturnValue(clients[2]),
      createReviewClient: jest.fn().mockReturnValue(clients[3]),
    };

    const service = new DatabaseClientsService(
      configuration,
      factoryMocks,
      runtimeConfiguration,
    );

    expect(factoryMocks.createChallengeClient).toHaveBeenCalledWith(
      configuration.challengeDatabaseUrl,
      driverFactoryOptions,
    );
    expect(factoryMocks.createEngagementsClient).toHaveBeenCalledWith(
      configuration.engagementsDatabaseUrl,
      driverFactoryOptions,
    );
    expect(factoryMocks.createProjectsClient).toHaveBeenCalledWith(
      configuration.projectsDatabaseUrl,
      driverFactoryOptions,
    );
    expect(factoryMocks.createReviewClient).toHaveBeenCalledWith(
      "postgresql://u:p@review:5432/db?connect_timeout=2&pool_timeout=2&socket_timeout=4",
    );
    expect(service.challenge).toBe(clients[0]);
    expect(service.engagements).toBe(clients[1]);
    expect(service.projects).toBe(clients[2]);
    expect(service.review).toBe(clients[3]);
  });

  it("preserves review URL settings while enforcing Prisma 6 timeouts", () => {
    const clients = [
      { $disconnect: jest.fn() },
      { $disconnect: jest.fn() },
      { $disconnect: jest.fn() },
      { $disconnect: jest.fn() },
    ];
    const factories = {
      createChallengeClient: jest.fn().mockReturnValue(clients[0]),
      createEngagementsClient: jest.fn().mockReturnValue(clients[1]),
      createProjectsClient: jest.fn().mockReturnValue(clients[2]),
      createReviewClient: jest.fn().mockReturnValue(clients[3]),
    };

    new DatabaseClientsService(
      {
        ...configuration,
        reviewDatabaseUrl:
          "postgresql://u:p@review:5432/db?schema=review&sslmode=require&connect_timeout=99",
      },
      factories,
      runtimeConfiguration,
    );

    expect(factories.createReviewClient).toHaveBeenCalledWith(
      "postgresql://u:p@review:5432/db?schema=review&sslmode=require&connect_timeout=2&pool_timeout=2&socket_timeout=4",
    );
  });

  it("attempts every disconnect and resolves when one client rejects", async () => {
    const disconnects = [
      jest.fn().mockResolvedValue(undefined),
      jest.fn(() => {
        throw new Error("credential-like-detail");
      }),
      jest.fn().mockResolvedValue(undefined),
      jest.fn().mockResolvedValue(undefined),
    ];
    const clients = disconnects.map(($disconnect) => ({ $disconnect }));
    const factories = {
      createChallengeClient: () => clients[0],
      createEngagementsClient: () => clients[1],
      createProjectsClient: () => clients[2],
      createReviewClient: () => clients[3],
    } as unknown as DatabaseClientFactories;
    const logger = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const service = new DatabaseClientsService(
      configuration,
      factories,
      runtimeConfiguration,
    );

    await expect(
      service.onApplicationShutdown("SIGTERM"),
    ).resolves.toBeUndefined();
    disconnects.forEach((disconnect) =>
      expect(disconnect).toHaveBeenCalledTimes(1),
    );
    expect(logger).toHaveBeenCalledWith(
      "Failed to disconnect engagements database client during SIGTERM (Error)",
    );
    expect(logger).not.toHaveBeenCalledWith(
      expect.stringContaining("credential-like-detail"),
    );
    logger.mockRestore();
  });

  it("rolls back previously created clients when a later factory fails", async () => {
    const challengeDisconnect = jest.fn().mockResolvedValue(undefined);
    const engagementsDisconnect = jest.fn().mockResolvedValue(undefined);
    const startupError = new Error("projects factory failed");
    const createReviewClient = jest.fn();
    const factories = {
      createChallengeClient: () => ({ $disconnect: challengeDisconnect }),
      createEngagementsClient: () => ({ $disconnect: engagementsDisconnect }),
      createProjectsClient: () => {
        throw startupError;
      },
      createReviewClient,
    } as unknown as DatabaseClientFactories;

    expect(
      () =>
        new DatabaseClientsService(
          configuration,
          factories,
          runtimeConfiguration,
        ),
    ).toThrow(startupError);
    await Promise.resolve();
    await Promise.resolve();

    expect(challengeDisconnect).toHaveBeenCalledTimes(1);
    expect(engagementsDisconnect).toHaveBeenCalledTimes(1);
    expect(createReviewClient).not.toHaveBeenCalled();
  });

  it("bounds shutdown when a client disconnect never settles", async () => {
    jest.useFakeTimers();
    const neverSettles = new Promise<void>(() => undefined);
    const clients = [
      { $disconnect: jest.fn().mockReturnValue(neverSettles) },
      { $disconnect: jest.fn().mockResolvedValue(undefined) },
      { $disconnect: jest.fn().mockResolvedValue(undefined) },
      { $disconnect: jest.fn().mockResolvedValue(undefined) },
    ];
    const factories = {
      createChallengeClient: () => clients[0],
      createEngagementsClient: () => clients[1],
      createProjectsClient: () => clients[2],
      createReviewClient: () => clients[3],
    } as unknown as DatabaseClientFactories;
    const logger = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const service = new DatabaseClientsService(configuration, factories, {
      ...runtimeConfiguration,
      databaseDisconnectTimeoutMs: 25,
    });
    const shutdown = service.onApplicationShutdown("SIGTERM");

    await jest.advanceTimersByTimeAsync(25);
    await expect(shutdown).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledWith(
      "Failed to disconnect challenge database client during SIGTERM (Error)",
    );
    jest.useRealTimers();
  });
});
