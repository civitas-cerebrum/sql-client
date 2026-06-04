/** Base class for all sql-client errors. */
export class SqlException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SqlException';
    }
}

/** Thrown when a query/execute fails. Carries the offending SQL, params, and driver cause. */
export class QueryFailedException extends SqlException {
    constructor(
        message: string,
        public readonly sql: string,
        public readonly params: unknown[],
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'QueryFailedException';
    }
}
