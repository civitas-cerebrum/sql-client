import { EngineFactory } from './EngineFactory';
import { SqlDriver } from '../driver/SqlDriver';
import { Dialect, OracleDialect } from '../builder/Dialect';
import { DriverConfig } from '../models/SqlEngine';
import { OracleDriver } from '../driver/OracleDriver';

export class OracleFactory implements EngineFactory {
    createDriver(config: DriverConfig): SqlDriver { return new OracleDriver(config); }
    createDialect(): Dialect { return new OracleDialect(); }
}
