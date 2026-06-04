import { SqlClient } from '../../src/client/SqlClient';
import { runUseCases } from './use-cases';

const CONN = process.env.SQL_TEST_URL ?? 'postgres://bookhive:bookhive@localhost:5432/bookhive';

async function main() {
    // Bootstrap: container auto-initialises the bookhive schema+seed on startup.
    const client = new SqlClient({ connectionString: CONN });

    await runUseCases(client);
    await client.end();
    console.log('integration/postgres.test.ts PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
