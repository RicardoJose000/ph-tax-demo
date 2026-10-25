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

// sales: the entity's lines are sales lines; credit: the document reduces totals.
// A Purchase (cash, cheque or card expense) with Credit = true is a card refund.
const QBO_TYPES = {
  Invoice: { sales: true },
  SalesReceipt: { sales: true },
  CreditMemo: { sales: true, credit: true },
  RefundReceipt: { sales: true, credit: true },
  Bill: { sales: false },
  VendorCredit: { sales: false, credit: true },
  Purchase: { sales: false, credit: (doc) => doc.Credit === true },
};
export const QBO_ENTITIES = Object.keys(QBO_TYPES);

const QBO_LINE_DETAILS = {
  true: ['SalesItemLineDetail'],
  false: ['AccountBasedExpenseLineDetail', 'ItemBasedExpenseLineDetail'],
};

/** Document-level facts the review screens show, the same shape for every QBO entity. */
export function qboDocInfo(entityType, doc) {
  const t = QBO_TYPES[entityType];
  const credit = typeof t?.credit === 'function' ? t.credit(doc) : Boolean(t?.credit);
  return {
    id: `${entityType}:${doc.Id}`,
    sales: Boolean(t?.sales),
    credit,
    docType: t ? `${t.sales ? 'SALE' : 'PURCHASE'}${credit ? '_CREDIT' : ''}` : null,
    contact: doc.CustomerRef?.name ?? doc.VendorRef?.name ?? doc.EntityRef?.name ?? null,
    currency: doc.CurrencyRef?.value ?? null,
    total: Number(doc.TotalAmt ?? 0),
  };
}

/**
 * QBO entity -> canonical lines.
 *
 * QBO states tax per document, not per line: TxnTaxDetail.TaxLine holds one
 * amount per tax rate, and each line only names its tax code. So each TaxLine
 * is spread over the lines whose code uses that rate, pro rata by amount, and
 * the last of those lines takes the rounding remainder. A zero-rated or exempt
 * line therefore never picks up VAT from a 12% line on the same document.
 *
 * codeRates maps a tax code Id to the tax rate Ids it uses (from the TaxCode
 * entity, sales and purchase lists together). Without it, or when a TaxLine
 * names a rate no line uses, that amount falls back to every line with a
 * taxable code - and the document's tax still sums exactly.
 *
 * Amounts: QBO's ExchangeRate is home-currency units per one unit of the
 * document currency, so foreign amounts are MULTIPLIED by it (Xero's rate is
 * the other way round).
 */
export function normalizeQboDocument(entityType, doc, baseCurrency = 'PHP', codeRates = null) {
  const kind = QBO_TYPES[entityType];
  if (!kind || doc._deleted) return [];
  const info = qboDocInfo(entityType, doc);
  const sign = info.credit ? -1 : 1;
  const fx = doc.CurrencyRef?.value && doc.CurrencyRef.value !== baseCurrency && doc.ExchangeRate ? Number(doc.ExchangeRate) : 1;
  const details = QBO_LINE_DETAILS[kind.sales];
  const lines = (doc.Line ?? [])
    .filter((l) => details.includes(l.DetailType))
    .map((l, i) => {
      const detail = l[l.DetailType] ?? {};
      // When a line also carries TaxInclusiveAmt, QBO's Amount is already net of
      // tax. To confirm against a live sandbox company at M1.
      const netGiven = detail.TaxInclusiveAmt != null;
      return { l, i, code: detail.TaxCodeRef?.value ?? 'NON', amount: Number(l.Amount ?? 0), account: detail.AccountRef?.value ?? null, netGiven, tax: 0 };
    });

  const taxable = lines.filter((x) => x.code !== 'NON');
  const spread = (amount, over) => {
    const base = over.reduce((s, x) => s + x.amount, 0);
    if (!over.length || !base) return false;
    let given = 0;
    over.forEach((x, n) => {
      const share = n === over.length - 1 ? r2(amount - given) : r2((amount * x.amount) / base);
      x.tax = r2(x.tax + share);
      given = r2(given + share);
    });
    return true;
  };

  const taxLines = (doc.TxnTaxDetail?.TaxLine ?? [])
    .filter((t) => t.DetailType === 'TaxLineDetail')
    .map((t) => ({ rate: t.TaxLineDetail?.TaxRateRef?.value ?? null, amount: Number(t.Amount ?? 0) }));

  if (codeRates && taxLines.length) {
    for (const t of taxLines) {
      const using = taxable.filter((x) => (codeRates[x.code] ?? []).includes(t.rate));
      if (!spread(t.amount, using)) spread(t.amount, taxable);
    }
  } else {
    spread(Number(doc.TxnTaxDetail?.TotalTax ?? 0), taxable);
  }

  const inclusive = doc.GlobalTaxCalculation === 'TaxInclusive';
  return lines.map((x) => {
    const net = inclusive && !x.netGiven ? x.amount - x.tax : x.amount;
    return {
      source: 'qbo',
      sourceDocId: info.id,
      sourceLineId: `${info.id}:${x.l.Id ?? x.i}`,
      docType: info.docType,
      docNumber: doc.DocNumber ?? null,
      docDate: doc.TxnDate,
      docStatus: 'POSTED',
      contact: info.contact,
      description: x.l.Description ?? null,
      accountCode: x.account,
      sourceTaxCode: x.code,
      net: r2(sign * net * fx),
      tax: r2(sign * x.tax * fx),
      gross: r2(sign * (net + x.tax) * fx),
      currency: doc.CurrencyRef?.value ?? baseCurrency,
      rawKey: key({ entityType, id: doc.Id, sync: doc.SyncToken, line: x.l, codeRates: codeRates ? taxable.map((t) => codeRates[t.code] ?? null) : null }),
    };
  });
}
