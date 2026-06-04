/** A field descriptor as returned by the driver for a result set. */
export interface SqlField {
    name: string;
    dataTypeID: number;
}

/**
 * The typed outcome of a query or execute call.
 * @typeParam T - the row shape; defaults to a generic record.
 */
export interface SqlResult<T = Record<string, unknown>> {
    /** Rows returned (empty for non-RETURNING writes). */
    rows: T[];
    /** Number of rows affected/returned. */
    rowCount: number;
    /** Column descriptors for the result set. */
    fields: SqlField[];
}
