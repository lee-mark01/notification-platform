import { Environment, validate } from './env.validation';

describe('validate (environment variables)', () => {
  const valid = {
    NODE_ENV: 'test',
    PORT: '3000',
    DB_HOST: 'localhost',
    DB_PORT: '3307',
    DB_DATABASE: 'notification',
    DB_USERNAME: 'app',
    DB_PASSWORD: 'secret',
    REDIS_HOST: 'localhost',
    REDIS_PORT: '6379',
  };

  it('converts numeric strings to numbers', () => {
    const config = validate(valid);

    expect(config.NODE_ENV).toBe(Environment.Test);
    expect(config.PORT).toBe(3000);
    expect(config.DB_PORT).toBe(3307);
    expect(config.REDIS_PORT).toBe(6379);
  });

  it('applies defaults for NODE_ENV and PORT', () => {
    const { NODE_ENV: _env, PORT: _port, ...rest } = valid;

    const config = validate(rest);

    expect(config.NODE_ENV).toBe(Environment.Development);
    expect(config.PORT).toBe(3000);
  });

  it('fails and names the variable when a required one is missing', () => {
    const { DB_HOST: _host, ...rest } = valid;

    expect(() => validate(rest)).toThrow(/DB_HOST/);
  });

  it('fails when a port is not a number', () => {
    expect(() => validate({ ...valid, REDIS_PORT: 'abc' })).toThrow(
      /REDIS_PORT/,
    );
  });

  it('fails when NODE_ENV is not a known environment', () => {
    expect(() => validate({ ...valid, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  describe('SWAGGER_ENABLED', () => {
    it('defaults to false when unset', () => {
      expect(validate(valid).SWAGGER_ENABLED).toBe(false);
    });

    it.each([
      ['true', true],
      ['false', false],
    ])('parses "%s" as %s', (raw, expected) => {
      expect(validate({ ...valid, SWAGGER_ENABLED: raw }).SWAGGER_ENABLED).toBe(
        expected,
      );
    });

    it('fails on values other than true or false', () => {
      expect(() => validate({ ...valid, SWAGGER_ENABLED: 'yes' })).toThrow(
        /SWAGGER_ENABLED/,
      );
    });
  });
  describe('workers and providers', () => {
    it('runs workers with fake providers by default', () => {
      const config = validate(valid);

      expect(config.WORKERS_ENABLED).toBe(true);
      expect(config.EMAIL_PROVIDER).toBe('fake');
      expect(config.PUSH_PROVIDER).toBe('fake');
      expect(config.FAKE_PROVIDER_LATENCY_MS).toBe(0);
    });

    it('turns workers off with WORKERS_ENABLED=false', () => {
      expect(
        validate({ ...valid, WORKERS_ENABLED: 'false' }).WORKERS_ENABLED,
      ).toBe(false);
    });

    it('fails on an unknown provider', () => {
      expect(() => validate({ ...valid, EMAIL_PROVIDER: 'smtp' })).toThrow(
        /EMAIL_PROVIDER/,
      );
    });
  });
});
