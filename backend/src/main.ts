import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const host = process.env.HOST ?? '127.0.0.1';
  const rawPort = process.env.PORT ?? '3000';
  const port = Number(rawPort);

  if (!host.trim()) {
    throw new Error('HOST must not be empty');
  }
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(port, host);
}

bootstrap().catch((error: unknown) => {
  console.error('Backend startup failed:', error);
  process.exitCode = 1;
});
