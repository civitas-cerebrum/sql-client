import { Dialect, PostgresDialect } from './Dialect';
import { SqlResult } from '../models/SqlResult';

type Kind = 'select' | 'insert' | 'update' | 'delete';
interface WhereFrag { clause: string; params: unknown[]; }

/** Minimal client shape QueryBuilder needs to dispatch via `.run()`. */
export interface RunnableClient {
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
    private _insertRow?: Record<string, unknown>;
    private _setRow?: Record<string, unknown>;

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
    values(row: Record<string, unknown>): this { this._insertRow = row; return this; }
    set(row: Record<string, unknown>): this { this._setRow = row; return this; }

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
        if (this._limit !== undefined) sql += ` LIMIT ${this._limit}`;
        if (this._offset !== undefined) sql += ` OFFSET ${this._offset}`;
        return sql;
    }

    private buildInsert(d: Dialect, values: unknown[]): string {
        if (!this._insertRow) throw new Error('insert() requires .values({...})');
        const keys = Object.keys(this._insertRow);
        const cols = keys.map((k) => d.quoteIdentifier(k)).join(', ');
        const placeholders = keys.map((k, i) => { values.push(this._insertRow![k]); return d.placeholder(i + 1); }).join(', ');
        return `INSERT INTO ${d.quoteIdentifier(this.table)} (${cols}) VALUES (${placeholders})`;
    }

    private buildUpdate(d: Dialect, values: unknown[]): string {
        if (!this._setRow) throw new Error('update() requires .set({...})');
        const keys = Object.keys(this._setRow);
        const assignments = keys.map((k) => { values.push(this._setRow![k]); return `${d.quoteIdentifier(k)} = ${d.placeholder(values.length)}`; }).join(', ');
        let sql = `UPDATE ${d.quoteIdentifier(this.table)} SET ${assignments}`;
        sql += this.buildWhere(d, values);
        return sql;
    }

    private buildDelete(d: Dialect, values: unknown[]): string {
        let sql = `DELETE FROM ${d.quoteIdentifier(this.table)}`;
        sql += this.buildWhere(d, values);
        return sql;
    }

    /** Dispatch through a client: SELECT → query, everything else → execute. */
    async run<T = Record<string, unknown>>(client: RunnableClient): Promise<SqlResult<T>> {
        const { text, values } = this.toSql();
        return this.kind === 'select'
            ? client.query<T>(text, values)
            : (client.execute(text, values) as Promise<SqlResult<T>>);
    }
}
