import { Dialect } from './Dialect';

/** Marks an interpolation as an identifier: spliced into the SQL text dialect-quoted, never a bind parameter. */
export class SqlIdentifier {
    constructor(readonly name: string) {}
}

// Same rule as QueryBuilder.quoteColumn (duplicated to keep the tag independent of the builder).
function quoteName(d: Dialect, name: string): string {
    if (/[()\s]/.test(name) || /\bAS\b/i.test(name)) return name; // expression/alias → raw
    return name.split('.').map((seg) => d.quoteIdentifier(seg)).join('.');
}

/** A composable, dialect-agnostic SQL snippet produced by the `sql` tag. */
export class SqlFragment {
    constructor(readonly strings: readonly string[], readonly values: readonly unknown[]) {}

    /** Compile for a dialect. `startIndex` seeds placeholder numbering so nested fragments thread through. */
    render(dialect: Dialect, startIndex = 1): { text: string; values: unknown[] } {
        let text = '';
        const values: unknown[] = [];
        let n = startIndex;
        for (let i = 0; i < this.strings.length; i++) {
            text += this.strings[i];
            if (i >= this.values.length) continue;
            const v = this.values[i];
            if (v instanceof SqlFragment) {
                const sub = v.render(dialect, n);
                text += sub.text;
                values.push(...sub.values);
                n += sub.values.length;
            } else if (v instanceof SqlIdentifier) {
                text += quoteName(dialect, v.name);
            } else {
                text += dialect.placeholder(n++);
                values.push(v);
            }
        }
        return { text, values };
    }
}

/** Tagged-template literal: interpolations become bind parameters; nest fragments or `sql.id()` to compose. */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlFragment {
    return new SqlFragment(strings, values);
}
/** Interpolate a table/column name (dotted ok) — quoted per dialect instead of parameterized. */
sql.id = (name: string) => new SqlIdentifier(name);
