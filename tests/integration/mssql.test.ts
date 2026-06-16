import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqlClient } from '../../src/client/SqlClient';
import { runUseCases } from './use-cases';
import { runLookups } from './lookups';
import { runBuilderCases } from './builder-cases';
import { runSchemaMap } from './schema-map';
import { runDbCoverage } from './db-coverage';

const BASE_CONFIG = {
    engine: 'mssql' as const,
    connection: {
        server: process.env.MSSQL_HOST ?? 'localhost',
        port: Number(process.env.MSSQL_PORT ?? 1433),
        user: process.env.MSSQL_USER ?? 'sa',
        password: process.env.MSSQL_PASSWORD ?? 'Bookhive!Passw0rd',
        database: 'master',
        options: { trustServerCertificate: true, encrypt: true },
    } as Record<string, unknown>,
};

async function main() {
    // Bootstrap step 1: connect to master and create bookhive DB if absent.
    const masterClient = new SqlClient(BASE_CONFIG);
    await masterClient.execute("IF DB_ID('bookhive') IS NULL CREATE DATABASE bookhive");
    await masterClient.end();

    // Bootstrap step 2: connect to bookhive and apply schema + seed (DROP-first for rerunnability).
    const bookhiveConnection = { ...BASE_CONFIG.connection, database: 'bookhive' };
    const client = new SqlClient({ engine: 'mssql', connection: bookhiveConnection });

    const schemaPath = join(__dirname, '../sql/mssql.schema.sql');
    const seedPath = join(__dirname, '../sql/mssql.seed.sql');
    for (const filePath of [schemaPath, seedPath]) {
        await client.runScript(readFileSync(filePath, 'utf8'));
    }

    await runUseCases(client);
    await runLookups(client);
    await runBuilderCases(client);
    await runSchemaMap(client);
    await runDbCoverage(client);
    await client.end();
    console.log('integration/mssql.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
