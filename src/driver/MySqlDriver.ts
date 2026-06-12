import { SqlResult } from '../models/SqlResult';
import { QueryFailedException, UnsupportedEngineException } from '../exceptions/SqlException';
import { SqlDriver, DriverTransaction } from './SqlDriver';
import { DriverConfig } from '../models/SqlEngine';
import { createLogger } from '../logger/Logger';

const log = createLogger('mysql');

export class MySqlDriver implements SqlDriver {
    private pool: import('mysql2/promise').Pool;
    constructor(config: DriverConfig) {
        let mysql: typeof import('mysql2/promise');
        try { mysql = require('mysql2/promise'); }
        catch { throw new UnsupportedEngineException('Install "mysql2" to use the mysql engine.'); }
        if (config.connectionString) {
            this.pool = mysql.createPool(config.connectionString);
        } else {
            this.pool = mysql.createPool((config.connection as import('mysql2/promise').PoolOptions) ?? {});
        }
    }
    private toResult<T>(rowsOrHeader: unknown, fields: unknown): SqlResult<T> {
        if (Array.isArray(rowsOrHeader)) {
            const f = Array.isArray(fields) ? (fields as { name: string; columnType?: number }[]) : [];
            return { rows: rowsOrHeader as T[], rowCount: rowsOrHeader.length, fields: f.map((c) => ({ name: c.name, dataTypeID: c.columnType ?? 0 })) };
        }
        const header = rowsOrHeader as { affectedRows?: number };
        return { rows: [] as T[], rowCount: header.affectedRows ?? 0, fields: [] };
    }
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> {
        log('query %s %o', sql, params);
        try { const [rows, fields] = await this.pool.query(sql, params); return this.toResult<T>(rows, fields); }
        catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
    }
    async execute(sql: string, params: unknown[] = []): Promise<SqlResult> { return this.query(sql, params); }
    async transaction<R>(fn: (tx: DriverTransaction) => Promise<R>): Promise<R> {
        const conn = await this.pool.getConnection();
        const tx: DriverTransaction = {
            query: async <T>(sql: string, params: unknown[] = []) => {
                try { const [rows, fields] = await conn.query(sql, params); return this.toResult<T>(rows, fields); }
                catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
            },
            execute: (sql: string, params: unknown[] = []) => tx.query(sql, params),
        };
        try { await conn.beginTransaction(); const r = await fn(tx); await conn.commit(); return r; }
        catch (err) { await conn.rollback(); throw err; }
        finally { conn.release(); }
    }
    async end(): Promise<void> { await this.pool.end(); }
}
