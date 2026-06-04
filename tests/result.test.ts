import assert from 'node:assert/strict';
import { getValue, getString, getNumber, getBoolean } from '../src/result/accessors';

const row = { title: 'To Kill a Mockingbird', price: '12.99', stock: 15, active: 1, sold: 't', missingNull: null };
const oracleRow = { TITLE: '1984', PRICE: '11.99' };

// getValue: case-insensitive, null-aware, absent→undefined
assert.equal(getValue(row, 'title'), 'To Kill a Mockingbird');
assert.equal(getValue(oracleRow, 'title'), '1984');           // UPPERCASE key (Oracle)
assert.equal(getValue(row, 'missingNull'), null);             // present-null → null
assert.equal(getValue(row, 'nope'), undefined);               // absent → undefined

// getString
assert.equal(getString(row, 'title'), 'To Kill a Mockingbird');
assert.equal(getString(row, 'price'), '12.99');
assert.equal(getString(row, 'missingNull'), null);
assert.equal(getString(row, 'nope'), undefined);

// getNumber (decimal-as-string → number)
assert.equal(getNumber(row, 'price'), 12.99);
assert.equal(getNumber(oracleRow, 'price'), 11.99);
assert.equal(getNumber(row, 'stock'), 15);
assert.equal(getNumber(row, 'missingNull'), null);
assert.equal(getNumber(row, 'nope'), undefined);

// getBoolean (engine variants)
assert.equal(getBoolean(row, 'active'), true);                // 1
assert.equal(getBoolean(row, 'sold'), true);                  // 't'
assert.equal(getBoolean({ x: 0 }, 'x'), false);
assert.equal(getBoolean({ x: 'false' }, 'x'), false);
assert.equal(getBoolean({ x: true }, 'x'), true);
assert.equal(getBoolean(row, 'missingNull'), null);
assert.equal(getBoolean(row, 'nope'), undefined);
assert.throws(() => getBoolean({ x: 'maybe' }, 'x'), RangeError);

console.log('result.test.ts core PASSED');
