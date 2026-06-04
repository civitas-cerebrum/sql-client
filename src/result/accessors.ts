import { SqlResult } from '../models/SqlResult';

/** Sentinel meaning "column key not found on the row". */
const ABSENT = Symbol('absent');

/** Case-insensitive raw read. Returns ABSENT when no key (any case) matches. */
function read(row: Record<string, unknown>, column: string): unknown | typeof ABSENT {
    if (column in row) return row[column];
    const upper = column.toUpperCase();
    if (upper in row) return row[upper];
    return ABSENT;
}

/** Case-insensitive raw value. absent → undefined; present-null → null. */
export function getValue(row: Record<string, unknown>, column: string): unknown {
    const v = read(row, column);
    return v === ABSENT ? undefined : v;
}

/** String coercion. null/undefined pass through; else String(v). */
export function getString(row: Record<string, unknown>, column: string): string | null | undefined {
    const v = getValue(row, column);
    return v === null || v === undefined ? v : String(v);
}

/** Number coercion (pg/mysql decimal-as-string → number). null/undefined pass through; else Number(v). */
export function getNumber(row: Record<string, unknown>, column: string): number | null | undefined {
    const v = getValue(row, column);
    return v === null || v === undefined ? v : Number(v);
}

const TRUE_STRINGS = new Set(['1', 'true', 't', 'y', 'yes']);
const FALSE_STRINGS = new Set(['0', 'false', 'f', 'n', 'no']);

/**
 * Boolean coercion normalizing engine representations.
 * null/undefined pass through. boolean → as-is. number → v !== 0.
 * string (case-insensitive): true/false sets above; any other non-empty string → RangeError.
 */
export function getBoolean(row: Record<string, unknown>, column: string): boolean | null | undefined {
    const v = getValue(row, column);
    if (v === null || v === undefined) return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).toLowerCase();
    if (TRUE_STRINGS.has(s)) return true;
    if (FALSE_STRINGS.has(s)) return false;
    throw new RangeError(`getBoolean: cannot coerce "${v}" in column "${column}" to a boolean.`);
}

/** Values of `column` across every row (via getValue). */
export function getColumn(rows: Record<string, unknown>[], column: string): unknown[] {
    return rows.map((r) => getValue(r, column));
}

/** True if every key/value in `partial` matches the row (case-insensitive key, String() loose compare). */
function matches(row: Record<string, unknown>, partial: Record<string, unknown>): boolean {
    return Object.entries(partial).every(([k, v]) => String(getValue(row, k)) === String(v));
}

/** First row matching `partial`. */
export function findRow<T extends Record<string, unknown>>(rows: T[], partial: Record<string, unknown>): T | undefined {
    return rows.find((r) => matches(r, partial));
}

/** All rows matching `partial`. */
export function filterRows<T extends Record<string, unknown>>(rows: T[], partial: Record<string, unknown>): T[] {
    return rows.filter((r) => matches(r, partial));
}

/** Value of the first row's `column` (named, or the first field when omitted). undefined if no rows. */
export function getScalar(result: SqlResult<Record<string, unknown>>, column?: string): unknown {
    const row = result.rows[0];
    if (!row) return undefined;
    const name = column ?? result.fields[0]?.name ?? Object.keys(row)[0];
    return name === undefined ? undefined : getValue(row, name);
}
