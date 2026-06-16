import { SqlResult } from '../models/SqlResult';
import { UnsupportedEngineException, isModuleNotFound, wrapQueryError } from '../exceptions/SqlException';
import { SqlDriver, DriverTransaction } from './SqlDriver';
import { DriverConfig } from '../models/SqlEngine';
import { createLogger } from '../logger/Logger';

const log = createLogger('sqlite');

/** Strip a sqlite: / file: scheme to a filesystem path or ':memory:'. */
function resolvePath(config: DriverConfig): string {
    const cs = config.connectionString ?? ':memory:';
    if (cs === ':memory:' || cs === 'sqlite::memory:') return ':memory:';
    return cs.replace(/^sqlite:(\/\/)?/, '').replace(/^file:/, '') || ':memory:';
}

/** better-sqlite3 only binds numbers/strings/bigints/buffers/null. */
function normalizeParam(p: unknown): unknown {
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p === undefined) return null;
    return p;
}

export class SqliteDriver implements SqlDriver {
    // better-sqlite3 has no async API and no pool; one connection is correct.
    private db: import('better-sqlite3').Database;
    constructor(config: DriverConfig) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        let Database: typeof import('better-sqlite3');
        try { Database = require('better-sqlite3'); }
        catch (err) {
            if (isModuleNotFound(err, 'better-sqlite3')) throw new UnsupportedEngineException('Install "better-sqlite3" to use the sqlite engine.');
            throw err;
        }
        this.db = new Database(resolvePath(config));
    }
    private run<T>(sql: string, params: unknown[]): SqlResult<T> {
        try {
            const stmt = this.db.prepare(sql);
            const bound = params.map(normalizeParam);
            if (stmt.reader) {
                const rows = stmt.all(...bound) as T[];
                return { rows, rowCount: rows.length, fields: stmt.columns().map((c) => ({ name: c.name, dataTypeID: 0 })) };
            }
            const info = stmt.run(...bound);
            return { rows: [] as T[], rowCount: info.changes, fields: [] };
        } catch (cause) { log('query failed: %s', (cause as Error).message); throw wrapQueryError('sqlite', sql, params, cause); }
    }
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> { log('query %s %o', sql, params); return this.run<T>(sql, params); }
    async execute(sql: string, params: unknown[] = []): Promise<SqlResult> { return this.query(sql, params); }
    async transaction<R>(fn: (tx: DriverTransaction) => Promise<R>): Promise<R> {
        const tx: DriverTransaction = {
            query: async <T>(sql: string, params: unknown[] = []) => this.query<T>(sql, params),
            execute: async (sql: string, params: unknown[] = []) => this.query(sql, params),
        };
        log('begin'); this.db.exec('BEGIN');
        try { const r = await fn(tx); log('commit'); this.db.exec('COMMIT'); return r; }
        catch (err) { log('rollback'); this.db.exec('ROLLBACK'); throw err; }
    }
    async end(): Promise<void> { this.db.close(); }
}
