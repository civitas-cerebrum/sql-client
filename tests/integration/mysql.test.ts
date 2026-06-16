import { SqlClient } from '../../src/client/SqlClient';
import { runUseCases } from './use-cases';
import { runLookups } from './lookups';
import { runBuilderCases } from './builder-cases';
import { runSchemaMap, runCoverageReport } from './schema-map';
import { runDbCoverage } from './db-coverage';

const CONN = process.env.MYSQL_TEST_URL ?? 'mysql://bookhive:bookhive@localhost:3306/bookhive';

async function main() {
    // Bootstrap: container auto-initialises the bookhive schema+seed on startup.
    const client = new SqlClient({ connectionString: CONN });

    await runUseCases(client);
    await runLookups(client);
    await runBuilderCases(client);
    await runSchemaMap(client);
    const __ledger = await runDbCoverage(client);
    await runCoverageReport(client, __ledger);
    await client.end();
    console.log('integration/mysql.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
