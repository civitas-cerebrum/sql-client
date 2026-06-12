import assert from 'node:assert/strict';

// All native drivers are optional peer deps: importing the package must not
// require() any of them. A consumer with only (say) better-sqlite3 installed
// would otherwise crash on import with "Cannot find module 'pg'".
import '../src/index';

const NATIVE_MODULES = ['pg', 'mysql2', 'better-sqlite3', 'mssql', 'oracledb'];

for (const mod of NATIVE_MODULES) {
    const resolved = require.resolve(mod);
    assert.ok(
        !require.cache[resolved],
        `importing sql-client must not eagerly load "${mod}" (optional peer dep)`,
    );
}

console.log('lazy-driver.test.ts eager-load PASSED');

// With the native module absent, constructing a driver must throw
// UnsupportedEngineException with an install hint — simulate the missing
// module by intercepting the CJS loader.
import { UnsupportedEngineException } from '../src/exceptions/SqlException';
import { PostgresDriver } from '../src/driver/PostgresDriver';
import { MySqlDriver } from '../src/driver/MySqlDriver';
import { SqliteDriver } from '../src/driver/SqliteDriver';
import { MssqlDriver } from '../src/driver/MssqlDriver';
import { OracleDriver } from '../src/driver/OracleDriver';
import Module from 'node:module';

const origLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: (...a: unknown[]) => unknown })._load = function (request: unknown, ...rest: unknown[]) {
    const req = request as string;
    if (NATIVE_MODULES.some((m) => req === m || req.startsWith(`${m}/`))) {
        const err = new Error(`Cannot find module '${request}'`) as Error & { code: string };
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }
    return origLoad.call(this, request, ...rest);
};

try {
    const cases: [string, () => unknown][] = [
        ['pg', () => new PostgresDriver({ connectionString: 'postgres://u:p@localhost/db' })],
        ['mysql2', () => new MySqlDriver({ connectionString: 'mysql://u:p@localhost/db' })],
        ['better-sqlite3', () => new SqliteDriver({ connectionString: ':memory:' })],
        ['mssql', () => new MssqlDriver({ connection: { server: 'localhost' } })],
        ['oracledb', () => new OracleDriver({ connectionString: 'oracle://u:p@localhost/db' })],
    ];
    for (const [mod, construct] of cases) {
        assert.throws(
            construct,
            (e: unknown) => e instanceof UnsupportedEngineException && (e as Error).message.includes(`"${mod}"`),
            `constructing without "${mod}" should throw UnsupportedEngineException naming the module`,
        );
    }
} finally {
    (Module as unknown as { _load: (...a: unknown[]) => unknown })._load = origLoad;
}

console.log('lazy-driver.test.ts PASSED');
