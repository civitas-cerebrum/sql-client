import { Dialect, PostgresDialect, ReturningClause, ReturningSource } from './Dialect';
import { SqlResult } from '../models/SqlResult';

type Kind = 'select' | 'insert' | 'update' | 'delete';
interface WhereFrag { clause: string; params: unknown[]; }

/** Minimal client shape QueryBuilder needs to dispatch via `.run()`. */
export interface RunnableClient {
    dialect: Dialect;
    query<T>(sql: string, params?: unknown[]): Promise<SqlResult<T>>;
    execute(sql: string, params?: unknown[]): Promise<SqlResult>;
}

/**
 * Fluent SQL builder that compiles to a parametrised `{ text, values }`.
 * Never executes on its own — call `.toSql()` to hand the statement to a raw
 * call, or `.run(client)` to dispatch through a client.
 */
export class QueryBuilder {
    private _columns: string[] = [];
    private _joins: { table: string; on: string }[] = [];
    private _wheres: WhereFrag[] = [];
    private _groupBy: string[] = [];
    private _having: WhereFrag[] = [];
    private _orderBy: { col: string; dir: 'asc' | 'desc' }[] = [];
    private _limit?: number;
    private _offset?: number;
    private _insertRows: Record<string, unknown>[] = [];
    private _setRow?: Record<string, unknown>;
    private _returning?: string[];

    private constructor(private kind: Kind, private table: string) {}

    static select(table: string): QueryBuilder { return new QueryBuilder('select', table); }
    static insert(table: string): QueryBuilder { return new QueryBuilder('insert', table); }
    static update(table: string): QueryBuilder { return new QueryBuilder('update', table); }
    static delete(table: string): QueryBuilder { return new QueryBuilder('delete', table); }

    columns(...cols: string[]): this { this._columns.push(...cols); return this; }
    join(table: string, on: string): this { this._joins.push({ table, on }); return this; }
    where(clause: string, ...params: unknown[]): this { this._wheres.push({ clause, params }); return this; }
    groupBy(...cols: string[]): this { this._groupBy.push(...cols); return this; }
    having(clause: string, ...params: unknown[]): this { this._having.push({ clause, params }); return this; }
    orderBy(col: string, dir: 'asc' | 'desc' = 'asc'): this { this._orderBy.push({ col, dir }); return this; }
    limit(n: number): this { this._limit = n; return this; }
    offset(n: number): this { this._offset = n; return this; }
    /** Add row(s) to insert. Repeated calls (or an array) accumulate into a multi-row INSERT. */
    values(row: Record<string, unknown> | Record<string, unknown>[]): this {
        this._insertRows.push(...(Array.isArray(row) ? row : [row]));
        return this;
    }
    set(row: Record<string, unknown>): this { this._setRow = row; return this; }
    /** Make the write return rows (RETURNING / OUTPUT). No args → all columns. */
    returning(...cols: string[]): this { this._returning = cols; return this; }

    /** Quote a column reference: per-segment for dotted names, raw for expressions. */
    private quoteColumn(d: Dialect, col: string): string {
        if (/[()\s]/.test(col) || /\bAS\b/i.test(col)) return col; // expression/alias → raw
        return col.split('.').map((seg) => d.quoteIdentifier(seg)).join('.');
    }

    /** Replace `?` markers in a fragment with dialect placeholders, threading the counter. */
    private renderFragment(d: Dialect, clause: string, start: number): string {
        let i = start;
        return clause.replace(/\?/g, () => d.placeholder(i++));
    }

    toSql(dialect: Dialect = new PostgresDialect()): { text: string; values: unknown[] } {
        const values: unknown[] = [];
        let text: string;
        switch (this.kind) {
            case 'select': text = this.buildSelect(dialect, values); break;
            case 'insert': text = this.buildInsert(dialect, values); break;
            case 'update': text = this.buildUpdate(dialect, values); break;
            case 'delete': text = this.buildDelete(dialect, values); break;
        }
        return { text, values };
    }

    private buildWhere(d: Dialect, values: unknown[]): string {
        if (this._wheres.length === 0) return '';
        const parts = this._wheres.map((w) => {
            const rendered = this.renderFragment(d, w.clause, values.length + 1);
            values.push(...w.params);
            return rendered;
        });
        return ' WHERE ' + parts.join(' AND ');
    }

