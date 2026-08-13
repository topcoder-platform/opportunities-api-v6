import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import {
  ThrottlerGuard,
  ThrottlerModule,
  type ThrottlerModuleOptions,
} from "@nestjs/throttler";

import {
  loadRuntimeConfiguration,
  type RuntimeConfiguration,
} from "./config/runtime.config";
import {
  DATABASE_CLIENT_FACTORIES,
  DATABASE_CONFIGURATION,
  DatabaseClientsService,
  RUNTIME_CONFIGURATION,
  defaultDatabaseClientFactories,
} from "./database/database-clients.service";
import { HealthController } from "./health.controller";
import {
  DatabaseConfiguration,
  loadDatabaseConfiguration,
} from "./database/database.config";
import { OpportunitiesController } from "./opportunities/opportunities.controller";
import { OpportunitiesSummaryService } from "./opportunities/opportunities-summary.service";

/** Root module for the Opportunities API process. */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: (): ThrottlerModuleOptions => {
        const configuration = loadRuntimeConfiguration(process.env);
        return [
          {
            limit: configuration.summaryRateLimit,
            name: "summary",
            ttl: configuration.summaryRateTtlMs,
          },
        ];
      },
    }),
  ],
  controllers: [HealthController, OpportunitiesController],
  providers: [
    {
      provide: DATABASE_CONFIGURATION,
      useFactory: (): DatabaseConfiguration =>
        loadDatabaseConfiguration(process.env),
    },
    {
      provide: DATABASE_CLIENT_FACTORIES,
      useValue: defaultDatabaseClientFactories,
    },
    {
      provide: RUNTIME_CONFIGURATION,
      useFactory: (): RuntimeConfiguration =>
        loadRuntimeConfiguration(process.env),
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    DatabaseClientsService,
    OpportunitiesSummaryService,
  ],
})
export class AppModule {}
