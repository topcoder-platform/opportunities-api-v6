import { ServiceUnavailableException } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import request from "supertest";
import type { Server } from "node:http";

import { configureTrustProxy } from "../config/trust-proxy.config";
import { HealthController } from "../health.controller";
import { OpportunitiesController } from "./opportunities.controller";
import { OpportunitiesSummaryService } from "./opportunities-summary.service";

describe("Opportunities HTTP contract", () => {
  let application: NestExpressApplication;
  const summary = {
    cells: {
      competitions: { amount: 38500, count: 12 },
      engagements: { count: 8 },
      copilots: { count: 2 },
      reviews: { count: 3 },
    },
    generatedAt: "2026-08-13T01:23:45.678Z",
  };
  const summaryService = {
    getSummary: jest.fn(),
  };

  /**
   * Returns the typed HTTP server consumed by Supertest.
   *
   * @returns Initialized Nest HTTP server.
   * @throws Propagates Nest adapter errors if the server is unavailable.
   */
  function getHttpServer(): Server {
    return application.getHttpAdapter().getHttpServer() as Server;
  }

  /**
   * Reads property names from a generated OpenAPI schema without unsafe casts.
   *
   * @param schema Swagger schema value that may be absent or a reference.
   * @returns Declared object property names, or an empty array.
   * @throws Does not throw for malformed or missing schema values.
   */
  function getSchemaPropertyNames(schema: unknown): string[] {
    if (!schema || typeof schema !== "object" || !("properties" in schema)) {
      return [];
    }
    const properties = schema.properties;
    return properties && typeof properties === "object"
      ? Object.keys(properties)
      : [];
  }

  beforeEach(async () => {
    summaryService.getSummary.mockReset().mockResolvedValue(summary);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ limit: 2, name: "summary", ttl: 60000 }]),
      ],
      controllers: [HealthController, OpportunitiesController],
      providers: [
        { provide: OpportunitiesSummaryService, useValue: summaryService },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();

    application =
      moduleFixture.createNestApplication<NestExpressApplication>();
    configureTrustProxy(application, 1);
    application.setGlobalPrefix("v6/opportunities");
    await application.init();
  });

  afterEach(async () => {
    await application.close();
  });

  it("serves the prefixed summary route with the exact serialized contract", async () => {
    await request(getHttpServer())
      .get("/v6/opportunities/summary")
      .expect(200)
      .expect({
        result: { success: true, status: 200, content: summary },
      });
  });

  it("serializes a safe 503 without leaking an owning database error", async () => {
    summaryService.getSummary.mockRejectedValueOnce(
      new ServiceUnavailableException(
        "Opportunity summary is temporarily unavailable.",
      ),
    );

    const response = await request(getHttpServer())
      .get("/v6/opportunities/summary")
      .expect(503);

    expect(response.body).toEqual({
      error: "Service Unavailable",
      message: "Opportunity summary is temporarily unavailable.",
      statusCode: 503,
    });
    expect(JSON.stringify(response.body)).not.toContain("postgresql://");
  });

  it("rate limits summary calls but never throttles the health probe", async () => {
    await request(getHttpServer()).get("/v6/opportunities/summary").expect(200);
    await request(getHttpServer()).get("/v6/opportunities/summary").expect(200);
    const throttled = await request(getHttpServer())
      .get("/v6/opportunities/summary")
      .expect(429);
    expect(throttled.body).toMatchObject({ statusCode: 429 });

    for (let requestNumber = 0; requestNumber < 3; requestNumber += 1) {
      await request(getHttpServer())
        .get("/v6/opportunities/health")
        .expect(200)
        .expect({ status: "ok" });
    }
  });

  it("keeps throttling keys separate for clients behind the trusted edge", async () => {
    const firstClient = "198.51.100.10";
    const secondClient = "198.51.100.11";

    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      await request(getHttpServer())
        .get("/v6/opportunities/summary")
        .set("X-Forwarded-For", firstClient)
        .expect(200);
      await request(getHttpServer())
        .get("/v6/opportunities/summary")
        .set("X-Forwarded-For", secondClient)
        .expect(200);
    }

    await request(getHttpServer())
      .get("/v6/opportunities/summary")
      .set("X-Forwarded-For", firstClient)
      .expect(429);
  });

  it("publishes the summary 200, 429, and 503 schemas in OpenAPI", () => {
    const document = SwaggerModule.createDocument(
      application,
      new DocumentBuilder().setTitle("Opportunities API").build(),
    );
    const operation = document.paths["/v6/opportunities/summary"]?.get;

    expect(operation?.responses).toHaveProperty("200");
    expect(operation?.responses).toHaveProperty("429");
    expect(operation?.responses).toHaveProperty("503");
    expect(
      getSchemaPropertyNames(
        document.components?.schemas?.EngagementSummaryDto,
      ),
    ).toEqual(["count"]);
    expect(
      getSchemaPropertyNames(document.components?.schemas?.CopilotSummaryDto),
    ).toEqual(["count"]);
  });
});
