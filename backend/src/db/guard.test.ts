import { Client } from "pg";
import { parse } from "pg-connection-string";
import { describe, expect, it } from "vitest";
import { assertSafeToDestroy, LEGACY_LOCAL_DATABASES } from "./guard.js";

const NEON_POOLED =
  "postgresql://neondb_owner:npg_S3cretPw@ep-cool-name-a1b2c3-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require";
const NEON_DIRECT =
  "postgresql://neondb_owner:npg_S3cretPw@ep-cool-name-a1b2c3.us-east-1.aws.neon.tech/neondb?sslmode=require";

function local(database: string, host = "localhost:5433"): string {
  return `postgres://ch_fuel:ch_fuel@${host}/${database}`;
}

describe("assertSafeToDestroy — accepts a local dev, test or real database", () => {
  it.each(["ch_fuel_dev", "ch_fuel_test", "ch_fuel_real"])("%s on localhost, 127.0.0.1 and [::1]", (db) => {
    for (const host of ["localhost:5433", "127.0.0.1:5433", "[::1]:5433", "LOCALHOST:5433"]) {
      expect(() => assertSafeToDestroy(local(db, host), {})).not.toThrow();
    }
  });

  it.each(["development", "test", "real"])("under APP_ENV=%s", (appEnv) => {
    expect(() => assertSafeToDestroy(local("ch_fuel_test"), { APP_ENV: appEnv })).not.toThrow();
  });

  it("[::1] is accepted as the real parser and pg's own Client report it", () => {
    // No mock. pg-connection-string 2.14.0 kept the brackets and 2.14.1 strips
    // them, so the guard must not depend on either form — check both the
    // parser's answer and the host pg's Client would actually connect to.
    const url = local("ch_fuel_dev", "[::1]:5433");
    expect(["::1", "[::1]"]).toContain(parse(url).host);
    expect(new Client(url).host).toBe("::1");
    expect(() => assertSafeToDestroy(url, {})).not.toThrow();
    expect(() => assertSafeToDestroy(url.replace("[::1]", "[::2]"), {})).toThrow(/not a local host/);
  });

  it("accepts the search_path option the integration tests append", () => {
    const url = `${local("ch_fuel_test")}?options=${encodeURIComponent("-c search_path=test_x_1,public")}`;
    expect(() => assertSafeToDestroy(url, { APP_ENV: "test" })).not.toThrow();
  });

  // Temporary, until T-100: local dev and CI still run on ch_fuel_planner.
  // T-100 deletes LEGACY_LOCAL_DATABASES and flips this test to expect a rejection.
  it("accepts ch_fuel_planner on localhost (temporary, until T-100)", () => {
    expect(LEGACY_LOCAL_DATABASES).toEqual(["ch_fuel_planner"]);
    expect(() => assertSafeToDestroy(local("ch_fuel_planner"), {})).not.toThrow();
  });
});

describe("assertSafeToDestroy — rejects", () => {
  it.each(["production", "preview"])("APP_ENV=%s, even with a local URL", (appEnv) => {
    expect(() => assertSafeToDestroy(local("ch_fuel_dev"), { APP_ENV: appEnv })).toThrow(/APP_ENV/);
  });

  it("an unknown APP_ENV", () => {
    expect(() => assertSafeToDestroy(local("ch_fuel_dev"), { APP_ENV: "prod" })).toThrow(/APP_ENV/);
  });

  it.each([
    ["pooled", NEON_POOLED],
    ["direct", NEON_DIRECT],
  ])("a Neon %s URL", (_kind, url) => {
    expect(() => assertSafeToDestroy(url, {})).toThrow(/not a local host/);
  });

  it.each(["db.example.com:5432", "10.0.0.5:5432", "localhost.example.com:5433", "127.0.0.2:5433"])(
    "a remote host (%s)",
    (host) => {
      expect(() => assertSafeToDestroy(local("ch_fuel_dev", host), {})).toThrow(/not a local host/);
    },
  );

  it("a host containing neon.tech, as its own rule", () => {
    // Unreachable past the exact-match host rule today; kept so the rule
    // survives if the host list ever grows.
    expect(() => assertSafeToDestroy(local("ch_fuel_dev", "ep-x.neon.tech"), {})).toThrow();
  });

  it.each(["postgres", "neondb", "ch_fuel_dev_old", "CH_FUEL_DEV", ""])("an unknown database (%s)", (db) => {
    expect(() => assertSafeToDestroy(local(db), {})).toThrow(/database/);
  });

  it("ch_fuel_planner on a remote host", () => {
    expect(() => assertSafeToDestroy(local("ch_fuel_planner", "db.example.com"), {})).toThrow(/not a local host/);
  });

  it("a ?host= parameter that overrides the URL's host", () => {
    const url = `${local("ch_fuel_dev")}?host=ep-x.us-east-1.aws.neon.tech`;
    expect(parse(url).host).toBe("ep-x.us-east-1.aws.neon.tech");
    expect(() => assertSafeToDestroy(url, {})).toThrow(/not a local host/);
  });

  it("a hostaddr or dbname parameter", () => {
    expect(() => assertSafeToDestroy(`${local("ch_fuel_dev")}?hostaddr=10.0.0.5`, {})).toThrow(/hostaddr/);
    expect(() => assertSafeToDestroy(`${local("ch_fuel_dev")}?dbname=neondb`, {})).toThrow(/dbname/);
  });

  it("a URL with no host while PGHOST names a Neon host", () => {
    // pg falls back to PGHOST when the URL has no host.
    const env = { PGHOST: "ep-cool-name-a1b2c3.us-east-1.aws.neon.tech" };
    expect(parse("postgres:///ch_fuel_dev").host).toBe("");
    expect(() => assertSafeToDestroy("postgres:///ch_fuel_dev", env)).toThrow(/no host/);
  });

  it("a URL with no host and no PGHOST", () => {
    expect(() => assertSafeToDestroy("postgres:///ch_fuel_dev", {})).toThrow(/no host/);
  });

  it("a Unix socket path", () => {
    expect(() => assertSafeToDestroy("/var/run/postgresql ch_fuel_dev", {})).toThrow(/not a local host/);
  });

  it("an empty or unparseable connection string", () => {
    expect(() => assertSafeToDestroy("", {})).toThrow();
    expect(() => assertSafeToDestroy("not a url :pass@", {})).toThrow();
  });

  it("never puts the user or password in the error", () => {
    for (const url of [NEON_POOLED, local("postgres").replace("ch_fuel:ch_fuel", "ch_fuel:hunter2")]) {
      let message = "";
      try {
        assertSafeToDestroy(url, {});
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("npg_S3cretPw");
      expect(message).not.toContain("hunter2");
      expect(message).not.toContain("neondb_owner");
    }
  });
});
