import { SqlResult } from '../models/SqlResult';
import { SqlEngine, DriverConfig } from '../models/SqlEngine';
import { SqlDriver, DriverTransaction } from '../driver/SqlDriver';
import { Dialect } from '../builder/Dialect';
import { SqlFragment } from '../builder/SqlTag';
import { getEngineFactory, detectEngine } from '../factory/EngineFactory';
import { rows, ResultSet } from '../result/ResultSet';
import { splitSqlScript } from '../script/SqlScript';

/** Transaction handle: driver tx plus the client's dialect/engine, so QueryBuilder.run(tx) works. */
export type SqlTransaction = DriverTransaction & { dialect: Dialect; engine: SqlEngine };

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
    query<T = Record<string, unknown>>(fragment: SqlFragment): Promise<SqlResult<T>>;
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
    query<T = Record<string, unknown>>(sql: string | SqlFragment, params: unknown[] = []): Promise<SqlResult<T>> {
        if (sql instanceof SqlFragment) {
            const { text, values } = sql.render(this.dialect);
            return this.driver.query<T>(text, values);
        }
        return this.driver.query<T>(sql, params);
    }
    execute(fragment: SqlFragment): Promise<SqlResult>;
    execute(sql: string, params?: unknown[]): Promise<SqlResult>;
    execute(sql: string | SqlFragment, params: unknown[] = []): Promise<SqlResult> {
        if (sql instanceof SqlFragment) {
            const { text, values } = sql.render(this.dialect);
            return this.driver.execute(text, values);
        }
        return this.driver.execute(sql, params);
    }
    /** query() + rows(): fetch straight into a ResultSet. */
    async fetch<T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<ResultSet<T>> {
        return rows(await this.query<T>(sql, params));
    }
    /** Split a multi-statement script with this engine's rules and execute each statement in order. */
    async runScript(sqlText: string): Promise<void> {
        for (const stmt of splitSqlScript(sqlText, this.engine)) await this.execute(stmt);
    }
    /** Cheap connectivity check; throws if the engine is unreachable. */
    async ping(): Promise<void> {
        await this.query(this.engine === 'oracle' ? 'SELECT 1 FROM DUAL' : 'SELECT 1');
    }
    transaction<R>(fn: (tx: SqlTransaction) => Promise<R>): Promise<R> {
        // Driver tx handles are plain objects with closure methods, so spreading is safe.
        return this.driver.transaction((t) => fn({ ...t, dialect: this.dialect, engine: this.engine }));
    }
    async end(): Promise<void> { await this.driver.end(); }
}
