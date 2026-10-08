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
});
