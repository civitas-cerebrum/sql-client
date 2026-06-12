import { SqlResult } from '../models/SqlResult';
import { QueryFailedException, UnsupportedEngineException } from '../exceptions/SqlException';
import { SqlDriver, DriverTransaction } from './SqlDriver';
import { DriverConfig } from '../models/SqlEngine';
import { createLogger } from '../logger/Logger';

const log = createLogger('mssql');

export class MssqlDriver implements SqlDriver {
    private mssql: typeof import('mssql');
    private cfg: import('mssql').config | string;
    private poolPromise: Promise<import('mssql').ConnectionPool> | null = null;
    constructor(config: DriverConfig) {
        try { this.mssql = require('mssql'); }
        catch { throw new UnsupportedEngineException('Install "mssql" to use the mssql engine.'); }
        this.cfg = config.connectionString ?? (config.connection as unknown as import('mssql').config);
    }
    private getPool(): Promise<import('mssql').ConnectionPool> {
        if (!this.poolPromise) {
            this.poolPromise = new this.mssql.ConnectionPool(this.cfg as never).connect();
        }
        return this.poolPromise;
    }
    /** Build a request, binding params as p1..pN (matching MssqlDialect placeholders @p1..@pN). */
    private bind(req: import('mssql').Request, params: unknown[]): import('mssql').Request {
        params.forEach((v, i) => req.input(`p${i + 1}`, v));
        return req;
    }
    private toResult<T>(res: import('mssql').IResult<T>): SqlResult<T> {
        const cols = res.recordset?.columns ? Object.values(res.recordset.columns).map((c) => ({ name: (c as { name: string }).name, dataTypeID: 0 })) : [];
        return { rows: (res.recordset ?? []) as T[], rowCount: res.rowsAffected?.[0] ?? (res.recordset?.length ?? 0), fields: cols };
    }
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> {
        log('query %s %o', sql, params);
        try { const pool = await this.getPool(); return this.toResult<T>(await this.bind(pool.request(), params).query<T>(sql)); }
        catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
    }
    async execute(sql: string, params: unknown[] = []): Promise<SqlResult> { return this.query(sql, params); }
    async transaction<R>(fn: (tx: DriverTransaction) => Promise<R>): Promise<R> {
        const pool = await this.getPool();
        const transaction = new this.mssql.Transaction(pool);
        await transaction.begin();
        const tx: DriverTransaction = {
            query: async <T>(sql: string, params: unknown[] = []) => {
                try { return this.toResult<T>(await this.bind(new this.mssql.Request(transaction), params).query<T>(sql)); }
                catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
            },
            execute: (sql: string, params: unknown[] = []) => tx.query(sql, params),
        };
        try { const r = await fn(tx); await transaction.commit(); return r; }
        catch (err) {
            try { await transaction.rollback(); } catch { /* ignore secondary rollback error */ }
            throw err;
        }
    }
    async end(): Promise<void> { if (!this.poolPromise) return; const pool = await this.poolPromise; await pool.close(); this.poolPromise = null; }
}
