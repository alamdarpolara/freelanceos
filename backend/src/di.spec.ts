import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

@Injectable()
class DependencyProvider {
  getStatus(): string {
    return 'dependency resolved';
  }
}

@Injectable()
class ConsumerProvider {
  constructor(readonly dependency: DependencyProvider) {}

  getStatus(): string {
    return this.dependency.getStatus();
  }
}

@Module({
  providers: [DependencyProvider, ConsumerProvider],
})
class DependencyInjectionModule {}

describe('Nest constructor metadata', () => {
  it('resolves constructor injection through a real module without explicit tokens', async () => {
    const parameterTypes: unknown = Reflect.getMetadata(
      'design:paramtypes',
      ConsumerProvider,
    );
    expect(parameterTypes).toEqual([DependencyProvider]);

    const testingModule = await Test.createTestingModule({
      imports: [DependencyInjectionModule],
    }).compile();

    try {
      await testingModule.init();
      const consumer = testingModule.get(ConsumerProvider);
      const dependency = testingModule.get(DependencyProvider);

      expect(consumer.dependency).toBe(dependency);
      expect(consumer.getStatus()).toBe('dependency resolved');
    } finally {
      await testingModule.close();
    }
  });
});
