import { SqlResult, SqlField } from '../models/SqlResult';
import { ResultError } from '../exceptions/SqlException';
import { getValue, getString, getNumber, getBoolean, getColumn, findRow, filterRows } from './accessors';

/** A single result row with case-insensitive, type-coercing accessors. */
export class Row {
    constructor(private data: Record<string, unknown>) {}
    get(column: string): unknown { return getValue(this.data, column); }
    string(column: string): string | null | undefined { return getString(this.data, column); }
    number(column: string): number | null | undefined { return getNumber(this.data, column); }
    boolean(column: string): boolean | null | undefined { return getBoolean(this.data, column); }
    has(column: string): boolean {
        return column in this.data || column.toUpperCase() in this.data;
    }
    raw(): Record<string, unknown> { return this.data; }
}

/** Ergonomic wrapper over a result's rows. */
export class ResultSet<T extends Record<string, unknown> = Record<string, unknown>> {
    constructor(private _rows: T[], private _rowCount: number, private _fields: SqlField[]) {}

    get length(): number { return this._rows.length; }
    get rowCount(): number { return this._rowCount; }
    isEmpty(): boolean { return this._rows.length === 0; }

    at(index: number): Row | undefined {
        const r = this._rows[index];
        return r ? new Row(r) : undefined;
    }
    first(): Row | undefined { return this.at(0); }

    one(): Row {
        if (this._rows.length !== 1) {
            throw new ResultError(`Expected exactly one row but got ${this._rows.length}.`);
        }
        return new Row(this._rows[0]);
    }
    maybeOne(): Row | undefined {
        if (this._rows.length > 1) {
            throw new ResultError(`Expected at most one row but got ${this._rows.length}.`);
        }
        return this.first();
    }

    scalar<V = unknown>(column?: string): V | null | undefined {
        const row = this._rows[0];
        if (!row) return undefined;
        const name = column ?? this._fields[0]?.name ?? Object.keys(row)[0];
        return name === undefined ? undefined : (getValue(row, name) as V | null | undefined);
    }
    column(name: string): unknown[] { return getColumn(this._rows, name); }
    find(partial: Record<string, unknown>): Row | undefined {
        const r = findRow(this._rows, partial);
        return r ? new Row(r) : undefined;
    }
    where(partial: Record<string, unknown>): Row[] {
        return filterRows(this._rows, partial).map((r) => new Row(r));
    }
    map<R>(fn: (row: Row, index: number) => R): R[] {
        return this._rows.map((r, i) => fn(new Row(r), i));
    }
    all(): Row[] { return this._rows.map((r) => new Row(r)); }
    raw(): T[] { return this._rows; }
}

/** Wrap a SqlResult (or a raw rows array) for ergonomic access. */
export function rows<T extends Record<string, unknown>>(source: SqlResult<T> | T[]): ResultSet<T> {
    if (Array.isArray(source)) return new ResultSet<T>(source, source.length, []);
    return new ResultSet<T>(source.rows, source.rowCount, source.fields);
}
