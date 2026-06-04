import { EngineFactory } from './EngineFactory';
import { SqlDriver } from '../driver/SqlDriver';
import { Dialect, MySqlDialect } from '../builder/Dialect';
import { DriverConfig } from '../models/SqlEngine';
import { MySqlDriver } from '../driver/MySqlDriver';

export class MySqlFactory implements EngineFactory {
    createDriver(config: DriverConfig): SqlDriver { return new MySqlDriver(config); }
    createDialect(): Dialect { return new MySqlDialect(); }
}
