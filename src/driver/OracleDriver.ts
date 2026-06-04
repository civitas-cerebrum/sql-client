import { SqlResult } from '../models/SqlResult';
import { QueryFailedException } from '../exceptions/SqlException';
import { SqlDriver, DriverTransaction } from './SqlDriver';
import { DriverConfig } from '../models/SqlEngine';
import { createLogger } from '../logger/Logger';

const log = createLogger('oracle');

export class OracleDriver implements SqlDriver {
    private oracledb: typeof import('oracledb');
    private connAttrs: import('oracledb').PoolAttributes;
    private poolMax: number;
    private poolPromise: Promise<import('oracledb').Pool> | null = null;
    constructor(config: DriverConfig) {
        try { this.oracledb = require('oracledb'); }
        catch { throw new QueryFailedException('Install "oracledb" to use the oracle engine.', '', []); }
        if (!config.connection && !config.connectionString) throw new QueryFailedException('Provide connection or connectionString for the oracle engine.', '', []);
        this.connAttrs = (config.connection as import('oracledb').PoolAttributes) ?? this.parseUrl(config.connectionString!);
        this.poolMax = config.max ?? 10;
    }
    private getPool(): Promise<import('oracledb').Pool> {
        if (!this.poolPromise) {
            this.poolPromise = this.oracledb.createPool({ poolMax: this.poolMax, ...this.connAttrs });
        }
        return this.poolPromise;
    }
    /** oracle://user:pass@host:port/service → PoolAttributes */
    private parseUrl(cs: string): import('oracledb').PoolAttributes {
        const u = new URL(cs.replace(/^oracledb:/, 'oracle:'));
        return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), connectString: `${u.hostname}:${u.port || 1521}/${u.pathname.replace(/^\//, '')}` };
    }
    private toResult<T>(res: import('oracledb').Result<T>): SqlResult<T> {
        return { rows: (res.rows ?? []) as T[], rowCount: res.rowsAffected ?? (res.rows?.length ?? 0), fields: (res.metaData ?? []).map((m) => ({ name: m.name, dataTypeID: 0 })) };
    }
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> {
        log('query %s %o', sql, params);
        const pool = await this.getPool(); const conn = await pool.getConnection();
        try { return this.toResult<T>(await conn.execute<T>(sql, params, { autoCommit: true, outFormat: this.oracledb.OUT_FORMAT_OBJECT })); }
        catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
        finally { await conn.close(); }
    }
    async execute(sql: string, params: unknown[] = []): Promise<SqlResult> { return this.query(sql, params); }
    async transaction<R>(fn: (tx: DriverTransaction) => Promise<R>): Promise<R> {
        const pool = await this.getPool(); const conn = await pool.getConnection();
        const tx: DriverTransaction = {
            query: async <T>(sql: string, params: unknown[] = []) => {
                try { return this.toResult<T>(await conn.execute<T>(sql, params, { autoCommit: false, outFormat: this.oracledb.OUT_FORMAT_OBJECT })); }
                catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
            },
            execute: (sql: string, params: unknown[] = []) => tx.query(sql, params),
        };
        try { const r = await fn(tx); await conn.commit(); return r; }
        catch (err) {
            try { await conn.rollback(); } catch { /* ignore secondary rollback error */ }
            throw err;
        }
        finally { await conn.close(); }
    }
    async end(): Promise<void> { if (!this.poolPromise) return; const pool = await this.poolPromise; await pool.close(0); this.poolPromise = null; }
}
