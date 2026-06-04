/**
 * Strategy for rendering SQL that differs between engines: placeholder style,
 * identifier quoting, and pagination. One implementation per supported engine.
 */
export interface Dialect {
    /** Render the i-th positional placeholder (1-based). */
    placeholder(index: number): string;
    /** Quote a table/column identifier safely. */
    quoteIdentifier(name: string): string;
    /** Render the pagination clause (leading space included), engine-correct. */
    compilePagination(limit?: number, offset?: number): string;
}

/** LIMIT/OFFSET pagination shared by Postgres, MySQL, SQLite. */
function limitOffset(limit?: number, offset?: number): string {
    let s = '';
    if (limit !== undefined) s += ` LIMIT ${limit}`;
    if (offset !== undefined) s += ` OFFSET ${offset}`;
    return s;
}

/** OFFSET..FETCH pagination shared by SQL Server and Oracle (ANSI). */
function offsetFetch(limit?: number, offset?: number): string {
    if (limit === undefined && offset === undefined) return '';
    if (limit === undefined) return ` OFFSET ${offset} ROWS`;
    return ` OFFSET ${offset ?? 0} ROWS FETCH NEXT ${limit} ROWS ONLY`;
}

export class PostgresDialect implements Dialect {
    placeholder(index: number): string { return `$${index}`; }
    quoteIdentifier(name: string): string { return `"${name.replace(/"/g, '""')}"`; }
    compilePagination(limit?: number, offset?: number): string { return limitOffset(limit, offset); }
}

export class MySqlDialect implements Dialect {
    placeholder(_index: number): string { return '?'; }
    quoteIdentifier(name: string): string { return `\`${name.replace(/`/g, '``')}\``; }
    compilePagination(limit?: number, offset?: number): string { return limitOffset(limit, offset); }
}

export class SqliteDialect implements Dialect {
    placeholder(_index: number): string { return '?'; }
    quoteIdentifier(name: string): string { return `"${name.replace(/"/g, '""')}"`; }
    compilePagination(limit?: number, offset?: number): string { return limitOffset(limit, offset); }
}

export class MssqlDialect implements Dialect {
    placeholder(index: number): string { return `@p${index}`; }
    quoteIdentifier(name: string): string { return `[${name.replace(/]/g, ']]')}]`; }
    compilePagination(limit?: number, offset?: number): string { return offsetFetch(limit, offset); }
}

export class OracleDialect implements Dialect {
    placeholder(index: number): string { return `:${index}`; }
    // Bare identifier: Oracle folds unquoted names to UPPERCASE; the schema is created unquoted too,
    // so both sides agree. Avoids the quoted-lowercase case-mismatch footgun. (No reserved-word cols.)
    quoteIdentifier(name: string): string { return name; }
    compilePagination(limit?: number, offset?: number): string { return offsetFetch(limit, offset); }
}
