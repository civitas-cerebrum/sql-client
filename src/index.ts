// Client
export { SqlClient } from './client/SqlClient';
export type { SqlClientConfig, SqlTransaction } from './client/SqlClient';

// Builder
export { QueryBuilder } from './builder/QueryBuilder';
export type { RunnableClient } from './builder/QueryBuilder';
export { PostgresDialect, MySqlDialect, SqliteDialect, MssqlDialect, OracleDialect } from './builder/Dialect';
export type { Dialect } from './builder/Dialect';

// Models
export type { SqlResult, SqlField } from './models/SqlResult';
export type { SqlEngine, DriverConfig } from './models/SqlEngine';

// Exceptions
export { SqlException, QueryFailedException, UnsupportedEngineException } from './exceptions/SqlException';

// Result accessors
export { getValue, getString, getNumber, getBoolean, getColumn, findRow, filterRows, getScalar } from './result/accessors';
export { rows, ResultSet, Row } from './result/ResultSet';
export { ResultError } from './exceptions/SqlException';

// Row matchers
export type { Matcher } from './result/matchers';
export { eq, ne, lt, lte, gt, gte, between, oneOf, like, contains, startsWith, endsWith, matches, isNull, notNull, not } from './result/matchers';
export type { RowPredicate } from './result/accessors';

// Logger
export { log, createLogger } from './logger/Logger';

// Engine / driver / factory surface
export type { SqlDriver, DriverTransaction } from './driver/SqlDriver';
export { PostgresDriver } from './driver/PostgresDriver';
export { MySqlDriver } from './driver/MySqlDriver';
export { SqliteDriver } from './driver/SqliteDriver';
export { MssqlDriver } from './driver/MssqlDriver';
export { OracleDriver } from './driver/OracleDriver';
export type { EngineFactory } from './factory/EngineFactory';
export { getEngineFactory, registerEngineFactory, detectEngine } from './factory/EngineFactory';
