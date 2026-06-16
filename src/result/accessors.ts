import { SqlResult } from '../models/SqlResult';
import { ResultError } from '../exceptions/SqlException';
import { looseEquals } from './matchers';

/** Sentinel meaning "column key not found on the row". */
const ABSENT = Symbol('absent');

/** Case-insensitive raw read. Returns ABSENT when no key (any case) matches. */
function read(row: Record<string, unknown>, column: string): unknown | typeof ABSENT {
    if (column in row) return row[column];
    const upper = column.toUpperCase();
    if (upper in row) return row[upper];
    const lower = column.toLowerCase();
    if (lower in row) return row[lower];
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
 * string (case-insensitive): true/false sets above; any other non-empty string → ResultError.
 */
export function getBoolean(row: Record<string, unknown>, column: string): boolean | null | undefined {
    const v = getValue(row, column);
    if (v === null || v === undefined) return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const s = String(v).toLowerCase();
    if (TRUE_STRINGS.has(s)) return true;
    if (FALSE_STRINGS.has(s)) return false;
    throw new ResultError(`getBoolean: cannot coerce "${v}" in column "${column}" to a boolean.`);
}

/** Values of `column` across every row (via getValue). */
export function getColumn(rows: Record<string, unknown>[], column: string): unknown[] {
    return rows.map((r) => getValue(r, column));
}

/** A predicate over a raw row record. */
export type RowPredicate = (row: Record<string, unknown>) => boolean;

/** True if every key/value in `partial` matches. A function value is a Matcher applied to the column. */
function matchesPartial(row: Record<string, unknown>, partial: Record<string, unknown>): boolean {
    return Object.entries(partial).every(([k, v]) => {
        const actual = getValue(row, k);
        return typeof v === 'function' ? (v as (value: unknown) => boolean)(actual) : looseEquals(actual, v);
    });
}

/** Normalise a where-arg into a row predicate. */
function toPredicate(where: Record<string, unknown> | RowPredicate): RowPredicate {
    return typeof where === 'function' ? where : (row) => matchesPartial(row, where);
}

/** First row matching `where` (matcher-aware partial or a raw-row predicate). */
export function findRow<T extends object>(rows: T[], where: Record<string, unknown> | RowPredicate): T | undefined {
    const pred = toPredicate(where);
    return rows.find((r) => pred(r as Record<string, unknown>));
}

/** All rows matching `where` (matcher-aware partial or a raw-row predicate). */
export function filterRows<T extends object>(rows: T[], where: Record<string, unknown> | RowPredicate): T[] {
    const pred = toPredicate(where);
    return rows.filter((r) => pred(r as Record<string, unknown>));
}

/** Value of the first row's `column` (named, or the first field when omitted). undefined if no rows. */
export function getScalar<T extends object>(result: SqlResult<T>, column?: string): unknown {
    const row = result.rows[0];
    if (!row) return undefined;
    const name = column ?? result.fields[0]?.name ?? Object.keys(row)[0];
    return name === undefined ? undefined : getValue(row as Record<string, unknown>, name);
}
