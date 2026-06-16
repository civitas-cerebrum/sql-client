import { SqlResult, SqlField } from '../models/SqlResult';
import { ResultError } from '../exceptions/SqlException';
import { getValue, getString, getNumber, getBoolean, getColumn, findRow, filterRows } from './accessors';

/** The known string column names of a row shape. */
export type ColumnOf<T> = Extract<keyof T, string>;
/** Known columns get autocomplete; (string & {}) keeps arbitrary names legal (case-insensitive/Oracle-UPPERCASE access). */
type ColumnArg<T> = ColumnOf<T> | (string & {});

/** A single result row with case-insensitive, type-coercing accessors. */
export class Row<T extends object = Record<string, unknown>> {
    private data: Record<string, unknown>;
    constructor(data: T) { this.data = data as Record<string, unknown>; }
    get(column: ColumnArg<T>): unknown { return getValue(this.data, column); }
    string(column: ColumnArg<T>): string | null | undefined { return getString(this.data, column); }
    number(column: ColumnArg<T>): number | null | undefined { return getNumber(this.data, column); }
    boolean(column: ColumnArg<T>): boolean | null | undefined { return getBoolean(this.data, column); }
    has(column: ColumnArg<T>): boolean {
        return column in this.data || column.toUpperCase() in this.data || column.toLowerCase() in this.data;
    }
    raw(): Record<string, unknown> { return this.data; }
}

/** Ergonomic wrapper over a result's rows. */
export class ResultSet<T extends object = Record<string, unknown>> {
    constructor(private _rows: T[], private _rowCount: number, private _fields: SqlField[]) {}

    get length(): number { return this._rows.length; }
    get rowCount(): number { return this._rowCount; }
    isEmpty(): boolean { return this._rows.length === 0; }

    at(index: number): Row<T> | undefined {
        const r = this._rows[index];
        return r ? new Row(r) : undefined;
    }
    first(): Row<T> | undefined { return this.at(0); }

    one(): Row<T> {
        if (this._rows.length !== 1) {
            throw new ResultError(`Expected exactly one row but got ${this._rows.length}.`);
        }
        return new Row(this._rows[0]);
    }
    maybeOne(): Row<T> | undefined {
        if (this._rows.length > 1) {
            throw new ResultError(`Expected at most one row but got ${this._rows.length}.`);
        }
        return this.first();
    }

    scalar<V = unknown>(column?: string): V | null | undefined {
        const row = this._rows[0];
        if (!row) return undefined;
        const name = column ?? this._fields[0]?.name ?? Object.keys(row)[0];
        return name === undefined ? undefined : (getValue(row as Record<string, unknown>, name) as V | null | undefined);
    }
    column(name: string): unknown[] { return getColumn(this._rows as Record<string, unknown>[], name); }
    find(where: Record<string, unknown> | ((row: Row<T>) => boolean)): Row<T> | undefined {
        if (typeof where === 'function') {
            const r = this._rows.find((row) => where(new Row(row)));
            return r ? new Row(r) : undefined;
        }
        const r = findRow(this._rows, where);
        return r ? new Row(r) : undefined;
    }
    where(where: Record<string, unknown> | ((row: Row<T>) => boolean)): ResultSet<T> {
        const matched = typeof where === 'function'
            ? this._rows.filter((r) => where(new Row(r)))
            : filterRows(this._rows, where);
        return new ResultSet(matched, matched.length, this._fields);
    }
    map<R>(fn: (row: Row<T>, index: number) => R): R[] {
        return this._rows.map((r, i) => fn(new Row(r), i));
    }
    all(): Row<T>[] { return this._rows.map((r) => new Row(r)); }
    raw(): T[] { return this._rows; }
}

/** Wrap a SqlResult (or a raw rows array) for ergonomic access. */
export function rows<T extends object>(source: SqlResult<T> | T[]): ResultSet<T> {
    if (Array.isArray(source)) return new ResultSet<T>(source, source.length, []);
    return new ResultSet<T>(source.rows, source.rowCount, source.fields);
}
