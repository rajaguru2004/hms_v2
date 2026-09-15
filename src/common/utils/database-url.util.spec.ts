import {
  assertLocalDatabaseUrl,
  assertTruncatableDatabaseUrl,
  describeDatabaseUrl,
  isLocalDatabaseUrl,
} from './database-url.util';

/**
 * The guard that stands between a routine command and the production database.
 *
 * These are not tests of a formatting helper. `assertLocalDatabaseUrl` is what
 * `PrismaService.onModuleInit` and every seed script call before they touch
 * anything, and the tracked `.env` in this repository points at a live
 * production host. A regression here is silent — a wrong answer looks exactly
 * like a right one until somebody reads the data back.
 *
 * So the case that matters most is the negative one: `140.245.10.145` must stay
 * refused, no matter what else we teach this helper to accept.
 */

const PRODUCTION_URL =
  'postgresql://db_user:db_password@140.245.10.145:5432/hms_v2_prod?schema=public';

describe('describeDatabaseUrl', () => {
  it('splits a URL into the parts a human recognises, without the password', () => {
    const target = describeDatabaseUrl(PRODUCTION_URL);

    expect(target.host).toBe('140.245.10.145');
    expect(target.port).toBe('5432');
    expect(target.database).toBe('hms_v2_prod');
    expect(target.label).toBe('140.245.10.145:5432/hms_v2_prod');
    // This string reaches logs and error messages. A guard that leaks the
    // credential it was protecting has traded one incident for another.
    expect(target.label).not.toContain('db_password');
  });

  it('defaults a missing port rather than reporting an empty one', () => {
    expect(
      describeDatabaseUrl('postgresql://u:p@localhost/hms_v2_dev').port,
    ).toBe('5432');
  });

  it('answers instead of throwing for junk, because callers are logging', () => {
    expect(describeDatabaseUrl('not a url at all').label).toBe(
      'unparseable-url',
    );
    expect(describeDatabaseUrl(undefined).label).toBe('unset');
    // Unparseable is emphatically not local: failing open here would make a
    // malformed URL the easiest way past the guard.
    expect(describeDatabaseUrl('not a url at all').isLocal).toBe(false);
    expect(describeDatabaseUrl(undefined).isLocal).toBe(false);
  });
});

