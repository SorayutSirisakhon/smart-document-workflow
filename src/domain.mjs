export const MAX_AMOUNT_SATANG = 1_000_000_000_000;
export const MAX_QUANTITY_MILLI = 1_000_000_000;
export const SCHEMA_VERSION = 2;
const MAX_QUOTE_AMOUNT = BigInt(MAX_AMOUNT_SATANG);
export const defaultSettings = Object.freeze({
  companyName: '',
  companyTaxId: '',
  companyEmail: '',
  companyPhone: '',
  companyAddress: '',
  defaultVat: 7,
  defaultValidity: 30,
  quotePrefix: 'QT',
});
const MAX_ITEMS_PER_QUOTE = 500;
const MAX_COLLECTION_SIZE = 100_000;
const VALID_STATUSES = new Set(['draft', 'sent', 'approved', 'rejected', 'expired']);

const asRecord = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max = 10_000) => typeof value === 'string' && value.length <= max;
const isSafeIntBetween = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function quoteCanEdit(quote) {
  return Boolean(quote && quote.status === 'draft' && !quote.issuedAt);
}

export function canTransitionQuoteStatus(quote, nextStatus) {
  if (!quote || !VALID_STATUSES.has(quote.status) || !VALID_STATUSES.has(nextStatus)) return false;
  const locked = Boolean(quote.issuedAt || quote.status !== 'draft');
  return !(locked && nextStatus === 'draft');
}

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  if (!isText(value, 100) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !parseISODate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function parseISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function todayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(dateString, days) {
  const parsed = parseISODate(dateString);
  const offset = Number(days);
  if (!parsed || !Number.isSafeInteger(offset)) throw new RangeError('Invalid date or day offset');
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + offset));
  const year = String(date.getUTCFullYear()).padStart(4, '0');
  return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function dateLabel(value, options = {}) {
  const parsed = parseISODate(value);
  if (!parsed) return '-';
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', ...options,
  }).format(date);
}

export function money(satang) {
  const amount = Number.isSafeInteger(satang) ? satang : 0;
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100);
}

export function numberValue(value) {
  const numeric = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(MAX_AMOUNT_SATANG, Math.max(-MAX_AMOUNT_SATANG, Math.round(numeric)));
}

