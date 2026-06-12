import { UnsupportedEngineException } from '../exceptions/SqlException';

/** Which row image an inline OUTPUT clause reads (mssql): writes → INSERTED, deletes → DELETED. */
export type ReturningSource = 'inserted' | 'deleted';

/** A compiled row-returning clause and where the builder must splice it. */
export interface ReturningClause {
    sql: string;
    /** 'suffix' → appended to the statement (RETURNING); 'inline' → before VALUES/WHERE (OUTPUT). */
    placement: 'inline' | 'suffix';
}

/**
 * Strategy for rendering SQL that differs between engines: placeholder style,
 * identifier quoting, pagination, and row-returning writes. One implementation
 * per supported engine.
 */
export interface Dialect {
    /** Render the i-th positional placeholder (1-based). */
    placeholder(index: number): string;
    /** Quote a table/column identifier safely. */
    quoteIdentifier(name: string): string;
    /** Render the pagination clause (leading space included), engine-correct. */
    compilePagination(limit?: number, offset?: number): string;
    /**
     * Render the clause that makes a write return rows (RETURNING / OUTPUT).
     * Empty `columns` means all columns. Throws UnsupportedEngineException
     * where the engine has no equivalent (mysql, oracle).
     */
    compileReturning(columns: string[], source: ReturningSource): ReturningClause;
}

/** LIMIT/OFFSET pagination shared by Postgres, MySQL, SQLite. */
function limitOffset(limit?: number, offset?: number): string {
    let s = '';
    if (limit !== undefined) s += ` LIMIT ${limit}`;
    if (offset !== undefined) s += ` OFFSET ${offset}`;
    return s;
}

/**
 * LIMIT/OFFSET variant for engines that require a LIMIT when OFFSET is used.
 * Pass the engine-specific sentinel string (MySQL: '18446744073709551615', SQLite: '-1').
 */
function limitOffsetWithSentinel(sentinel: string, limit?: number, offset?: number): string {
    if (limit === undefined && offset === undefined) return '';
    if (offset === undefined) return ` LIMIT ${limit}`;
    return ` LIMIT ${limit ?? sentinel} OFFSET ${offset}`;
}

// NOTE: callers must supply ORDER BY when using mssql/oracle pagination — SQL Server and Oracle
// require an ORDER BY clause when OFFSET..FETCH is used.
/** OFFSET..FETCH pagination shared by SQL Server and Oracle (ANSI). */
function offsetFetch(limit?: number, offset?: number): string {
    if (limit === undefined && offset === undefined) return '';
    if (limit === undefined) return ` OFFSET ${offset} ROWS`;
    return ` OFFSET ${offset ?? 0} ROWS FETCH NEXT ${limit} ROWS ONLY`;
}

/** ANSI-style `RETURNING col, ...` appended to the statement (Postgres, SQLite). */
function returningSuffix(d: Dialect, columns: string[]): ReturningClause {
    const cols = columns.length ? columns.map((c) => d.quoteIdentifier(c)).join(', ') : '*';
    return { sql: `RETURNING ${cols}`, placement: 'suffix' };
}

export class PostgresDialect implements Dialect {
    placeholder(index: number): string { return `$${index}`; }
    quoteIdentifier(name: string): string { return `"${name.replace(/"/g, '""')}"`; }
    compilePagination(limit?: number, offset?: number): string { return limitOffset(limit, offset); }
    compileReturning(columns: string[]): ReturningClause { return returningSuffix(this, columns); }
}

export class MySqlDialect implements Dialect {
    placeholder(_index: number): string { return '?'; }
    quoteIdentifier(name: string): string { return `\`${name.replace(/`/g, '``')}\``; }
    compilePagination(limit?: number, offset?: number): string { return limitOffsetWithSentinel('18446744073709551615', limit, offset); }
    compileReturning(): ReturningClause {
        throw new UnsupportedEngineException('mysql cannot return rows from writes — issue a follow-up SELECT instead.');
    }
}

export class SqliteDialect implements Dialect {
    placeholder(_index: number): string { return '?'; }
    quoteIdentifier(name: string): string { return `"${name.replace(/"/g, '""')}"`; }
    compilePagination(limit?: number, offset?: number): string { return limitOffsetWithSentinel('-1', limit, offset); }
    compileReturning(columns: string[]): ReturningClause { return returningSuffix(this, columns); }
}

export class MssqlDialect implements Dialect {
    placeholder(index: number): string { return `@p${index}`; }
    quoteIdentifier(name: string): string { return `[${name.replace(/]/g, ']]')}]`; }
    compilePagination(limit?: number, offset?: number): string { return offsetFetch(limit, offset); }
    compileReturning(columns: string[], source: ReturningSource): ReturningClause {
        const image = source === 'deleted' ? 'DELETED' : 'INSERTED';
        const cols = columns.length ? columns.map((c) => `${image}.${this.quoteIdentifier(c)}`).join(', ') : `${image}.*`;
        return { sql: `OUTPUT ${cols}`, placement: 'inline' };
    }
}

export class OracleDialect implements Dialect {
    placeholder(index: number): string { return `:${index}`; }
    // Bare identifier: Oracle folds unquoted names to UPPERCASE; the schema is created unquoted too,
    // so both sides agree. Avoids the quoted-lowercase case-mismatch footgun. (No reserved-word cols.)
    quoteIdentifier(name: string): string { return name; }
    compilePagination(limit?: number, offset?: number): string { return offsetFetch(limit, offset); }
    compileReturning(): ReturningClause {
        throw new UnsupportedEngineException('oracle RETURNING INTO needs out-binds, which this builder does not support — issue a follow-up SELECT instead.');
    }
}
