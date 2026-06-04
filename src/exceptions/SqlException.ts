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
