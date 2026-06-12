import { SqlEngine, DriverConfig } from '../models/SqlEngine';
import { SqlDriver } from '../driver/SqlDriver';
import { Dialect } from '../builder/Dialect';
import { UnsupportedEngineException } from '../exceptions/SqlException';
import { PostgresFactory } from './PostgresFactory';
import { SqliteFactory } from './SqliteFactory';
import { MySqlFactory } from './MySqlFactory';
import { MssqlFactory } from './MssqlFactory';
import { OracleFactory } from './OracleFactory';

/** Abstract Factory: produces the matching driver + dialect family for one engine. */
export interface EngineFactory {
    createDriver(config: DriverConfig): SqlDriver;
    createDialect(): Dialect;
}

const registry: Partial<Record<SqlEngine, EngineFactory>> = {
    postgres: new PostgresFactory(),
    sqlite: new SqliteFactory(),
    mysql: new MySqlFactory(),
    mssql: new MssqlFactory(),
    oracle: new OracleFactory(),
};

export function registerEngineFactory(engine: SqlEngine, factory: EngineFactory): void {
    registry[engine] = factory;
}

export function getEngineFactory(engine: SqlEngine): EngineFactory {
    const f = registry[engine];
    if (!f) throw new UnsupportedEngineException(`Engine "${engine}" is not registered. Supported: ${Object.keys(registry).join(', ')}.`);
    return f;
}

/** Infer the engine from a connection string's scheme. */
export function detectEngine(connectionString: string): SqlEngine {
    const s = connectionString.trim().toLowerCase();
    if (s.startsWith('postgres://') || s.startsWith('postgresql://')) return 'postgres';
    if (s.startsWith('mysql://') || s.startsWith('mariadb://')) return 'mysql';
    if (s.startsWith('sqlite:') || s.startsWith('file:') || s === ':memory:' || s.endsWith('.db') || s.endsWith('.sqlite')) return 'sqlite';
    if (s.startsWith('mssql://') || s.startsWith('sqlserver://')) return 'mssql';
    if (s.startsWith('oracle://') || s.startsWith('oracledb://')) return 'oracle';
    throw new UnsupportedEngineException(`Unable to detect SQL engine from connection string "${connectionString}". Pass an explicit { engine } or use a known scheme.`);
}
