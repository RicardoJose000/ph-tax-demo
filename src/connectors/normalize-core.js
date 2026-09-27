// Canonical ledger line produced by every connector:
// { source, sourceDocId, sourceLineId, docType, docNumber, docDate, docStatus,
//   contact, description, accountCode, sourceTaxCode, net, tax, gross, currency, rawKey }
// Amounts are in base currency (PHP), signed: credit notes are negative.
// rawKey is a stable serialization of the source record, hashed on the server
// for change detection. Pure: runs on the server and in the browser.

const r2 = (n) => Math.round(n * 100) / 100;
const key = (obj) => JSON.stringify(obj);

// ---------- Xero ----------

const XERO_TYPES = {
  ACCREC: { docType: 'SALE', sign: 1 },
  ACCPAY: { docType: 'PURCHASE', sign: 1 },
  ACCRECCREDIT: { docType: 'SALE_CREDIT', sign: -1 },
  ACCPAYCREDIT: { docType: 'PURCHASE_CREDIT', sign: -1 },
};
const XERO_POSTED = new Set(['AUTHORISED', 'PAID']);

function xeroDate(doc) {
  if (doc.DateString) return doc.DateString.slice(0, 10);
  const m = /\/Date\((\d+)/.exec(doc.Date ?? '');
  if (m) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return String(doc.Date).slice(0, 10);
}

/** Xero Invoice or CreditNote -> canonical lines. Drafts/voided docs are skipped. */
export function normalizeXeroDocument(doc, baseCurrency = 'PHP', source = 'xero') {
  const kind = XERO_TYPES[doc.Type];
  if (!kind || !XERO_POSTED.has(doc.Status)) return [];
  const id = doc.InvoiceID ?? doc.CreditNoteID;
  const fx = doc.CurrencyCode && doc.CurrencyCode !== baseCurrency && doc.CurrencyRate ? Number(doc.CurrencyRate) : 1;
  const inclusive = doc.LineAmountTypes === 'Inclusive';
  return (doc.LineItems ?? []).map((li, i) => {
    const tax = Number(li.TaxAmount ?? 0);
    const lineAmount = Number(li.LineAmount ?? 0);
    const net = inclusive ? lineAmount - tax : lineAmount;
    return {
      source,
      sourceDocId: id,
      sourceLineId: li.LineItemID ?? `${id}:${i}`,
      docType: kind.docType,
      docNumber: doc.InvoiceNumber ?? doc.CreditNoteNumber ?? null,
      docDate: xeroDate(doc),
      docStatus: doc.Status,
      contact: doc.Contact?.Name ?? null,
      description: li.Description ?? null,
      accountCode: li.AccountCode ?? null,
      sourceTaxCode: li.TaxType ?? 'NONE',
      net: r2((kind.sign * net) / fx),
      tax: r2((kind.sign * tax) / fx),
      gross: r2((kind.sign * (net + tax)) / fx),
      currency: doc.CurrencyCode ?? baseCurrency,
      rawKey: key({ doc: { id, Status: doc.Status, UpdatedDateUTC: doc.UpdatedDateUTC }, li }),
    };
  });
}

// ---------- QuickBooks Online ----------

const QBO_TYPES = {
  Invoice: { docType: 'SALE', sign: 1, lineDetail: 'SalesItemLineDetail' },
  SalesReceipt: { docType: 'SALE', sign: 1, lineDetail: 'SalesItemLineDetail' },
  CreditMemo: { docType: 'SALE_CREDIT', sign: -1, lineDetail: 'SalesItemLineDetail' },
  Bill: { docType: 'PURCHASE', sign: 1, lineDetail: 'AccountBasedExpenseLineDetail' },
  VendorCredit: { docType: 'PURCHASE_CREDIT', sign: -1, lineDetail: 'AccountBasedExpenseLineDetail' },
};

/**
 * QBO entity -> canonical lines. QBO reports tax per document (TxnTaxDetail),
 * not per line, so tax is allocated to lines pro rata within each tax code.
 */
export function normalizeQboDocument(entityType, doc, baseCurrency = 'PHP') {
  const kind = QBO_TYPES[entityType];
  if (!kind) return [];
  const fx = doc.CurrencyRef?.value && doc.CurrencyRef.value !== baseCurrency && doc.ExchangeRate ? Number(doc.ExchangeRate) : 1;
  const lines = (doc.Line ?? [])
    .filter((l) => l.DetailType === kind.lineDetail || l.DetailType === 'ItemBasedExpenseLineDetail')
    .map((l) => {
      const detail = l[l.DetailType] ?? {};
      return { l, code: detail.TaxCodeRef?.value ?? 'NON', amount: Number(l.Amount ?? 0), account: detail.AccountRef?.value ?? null };
    });

  // Tax per tax code from TxnTaxDetail; lines carry the code, TaxLine carries the amount.
  const totalTax = Number(doc.TxnTaxDetail?.TotalTax ?? 0);
  const taxable = lines.filter((x) => x.code !== 'NON');
  const taxableBase = taxable.reduce((s, x) => s + x.amount, 0);
  const inclusive = doc.GlobalTaxCalculation === 'TaxInclusive';

  let allocated = 0;
  return lines.map((x, i) => {
    let tax = 0;
    if (x.code !== 'NON' && taxableBase) {
      const isLastTaxable = taxable[taxable.length - 1] === x;
      tax = isLastTaxable ? r2(totalTax - allocated) : r2((totalTax * x.amount) / taxableBase);
      allocated = r2(allocated + tax);
    }
    const net = inclusive ? x.amount - tax : x.amount;
    return {
      source: 'qbo',
      sourceDocId: `${entityType}:${doc.Id}`,
      sourceLineId: `${entityType}:${doc.Id}:${x.l.Id ?? i}`,
      docType: kind.docType,
      docNumber: doc.DocNumber ?? null,
      docDate: doc.TxnDate,
      docStatus: 'POSTED',
      contact: doc.CustomerRef?.name ?? doc.VendorRef?.name ?? null,
      description: x.l.Description ?? null,
      accountCode: x.account,
      sourceTaxCode: x.code,
      net: r2((kind.sign * net) / fx),
      tax: r2((kind.sign * tax) / fx),
      gross: r2((kind.sign * (net + tax)) / fx),
      currency: doc.CurrencyRef?.value ?? baseCurrency,
      rawKey: key({ entityType, id: doc.Id, sync: doc.SyncToken, line: x.l }),
    };
  });
}
