import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  calculateQuote,
  canTransitionQuoteStatus,
  createEmptyStore,
  dateLabel,
  defaultSettings,
  lineAmount,
  lineParts,
  MAX_AMOUNT_SATANG,
  normalizeStore,
  quoteCanEdit,
  quantityMilli,
  todayISO,
} from './domain.mjs';

// Test fixtures only. The application starts from createEmptyStore().
const defaults = {
  companyName: 'Example Ltd.', companyTaxId: '', companyEmail: '', companyPhone: '', companyAddress: '',
  defaultVat: 7, defaultValidity: 30, quotePrefix: 'QT',
};

const customer = { id: 'cus-1', name: 'บริษัท ตัวอย่าง จำกัด', contact: 'ผู้ติดต่อ', email: 'a@example.com', phone: '0812345678', address: 'กรุงเทพฯ' };
const product = { id: 'prd-1', code: 'A-1', name: 'บริการ', unit: 'งาน', price: 10000, vat: true };
const quote = {
  id: 'qt-1', number: 'QT-2026-001', customerId: customer.id, status: 'draft', issueDate: '2026-11-18',
  validUntil: '2026-12-18', followUpDate: '', note: '',
  items: [{ id: 'line-1', name: 'บริการ', description: '', qty: 1, unit: 'งาน', price: 10000, discount: 0, vat: true }],
  discount: 0, vatRate: 7, createdAt: '2026-11-18T10:00:00.000Z',
};
const validStore = (overrides = {}) => ({ quotes: [quote], customers: [customer], products: [product], settings: defaults, sequences: {}, ...overrides });

test('todayISO uses Bangkok calendar date on both sides of local midnight', () => {
  assert.equal(todayISO(new Date('2026-11-17T17:00:00.000Z')), '2026-11-18');
  assert.equal(todayISO(new Date('2026-11-18T02:00:00.000Z')), '2026-11-18');
});

test('addDays uses calendar arithmetic and validates dates', () => {
  assert.equal(addDays('2026-11-18', 30), '2026-12-18');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
});

test('date labels do not shift with the host timezone', () => {
  assert.match(dateLabel('2026-11-18'), /18/);
  assert.equal(dateLabel('2026-02-30'), '-');
});

test('quantity and line money round to integer satang with bounded quantities', () => {
  assert.equal(quantityMilli('0.3334'), 333);
  assert.equal(lineAmount({ qty: 0.333, price: 100, discount: 0 }), 33);
  assert.equal(lineAmount({ qty: 0.005, price: 100, discount: 0 }), 1);
  assert.equal(lineAmount({ qty: 1, price: 500, discount: 900 }), 0);
  assert.equal(quantityMilli('999999999'), 1_000_000_000);
});

test('quote totals apply item and bill discounts and prorate VAT exactly in satang', () => {
  const totals = calculateQuote({
    vatRate: 7, discount: 1000,
    items: [
      { qty: 1, price: 10_000, discount: 0, vat: true },
      { qty: 1, price: 10_000, discount: 0, vat: false },
    ],
  });
  assert.deepEqual(totals, { itemSubtotal: 20_000, discount: 1_000, beforeVat: 19_000, vat: 665, total: 19_665 });
  const withLineDiscount = calculateQuote({ vatRate: 7, discount: 0, items: [{ qty: 1, price: 10_000, discount: 1_000, vat: true }] });
  assert.equal(withLineDiscount.total, 9_630);
});

test('document VAT rounds once after exact allocation of the bill discount', () => {
  const totals = calculateQuote({
    vatRate: 7, discount: 1,
    items: [
      { qty: 1, price: 8, discount: 0, vat: true },
      { qty: 1, price: 2, discount: 0, vat: false },
    ],
  });
  // Exact VAT is 8 * (9 / 10) * 7 / 100 = 0.504 satang.
  assert.deepEqual(totals, { itemSubtotal: 10, discount: 1, beforeVat: 9, vat: 1, total: 10 });
  assert.equal(calculateQuote({ items: [], discount: 0, vatRate: 7 }).vat, 0);
});

test('fresh stores contain no customer, company, product, or document examples', () => {
  const first = createEmptyStore();
  const second = createEmptyStore();
  assert.deepEqual(first, {
    schemaVersion: 2, quotes: [], customers: [], products: [], settings: { ...defaultSettings }, sequences: {},
  });
  for (const key of ['companyName', 'companyTaxId', 'companyEmail', 'companyPhone', 'companyAddress']) {
    assert.equal(first.settings[key], '');
  }
  assert.equal('isSample' in first, false);
  assert.deepEqual(normalizeStore(JSON.parse(JSON.stringify(first))), first);
  first.settings.companyName = 'Test only';
  first.customers.push(customer);
  assert.equal(second.settings.companyName, '');
  assert.equal(second.customers.length, 0);
});

test('import normalizes legacy records and snapshots the linked customer', () => {
  const legacy = validStore();
  delete legacy.isSample;
  delete legacy.quotes[0].customerSnapshot;
  const normalized = normalizeStore(legacy, defaults);
  assert.deepEqual(normalized.quotes[0].customerSnapshot, customer);
  assert.deepEqual(normalized.quotes[0].companySnapshot, defaults);
  assert.equal(normalized.schemaVersion, 2);
  assert.equal('isSample' in normalized, false);
  assert.equal(normalized.settings.defaultVat, 7);
  assert.equal(legacy.quotes[0].customerSnapshot, undefined);
});

