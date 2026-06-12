import { SqlResult } from '../models/SqlResult';
import { QueryFailedException, UnsupportedEngineException } from '../exceptions/SqlException';
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

export class SqliteDriver implements SqlDriver {
    // better-sqlite3 has no async API and no pool; one connection is correct.
    private db: import('better-sqlite3').Database;
    constructor(config: DriverConfig) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        let Database: typeof import('better-sqlite3');
        try { Database = require('better-sqlite3'); }
        catch { throw new UnsupportedEngineException('Install "better-sqlite3" to use the sqlite engine.'); }
        this.db = new Database(resolvePath(config));
    }
    private run<T>(sql: string, params: unknown[]): SqlResult<T> {
        try {
            const stmt = this.db.prepare(sql);
            if (stmt.reader) {
                const rows = stmt.all(...params) as T[];
                return { rows, rowCount: rows.length, fields: stmt.columns().map((c) => ({ name: c.name, dataTypeID: 0 })) };
            }
            const info = stmt.run(...params);
            return { rows: [] as T[], rowCount: info.changes, fields: [] };
        } catch (cause) { throw new QueryFailedException(`Query failed: ${(cause as Error).message}`, sql, params, cause); }
    }
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<SqlResult<T>> { log('query %s %o', sql, params); return this.run<T>(sql, params); }
    async execute(sql: string, params: unknown[] = []): Promise<SqlResult> { return this.run(sql, params); }
    async transaction<R>(fn: (tx: DriverTransaction) => Promise<R>): Promise<R> {
        const tx: DriverTransaction = {
            query: async <T>(sql: string, params: unknown[] = []) => this.run<T>(sql, params),
            execute: async (sql: string, params: unknown[] = []) => this.run(sql, params),
        };
        this.db.exec('BEGIN');
        try { const r = await fn(tx); this.db.exec('COMMIT'); return r; }
        catch (err) { this.db.exec('ROLLBACK'); throw err; }
    }
    async end(): Promise<void> { this.db.close(); }
}
