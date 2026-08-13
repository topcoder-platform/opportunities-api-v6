import { ChallengeStatusEnum } from "@topcoder/challenge-api-v6";
import { EngagementStatus } from "@topcoder/engagements-api-v6";
import { CopilotOpportunityStatus } from "@topcoder/projects-api-v6";
import { ReviewOpportunityStatus } from "@topcoder/review-api-v6-prisma-client";
import { Logger, ServiceUnavailableException } from "@nestjs/common";

import { DatabaseClientsService } from "../database/database-clients.service";
import { OpportunitiesSummaryService } from "./opportunities-summary.service";

const runtimeConfiguration = {
  databaseConnectTimeoutMs: 5000,
  databaseDisconnectTimeoutMs: 5000,
  databaseQueryTimeoutMs: 5000,
  summaryCacheTtlMs: 15000,
  summaryJoinRowLimit: 10000,
  summaryRateLimit: 60,
  summaryRateTtlMs: 60000,
  summaryTimeoutMs: 12000,
  trustProxyHops: 1,
};

const publicChallengeWhere = {
  groups: { isEmpty: true },
  status: ChallengeStatusEnum.ACTIVE,
  taskIsTask: false,
  userWhitelist: { none: {} },
};

describe("OpportunitiesSummaryService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("dispatches the owning reads in parallel and returns supported totals", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T01:23:45.678Z"));

    let resolveCompetitionCount!: (value: number) => void;
    let resolvePrizeAggregate!: (value: unknown) => void;
    let resolveEngagements!: (value: number) => void;
    let resolveCopilots!: (value: number) => void;
    let resolveReviews!: (value: unknown) => void;
    const challengeCount = jest.fn().mockReturnValue(
      new Promise<number>((resolve) => {
        resolveCompetitionCount = resolve;
      }),
    );
    const challengeAggregate = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolvePrizeAggregate = resolve;
      }),
    );
    const challengeFindMany = jest
      .fn()
      .mockResolvedValue([{ id: "public-1" }, { id: "public-2" }]);
    const engagementCount = jest.fn().mockReturnValue(
      new Promise<number>((resolve) => {
        resolveEngagements = resolve;
      }),
    );
    const copilotCount = jest.fn().mockReturnValue(
      new Promise<number>((resolve) => {
        resolveCopilots = resolve;
      }),
    );
    const reviewFindMany = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveReviews = resolve;
      }),
    );
    const databases = {
      challenge: {
        challenge: {
          aggregate: challengeAggregate,
          count: challengeCount,
          findMany: challengeFindMany,
        },
      },
      engagements: { engagement: { count: engagementCount } },
      projects: { copilotOpportunity: { count: copilotCount } },
      review: { reviewOpportunity: { findMany: reviewFindMany } },
    } as unknown as DatabaseClientsService;
    const summaryPromise = new OpportunitiesSummaryService(
      databases,
      runtimeConfiguration,
    ).getSummary();

    expect(challengeCount).toHaveBeenCalledTimes(1);
    expect(challengeAggregate).toHaveBeenCalledTimes(1);
    expect(engagementCount).toHaveBeenCalledTimes(1);
    expect(copilotCount).toHaveBeenCalledTimes(1);
    expect(reviewFindMany).toHaveBeenCalledTimes(1);
    expect(challengeFindMany).not.toHaveBeenCalled();

    resolveCompetitionCount(5);
    resolvePrizeAggregate({ _sum: { overviewTotalPrizes: 125.005 } });
    resolveEngagements(8);
    resolveCopilots(2);
    resolveReviews([
      { challengeId: "public-1", id: "review-1" },
      { challengeId: "restricted-challenge", id: "review-2" },
      { challengeId: "public-2", id: "review-3" },
    ]);

    await expect(summaryPromise).resolves.toEqual({
      cells: {
        competitions: { amount: 125.01, count: 5 },
        engagements: { count: 8 },
        copilots: { count: 2 },
        reviews: { count: 2 },
      },
      generatedAt: "2026-08-13T01:23:45.678Z",
    });
    expect(challengeCount).toHaveBeenCalledWith({
      where: publicChallengeWhere,
    });
    expect(challengeAggregate).toHaveBeenCalledWith({
      where: {
        ...publicChallengeWhere,
        overviewTotalPrizes: { gte: 0 },
      },
      _sum: { overviewTotalPrizes: true },
    });
    expect(engagementCount).toHaveBeenCalledWith({
      where: { isPrivate: false, status: EngagementStatus.OPEN },
    });
    expect(copilotCount).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        status: CopilotOpportunityStatus.active,
      },
    });
    expect(reviewFindMany).toHaveBeenCalledWith({
      where: { status: ReviewOpportunityStatus.OPEN },
      orderBy: { id: "asc" },
      select: { challengeId: true, id: true },
      take: 10001,
    });
    expect(challengeFindMany).toHaveBeenCalledWith({
      where: {
        ...publicChallengeWhere,
        id: {
          in: ["public-1", "restricted-challenge", "public-2"],
        },
      },
      select: { id: true },
    });
  });

  it("returns a safe 503 instead of partial totals when a query fails", async () => {
    const databaseError = new Error(
      "postgresql://user:secret@internal-host/db",
    );
    const logger = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const databases = {
      challenge: {
        challenge: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { overviewTotalPrizes: 0 } }),
          count: jest.fn().mockRejectedValue(databaseError),
        },
      },
      engagements: {
        engagement: { count: jest.fn().mockResolvedValue(8) },
      },
      projects: {
        copilotOpportunity: { count: jest.fn().mockResolvedValue(2) },
      },
      review: {
        reviewOpportunity: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as unknown as DatabaseClientsService;

    await expect(
      new OpportunitiesSummaryService(
        databases,
        runtimeConfiguration,
      ).getSummary(),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        "Opportunity summary is temporarily unavailable.",
      ),
    );
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger).not.toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  it("shares concurrent misses and serves the result until its TTL expires", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T01:00:00.000Z"));
    let resolveCompetitionCount!: (value: number) => void;
    const challengeCount = jest
      .fn()
      .mockReturnValueOnce(
        new Promise<number>((resolve) => {
          resolveCompetitionCount = resolve;
        }),
      )
      .mockResolvedValueOnce(0);
    const databases = {
      challenge: {
        challenge: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { overviewTotalPrizes: null } }),
          count: challengeCount,
        },
      },
      engagements: { engagement: { count: jest.fn().mockResolvedValue(1) } },
      projects: {
        copilotOpportunity: { count: jest.fn().mockResolvedValue(2) },
      },
      review: {
        reviewOpportunity: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as unknown as DatabaseClientsService;
    const service = new OpportunitiesSummaryService(databases, {
      ...runtimeConfiguration,
      summaryCacheTtlMs: 100,
    });

    const first = service.getSummary();
    const concurrent = service.getSummary();
    expect(challengeCount).toHaveBeenCalledTimes(1);
    resolveCompetitionCount(0);
    expect(await concurrent).toBe(await first);

    await service.getSummary();
    expect(challengeCount).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date("2026-08-13T01:00:00.101Z"));
    await service.getSummary();
    expect(challengeCount).toHaveBeenCalledTimes(2);
  });

  it("fails safely when the bounded review visibility join is exceeded", async () => {
    jest.spyOn(Logger.prototype, "error").mockImplementation();
    const challengeFindMany = jest.fn();
    const databases = {
      challenge: {
        challenge: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { overviewTotalPrizes: 0 } }),
          count: jest.fn().mockResolvedValue(1),
          findMany: challengeFindMany,
        },
      },
      engagements: { engagement: { count: jest.fn().mockResolvedValue(1) } },
      projects: {
        copilotOpportunity: { count: jest.fn().mockResolvedValue(1) },
      },
      review: {
        reviewOpportunity: {
          findMany: jest.fn().mockResolvedValue([
            { challengeId: "challenge-1", id: "review-1" },
            { challengeId: "challenge-2", id: "review-2" },
          ]),
        },
      },
    } as unknown as DatabaseClientsService;

    await expect(
      new OpportunitiesSummaryService(databases, {
        ...runtimeConfiguration,
        summaryJoinRowLimit: 1,
      }).getSummary(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(challengeFindMany).not.toHaveBeenCalled();
  });

  it("returns 503 on deadline and releases the pending cache slot for retry", async () => {
    jest.useFakeTimers();
    const logger = jest.spyOn(Logger.prototype, "error").mockImplementation();
    const neverSettles = new Promise<number>(() => undefined);
    const challengeCount = jest
      .fn()
      .mockReturnValueOnce(neverSettles)
      .mockResolvedValueOnce(4);
    const databases = {
      challenge: {
        challenge: {
          aggregate: jest
            .fn()
            .mockResolvedValue({ _sum: { overviewTotalPrizes: 500 } }),
          count: challengeCount,
        },
      },
      engagements: { engagement: { count: jest.fn().mockResolvedValue(3) } },
      projects: {
        copilotOpportunity: { count: jest.fn().mockResolvedValue(2) },
      },
      review: {
        reviewOpportunity: { findMany: jest.fn().mockResolvedValue([]) },
      },
    } as unknown as DatabaseClientsService;
    const service = new OpportunitiesSummaryService(databases, {
      ...runtimeConfiguration,
      summaryTimeoutMs: 25,
    });

    const timedOut = expect(service.getSummary()).rejects.toEqual(
      new ServiceUnavailableException(
        "Opportunity summary is temporarily unavailable.",
      ),
    );
    await jest.advanceTimersByTimeAsync(25);
    await timedOut;

    await expect(service.getSummary()).resolves.toMatchObject({
      cells: {
        competitions: { amount: 500, count: 4 },
        engagements: { count: 3 },
        copilots: { count: 2 },
        reviews: { count: 0 },
      },
    });
    expect(challengeCount).toHaveBeenCalledTimes(2);
    expect(logger).toHaveBeenCalledWith(
      "Unable to aggregate opportunity summary (SummaryDeadlineExceededError)",
    );
  });
});
