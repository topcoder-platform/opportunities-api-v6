import { Controller, Get } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";

import {
  OpportunitySummaryResponseDto,
  SummaryUnavailableResponseDto,
} from "./dto/opportunity-summary.dto";
import { OpportunitiesSummaryService } from "./opportunities-summary.service";

/** Exposes public, cross-domain aggregates for the Opportunities experience. */
@ApiTags("Opportunities")
@Controller()
export class OpportunitiesController {
  /**
   * Creates the controller for the summary aggregation service.
   *
   * @param summaryService Service that performs the four parallel database
   * reads.
   * @throws Does not throw.
   */
  constructor(private readonly summaryService: OpportunitiesSummaryService) {}

  /**
   * Returns the four public opportunity-navigation cell totals in one call.
   *
   * @returns Standard v6 success envelope with timestamped cell summaries.
   * @throws ServiceUnavailableException when any owning database is unavailable.
   */
  @Get("summary")
  @ApiOperation({
    summary: "Get public opportunity totals",
    description:
      "Reads the challenge, engagements, projects, and review databases in parallel. The endpoint fails as a whole instead of returning partial or stale-looking zero cells.",
  })
  @ApiOkResponse({ type: OpportunitySummaryResponseDto })
  @ApiTooManyRequestsResponse({
    description: "Per-client summary request limit exceeded.",
  })
  @ApiServiceUnavailableResponse({ type: SummaryUnavailableResponseDto })
  async getSummary(): Promise<OpportunitySummaryResponseDto> {
    const content = await this.summaryService.getSummary();
    return {
      result: {
        success: true,
        status: 200,
        content,
      },
    };
  }
}
