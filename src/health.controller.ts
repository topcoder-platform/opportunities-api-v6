import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";

export interface HealthResponse {
  status: "ok";
}

/** Provides the process-level health check used by deployment probes. */
@ApiTags("Health")
@Controller("health")
@SkipThrottle({ summary: true })
export class HealthController {
  /**
   * Reports that the HTTP process is accepting requests.
   *
   * @returns A stable healthy status object.
   * @throws Does not throw.
   */
  @Get()
  @ApiOperation({ summary: "Check process health" })
  @ApiOkResponse({ schema: { example: { status: "ok" } } })
  getHealth(): HealthResponse {
    return { status: "ok" };
  }
}
