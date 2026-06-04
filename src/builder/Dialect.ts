/**
 * Strategy for rendering SQL that differs between engines. Only the placeholder
 * style and identifier quoting vary today; a Postgres implementation is provided.
 * Adding SQLite/MySQL later means adding a Dialect, not rewriting the builder.
 */
export interface Dialect {
    /** Render the i-th positional placeholder (1-based). Postgres: `$1`. */
    placeholder(index: number): string;
    /** Quote a table/column identifier safely. */
    quoteIdentifier(name: string): string;
}

export class PostgresDialect implements Dialect {
    placeholder(index: number): string {
        return `$${index}`;
    }
    quoteIdentifier(name: string): string {
        return `"${name.replace(/"/g, '""')}"`;
    }
}
