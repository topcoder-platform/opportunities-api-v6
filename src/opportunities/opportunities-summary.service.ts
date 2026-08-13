import {
  ChallengeStatusEnum,
  type Prisma as ChallengePrisma,
} from "@topcoder/challenge-api-v6";
import { EngagementStatus } from "@topcoder/engagements-api-v6";
import { CopilotOpportunityStatus } from "@topcoder/projects-api-v6";
import { ReviewOpportunityStatus } from "@topcoder/review-api-v6-prisma-client";
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  DatabaseClientsService,
  RUNTIME_CONFIGURATION,
} from "../database/database-clients.service";
import { RuntimeConfiguration } from "../config/runtime.config";
import { OpportunitySummaryContentDto } from "./dto/opportunity-summary.dto";

const PUBLIC_CHALLENGE_WHERE = {
  groups: { isEmpty: true },
  status: ChallengeStatusEnum.ACTIVE,
  taskIsTask: false,
  userWhitelist: { none: {} },
} satisfies ChallengePrisma.ChallengeWhereInput;

/**
 * Normalizes an aggregate USD value and rounds it to cents.
 *
 * @param value Nullable aggregate read from the owning challenge schema.
 * @returns A finite non-negative USD total.
 * @throws Does not throw; malformed values are excluded from the total.
 */
function normalizeUsdAmount(value: number | null): number {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Aggregates the four public Opportunities header cells from owning databases.
 *
 * The service intentionally reads only lightweight fields and runs all four
 * domain queries concurrently. It does not call or reproduce domain HTTP APIs.
 */
@Injectable()
export class OpportunitiesSummaryService {
  private readonly logger = new Logger(OpportunitiesSummaryService.name);
  private cachedSummary?: {
    expiresAt: number;
    value: OpportunitySummaryContentDto;
  };
  private pendingSummary?: Promise<OpportunitySummaryContentDto>;

  /**
   * Creates the summary service around process-owned database clients.
   *
   * @param databases Four Prisma clients managed by DatabaseClientsService.
   * @param runtimeConfiguration Validated cache and join-bound settings.
   * @throws Does not throw.
   */
  constructor(
    private readonly databases: DatabaseClientsService,
    @Inject(RUNTIME_CONFIGURATION)
    private readonly runtimeConfiguration: RuntimeConfiguration,
  ) {}

  /**
   * Loads counts for all opportunity kinds and supported monetary totals.
   * Successful values are cached for the configured short TTL, while
   * concurrent misses share the same in-flight aggregation.
   *
   * Competitions are ACTIVE, non-task challenges with no group or whitelist
   * restriction. Engagements are public OPEN records. Copilot opportunities
   * are active and not soft-deleted. Reviews are OPEN records whose challenge
   * is also among the public ACTIVE competition set. Engagement compensation
   * and copilot request payment text are deliberately not parsed as money.
   *
   * @returns Timestamped four-cell payload for the standard API envelope.
   * @throws ServiceUnavailableException when any owning database read fails;
   * partial totals are never returned.
   */
  async getSummary(): Promise<OpportunitySummaryContentDto> {
    const now = Date.now();
    if (this.cachedSummary && this.cachedSummary.expiresAt > now) {
      return this.cachedSummary.value;
    }
    if (this.pendingSummary) {
      return this.pendingSummary;
    }

    const pendingSummary = this.loadSummary();
    this.pendingSummary = pendingSummary;
    try {
      const value = await pendingSummary;
      this.cachedSummary = {
        expiresAt: Date.now() + this.runtimeConfiguration.summaryCacheTtlMs,
        value,
      };
      return value;
    } finally {
      if (this.pendingSummary === pendingSummary) {
        this.pendingSummary = undefined;
      }
    }
  }

  /**
   * Performs one uncached parallel aggregation across the four owning schemas.
   *
   * @returns Fresh timestamped four-cell content.
   * @throws ServiceUnavailableException when any owning query fails.
   */
  private async loadSummary(): Promise<OpportunitySummaryContentDto> {
    try {
      const [
        competitionCount,
        prizeAggregate,
        engagementCount,
        copilotCount,
        openReviews,
      ] = await Promise.all([
        this.databases.challenge.challenge.count({
          where: PUBLIC_CHALLENGE_WHERE,
        }),
        this.databases.challenge.challenge.aggregate({
          where: {
            ...PUBLIC_CHALLENGE_WHERE,
            overviewTotalPrizes: { gte: 0 },
          },
          _sum: { overviewTotalPrizes: true },
        }),
        this.databases.engagements.engagement.count({
          where: {
            isPrivate: false,
            status: EngagementStatus.OPEN,
          },
        }),
        this.databases.projects.copilotOpportunity.count({
          where: {
            deletedAt: null,
            status: CopilotOpportunityStatus.active,
          },
        }),
        this.databases.review.reviewOpportunity.findMany({
          where: { status: ReviewOpportunityStatus.OPEN },
          orderBy: { id: "asc" },
          select: { challengeId: true, id: true },
          take: this.runtimeConfiguration.summaryJoinRowLimit + 1,
        }),
      ]);

      if (openReviews.length > this.runtimeConfiguration.summaryJoinRowLimit) {
        throw new Error("ReviewOpportunityJoinLimitExceeded");
      }
      const reviewChallengeIds = [
        ...new Set(openReviews.map((opportunity) => opportunity.challengeId)),
      ];
      const publicReviewChallenges = reviewChallengeIds.length
        ? await this.databases.challenge.challenge.findMany({
            where: {
              ...PUBLIC_CHALLENGE_WHERE,
              id: { in: reviewChallengeIds },
            },
            select: { id: true },
          })
        : [];
      const publicChallengeIds = new Set(
        publicReviewChallenges.map((challenge) => challenge.id),
      );
      const reviewCount = openReviews.reduce(
        (count, opportunity) =>
          count + (publicChallengeIds.has(opportunity.challengeId) ? 1 : 0),
        0,
      );

      return {
        cells: {
          competitions: {
            amount: normalizeUsdAmount(prizeAggregate._sum.overviewTotalPrizes),
            count: competitionCount,
          },
          engagements: { count: engagementCount },
          copilots: { count: copilotCount },
          reviews: { count: reviewCount },
        },
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorType = error instanceof Error ? error.name : "UnknownError";
      this.logger.error(
        `Unable to aggregate opportunity summary (${errorType})`,
      );
      throw new ServiceUnavailableException(
        "Opportunity summary is temporarily unavailable.",
      );
    }
  }
}
