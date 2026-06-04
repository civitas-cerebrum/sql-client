import type { EngineFactory } from './EngineFactory';
import { SqlDriver } from '../driver/SqlDriver';
import { Dialect, PostgresDialect } from '../builder/Dialect';
import { DriverConfig } from '../models/SqlEngine';
import { PostgresDriver } from '../driver/PostgresDriver';

export class PostgresFactory implements EngineFactory {
    createDriver(config: DriverConfig): SqlDriver { return new PostgresDriver(config); }
    createDialect(): Dialect { return new PostgresDialect(); }
}