export function quantityMilli(value) {
  const numeric = Number(String(value ?? '').replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(MAX_QUANTITY_MILLI, Math.max(0, Math.round(numeric * 1000)));
}

function boundedMoney(value) {
  return isSafeIntBetween(value, 0, MAX_AMOUNT_SATANG) ? value : 0;
}

function roundedLineGross(item) {
  return (BigInt(quantityMilli(item?.qty)) * BigInt(boundedMoney(item?.price)) + 500n) / 1000n;
}

export function lineParts(item) {
  const rawGross = roundedLineGross(item);
  const gross = Number(rawGross > MAX_QUOTE_AMOUNT ? MAX_QUOTE_AMOUNT : rawGross);
  const discount = Math.min(gross, boundedMoney(item?.discount));
  return { gross, discount, net: gross - discount };
}

export function lineAmount(item) {
  return lineParts(item).net;
}

function clampTotal(value) {
  return Math.min(MAX_AMOUNT_SATANG, Math.max(0, value));
}

export function calculateQuote(quote) {
  const items = Array.isArray(quote?.items) ? quote.items : [];
  const subtotal = items.reduce((total, item) => clampTotal(total + lineParts(item).net), 0);
  const discount = Math.min(subtotal, boundedMoney(quote?.discount));
  const beforeVat = subtotal - discount;
  const vatBase = items.reduce((total, item) => clampTotal(total + (item?.vat ? lineParts(item).net : 0)), 0);
  const vatRate = Number.isInteger(Number(quote?.vatRate)) ? Math.max(0, Math.min(100, Number(quote.vatRate))) : 0;
  // Keep the prorated taxable base as an exact fraction. Rounding the base
  // before applying VAT can change the final VAT by a satang.
  const vatDenominator = BigInt(subtotal) * 100n;
  const vatNumerator = BigInt(vatBase) * BigInt(beforeVat) * BigInt(vatRate);
  const vat = subtotal ? Number((vatNumerator + vatDenominator / 2n) / vatDenominator) : 0;
  return { itemSubtotal: subtotal, discount, beforeVat, vat, total: clampTotal(beforeVat + vat) };
}

function normalizeCustomer(customer) {
  if (!asRecord(customer) || !isText(customer.id, 128) || !customer.id || !isText(customer.name, 300) || !customer.name.trim()) {
    throw new TypeError('ข้อมูลลูกค้าไม่ถูกต้อง');
  }
  for (const key of ['contact', 'email', 'phone', 'address']) {
    if (!isText(customer[key] ?? '', key === 'address' ? 2000 : 300)) throw new TypeError('ข้อมูลลูกค้าไม่ถูกต้อง');
  }
  return {
    id: customer.id, name: customer.name, contact: customer.contact || '', email: customer.email || '',
    phone: customer.phone || '', address: customer.address || '',
  };
}

function normalizeProduct(product) {
  if (!asRecord(product) || !isText(product.id, 128) || !product.id || !isText(product.name, 500) || !product.name.trim()
    || !isText(product.code ?? '', 100) || !isText(product.unit ?? '', 100)
    || !isSafeIntBetween(product.price, 0, MAX_AMOUNT_SATANG) || typeof product.vat !== 'boolean') {
    throw new TypeError('ข้อมูลสินค้า/บริการไม่ถูกต้อง');
  }
  return { id: product.id, code: product.code || '', name: product.name, unit: product.unit || '', price: product.price, vat: product.vat };
}

function normalizeSettings(value, defaults) {
  if (value == null) return { ...defaults };
  if (!asRecord(value) || Object.keys(value).some((key) => !Object.hasOwn(defaults, key))) {
    throw new TypeError('ข้อมูลการตั้งค่าไม่ถูกต้อง');
  }
  const settings = { ...defaults };
  for (const [key, field] of Object.entries(value)) {
    if (typeof defaults[key] === 'string') {
      const maxLength = key === 'companyAddress' ? 2000 : key === 'companyName' ? 300 : key === 'companyEmail' ? 254 : 100;
      if (!isText(field, maxLength)) throw new TypeError('ข้อมูลการตั้งค่าไม่ถูกต้อง');
      settings[key] = field;
      continue;
    }
    const maximum = key === 'defaultVat' ? 100 : 3650;
    const minimum = key === 'defaultValidity' ? 1 : 0;
    if (!isSafeIntBetween(field, minimum, maximum)) throw new TypeError('ข้อมูลการตั้งค่าไม่ถูกต้อง');
    settings[key] = field;
  }
  if (!settings.quotePrefix.trim()) throw new TypeError('คำนำหน้าเลขที่เอกสารต้องไม่ว่าง');
  return settings;
}

function normalizeItem(item) {
  if (!asRecord(item) || !isText(item.id, 128) || !item.id || !isText(item.name, 500) || !isText(item.description ?? '', 2000)
    || !isText(item.unit ?? '', 100) || !Number.isFinite(item.qty) || item.qty <= 0 || item.qty > MAX_QUANTITY_MILLI / 1000
    || !isSafeIntBetween(item.price, 0, MAX_AMOUNT_SATANG) || !isSafeIntBetween(item.discount, 0, MAX_AMOUNT_SATANG)
    || typeof item.vat !== 'boolean') {
    throw new TypeError('รายการสินค้าในใบเสนอราคาไม่ถูกต้อง');
  }
  return { id: item.id, name: item.name, description: item.description || '', qty: item.qty, unit: item.unit || '', price: item.price, discount: item.discount, vat: item.vat };
}

export function createEmptyStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    quotes: [],
    customers: [],
    products: [],
    settings: { ...defaultSettings },
    sequences: {},
  };
}

