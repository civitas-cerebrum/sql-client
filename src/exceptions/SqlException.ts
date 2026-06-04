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