    private buildSelect(d: Dialect, values: unknown[]): string {
        const cols = this._columns.length
            ? this._columns.map((c) => this.quoteColumn(d, c)).join(', ')
            : '*';
        let sql = `SELECT ${cols} FROM ${d.quoteIdentifier(this.table)}`;
        for (const j of this._joins) sql += ` JOIN ${d.quoteIdentifier(j.table)} ON ${j.on}`;
        sql += this.buildWhere(d, values);
        if (this._groupBy.length) sql += ' GROUP BY ' + this._groupBy.map((c) => this.quoteColumn(d, c)).join(', ');
        if (this._having.length) {
            const parts = this._having.map((h) => {
                const rendered = this.renderFragment(d, h.clause, values.length + 1);
                values.push(...h.params);
                return rendered;
            });
            sql += ' HAVING ' + parts.join(' AND ');
        }
        if (this._orderBy.length) {
            sql += ' ORDER BY ' + this._orderBy.map((o) => `${this.quoteColumn(d, o.col)} ${o.dir}`).join(', ');
        }
        sql += d.compilePagination(this._limit, this._offset);
        return sql;
    }

    /** Compile the RETURNING/OUTPUT clause if requested, else undefined. */
    private compileReturning(d: Dialect, source: ReturningSource): ReturningClause | undefined {
        return this._returning ? d.compileReturning(this._returning, source) : undefined;
    }

    private buildInsert(d: Dialect, values: unknown[]): string {
        if (this._insertRows.length === 0) throw new Error('insert() requires .values({...})');
        const keys = Object.keys(this._insertRows[0]);
        for (const row of this._insertRows) {
            const rowKeys = Object.keys(row);
            if (rowKeys.length !== keys.length || !keys.every((k) => k in row)) {
                throw new Error('all rows passed to values() must have the same columns');
            }
        }
        const cols = keys.map((k) => d.quoteIdentifier(k)).join(', ');
        const tuples = this._insertRows
            .map((row) => '(' + keys.map((k) => { values.push(row[k]); return d.placeholder(values.length); }).join(', ') + ')')
            .join(', ');
        const ret = this.compileReturning(d, 'inserted');
        let sql = `INSERT INTO ${d.quoteIdentifier(this.table)} (${cols})`;
        if (ret?.placement === 'inline') sql += ` ${ret.sql}`;
        sql += ` VALUES ${tuples}`;
        if (ret?.placement === 'suffix') sql += ` ${ret.sql}`;
        return sql;
    }

    private buildUpdate(d: Dialect, values: unknown[]): string {
        if (!this._setRow) throw new Error('update() requires .set({...})');
        const keys = Object.keys(this._setRow);
        const assignments = keys.map((k) => { values.push(this._setRow![k]); return `${d.quoteIdentifier(k)} = ${d.placeholder(values.length)}`; }).join(', ');
        const ret = this.compileReturning(d, 'inserted');
        let sql = `UPDATE ${d.quoteIdentifier(this.table)} SET ${assignments}`;
        if (ret?.placement === 'inline') sql += ` ${ret.sql}`;
        sql += this.buildWhere(d, values);
        if (ret?.placement === 'suffix') sql += ` ${ret.sql}`;
        return sql;
    }

    private buildDelete(d: Dialect, values: unknown[]): string {
        const ret = this.compileReturning(d, 'deleted');
        let sql = `DELETE FROM ${d.quoteIdentifier(this.table)}`;
        if (ret?.placement === 'inline') sql += ` ${ret.sql}`;
        sql += this.buildWhere(d, values);
        if (ret?.placement === 'suffix') sql += ` ${ret.sql}`;
        return sql;
    }

    /** Dispatch through a client: SELECT and row-returning writes → query, everything else → execute. */
    async run<T = Record<string, unknown>>(client: RunnableClient): Promise<SqlResult<T>> {
        const { text, values } = this.toSql(client.dialect);
        return this.kind === 'select' || this._returning
            ? client.query<T>(text, values)
            : (client.execute(text, values) as Promise<SqlResult<T>>);
    }
}
