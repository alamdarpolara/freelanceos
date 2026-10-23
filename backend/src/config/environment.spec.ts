import { describe, expect, it } from 'vitest';
import { applicationEnvironment, databaseUrl } from './environment.js';

const url = 'postgresql://runtime:fake_password@localhost:5432/example';

describe('environment validation', () => {
  it.each([undefined, '', ' ', 'https://user:secret@host/db', 'postgresql://host/db',
    'postgresql://user:secret@host/', 'postgresql://user:secret@host:0/db',
    'postgresql://user:secret@host:99999/db', `${url}#fragment`, `${url} `,
    'postgresql://runtime:%@localhost/example',
    'postgresql://runtime:%2@localhost/example',
    'postgresql://runtime:%GG@localhost/example',
    'postgresql://runtime:%AB@localhost/example',
    'postgresql://runtime:fake@localhost/example%AB',
    'postgresql://runtime:fake@localhost/example%00'])(
    'rejects missing or malformed URLs without echoing their values (case %#)', (value) => {
      expect(() => databaseUrl({ DATABASE_URL: value })).toThrow(
        'DATABASE_URL must be a valid PostgreSQL URL',
      );
    },
  );

  it('accepts both PostgreSQL schemes and encoded credentials', () => {
    expect(databaseUrl({ DATABASE_URL: url })).toBe(url);
    const encoded = 'postgres://runtime:fake%40password@localhost/example';
    expect(databaseUrl({ DATABASE_URL: encoded })).toBe(encoded);
    const percent = 'postgresql://runtime:fake%25password@localhost/example';
    expect(databaseUrl({ DATABASE_URL: percent })).toBe(percent);
  });

  it('keeps migration credentials separate with no runtime fallback', () => {
    expect(() => databaseUrl({ DATABASE_URL: url }, 'MIGRATION_DATABASE_URL'))
      .toThrow('MIGRATION_DATABASE_URL must be a valid PostgreSQL URL');
    expect(databaseUrl({ MIGRATION_DATABASE_URL: url }, 'MIGRATION_DATABASE_URL')).toBe(url);
    expect(applicationEnvironment({ DATABASE_URL: url, MIGRATION_DATABASE_URL: 'invalid' }))
      .toEqual({ host: '127.0.0.1', port: 3000, databaseUrl: url });
  });

  it.each(['', ' ', '0', '65536', '1.5', 'abc', '-1'])(
    'preserves port validation (case %#)', (PORT) => {
      expect(() => applicationEnvironment({ DATABASE_URL: url, PORT }))
        .toThrow('PORT must be an integer between 1 and 65535');
    },
  );

  it('preserves host validation and valid port boundaries', () => {
    expect(() => applicationEnvironment({ DATABASE_URL: url, HOST: ' ' }))
      .toThrow('HOST must not be empty');
    for (const PORT of ['1', '65535']) {
      expect(applicationEnvironment({ DATABASE_URL: url, HOST: '0.0.0.0', PORT }).port)
        .toBe(Number(PORT));
    }
  });
});
