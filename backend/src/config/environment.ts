export type Environment = Readonly<Record<string, string | undefined>>;

export function databaseUrl(
  environment: Environment,
  name: 'DATABASE_URL' | 'MIGRATION_DATABASE_URL' = 'DATABASE_URL',
): string {
  const value = environment[name];
  const invalid = () => new Error(`${name} must be a valid PostgreSQL URL`);
  if (!value || value.trim() !== value || /\s/.test(value)) throw invalid();
  try {
    const url = new URL(value);
    // WHATWG URL preserves malformed escapes; pg decodes these components later.
    if (/%(?![0-9a-f]{2})/i.test(value)) throw invalid();
    for (const component of [url.username, url.password, url.hostname, url.pathname, url.search]) {
      if (decodeURIComponent(component).includes('\0')) throw invalid();
    }
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname || !url.username || url.pathname.length <= 1 ||
      url.hash || (url.port && Number(url.port) === 0)
    ) throw invalid();
  } catch {
    throw invalid();
  }
  return value;
}

export function applicationEnvironment(environment: Environment) {
  const host = environment.HOST ?? '127.0.0.1';
  const rawPort = environment.PORT ?? '3000';
  const port = Number(rawPort);
  if (!host.trim()) throw new Error('HOST must not be empty');
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return { host, port, databaseUrl: databaseUrl(environment) };
}
