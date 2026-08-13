import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import * as dotenv from "dotenv";

import { AppModule } from "./app.module";

/**
 * Starts the Opportunities API with validation, CORS, and OpenAPI documentation.
 *
 * @returns A promise that resolves after the HTTP server starts listening.
 * @throws Propagates Nest application creation and listen failures.
 */
async function bootstrap(): Promise<void> {
  dotenv.config();

  const app = await NestFactory.create(AppModule);
  const prefix = process.env.API_PREFIX ?? "v6/opportunities";

  app.enableCors();
  app.enableShutdownHooks();
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Topcoder Opportunities API v6")
    .setDescription(
      "Aggregated summary data for the Topcoder Opportunities experience.",
    )
    .setVersion("0.1")
    .build();
  SwaggerModule.setup(
    "docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(Number(process.env.PORT ?? 3000));
}

void bootstrap();
