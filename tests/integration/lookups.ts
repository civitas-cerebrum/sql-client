/**
 * Exhaustive entry/value lookup harness for the bookhive schema.
 *
 * Exports `runLookups(client)` which asserts exact seed values for every table,
 * exercises data-type round-trips, and verifies edge-cases (no-match, NULL,
 * apostrophe, fields array). Designed to run identically on all five engines.
 *
 * Design notes
 * ------------
 * - All parametrised SQL uses `ph(client, n)` for engine-correct placeholders.
 * - Column access uses `col(row, name)` (case-insensitive; Oracle → UPPERCASE).
 * - Numeric columns go through `num(v)` (pg/mysql return DECIMAL as string).
 * - The `condition` column is named `item_condition` on Oracle and `[condition]`
 *   on MSSQL; retrieved via `conditionCol(client)` and aliased as `book_condition`
 *   so result rows use the same key on every engine.
 * - Timestamp values are NOT asserted as exact strings — engine formatting differs.
 * - Temporary rows (data-type round-trips) are cleaned up before the function
 *   returns, making it safely rerunnable.
 */

import assert from 'node:assert/strict';
import { SqlClient } from '../../src/client/SqlClient';
import { ph, col, num, conditionCol, bindDate } from './_helpers';
import { rows } from '../../src/result/ResultSet';
import { lt } from '../../src/result/matchers';

