import { ApiProperty } from "@nestjs/swagger";

/** Headline count shared by every opportunity cell. */
export class CountSummaryDto {
  @ApiProperty({ example: 12, minimum: 0 })
  count!: number;
}

/** Public active-competition count and available USD prize total. */
export class CompetitionSummaryDto extends CountSummaryDto {
  @ApiProperty({ description: "Available prize total in USD.", example: 38500 })
  amount!: number;
}

/** Public open-engagement count. */
export class EngagementSummaryDto extends CountSummaryDto {}

/** Active copilot-opportunity count. */
export class CopilotSummaryDto extends CountSummaryDto {}

/** Open review opportunities attached to public active challenges. */
export class ReviewSummaryDto extends CountSummaryDto {}

/** The four navigation-cell summaries consumed by platform-ui. */
export class OpportunitySummaryCellsDto {
  @ApiProperty({ type: () => CompetitionSummaryDto })
  competitions!: CompetitionSummaryDto;

  @ApiProperty({ type: () => EngagementSummaryDto })
  engagements!: EngagementSummaryDto;

  @ApiProperty({ type: () => CopilotSummaryDto })
  copilots!: CopilotSummaryDto;

  @ApiProperty({ type: () => ReviewSummaryDto })
  reviews!: ReviewSummaryDto;
}

/** Timestamped summary payload returned inside the standard response envelope. */
export class OpportunitySummaryContentDto {
  @ApiProperty({ type: () => OpportunitySummaryCellsDto })
  cells!: OpportunitySummaryCellsDto;

  @ApiProperty({
    description: "UTC time at which all four database reads had completed.",
    example: "2026-08-13T01:23:45.678Z",
    format: "date-time",
  })
  generatedAt!: string;
}

/** Standard successful Topcoder v6 result wrapper. */
export class OpportunitySummaryResultDto {
  @ApiProperty({ example: true })
  success!: true;

  @ApiProperty({ example: 200 })
  status!: 200;

  @ApiProperty({ type: () => OpportunitySummaryContentDto })
  content!: OpportunitySummaryContentDto;
}

/** HTTP response contract for GET /v6/opportunities/summary. */
export class OpportunitySummaryResponseDto {
  @ApiProperty({ type: () => OpportunitySummaryResultDto })
  result!: OpportunitySummaryResultDto;
}

/** Safe error body returned when any owning database cannot be queried. */
export class SummaryUnavailableResponseDto {
  @ApiProperty({ example: 503 })
  statusCode!: number;

  @ApiProperty({ example: "Opportunity summary is temporarily unavailable." })
  message!: string;

  @ApiProperty({ example: "Service Unavailable" })
  error!: string;
}