describe('isLocalDatabaseUrl — what counts as local', () => {
  it.each([
    ['localhost', 'postgresql://u:p@localhost:5432/hms_v2_dev'],
    ['the loopback address', 'postgresql://u:p@127.0.0.1:5432/hms_v2_dev'],
    ['the IPv6 loopback', 'postgresql://u:p@[::1]:5432/hms_v2_dev'],
  ])('accepts %s', (_label, url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  /**
   * The compose case. Inside the demo network the API's DATABASE_URL names a
   * service, not an address — `postgres` there is as local as `localhost` is
   * outside it, and the only alternative was ALLOW_REMOTE_DB=1, which would
   * have disabled the guard against the *production* host at the same time.
   */
  it.each([
    ['the conventional service name', 'postgres'],
    ['the short alias', 'db'],
    ['a container name nobody added to a list', 'hms_v2_postgres_demo'],
    ['a hyphenated service name', 'demo-postgres'],
    ['the docker host gateway', 'host.docker.internal'],
  ])('accepts %s (%s)', (_label, host) => {
    expect(isLocalDatabaseUrl(`postgresql://u:p@${host}:5432/hms_v2_dev`)).toBe(
      true,
    );
  });

  /**
   * The whole point. Everything below is reachable from off the machine, and
   * the first entry is the host this repository's tracked `.env` actually
   * contains.
   */
  it.each([
    ['the production host in the tracked .env', '140.245.10.145'],
    ['a public FQDN', 'hms.skillhiveinnovations.com'],
    [
      'a name that merely starts with a local-looking label',
      'postgres.example.com',
    ],
    ['an RFC1918 address on another box', '192.168.1.50'],
    ['an IPv6 literal', '[2606:4700:4700::1111]'],
    ['an integer-form IPv4 address', '3232235777'],
  ])('refuses %s (%s)', (_label, host) => {
    expect(
      isLocalDatabaseUrl(`postgresql://u:p@${host}:5432/hms_v2_prod`),
    ).toBe(false);
  });
});

describe('assertLocalDatabaseUrl', () => {
  const originalAllowRemote = process.env.ALLOW_REMOTE_DB;

  afterEach(() => {
    if (originalAllowRemote === undefined) {
      delete process.env.ALLOW_REMOTE_DB;
    } else {
      process.env.ALLOW_REMOTE_DB = originalAllowRemote;
    }
  });

  it('lets a compose service name through', () => {
    delete process.env.ALLOW_REMOTE_DB;

    const target = assertLocalDatabaseUrl(
      'postgresql://db_user:db_password@postgres:5432/hms_v2_dev?schema=public',
      { operation: 'the API server' },
    );

    expect(target.label).toBe('postgres:5432/hms_v2_dev');
    expect(target.isLocal).toBe(true);
  });

  it('throws on the production host, and names it in the message', () => {
    delete process.env.ALLOW_REMOTE_DB;

    expect(() => assertLocalDatabaseUrl(PRODUCTION_URL)).toThrow(
      /140\.245\.10\.145/,
    );
    // The message has to say what to do next, not only that it refused.
    expect(() => assertLocalDatabaseUrl(PRODUCTION_URL)).toThrow(
      /\.env\.local/,
    );
  });

  it('throws when DATABASE_URL is unset, rather than connecting to a default', () => {
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(
      /DATABASE_URL is not set/,
    );
  });

  it('honours ALLOW_REMOTE_DB=1 and tells the caller it did', () => {
    process.env.ALLOW_REMOTE_DB = '1';
    const onBypass = jest.fn();

    const target = assertLocalDatabaseUrl(PRODUCTION_URL, { onBypass });

    expect(target.host).toBe('140.245.10.145');
    expect(onBypass).toHaveBeenCalledWith(
      expect.objectContaining({ host: '140.245.10.145' }),
    );
  });

  it('ignores ALLOW_REMOTE_DB when the caller refuses the override', () => {
    process.env.ALLOW_REMOTE_DB = '1';

    // Truncation takes this path: no environment variable should be able to
    // arm a TRUNCATE against a remote host.
    expect(() =>
      assertLocalDatabaseUrl(PRODUCTION_URL, { allowRemote: false }),
    ).toThrow(/Refusing/);
  });
});

describe('assertTruncatableDatabaseUrl', () => {
  const originalAllowRemote = process.env.ALLOW_REMOTE_DB;

  afterEach(() => {
    if (originalAllowRemote === undefined) {
      delete process.env.ALLOW_REMOTE_DB;
    } else {
      process.env.ALLOW_REMOTE_DB = originalAllowRemote;
    }
  });

  it('accepts a local database whose name ends in _test', () => {
    expect(
      assertTruncatableDatabaseUrl(
        'postgresql://u:p@localhost:5433/hms_v2_test',
      ).database,
    ).toBe('hms_v2_test');
  });

  /**
   * The incident this check was written for: `.env.local` and `.env.test` are
   * both local, so "is it local" passed and the suite truncated the
   * development database. The name is the only thing that separates them.
   */
  it('refuses the development database even though it is local', () => {
    expect(() =>
      assertTruncatableDatabaseUrl(
        'postgresql://u:p@localhost:5432/hms_v2_dev',
      ),
    ).toThrow(/does not end in `_test`/);
  });

  it('refuses a compose service name pointing at a non-test database', () => {
    expect(() =>
      assertTruncatableDatabaseUrl('postgresql://u:p@postgres:5432/hms_v2_dev'),
    ).toThrow(/does not end in `_test`/);
  });

  it('cannot be unlocked with ALLOW_REMOTE_DB', () => {
    process.env.ALLOW_REMOTE_DB = '1';

    expect(() => assertTruncatableDatabaseUrl(PRODUCTION_URL)).toThrow(
      /Refusing/,
    );
  });
});
