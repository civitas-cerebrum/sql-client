import assert from 'node:assert/strict';
import {
    eq, ne, lt, lte, gt, gte, between, oneOf, like, contains,
    startsWith, endsWith, matches, isNull, notNull, not,
} from '../src/result/matchers';

// equality (loose String compare — pg decimals are strings)
assert.equal(eq('12.99')(12.99), true);
assert.equal(eq('Fiction')('Fiction'), true);
assert.equal(eq('Fiction')('Fantasy'), false);
assert.equal(ne('Fiction')('Fantasy'), true);
assert.equal(ne('Fiction')('Fiction'), false);

// numeric comparison (Number coercion; null/NaN → false)
assert.equal(lt(10)('8.99'), true);
assert.equal(lt(10)(10), false);
assert.equal(lte(10)(10), true);
assert.equal(gt(10)('12.99'), true);
assert.equal(gte(10)(10), true);
assert.equal(lt(10)(null), false);
assert.equal(lt(10)(undefined), false);
assert.equal(lt(10)('not-a-number'), false);
assert.equal(between(10, 15)('12.99'), true);
assert.equal(between(10, 15)('18.99'), false);
assert.equal(between(15, 10)(12), false);       // min>max → matches nothing

// membership
assert.equal(oneOf(['ACTIVE', 'SOLD'])('SOLD'), true);
assert.equal(oneOf(['ACTIVE', 'SOLD'])('PENDING'), false);

// string matchers (case-insensitive; null → false)
assert.equal(like('%1984%')('Nineteen 1984 Edition'), true);
assert.equal(like('book_001')('BOOK-001'.replace('-', '_').toLowerCase()), true); // _ = one char
assert.equal(like('Fic%')('Fiction'), true);
assert.equal(like('%tion')('Fiction'), true);
assert.equal(like('Fic%')('Fantasy'), false);
assert.equal(like('%x%')(null), false);
assert.equal(contains('gats')('The Great Gatsby'), true);
assert.equal(contains('zzz')('The Great Gatsby'), false);
assert.equal(startsWith('the ')('The Great Gatsby'), true);
assert.equal(endsWith('gatsby')('The Great Gatsby'), true);
assert.equal(matches(/^book-\d+$/)('book-001'), true);
assert.equal(matches(/^book-\d+$/)(null), false);

// null matchers
assert.equal(isNull()(null), true);
assert.equal(isNull()(undefined), true);
assert.equal(isNull()(0), false);
assert.equal(notNull()(0), true);
assert.equal(notNull()(null), false);

// negation
assert.equal(not(eq('Fiction'))('Fantasy'), true);
assert.equal(not(lt(10))(12), true);

import { findRow, filterRows } from '../src/result/accessors';

const books = [
    { book_id: 'book-004', genre: 'Fiction', price: '9.99' },
    { book_id: 'book-005', genre: 'Fiction', price: '8.99' },
    { book_id: 'book-006', genre: 'Non-Fiction', price: '18.99' },
];

// partial with matchers
assert.equal(filterRows(books, { genre: 'Fiction', price: lt(10) }).length, 2);
assert.equal(filterRows(books, { price: gte(15) }).length, 1);
assert.equal(findRow(books, { price: between(8, 9) })?.book_id, 'book-005');
assert.equal(findRow(books, { genre: eq('Non-Fiction') })?.book_id, 'book-006');

// literal still means equality (backward compat)
assert.equal(filterRows(books, { genre: 'Fiction' }).length, 2);

// raw-row predicate overload
assert.equal(filterRows(books, (r) => Number(r.price) < 10).length, 2);
assert.equal(findRow(books, (r) => r.genre === 'Non-Fiction')?.book_id, 'book-006');

console.log('matchers.test.ts accessors PASSED');
console.log('matchers.test.ts PASSED');
