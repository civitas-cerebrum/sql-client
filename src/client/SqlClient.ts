import { Pool, PoolClient } from 'pg';
import { SqlResult } from '../models/SqlResult';
import { QueryFailedException } from '../exceptions/SqlException';
import { Dialect, PostgresDialect } from '../builder/Dialect';
import { createLogger } from '../logger/Logger';

const log = createLogger('client');

export interface SqlClientConfig {
    connectionString: string;
    dialect?: Dialect;
    /** Max pool connections. Default 10. */
    max?: number;
}

/** A handle scoped to a single transaction (shares one checked-out connection). */
export interface SqlTransaction {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
    execute(sql: string, params?: unknown[]): Promise<SqlResult>;
}

/** Pooled Postgres client. All values are parametrised; never interpolate values into SQL. */
export class SqlClient {
    private pool: Pool;
    readonly dialect: Dialect;

    constructor(config: SqlClientConfig) {
        this.pool = new Pool({ connectionString: config.connectionString, max: config.max ?? 10 });
        this.dialect = config.dialect ?? new PostgresDialect();
    }

    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> {
        log('query %s %o', sql, params);
        try {
            const res = await this.pool.query(sql, params);
            return { rows: res.rows as T[], rowCount: res.rowCount ?? 0, fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) };
        } catch (cause) {
            throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause);
        }
    }

    async execute(sql: string, params: unknown[] = []): Promise<SqlResult> {
        return this.query(sql, params);
    }

    async transaction<R>(fn: (tx: SqlTransaction) => Promise<R>): Promise<R> {
        const conn: PoolClient = await this.pool.connect();
        const tx: SqlTransaction = {
            query: async <T>(sql: string, params: unknown[] = []) => {
                try {
                    const res = await conn.query(sql, params);
                    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0, fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) };
                } catch (cause) {
                    throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause);
                }
            },
            execute: (sql: string, params: unknown[] = []) => tx.query(sql, params),
        };
        try {
            await conn.query('BEGIN');
            const result = await fn(tx);
            await conn.query('COMMIT');
            return result;
        } catch (err) {
            await conn.query('ROLLBACK');
            throw err;
        } finally {
            conn.release();
        }
    }

    /** Close the pool. Call in fixture teardown. */
    async end(): Promise<void> {
        await this.pool.end();
    }
}
