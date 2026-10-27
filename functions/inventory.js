// Shared by the browser, trusted backend, and unit tests. No Firebase dependencies.
export const number = v => Number(String(v ?? 0).replace(/[₦,\s]/g, '')) || 0;
const text = v => String(v ?? '').toLowerCase();
export const isKeg = r => /keg/.test(text([r.stockContainerType, r.stockUnit, r.unit, r.size, r.productName, r.product, r.name, r.productType].join(' ')));
export const cancelled = r => ['cancelled', 'canceled', 'void', 'deleted'].includes(text(r.status || r.saleStatus));
export function category(r) {
  const explicit = text(r.category || r.productCategory || r.stockCategory);
  if (explicit === 'other') return 'Other';
  if (/honey|sweetener/.test(explicit)) return 'Honey';
  if (/kuli|groundnut/.test(explicit)) return 'Kuli-Kuli Oil';
  if (/palm|red oil/.test(explicit)) return 'Palm Oil';
  const s = text([r.category, r.productCategory, r.stockCategory, r.productType, r.product, r.productName, r.name].join(' '));
  if (/honey|sweetener/.test(s)) return 'Honey';
  if (/kuli|groundnut/.test(s)) return 'Kuli-Kuli Oil';
  if (/palm|red oil/.test(s)) return 'Palm Oil';
  return 'Other';
}
export function pack(r) {
  const s = text([r.stockContainerType, r.stockUnit, r.unit, r.size, r.productName, r.name, r.materialName].join(' ')).replace(/\s/g, '');
  if (/75cl|750ml/.test(s)) return '75cl';
  if (/5l|5litre|5liter/.test(s)) return '5L';
  if (/1l|1litre|1liter/.test(s)) return '1L';
  return '';
}
export function materialKey(r) {
  if (['75cl', '1L', '5L', 'kegs'].includes(r.inventoryType)) return r.inventoryType;
  const s = text(r.materialName || r.name || r.materialType);
  if (/keg/.test(s)) return 'kegs';
  // Do not count labels/caps as empty bottles. Explicit classification takes priority.
  if (/cap|label|seal/.test(s)) return '';
  return /bottle|container|jerrycan/.test(s) ? pack(r) : '';
}
const volume = { '75cl': .75, '1L': 1, '5L': 5 };
export function openingAmount(r) {
  if (category(r) === 'Honey') return number(r.quantityBottles ?? r.bottles ?? r.quantity);
  if (/keg/.test(text(r.stockUnit || r.unit || r.stockContainerType))) return 0;
  return number(r.quantityLitres ?? r.litres ?? r.liters ?? number(r.quantity) * (volume[pack(r)] || 1));
}
export function saleAmount(r) {
  if (category(r) === 'Honey') return number(r.honeyBottlesSold ?? r.quantityBottles ?? r.quantitySold ?? r.quantity);
  const specific = category(r) === 'Palm Oil' ? r.palmOilLitresSold || r.oilLitresSold : r.kuliKuliLitresSold;
  return number(specific || r.litresSold || r.quantityLitres || number(r.quantitySold ?? r.quantity) * (number(r.productVolumeLitres) || volume[pack(r)] || 1));
}
export function balance(records) {
  const stock = { 'Palm Oil': 0, 'Kuli-Kuli Oil': 0, Honey: 0 };
  const packaged = { '75cl': 0, '1L': 0, '5L': 0 };
  const materials = { '75cl': 0, '1L': 0, '5L': 0, kegs: 0 };
  const generic = {};
  let unclassified = 0;
  for (const r of records.shopOpeningStock || []) {
    if (cancelled(r)) continue;
    const c = category(r), k = pack(r);
    if (c in stock) stock[c] += openingAmount(r);
    if (c === 'Other' && r.productId) generic[r.productId] = (generic[r.productId] || 0) + number(r.quantity);
    const unitText = text([r.stockUnit, r.unit, r.stockContainerType, r.size].join(' '));
    const openingKegs = number(r.quantityKegs) || number(r.kegCount) || (/keg/.test(unitText) ? number(r.quantity) : 0);
    if (c === 'Palm Oil' && openingKegs > 0) materials.kegs += openingKegs;
    const openingPack = k || pack({ ...r, stockContainerType: r.stockContainerType || r.stockUnit || r.unit });
    if (openingPack && !/keg/.test(unitText)) {
      const quantity = number(r.quantityBottles) || number(r.bottles) || number(r.quantity);
      if (quantity > 0) materials[openingPack] += quantity;
    }
    if (c === 'Palm Oil' && k && !/keg/.test(unitText)) packaged[k] += number(r.quantity) || openingAmount(r) / volume[k];
  }
  for (const r of records.materials || []) {
    if (cancelled(r) || r.isPurchased === false || ['pending', 'unpaid', 'awaiting payment', 'not purchased', 'rejected'].includes(text(r.status)) || r.affectsStock === false) continue;
    const k = materialKey(r);
    if (k) materials[k] += number(r.purchasedQuantity ?? r.quantity);
    else unclassified++;
  }
  for (const r of records.conversions || []) {
    if (cancelled(r) || r.affectsStock === false || (r.stockLocation !== 'shop' && r.affectsShopStock !== true)) continue;
    const counts = { '75cl': number(r.bottles75clProduced ?? r.bottles75cl), '1L': number(r.bottles1LProduced ?? r.bottles1L), '5L': number(r.jerrycans5LProduced ?? r.jerrycans5L) };
    materials.kegs -= number(r.kegCount ?? r.kegs);
    for (const k of Object.keys(counts)) {
      packaged[k] += counts[k]; materials[k] -= counts[k]; stock['Palm Oil'] += counts[k] * volume[k];
    }
  }
  for (const r of records.sales || []) {
    if (cancelled(r) || r.affectsStock === false || !(r.isShopSale || r.stockLocation === 'shop' || r.saleLocation === 'shop')) continue;
    const c = category(r), k = pack(r);
    if (c === 'Palm Oil' && isKeg(r)) { materials.kegs -= number(r.quantitySold ?? r.quantity); continue; }
    if (c in stock) stock[c] -= saleAmount(r);
    if (c === 'Other' && r.productId) generic[r.productId] = (generic[r.productId] || 0) - number(r.quantitySold ?? r.quantity);
    if (c === 'Palm Oil' && k) packaged[k] -= number(r.quantitySold ?? r.quantity);
  }
  return { stock, packaged, materials, generic, unclassified };
}
export function assertAvailable(kind, r, b) {
  const fail = message => { throw new Error(message); };
  if (kind === 'sales' && r.affectsStock !== false) {
    const c = category(r), k = pack(r), qty = number(r.quantitySold ?? r.quantity), used = saleAmount(r);
    if (!(qty > 0) || !(used > 0)) fail('Enter a valid sale quantity and product volume.');
    if (c === 'Other' && (b.generic[r.productId] || 0) < qty) fail('This product stock no reach. Update its opening units in Product Management.');
    if (c === 'Palm Oil' && isKeg(r)) {
      if (b.materials.kegs < qty) fail('Not enough unturned oil kegs in this shop.');
      return;
    }
    if (c in b.stock && b.stock[c] + .000001 < used) fail(`${c} stock no reach. Available: ${Math.max(0, b.stock[c])}.`);
    if (c === 'Palm Oil' && k && b.packaged[k] + .000001 < qty) fail(`${k} packaged stock no reach. Turn more oil into this container first.`);
  }
  if (kind === 'conversions') {
    const counts = { kegs: number(r.kegCount), '75cl': number(r.bottles75cl), '1L': number(r.bottles1L), '5L': number(r.jerrycans5L) };
    if (!(counts.kegs > 0) || Object.values(counts).some(n => n < 0 || !Number.isInteger(n))) fail('Use positive whole kegs and whole container quantities.');
    const used = counts['75cl'] * .75 + counts['1L'] + counts['5L'] * 5;
    if (!(used > 0) || used > counts.kegs * 27 + .000001) fail('Containers must fit within 27 usable litres per keg.');
    for (const [k, n] of Object.entries(counts)) if (n > 0 && b.materials[k] + .000001 < n) fail(`Not enough ${k}. Admin must record the purchased materials or opening kegs before turning oil.`);
  }
}
