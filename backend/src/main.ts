import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { applicationEnvironment } from './config/environment.js';

async function bootstrap(): Promise<void> {
  const { host, port } = applicationEnvironment(process.env);
  let app: INestApplication | undefined;
  try {
    // Let bootstrap own failures; Nest must not log raw provider/driver errors.
    app = await NestFactory.create(AppModule, { abortOnError: false, logger: false });
    app.enableShutdownHooks();
    await app.init();
    await app.listen(port, host);
    console.log('Backend listening');
  } catch {
    try {
      await app?.close();
    } catch {
      // Cleanup was attempted; keep driver details out of startup output.
    }
    throw new Error('Backend initialization failed');
  }
}

bootstrap().catch(() => {
  console.error('Backend startup failed');
  process.exitCode = 1;
});
