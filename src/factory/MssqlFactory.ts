import { EngineFactory } from './EngineFactory';
import { SqlDriver } from '../driver/SqlDriver';
import { Dialect, MssqlDialect } from '../builder/Dialect';
import { DriverConfig } from '../models/SqlEngine';
import { MssqlDriver } from '../driver/MssqlDriver';

export class MssqlFactory implements EngineFactory {
    createDriver(config: DriverConfig): SqlDriver { return new MssqlDriver(config); }
    createDialect(): Dialect { return new MssqlDialect(); }
}
