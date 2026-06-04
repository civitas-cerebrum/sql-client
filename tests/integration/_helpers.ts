/**
 * Shared integration-test helpers.
 *
 * All five engine integration modules import from here. The helpers are kept
 * in a single place so that any engine-specific quirks (placeholder style,
 * reserved-word columns, data-type coercion) are documented once.
 */

import { SqlClient } from '../../src/client/SqlClient';

// ---------------------------------------------------------------------------
// Parametrisation helpers
// ---------------------------------------------------------------------------

/**
 * Bind a single placeholder at position `i` (1-based).
 * Thin wrapper around `client.dialect.placeholder(i)`.
 */
export function ph(client: SqlClient, i: number): string {
    return client.dialect.placeholder(i);
}

// ---------------------------------------------------------------------------
// Column accessor / coercion
// ---------------------------------------------------------------------------

/**
 * Case-insensitive column accessor (Oracle returns UPPERCASE keys).
 *
 * Behaviour:
 *  - Key present with any case → return the value (may be null).
 *  - Key genuinely absent → return undefined.
 *
 * The distinction matters for NULL-assertion tests: a present-NULL value
 * must come back as `null`, not be confused with an absent column.
 */
export function col(row: Record<string, unknown>, name: string): unknown {
    if (name in row) return row[name];
    const upper = name.toUpperCase();
    if (upper in row) return row[upper];
    return undefined;
}

/** Coerce pg/mysql NUMERIC/DECIMAL strings to number. */
export function num(v: unknown): number {
    return Number(v);
}

// ---------------------------------------------------------------------------
// Engine-specific rendering helpers (used only where unavoidable)
// ---------------------------------------------------------------------------

/**
 * The `status` column in the `orders` table is a reserved word in T-SQL and
 * must be bracketed in INSERT column lists for MSSQL. SELECT/WHERE work fine
 * without brackets on all engines.
 *
 * Per-engine override: mssql only.
 */
export function statusCol(engine: string): string {
    return engine === 'mssql' ? '[status]' : 'status';
}

/**
 * Return the marketplace_listings condition column identifier, ready to embed
 * in a raw SQL string.
 *
 *  - Oracle:  `item_condition`   (reserved word `condition` → renamed in schema)
 *  - MSSQL:   `[condition]`      (T-SQL reserved word → bracket-quoted)
 *  - MySQL:   `` `condition` ``  (reserved word in MySQL → backtick-quoted)
 *  - Others:  `condition`        (postgres/sqlite: not reserved in query context)
 */
export function conditionCol(client: SqlClient): string {
    if (client.engine === 'oracle') return 'item_condition';
    if (client.engine === 'mssql') return '[condition]';
    if (client.engine === 'mysql') return '`condition`';
    return 'condition';
}

/**
 * Return a date value suitable for binding as a timestamp parameter.
 *
 * Per-engine override: SQLite (better-sqlite3) rejects Date objects; it only
 * accepts numbers, strings, bigints, buffers, and null. All other engines
 * accept a JS Date object and map it to the correct timestamp type. For
 * Oracle the oracledb driver handles Date→TIMESTAMP WITH TIME ZONE correctly.
 */
export function bindDate(client: SqlClient, iso: string): unknown {
    return client.engine === 'sqlite' ? iso : new Date(iso);
}