export async function runLookups(client: SqlClient): Promise<void> {

    // ==========================================================================
    // BOOKS
    // ==========================================================================

    // L-B1: book-001 full row assertion
    {
        const sql = `SELECT title, author, genre, price, stock, isbn FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-001']);
        assert.equal(result.rowCount, 1, `L-B1: rowCount should be 1, got ${result.rowCount}`);
        const book = rows(result).one();
        assert.equal(book.string('title'), 'To Kill a Mockingbird', 'L-B1: title');
        assert.equal(book.string('author'), 'Harper Lee', 'L-B1: author');
        assert.equal(book.string('genre'), 'Fiction', 'L-B1: genre');
        assert.equal(book.number('price'), 12.99, 'L-B1: price');
        assert.equal(book.number('stock'), 15, 'L-B1: stock');
        assert.equal(book.string('isbn'), '978-0-06-112008-4', `L-B1: isbn mismatch`);
    }

    // L-B2: book-006 genre=Non-Fiction, price=18.99
    {
        const sql = `SELECT genre, price FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-006']);
        assert.equal(result.rowCount, 1, `L-B2: rowCount should be 1`);
        const row = result.rows[0];
        assert.equal(String(col(row, 'genre')), 'Non-Fiction', `L-B2: genre should be Non-Fiction`);
        assert.equal(num(col(row, 'price')), 18.99, `L-B2: price should be 18.99`);
    }

    // L-B3: lookup by isbn → book-003 title '1984'
    {
        const sql = `SELECT book_id, title FROM books WHERE isbn = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['978-0-452-28423-4']);
        assert.equal(result.rowCount, 1, `L-B3: rowCount should be 1`);
        assert.equal(String(col(result.rows[0], 'title')), '1984', `L-B3: title should be '1984'`);
        assert.equal(String(col(result.rows[0], 'book_id')), 'book-003', `L-B3: book_id should be 'book-003'`);
    }

    // L-B4: lookup by author 'Jane Austen' → book-004
    {
        const sql = `SELECT book_id FROM books WHERE author = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['Jane Austen']);
        assert.equal(result.rowCount, 1, `L-B4: rowCount should be 1`);
        assert.equal(String(col(result.rows[0], 'book_id')), 'book-004', `L-B4: book_id should be 'book-004'`);
    }

    // L-B5: multi-row genre='Non-Fiction' ORDER BY title → [Educated, Sapiens]
    {
        const sql = `SELECT title FROM books WHERE genre = ${ph(client, 1)} ORDER BY title`;
        const result = await client.query<Record<string, unknown>>(sql, ['Non-Fiction']);
        assert.equal(result.rowCount, 2, `L-B5: expected 2 Non-Fiction books, got ${result.rowCount}`);
        assert.deepEqual(rows(result).column('title').map(String), ['Educated', 'Sapiens'], `L-B5: titles mismatch`);
    }

    // L-B6: scalar stock of book-008 → 25
    {
        const sql = `SELECT stock FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-008']);
        assert.equal(result.rowCount, 1, `L-B6: rowCount should be 1`);
        assert.equal(num(col(result.rows[0], 'stock')), 25, `L-B6: stock should be 25`);
    }

    // L-B7: scalar price of book-005 → 8.99
    {
        const sql = `SELECT price FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-005']);
        assert.equal(result.rowCount, 1, `L-B7: rowCount should be 1`);
        assert.equal(num(col(result.rows[0], 'price')), 8.99, `L-B7: price should be 8.99`);
    }

    // L-B8: no-match id 'book-999' → rowCount=0 & rows empty
    {
        const sql = `SELECT title FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-999']);
        assert.equal(result.rowCount, 0, `L-B8: expected rowCount=0, got ${result.rowCount}`);
        assert.equal(result.rows.length, 0, `L-B8: expected rows.length=0, got ${result.rows.length}`);
    }

    // L-B9: count(*) → 8
    {
        const sql = 'SELECT COUNT(*) AS cnt FROM books';
        const countResult = await client.query<Record<string, unknown>>(sql);
        assert.equal(Number(rows(countResult).scalar()), 8, `L-B9: expected 8 books`);
    }

    // L-B10: matcher filtering on a fetched result (dogfood)
    {
        const allBooks = await client.query(`SELECT book_id, genre, price FROM books`);
        const cheapFiction = rows(allBooks).where({ genre: 'Fiction', price: lt(10) });
        assert.equal(cheapFiction.length, 2, 'matcher: Fiction under 10 → book-004, book-005');
        const orwell = rows(allBooks).find((row) => String(row.get('book_id')) === 'book-003');
        assert.ok(orwell, 'predicate: book-003 found');
    }

    // ==========================================================================
    // USERS
    // ==========================================================================

    // L-U1: by email 'bob@bookhive.test' → username 'bob' / user-002
    {
        const sql = `SELECT user_id, username FROM users WHERE email = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['bob@bookhive.test']);
        assert.equal(result.rowCount, 1, `L-U1: rowCount should be 1`);
        assert.equal(String(col(result.rows[0], 'username')), 'bob', `L-U1: username should be 'bob'`);
        assert.equal(String(col(result.rows[0], 'user_id')), 'user-002', `L-U1: user_id should be 'user-002'`);
    }

    // L-U2: by username 'carol' → email & user-003
    {
        const sql = `SELECT user_id, email FROM users WHERE username = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['carol']);
        assert.equal(result.rowCount, 1, `L-U2: rowCount should be 1`);
        assert.equal(String(col(result.rows[0], 'email')), 'carol@bookhive.test', `L-U2: email mismatch`);
        assert.equal(String(col(result.rows[0], 'user_id')), 'user-003', `L-U2: user_id should be 'user-003'`);
    }

    // L-U3: by id user-001 → username 'alice'
    {
        const sql = `SELECT username FROM users WHERE user_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['user-001']);
        assert.equal(result.rowCount, 1, `L-U3: rowCount should be 1`);
        assert.equal(String(col(result.rows[0], 'username')), 'alice', `L-U3: username should be 'alice'`);
    }

    // L-U4: count → 3
    {
        const sql = 'SELECT COUNT(*) AS cnt FROM users';
        const result = await client.query<Record<string, unknown>>(sql);
        assert.equal(num(col(result.rows[0], 'cnt')), 3, `L-U4: expected 3 users`);
    }

    // ==========================================================================
    // ORDERS
    // ==========================================================================

    // L-O1: order-001 → total_price=36.97 / status='COMPLETED' / user_id='user-001'
    {
        const sql = `SELECT user_id, total_price, status FROM orders WHERE order_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['order-001']);
        assert.equal(result.rowCount, 1, `L-O1: rowCount should be 1`);
        const row = result.rows[0];
        assert.equal(num(col(row, 'total_price')), 36.97, `L-O1: total_price mismatch`);
        assert.equal(String(col(row, 'status')), 'COMPLETED', `L-O1: status should be COMPLETED`);
        assert.equal(String(col(row, 'user_id')), 'user-001', `L-O1: user_id should be user-001`);
    }

    // L-O2: order-003 → total_price=29.98 / status='PENDING'
    {
        const sql = `SELECT total_price, status FROM orders WHERE order_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['order-003']);
        assert.equal(result.rowCount, 1, `L-O2: rowCount should be 1`);
        const row = result.rows[0];
        assert.equal(num(col(row, 'total_price')), 29.98, `L-O2: total_price mismatch`);
        assert.equal(String(col(row, 'status')), 'PENDING', `L-O2: status should be PENDING`);
    }

    // L-O3: orders for user-001 ORDER BY order_id → [order-001, order-002]
    {
        const sql = `SELECT order_id FROM orders WHERE user_id = ${ph(client, 1)} ORDER BY order_id`;
        const result = await client.query<Record<string, unknown>>(sql, ['user-001']);
        assert.equal(result.rowCount, 2, `L-O3: expected 2 orders for user-001`);
        const ids = result.rows.map((r) => String(col(r, 'order_id')));
        assert.deepEqual(ids, ['order-001', 'order-002'], `L-O3: order_ids mismatch: ${JSON.stringify(ids)}`);
    }

    // L-O4: count for user-001 → 2, user-003 → 0
    {
        const sql1 = `SELECT COUNT(*) AS cnt FROM orders WHERE user_id = ${ph(client, 1)}`;
        const res1 = await client.query<Record<string, unknown>>(sql1, ['user-001']);
        assert.equal(num(col(res1.rows[0], 'cnt')), 2, `L-O4: user-001 should have 2 orders`);

        const res3 = await client.query<Record<string, unknown>>(sql1, ['user-003']);
        assert.equal(num(col(res3.rows[0], 'cnt')), 0, `L-O4: user-003 should have 0 orders`);
    }

    // ==========================================================================
    // ORDER ITEMS
    // ==========================================================================

    // L-OI1: for order-002 → 1 row book-006 q1 price 18.99
    {
        const sql = `SELECT book_id, quantity, price_at_purchase FROM order_items WHERE order_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['order-002']);
        assert.equal(result.rowCount, 1, `L-OI1: expected 1 order item`);
        const row = result.rows[0];
        assert.equal(String(col(row, 'book_id')), 'book-006', `L-OI1: book_id should be book-006`);
        assert.equal(num(col(row, 'quantity')), 1, `L-OI1: quantity should be 1`);
        assert.equal(num(col(row, 'price_at_purchase')), 18.99, `L-OI1: price should be 18.99`);
    }

    // L-OI2: for order-001 ORDER BY book_id → [book-001 q1 12.99, book-003 q2 11.99]
    {
        const sql = `SELECT book_id, quantity, price_at_purchase FROM order_items WHERE order_id = ${ph(client, 1)} ORDER BY book_id`;
        const result = await client.query<Record<string, unknown>>(sql, ['order-001']);
        assert.equal(result.rowCount, 2, `L-OI2: expected 2 order items`);
        const row0 = result.rows[0];
        const row1 = result.rows[1];
        assert.equal(String(col(row0, 'book_id')), 'book-001', `L-OI2: first book_id should be book-001`);
        assert.equal(num(col(row0, 'quantity')), 1, `L-OI2: first quantity should be 1`);
        assert.equal(num(col(row0, 'price_at_purchase')), 12.99, `L-OI2: first price should be 12.99`);
        assert.equal(String(col(row1, 'book_id')), 'book-003', `L-OI2: second book_id should be book-003`);
        assert.equal(num(col(row1, 'quantity')), 2, `L-OI2: second quantity should be 2`);
        assert.equal(num(col(row1, 'price_at_purchase')), 11.99, `L-OI2: second price should be 11.99`);
    }

    // L-OI3: SUM(quantity) for order-001 → 3
    {
        const sql = `SELECT SUM(quantity) AS total_qty FROM order_items WHERE order_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['order-001']);
        assert.equal(num(col(result.rows[0], 'total_qty')), 3, `L-OI3: expected SUM(quantity)=3`);
    }

    // ==========================================================================
    // CART ITEMS
    // ==========================================================================

    // L-C1: for user-002 → book-002 q3
    {
        const sql = `SELECT book_id, quantity FROM cart_items WHERE user_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['user-002']);
        assert.equal(result.rowCount, 1, `L-C1: expected 1 cart item for user-002`);
        assert.equal(String(col(result.rows[0], 'book_id')), 'book-002', `L-C1: book_id should be book-002`);
        assert.equal(num(col(result.rows[0], 'quantity')), 3, `L-C1: quantity should be 3`);
    }

    // L-C2: for user-001 → book-005 q1
    {
        const sql = `SELECT book_id, quantity FROM cart_items WHERE user_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['user-001']);
        assert.equal(result.rowCount, 1, `L-C2: expected 1 cart item for user-001`);
        assert.equal(String(col(result.rows[0], 'book_id')), 'book-005', `L-C2: book_id should be book-005`);
        assert.equal(num(col(result.rows[0], 'quantity')), 1, `L-C2: quantity should be 1`);
    }

    // ==========================================================================
    // MARKETPLACE LISTINGS
    // ==========================================================================

    // L-ML1: listing-001 → seller=user-001 / book_id=book-004 / condition=USED_GOOD / price=6.5 / status=ACTIVE
    {
        const cc = conditionCol(client);
        const sql = `SELECT seller_id, book_id, ${cc} AS book_condition, price, status FROM marketplace_listings WHERE listing_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['listing-001']);
        assert.equal(result.rowCount, 1, `L-ML1: rowCount should be 1`);
        const row = result.rows[0];
        assert.equal(String(col(row, 'seller_id')), 'user-001', `L-ML1: seller_id mismatch`);
        assert.equal(String(col(row, 'book_id')), 'book-004', `L-ML1: book_id mismatch`);
        assert.equal(String(col(row, 'book_condition')), 'USED_GOOD', `L-ML1: condition mismatch`);
        assert.equal(num(col(row, 'price')), 6.5, `L-ML1: price mismatch`);
        assert.equal(String(col(row, 'status')), 'ACTIVE', `L-ML1: status mismatch`);
    }

    // L-ML2: listing-003 → condition=USED_FAIR / price=4 / status=SOLD
    {
        const cc = conditionCol(client);
        const sql = `SELECT ${cc} AS book_condition, price, status FROM marketplace_listings WHERE listing_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['listing-003']);
        assert.equal(result.rowCount, 1, `L-ML2: rowCount should be 1`);
        const row = result.rows[0];
        assert.equal(String(col(row, 'book_condition')), 'USED_FAIR', `L-ML2: condition mismatch`);
        assert.equal(num(col(row, 'price')), 4, `L-ML2: price mismatch`);
        assert.equal(String(col(row, 'status')), 'SOLD', `L-ML2: status mismatch`);
    }

    // L-ML3: by status='ACTIVE' ORDER BY listing_id → [listing-001, listing-002]
    {
        const sql = `SELECT listing_id FROM marketplace_listings WHERE status = ${ph(client, 1)} ORDER BY listing_id`;
        const result = await client.query<Record<string, unknown>>(sql, ['ACTIVE']);
        assert.equal(result.rowCount, 2, `L-ML3: expected 2 ACTIVE listings`);
        const ids = result.rows.map((r) => String(col(r, 'listing_id')));
        assert.deepEqual(ids, ['listing-001', 'listing-002'], `L-ML3: listing_ids mismatch: ${JSON.stringify(ids)}`);
    }

    // L-ML4: by seller user-002 → listing-002
    {
        const sql = `SELECT listing_id FROM marketplace_listings WHERE seller_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['user-002']);
        assert.equal(result.rowCount, 1, `L-ML4: expected 1 listing for user-002`);
        assert.equal(String(col(result.rows[0], 'listing_id')), 'listing-002', `L-ML4: listing_id should be listing-002`);
    }

    // ==========================================================================
    // DATA-TYPE ROUND-TRIPS & EDGES
    // ==========================================================================

    // L-DT1: insert a temp book with price 7.77 → retrieve num(price)===7.77
    {
        const tempId = 'lookup-dt1-tmp';
        const insSQL = [
            'INSERT INTO books',
            '(book_id, title, author, genre, description, price, cover_image, stock, isbn)',
            `VALUES (${ph(client, 1)}, ${ph(client, 2)}, ${ph(client, 3)}, ${ph(client, 4)}, ${ph(client, 5)}, ${ph(client, 6)}, ${ph(client, 7)}, ${ph(client, 8)}, ${ph(client, 9)})`,
        ].join(' ');
        await client.execute(insSQL, [
            tempId, 'Temp Price Book', 'Test Author', 'Fiction',
            'A test description', 7.77, null, 0, null,
        ]);
        try {
            const selSQL = `SELECT price FROM books WHERE book_id = ${ph(client, 1)}`;
            const result = await client.query<Record<string, unknown>>(selSQL, [tempId]);
            assert.equal(result.rowCount, 1, `L-DT1: rowCount should be 1`);
            assert.equal(num(col(result.rows[0], 'price')), 7.77, `L-DT1: price should round-trip as 7.77`);
        } finally {
            await client.execute(`DELETE FROM books WHERE book_id = ${ph(client, 1)}`, [tempId]);
        }
    }

    // L-DT2: insert a temp book with NULL description & NULL cover_image → col(row,'description')===null
    {
        const tempId = 'lookup-dt2-tmp';
        const insSQL = [
            'INSERT INTO books',
            '(book_id, title, author, genre, description, price, cover_image, stock, isbn)',
            `VALUES (${ph(client, 1)}, ${ph(client, 2)}, ${ph(client, 3)}, ${ph(client, 4)}, ${ph(client, 5)}, ${ph(client, 6)}, ${ph(client, 7)}, ${ph(client, 8)}, ${ph(client, 9)})`,
        ].join(' ');
        await client.execute(insSQL, [
            tempId, 'Null Fields Book', 'Test Author', 'Fiction',
            null, 5.00, null, 0, null,
        ]);
        try {
            const selSQL = `SELECT description, cover_image FROM books WHERE book_id = ${ph(client, 1)}`;
            const result = await client.query<Record<string, unknown>>(selSQL, [tempId]);
            assert.equal(result.rowCount, 1, `L-DT2: rowCount should be 1`);
            const row = result.rows[0];
            // col() must return null (not undefined) for a present-but-NULL column
            assert.strictEqual(col(row, 'description'), null, `L-DT2: description should be null (not undefined)`);
            assert.strictEqual(col(row, 'cover_image'), null, `L-DT2: cover_image should be null (not undefined)`);
        } finally {
            await client.execute(`DELETE FROM books WHERE book_id = ${ph(client, 1)}`, [tempId]);
        }
    }

    // L-DT3: apostrophe round-trip — description of book-008 contains "Baggins'"
    {
        const sql = `SELECT description FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-008']);
        assert.equal(result.rowCount, 1, `L-DT3: rowCount should be 1`);
        const desc = String(col(result.rows[0], 'description'));
        assert.ok(desc.includes("Baggins'"), `L-DT3: description should contain "Baggins'" (apostrophe), got: "${desc}"`);
    }

    // L-DT4: no-match SELECT → rowCount===0 and rows.length===0
    {
        const sql = `SELECT title, price FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['does-not-exist']);
        assert.strictEqual(result.rowCount, 0, `L-DT4: rowCount should be 0`);
        assert.strictEqual(result.rows.length, 0, `L-DT4: rows.length should be 0`);
    }

    // L-DT5: a SELECT returns a non-empty fields array with the selected column names
    {
        const sql = `SELECT book_id, title, price FROM books WHERE book_id = ${ph(client, 1)}`;
        const result = await client.query<Record<string, unknown>>(sql, ['book-001']);
        assert.ok(Array.isArray(result.fields), `L-DT5: fields should be an array`);
        assert.ok(result.fields.length > 0, `L-DT5: fields should be non-empty`);
        const fieldNames = result.fields.map((f) => f.name.toLowerCase());
        assert.ok(fieldNames.includes('book_id'), `L-DT5: fields should include 'book_id', got: ${JSON.stringify(fieldNames)}`);
        assert.ok(fieldNames.includes('title'), `L-DT5: fields should include 'title', got: ${JSON.stringify(fieldNames)}`);
        assert.ok(fieldNames.includes('price'), `L-DT5: fields should include 'price', got: ${JSON.stringify(fieldNames)}`);
    }
}
