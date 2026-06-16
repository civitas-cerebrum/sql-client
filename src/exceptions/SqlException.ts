/** Base class for all sql-client errors. */
export class SqlException extends Error {
    constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        this.name = 'SqlException';
    }
}

/** Thrown when a query/execute fails. Carries the offending SQL, params, and driver cause. */
export class QueryFailedException extends SqlException {
    constructor(
        message: string,
        public readonly sql: string,
        public readonly params: unknown[],
        cause?: unknown,
    ) {
        super(message);
        if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
        this.name = 'QueryFailedException';
    }
}

const PLACEHOLDER_STYLES: { engines: string[]; expected: string; found: string; re: RegExp }[] = [
    { engines: ['mysql', 'sqlite'], expected: '?', found: "'?' (mysql/sqlite style)", re: /\?/ },
    { engines: ['postgres'], expected: '$1..$N', found: "'$1' (postgres style)", re: /\$\d+/ },
    { engines: ['mssql'], expected: '@p1..@pN', found: "'@p1' (mssql style)", re: /@p\d+/i },
    { engines: ['oracle'], expected: ':1..:N', found: "':1' (oracle style)", re: /:\d+/ },
];

function placeholderHint(engine: string, sql: string): string | undefined {
    const own = PLACEHOLDER_STYLES.find((s) => s.engines.includes(engine));
    if (!own || own.re.test(sql)) return undefined;
    const foreign = PLACEHOLDER_STYLES.find((s) => !s.engines.includes(engine) && s.re.test(sql));
    if (!foreign) return undefined;
    return `hint: ${engine} placeholders are ${own.expected}; this SQL contains ${foreign.found}.`;
}

function clip(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Build a QueryFailedException with a rich multi-line message (engine, sql, params, placeholder hint). */
export function wrapQueryError(engine: string, sql: string, params: unknown[], cause: unknown): QueryFailedException {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    let paramsJson: string;
    // JSON.stringify throws on BigInt and circular params; fall back to String().
    try { paramsJson = JSON.stringify(params); } catch { paramsJson = String(params); }
    const lines = [
        `Query failed (${engine}): ${causeMsg}`,
        `  sql: ${clip(sql.replace(/\s+/g, ' ').trim(), 500)}`,
        `  params: ${clip(paramsJson, 200)}`,
    ];
    if (params.length > 0) {
        const hint = placeholderHint(engine, sql);
        if (hint) lines.push(`  ${hint}`);
    }
    return new QueryFailedException(lines.join('\n'), sql, params, cause);
}

/** True only when a lazy require() failed because `moduleName` itself is missing — not when the
 *  module exists but failed to load (native ABI mismatch, Instant Client, transitive errors). */
export function isModuleNotFound(err: unknown, moduleName: string): boolean {
    return (err as { code?: unknown } | null)?.code === 'MODULE_NOT_FOUND' && String((err as Error).message).includes(moduleName);
}

/** Thrown when an engine is unknown or its native driver isn't installed. */
export class UnsupportedEngineException extends SqlException {
    constructor(message: string) {
        super(message);
        this.name = 'UnsupportedEngineException';
    }
}

/** Thrown when a result-set cardinality expectation is violated (e.g. one() on 0 or >1 rows). */
export class ResultError extends SqlException {
    constructor(message: string) {
        super(message);
        this.name = 'ResultError';
    }
}
