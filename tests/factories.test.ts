import assert from 'node:assert/strict';
import { getEngineFactory } from '../src/factory/EngineFactory';
import { SqlEngine } from '../src/models/SqlEngine';
import { PostgresFactory } from '../src/factory/PostgresFactory';
import { MySqlFactory } from '../src/factory/MySqlFactory';
import { SqliteFactory } from '../src/factory/SqliteFactory';
import { MssqlFactory } from '../src/factory/MssqlFactory';
import { OracleFactory } from '../src/factory/OracleFactory';
import { PostgresDriver } from '../src/driver/PostgresDriver';
import { MySqlDriver } from '../src/driver/MySqlDriver';
import { SqliteDriver } from '../src/driver/SqliteDriver';
import { MssqlDriver } from '../src/driver/MssqlDriver';
import { OracleDriver } from '../src/driver/OracleDriver';
import { PostgresDialect, MySqlDialect, SqliteDialect, MssqlDialect, OracleDialect } from '../src/builder/Dialect';

async function main() {
    // ── postgres ──────────────────────────────────────────────────────────────
    {
        const factory = getEngineFactory('postgres' as SqlEngine);
        assert.ok(factory instanceof PostgresFactory, 'getEngineFactory("postgres") should return PostgresFactory');
        assert.ok(factory.createDialect() instanceof PostgresDialect, 'PostgresFactory.createDialect() should return PostgresDialect');
        const driver = factory.createDriver({ connectionString: 'postgres://u:p@localhost:5432/db' });
        assert.ok(driver instanceof PostgresDriver, 'PostgresFactory.createDriver() should return PostgresDriver');
        await driver.end();
    }

    // ── mysql ─────────────────────────────────────────────────────────────────
    {
        const factory = getEngineFactory('mysql' as SqlEngine);
        assert.ok(factory instanceof MySqlFactory, 'getEngineFactory("mysql") should return MySqlFactory');
        assert.ok(factory.createDialect() instanceof MySqlDialect, 'MySqlFactory.createDialect() should return MySqlDialect');
        const driver = factory.createDriver({ connectionString: 'mysql://u:p@localhost:3306/db' });
        assert.ok(driver instanceof MySqlDriver, 'MySqlFactory.createDriver() should return MySqlDriver');
        await driver.end();
    }

    // ── sqlite ────────────────────────────────────────────────────────────────
    {
        const factory = getEngineFactory('sqlite' as SqlEngine);
        assert.ok(factory instanceof SqliteFactory, 'getEngineFactory("sqlite") should return SqliteFactory');
        assert.ok(factory.createDialect() instanceof SqliteDialect, 'SqliteFactory.createDialect() should return SqliteDialect');
        const driver = factory.createDriver({ connectionString: ':memory:' });
        assert.ok(driver instanceof SqliteDriver, 'SqliteFactory.createDriver() should return SqliteDriver');
        await driver.end();
    }

    // ── mssql ─────────────────────────────────────────────────────────────────
    {
        const factory = getEngineFactory('mssql' as SqlEngine);
        assert.ok(factory instanceof MssqlFactory, 'getEngineFactory("mssql") should return MssqlFactory');
        assert.ok(factory.createDialect() instanceof MssqlDialect, 'MssqlFactory.createDialect() should return MssqlDialect');
        const driver = factory.createDriver({ connection: { server: 'localhost', user: 'sa', password: 'x', options: { trustServerCertificate: true } } });
        assert.ok(driver instanceof MssqlDriver, 'MssqlFactory.createDriver() should return MssqlDriver');
        await driver.end(); // no-op: pool was never created (lazy-init)
    }

    // ── oracle ────────────────────────────────────────────────────────────────
    {
        const factory = getEngineFactory('oracle' as SqlEngine);
        assert.ok(factory instanceof OracleFactory, 'getEngineFactory("oracle") should return OracleFactory');
        assert.ok(factory.createDialect() instanceof OracleDialect, 'OracleFactory.createDialect() should return OracleDialect');
        const driver = factory.createDriver({ connectionString: 'oracle://u:p@localhost:1521/FREEPDB1' });
        assert.ok(driver instanceof OracleDriver, 'OracleFactory.createDriver() should return OracleDriver');
        await driver.end(); // no-op: pool was never created (lazy-init)
    }

    console.log('factories.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
