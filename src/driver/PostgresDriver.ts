import type { Pool, PoolClient } from 'pg';
import { SqlResult } from '../models/SqlResult';
import { QueryFailedException, UnsupportedEngineException } from '../exceptions/SqlException';
import { SqlDriver, DriverTransaction } from './SqlDriver';
import { DriverConfig } from '../models/SqlEngine';
import { createLogger } from '../logger/Logger';

const log = createLogger('pg');

function toResult<T>(res: { rows: unknown[]; rowCount: number | null; fields: { name: string; dataTypeID: number }[] }): SqlResult<T> {
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0, fields: res.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })) };
}

export class PostgresDriver implements SqlDriver {
    private pool: Pool;
    constructor(config: DriverConfig) {
        let pg: typeof import('pg');
        try { pg = require('pg'); }
        catch { throw new UnsupportedEngineException('Install "pg" to use the postgres engine.'); }
        this.pool = new pg.Pool({ connectionString: config.connectionString, ...(config.connection ?? {}), max: config.max ?? 10 });
    }
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> {
        log('query %s %o', sql, params);
        try { return toResult<T>(await this.pool.query(sql, params)); }
        catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
    }
    async execute(sql: string, params: unknown[] = []): Promise<SqlResult> { return this.query(sql, params); }
    async transaction<R>(fn: (tx: DriverTransaction) => Promise<R>): Promise<R> {
        const conn: PoolClient = await this.pool.connect();
        const tx: DriverTransaction = {
            query: async <T>(sql: string, params: unknown[] = []) => {
                try { return toResult<T>(await conn.query(sql, params)); }
                catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
            },
            execute: (sql: string, params: unknown[] = []) => tx.query(sql, params),
        };
        try { await conn.query('BEGIN'); const r = await fn(tx); await conn.query('COMMIT'); return r; }
        catch (err) { await conn.query('ROLLBACK'); throw err; }
        finally { conn.release(); }
    }
    async end(): Promise<void> { await this.pool.end(); }
}
