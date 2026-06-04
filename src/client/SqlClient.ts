import { SqlResult } from '../models/SqlResult';
import { SqlEngine, DriverConfig } from '../models/SqlEngine';
import { SqlDriver, DriverTransaction } from '../driver/SqlDriver';
import { Dialect } from '../builder/Dialect';
import { getEngineFactory, detectEngine } from '../factory/EngineFactory';

export type SqlTransaction = DriverTransaction;

export interface SqlClientConfig extends DriverConfig {
    /** Explicit engine; if omitted, inferred from `connectionString`'s scheme. */
    engine?: SqlEngine;
    /** Override the dialect (rarely needed). */
    dialect?: Dialect;
}

/** Engine-agnostic SQL client. Resolves the engine via the Abstract Factory and delegates. */
export class SqlClient {
    readonly engine: SqlEngine;
    readonly dialect: Dialect;
    private driver: SqlDriver;

    constructor(config: SqlClientConfig) {
        this.engine = config.engine ?? detectEngine(config.connectionString ?? '');
        const factory = getEngineFactory(this.engine);
        this.dialect = config.dialect ?? factory.createDialect();
        this.driver = factory.createDriver(config);
    }
    query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> {
        return this.driver.query<T>(sql, params);
    }
    execute(sql: string, params: unknown[] = []): Promise<SqlResult> {
        return this.driver.execute(sql, params);
    }
    transaction<R>(fn: (tx: SqlTransaction) => Promise<R>): Promise<R> {
        return this.driver.transaction(fn);
    }
    async end(): Promise<void> { await this.driver.end(); }
}