test('legacy sample flags are removed without deleting user records', () => {
  const normalized = normalizeStore(validStore({ isSample: true }), defaults);
  assert.equal('isSample' in normalized, false);
  assert.equal(normalized.quotes.length, 1);
});

test('issued state survives import and prevents editing or transition back to draft', () => {
  const issued = { ...quote, status: 'sent', issuedAt: '2026-11-18T10:05:00.000Z' };
  const normalized = normalizeStore(validStore({ quotes: [issued] }), defaults).quotes[0];
  assert.equal(normalized.issuedAt, issued.issuedAt);
  assert.equal(quoteCanEdit(normalized), false);
  assert.equal(canTransitionQuoteStatus(normalized, 'draft'), false);
  assert.equal(canTransitionQuoteStatus(normalized, 'approved'), true);
  assert.equal(quoteCanEdit({ ...normalized, status: 'draft' }), false);
  assert.equal(canTransitionQuoteStatus({ ...normalized, status: 'draft' }, 'draft'), false);
  assert.equal(quoteCanEdit({ ...quote, issuedAt: null }), true);
  assert.equal(canTransitionQuoteStatus(quote, 'sent'), true);
  assert.equal(canTransitionQuoteStatus(quote, 'unknown'), false);
  assert.equal(canTransitionQuoteStatus(null, 'draft'), false);
});

test('legacy non-drafts are migrated as issued and invalid timestamps are rejected', () => {
  const migrated = normalizeStore(validStore({ quotes: [{ ...quote, status: 'approved' }] }), defaults).quotes[0];
  assert.equal(migrated.issuedAt, quote.createdAt);
  assert.equal(quoteCanEdit(migrated), false);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, issuedAt: 'not-a-date' }] }), defaults), /เวลา/);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, issuedAt: '2026-02-30T10:00:00Z' }] }), defaults), /เวลา/);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, createdAt: '2026-99-99' }] }), defaults), /เวลา/);
  assert.throws(() => normalizeStore({ ...createEmptyStore(), schemaVersion: 3 }), /เวอร์ชัน/);
});

test('quote company snapshots survive backup import and validate bounded settings', () => {
  const issuer = { ...defaults, companyName: 'บริษัทเดิม จำกัด', companyAddress: 'เลขที่ 12' };
  const normalized = normalizeStore(validStore({ quotes: [{ ...quote, companySnapshot: issuer }] }), defaults);
  assert.deepEqual(normalized.quotes[0].companySnapshot, issuer);
  assert.throws(() => normalizeStore(validStore({ settings: { ...defaults, unexpected: 'field' } }), defaults), /ตั้งค่า/);
  assert.throws(() => normalizeStore(validStore({ settings: { ...defaults, defaultVat: 101 } }), defaults), /ตั้งค่า/);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, companySnapshot: { ...issuer, extra: true } }] }), defaults), /ตั้งค่า/);
});

test('import rejects malformed nested data, invalid dates, duplicate keys, and excessive totals', () => {
  assert.throws(() => normalizeStore(validStore({ quotes: [{}] }), defaults), /ใบเสนอราคา/);
  assert.throws(() => normalizeStore(validStore({ customers: [customer, customer] }), defaults), /ซ้ำ/);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, issueDate: '2026-02-30' }] }), defaults), /ใบเสนอราคา/);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, items: [{ ...quote.items[0], qty: 0 }] }] }), defaults), /สินค้าในใบเสนอราคา/);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, vatRate: 101 }] }), defaults), /ใบเสนอราคา/);
  assert.throws(() => normalizeStore(validStore({ quotes: [{ ...quote, items: [{ ...quote.items[0], qty: 1_000_000, price: 1_000_000_000_000 }] }] }), defaults), /สูงเกิน/);
});

test('discounts cannot hide an over-limit line or pre-discount subtotal', () => {
  const item = quote.items[0];
  const quoteWithItems = (items, other = {}) => validStore({ quotes: [{ ...quote, items, ...other }] });

  const oversizedLine = { ...item, qty: 2, price: MAX_AMOUNT_SATANG, discount: MAX_AMOUNT_SATANG - 1 };
  assert.throws(() => normalizeStore(quoteWithItems([oversizedLine]), defaults), /สูงเกิน/);

  const first = { ...item, price: MAX_AMOUNT_SATANG / 2, discount: MAX_AMOUNT_SATANG / 2 - 100 };
  const second = { ...first, id: 'line-2', price: first.price + 1 };
  assert.throws(() => normalizeStore(quoteWithItems([first, second]), defaults), /สูงเกิน/);

  const atLimit = { ...item, price: MAX_AMOUNT_SATANG, discount: 0, vat: false };
  const results = normalizeStore(quoteWithItems([atLimit]), defaults).quotes[0];
  assert.equal(calculateQuote(results).total, MAX_AMOUNT_SATANG);
  assert.throws(() => normalizeStore(quoteWithItems([{ ...atLimit, vat: true }]), defaults), /สูงเกิน/);

  const zeroed = { ...item, qty: 0.005, price: 100, discount: 2 };
  assert.deepEqual(lineParts(zeroed), { gross: 1, discount: 1, net: 0 });
});
