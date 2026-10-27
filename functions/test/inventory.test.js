import test from 'node:test';
import assert from 'node:assert/strict';
import { balance, assertAvailable, materialKey, pack, category } from '../inventory.js';
const opening = (quantity = 10) => ({ category: 'Palm Oil', quantity, quantityLitres: quantity, unit: '1L', stockLocation: 'shop' });
const sale = (quantity = 1) => ({ category: 'Palm Oil', quantitySold: quantity, litresSold: quantity, stockContainerType: '1L', stockLocation: 'shop' });
const material = (inventoryType, quantity) => ({ inventoryType, quantity, status: 'Purchased' });
const turn = { kegCount: 1, bottles75cl: 0, bottles1L: 22, jerrycans5L: 1, stockLocation: 'shop' };

test('opening stock and sales deduct matching litres and packages', () => {
  const b = balance({ shopOpeningStock: [opening()], sales: [sale(3)] });
  assert.equal(b.stock['Palm Oil'], 7); assert.equal(b.packaged['1L'], 7);
});
test('sold-out product cannot be sold', () => assert.throws(() => assertAvailable('sales', sale(), balance({})), /stock no reach/));
test('sale exceeding available stock is rejected', () => assert.throws(() => assertAvailable('sales', sale(11), balance({ shopOpeningStock: [opening()] })), /stock no reach/));
test('exact remaining quantity can be sold', () => assert.doesNotThrow(() => assertAvailable('sales', sale(10), balance({ shopOpeningStock: [opening()] }))));
test('second sale cannot reuse stock consumed by first', () => {
  const b = balance({ shopOpeningStock: [opening(1)], sales: [sale(1)] });
  assert.throws(() => assertAvailable('sales', sale(1), b));
});
test('correct litres but wrong package size is blocked', () => assert.throws(() => assertAvailable('sales', { ...sale(), stockContainerType: '5L', litresSold: 5 }, balance({ shopOpeningStock: [opening()] })), /packaged stock/));
test('turning consumes exactly one keg and matching containers', () => {
  const records = { materials: [material('kegs', 1), material('1L', 22), material('5L', 1)] };
  assert.doesNotThrow(() => assertAvailable('conversions', turn, balance(records)));
  const b = balance({ ...records, conversions: [turn] });
  assert.equal(b.stock['Palm Oil'], 27); assert.equal(b.packaged['1L'], 22); assert.equal(b.packaged['5L'], 1);
  assert.equal(b.materials.kegs, 0); assert.equal(b.materials['1L'], 0);
});
test('missing containers prevent turning', () => assert.throws(() => assertAvailable('conversions', turn, balance({ materials: [material('kegs', 1)] })), /Not enough/));
test('missing kegs prevent turning', () => assert.throws(() => assertAvailable('conversions', turn, balance({ materials: [material('1L', 30), material('5L', 10)] })), /kegs/));
test('over 27 usable litres per keg is blocked', () => assert.throws(() => assertAvailable('conversions', { ...turn, bottles1L: 28 }, balance({})), /27 usable/));
test('fractional or negative packaging counts are blocked', () => {
  assert.throws(() => assertAvailable('conversions', { ...turn, bottles1L: 1.5 }, balance({})));
  assert.throws(() => assertAvailable('conversions', { ...turn, bottles1L: -1 }, balance({})));
});
test('pending materials never increase stock', () => assert.equal(balance({ materials: [{ ...material('1L', 99), status: 'Pending' }] }).materials['1L'], 0));
test('cancelled records do not affect inventory', () => assert.equal(balance({ shopOpeningStock: [opening()], sales: [{ ...sale(10), status: 'cancelled' }] }).stock['Palm Oil'], 10));
test('honey and kuli-kuli never deduct palm oil', () => {
  const b = balance({ shopOpeningStock: [opening()], sales: [{ category: 'Honey', honeyBottlesSold: 1, stockLocation: 'shop' }, { category: 'Kuli-Kuli Oil', litresSold: 5, stockLocation: 'shop' }] });
  assert.equal(b.stock['Palm Oil'], 10); assert.equal(b.stock.Honey, -1); assert.equal(b.stock['Kuli-Kuli Oil'], -5);
});
test('caps and labels are not treated as empty containers', () => {
  assert.equal(materialKey({ materialName: '1L bottle labels' }), '');
  assert.equal(materialKey({ materialName: '75cl empty bottles' }), '75cl');
});
test('raw keg sale consumes kegs, not packaged litres', () => {
  const r = { ...sale(), productName: '30L Palm Oil Keg', unit: 'keg', productVolumeLitres: 30, litresSold: 30 };
  const before = balance({ materials: [material('kegs', 1)] });
  assert.doesNotThrow(() => assertAvailable('sales', r, before));
  const after = balance({ materials: [material('kegs', 1)], sales: [r] });
  assert.equal(after.materials.kegs, 0); assert.equal(after.stock['Palm Oil'], 0);
});
test('legacy snake-case categories resolve correctly', () => { assert.equal(category({ productType: 'palm_oil' }), 'Palm Oil'); assert.equal(category({ category: 'kuli_kuli' }), 'Kuli-Kuli Oil'); });
test('package identity resolves all supported sizes', () => { assert.equal(pack({ size: '75cl' }), '75cl'); assert.equal(pack({ size: '1L' }), '1L'); assert.equal(pack({ size: '5L' }), '5L'); });

test('Other products use product-specific unit balances', () => {
 const r = { productId: 'soap', category: 'Other', productName: 'Soap', quantitySold: 1, stockLocation: 'shop' };
 const b = balance({ shopOpeningStock: [{ productId: 'soap', category: 'Other', quantity: 2 }], sales: [r] });
 assert.equal(b.generic.soap, 1); assert.doesNotThrow(() => assertAvailable('sales', r, b));
 assert.throws(() => assertAvailable('sales', { ...r, quantitySold: 2 }, b));
});

test('admin opening stock makes kegs and empty packaging available for oil turning', () => {
  const records = { shopOpeningStock: [
    { recordType: 'opening_stock', category: 'Palm Oil', productName: 'Palm Oil Keg', stockUnit: 'kegs', stockContainerType: 'keg', quantity: 2, quantityKegs: 2 },
    { recordType: 'opening_stock', category: 'Palm Oil', productName: '75cl empty bottles', stockUnit: '75cl bottles', stockContainerType: '75cl', quantity: 40, quantityBottles: 0 },
    { recordType: 'opening_stock', category: 'Palm Oil', productName: '1L empty bottles', stockUnit: '1L bottles', stockContainerType: '1L', quantity: 30 },
    { recordType: 'opening_stock', category: 'Palm Oil', productName: '5L jerrycans', stockUnit: '5L jerrycans', stockContainerType: '5L', quantity: 5 },
  ] };
  const b = balance(records);
  assert.equal(b.materials.kegs, 2);
  assert.equal(b.materials['75cl'], 40);
  assert.equal(b.materials['1L'], 30);
  assert.equal(b.materials['5L'], 5);
  assert.doesNotThrow(() => assertAvailable('conversions', { kegCount: 1, bottles75cl: 10, bottles1L: 5, jerrycans5L: 1, stockLocation: 'shop', affectsShopStock: true }, b));
});
