import { SqlResult } from '../models/SqlResult';

/** A handle scoped to a single transaction. */
export interface DriverTransaction {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
    execute(sql: string, params?: unknown[]): Promise<SqlResult>;
}

/**
 * Engine-specific execution backend. Each implementation wraps one native driver
 * and normalizes its results into `SqlResult`. Construction is cheap; connections
 * open lazily on first use.
 */
export interface SqlDriver {
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
    execute(sql: string, params?: unknown[]): Promise<SqlResult>;
    transaction<R>(fn: (tx: DriverTransaction) => Promise<R>): Promise<R>;
    end(): Promise<void>;
}
