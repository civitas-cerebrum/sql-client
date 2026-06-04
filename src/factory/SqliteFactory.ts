import { EngineFactory } from './EngineFactory';
import { SqlDriver } from '../driver/SqlDriver';
import { Dialect, SqliteDialect } from '../builder/Dialect';
import { DriverConfig } from '../models/SqlEngine';
import { SqliteDriver } from '../driver/SqliteDriver';

export class SqliteFactory implements EngineFactory {
    createDriver(config: DriverConfig): SqlDriver { return new SqliteDriver(config); }
    createDialect(): Dialect { return new SqliteDialect(); }
}
