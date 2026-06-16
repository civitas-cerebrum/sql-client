/** Supported SQL engine families. */
export type SqlEngine = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'oracle';

/** Driver construction config. Either a connection string or an engine-native connection object. */
export interface DriverConfig {
    connectionString?: string;
    /** Engine-native connection options (e.g. mssql/oracle config objects). */
    connection?: Record<string, unknown>;
    /** Max pool size where the engine pools. Default 10. */
    max?: number;
    /** Connection-establishment timeout in milliseconds. Only applied where provided; no implicit default. */
    connectTimeoutMs?: number;
}
