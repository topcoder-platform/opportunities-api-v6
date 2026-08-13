import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';

/** Root module for the Opportunities API process. */
@Module({
  controllers: [HealthController],
})
export class AppModule {}