export function normalizeStore(data, defaults = defaultSettings) {
  if (!asRecord(data) || !Array.isArray(data.quotes) || !Array.isArray(data.customers) || !Array.isArray(data.products)
    || data.quotes.length > MAX_COLLECTION_SIZE || data.customers.length > MAX_COLLECTION_SIZE || data.products.length > MAX_COLLECTION_SIZE) {
    throw new TypeError('ไฟล์สำรองไม่มีโครงสร้างข้อมูลที่รองรับ');
  }
  if (data.schemaVersion != null && (!Number.isSafeInteger(data.schemaVersion) || data.schemaVersion < 1 || data.schemaVersion > SCHEMA_VERSION)) {
    throw new TypeError('เวอร์ชันไฟล์สำรองนี้ยังไม่รองรับ');
  }

  const customers = data.customers.map(normalizeCustomer);
  const products = data.products.map(normalizeProduct);
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const settings = normalizeSettings(data.settings, defaults);
  const customerIds = new Set();
  const productIds = new Set();
  for (const customer of customers) {
    if (customerIds.has(customer.id)) throw new TypeError('พบรหัสลูกค้าซ้ำ');
    customerIds.add(customer.id);
  }
  for (const product of products) {
    if (productIds.has(product.id)) throw new TypeError('พบรหัสสินค้า/บริการซ้ำ');
    productIds.add(product.id);
  }

  const quoteIds = new Set();
  const quoteNumbers = new Set();
  const quotes = data.quotes.map((quote) => {
    if (!asRecord(quote) || !isText(quote.id, 128) || !quote.id || !isText(quote.number, 100) || !quote.number.trim()
      || !isText(quote.customerId ?? '', 128) || !VALID_STATUSES.has(quote.status) || !parseISODate(quote.issueDate) || !parseISODate(quote.validUntil)
      || (quote.followUpDate !== '' && quote.followUpDate != null && !parseISODate(quote.followUpDate))
      || !Array.isArray(quote.items) || quote.items.length < 1 || quote.items.length > MAX_ITEMS_PER_QUOTE
      || !isText(quote.note ?? '', 10_000) || !isSafeIntBetween(quote.discount, 0, MAX_AMOUNT_SATANG)
      || !isSafeIntBetween(quote.vatRate, 0, 100) || !isText(quote.createdAt ?? new Date().toISOString(), 100)) {
      throw new TypeError('ข้อมูลใบเสนอราคาไม่ถูกต้อง');
    }
    if (quote.validUntil < quote.issueDate) throw new TypeError('วันหมดอายุต้องไม่ก่อนวันที่ออกเอกสาร');
    if (quoteIds.has(quote.id) || quoteNumbers.has(quote.number)) throw new TypeError('พบรหัสหรือเลขที่ใบเสนอราคาซ้ำ');
    quoteIds.add(quote.id);
    quoteNumbers.add(quote.number);
    const items = quote.items.map(normalizeItem);
    if (new Set(items.map((item) => item.id)).size !== items.length) throw new TypeError('พบรหัสรายการซ้ำในใบเสนอราคา');
    // Reject the exact pre-discount amount before preview calculations can cap it.
    const gross = items.reduce((sum, item) => sum + roundedLineGross(item), 0n);
    if (gross > MAX_QUOTE_AMOUNT) throw new TypeError('ยอดใบเสนอราคาสูงเกินขอบเขตที่รองรับ');
    const customerSnapshot = quote.customerSnapshot ? normalizeCustomer(quote.customerSnapshot) : customerById.get(quote.customerId);
    if (customerSnapshot && quote.customerId && customerSnapshot.id !== quote.customerId) throw new TypeError('ข้อมูล snapshot ลูกค้าไม่ตรงกับใบเสนอราคา');
    if (!customerSnapshot) throw new TypeError('ไม่พบข้อมูลลูกค้าของใบเสนอราคา');
    const companySnapshot = normalizeSettings(quote.companySnapshot, settings);
    const createdAt = parseTimestamp(quote.createdAt);
    const importedIssuedAt = parseTimestamp(quote.issuedAt);
    if (createdAt === undefined || importedIssuedAt === undefined) throw new TypeError('เวลาออกหรือสร้างเอกสารไม่ถูกต้อง');
    const fallbackCreatedAt = `${quote.issueDate}T00:00:00.000Z`;
    // Old backups predate issuedAt. A document already outside draft remains
    // locked after migration; a provided issuedAt is never discarded.
    const issuedAt = importedIssuedAt || (quote.status !== 'draft' ? createdAt || fallbackCreatedAt : null);
    const normalized = {
      id: quote.id, number: quote.number, customerId: quote.customerId || customerSnapshot?.id || '',
      status: quote.status, issueDate: quote.issueDate, validUntil: quote.validUntil,
      followUpDate: quote.followUpDate || '', note: quote.note || '', items, discount: quote.discount,
      vatRate: quote.vatRate, createdAt: createdAt || fallbackCreatedAt,
      issuedAt,
      ...(customerSnapshot ? { customerSnapshot: { ...customerSnapshot } } : {}),
      companySnapshot,
    };
    const totals = calculateQuote(normalized);
    if (totals.beforeVat + totals.vat > MAX_AMOUNT_SATANG) throw new TypeError('ยอดใบเสนอราคาสูงเกินขอบเขตที่รองรับ');
    return normalized;
  });

  const sequences = {};
  if (asRecord(data.sequences)) {
    for (const [key, value] of Object.entries(data.sequences)) {
      if (isText(key, 120) && isSafeIntBetween(value, 0, Number.MAX_SAFE_INTEGER)) sequences[key] = value;
    }
  }
  return { schemaVersion: SCHEMA_VERSION, quotes, customers, products, settings, sequences };
}
