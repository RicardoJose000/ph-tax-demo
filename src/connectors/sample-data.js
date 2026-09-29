// Sample organisations emitted in the exact Xero Accounting API document
// shape, so they go through the same normalizer as a live Xero connection.
// All names are fictional. Pure: runs on the server and in the browser.

let seq = 0;
const uid = (p) => `${p}-${String(++seq).padStart(6, '0')}-sample`;

function doc(type, number, date, contact, lines, extra = {}) {
  const id = uid('doc');
  const items = lines.map(([desc, account, taxType, net, tax]) => ({
    LineItemID: uid('li'),
    Description: desc,
    AccountCode: account,
    TaxType: taxType,
    LineAmount: net,
    TaxAmount: tax,
  }));
  const sub = items.reduce((s, l) => s + l.LineAmount, 0);
  const tax = items.reduce((s, l) => s + l.TaxAmount, 0);
  const isCredit = type.endsWith('CREDIT');
  return {
    Type: type,
    [isCredit ? 'CreditNoteID' : 'InvoiceID']: id,
    [isCredit ? 'CreditNoteNumber' : 'InvoiceNumber']: number,
    Contact: { Name: contact },
    DateString: `${date}T00:00:00`,
    Status: 'AUTHORISED',
    LineAmountTypes: 'Exclusive',
    LineItems: items,
    SubTotal: sub,
    TotalTax: tax,
    Total: sub + tax,
    CurrencyCode: 'PHP',
    UpdatedDateUTC: `${date}T08:00:00`,
    ...extra,
  };
}

/** VAT-registered services company, Q3 2026. */
export function makatiDigitalDocs() {
  seq = 0;
  return [
    doc('ACCREC', 'INV-0141', '2026-07-06', 'Northpoint Land Corp.', [['Website redesign - phase 1', '200', 'OUTPUT', 850000, 102000]]),
    doc('ACCREC', 'INV-0142', '2026-07-20', 'Harbor Savings Bank Inc.', [
      ['Mobile app development - sprint 4', '200', 'OUTPUT', 1100000, 132000],
      ['QA and release support', '200', 'OUTPUT', 140000, 16800],
    ]),
    doc('ACCREC', 'INV-0143', '2026-08-03', 'Islandwide Telco Inc.', [['Maintenance retainer - August', '200', 'OUTPUT', 380000, 45600]]),
    // Export of services paid in foreign currency: zero-rated. USD 12,000 at 0.0175 USD/PHP.
    doc('ACCREC', 'INV-0144', '2026-08-15', 'Acme Analytics LLC (USA)', [['Data platform build - offshore', '210', 'ZERORATEDOUTPUT', 12000, 0]], {
      CurrencyCode: 'USD',
      CurrencyRate: 0.0175,
    }),
    doc('ACCREC', 'INV-0145', '2026-09-02', 'Visayas Technical Institute', [['Accredited training program', '220', 'EXEMPTOUTPUT', 120000, 0]]),
    // Tax keyed in wrong in the ledger (67,150 vs 67,200) - should raise a reconciliation variance.
    doc('ACCREC', 'INV-0146', '2026-09-18', 'Kusina Foods Corp.', [['Analytics dashboard', '200', 'OUTPUT', 560000, 67150]]),
    doc('ACCRECCREDIT', 'CN-0007', '2026-09-25', 'Harbor Savings Bank Inc.', [['Volume discount - sprint 4', '200', 'OUTPUT', 40000, 4800]]),
    doc('ACCREC', 'INV-0147', '2026-09-29', 'Metro Retail Holdings Inc.', [['Draft - not yet approved', '200', 'OUTPUT', 999999, 119999.88]], { Status: 'DRAFT' }),

    doc('ACCPAY', 'RENT-07', '2026-07-01', 'Paseo Tower Property Mgmt Corp.', [['Office rent - July', '460', 'INPUT', 150000, 18000]]),
    doc('ACCPAY', 'RENT-08', '2026-08-01', 'Paseo Tower Property Mgmt Corp.', [['Office rent - August', '460', 'INPUT', 150000, 18000]]),
    doc('ACCPAY', 'RENT-09', '2026-09-01', 'Paseo Tower Property Mgmt Corp.', [['Office rent - September', '460', 'INPUT', 150000, 18000]]),
    doc('ACCPAY', 'CC-0726', '2026-07-31', 'CloudCore Hosting Pte Ltd (Singapore)', [['Cloud hosting - July', '489', 'NRSERVICES', 95000, 0]]),
    doc('ACCPAY', 'TH-5531', '2026-08-10', 'TechHub Computer Center Inc.', [['Developer laptops x6', '710', 'INPUT', 420000, 50400]]),
    doc('ACCPAY', 'FD-0825', '2026-08-25', 'R. Santos (freelance designer, non-VAT)', [['UI illustration set', '485', 'NONE', 60000, 0]]),
    doc('ACCPAY', 'BOC-2291', '2026-09-05', 'Bureau of Customs', [['Server hardware importation', '710', 'IMPORTINPUT', 300000, 36000]]),
  ];
}

/** Non-VAT bakeshop whose trailing 12-month sales climb past PHP 3M in Q3 2026. */
export function bakeshopDocs() {
  seq = 0;
  const monthly = {
    '2025-07': 190000, '2025-08': 195000, '2025-09': 200000, '2025-10': 200000, '2025-11': 210000, '2025-12': 280000,
    '2026-01': 220000, '2026-02': 225000, '2026-03': 235000, '2026-04': 240000, '2026-05': 250000, '2026-06': 255000,
    '2026-07': 270000, '2026-08': 285000, '2026-09': 380000,
  };
  const docs = [];
  let n = 500;
  for (const [ym, total] of Object.entries(monthly)) {
    const half = Math.round(total * 0.55);
    docs.push(doc('ACCREC', `SI-${++n}`, `${ym}-15`, 'Walk-in customers', [[`Counter sales 1-15 ${ym}`, '200', 'NONE', half, 0]]));
    docs.push(doc('ACCREC', `SI-${++n}`, `${ym}-25`, 'Kape at Tinapay Cafe', [[`Wholesale pastries ${ym}`, '200', 'NONE', total - half, 0]]));
    docs.push(doc('ACCPAY', `PO-${n}`, `${ym}-05`, 'Golden Grain Flour Mills', [[`Flour and sugar ${ym}`, '310', 'NONE', Math.round(total * 0.35), 0]]));
  }
  return docs;
}

/**
 * Withholding profiles for suppliers, keyed by the contact name used in the
 * ledger. In production these come from the payee master data defined in the
 * requirements pack. atc: null means no expanded withholding applies, with the reason.
 */
export const SAMPLE_PAYEES = {
  'Paseo Tower Property Mgmt Corp.': {
    tin: '444555666', branch: '00000', type: 'CORPORATION', registeredName: 'PASEO TOWER PROPERTY MGMT CORP',
    address: '2F SAMPLE PLAZA PASEO DE ROXAS MAKATI CITY', zip: '1226', atc: 'WC100', nature: 'Rental of office space',
  },
  'R. Santos (freelance designer, non-VAT)': {
    tin: '777888999', branch: '00000', type: 'INDIVIDUAL', registeredName: 'SANTOS RAFAEL MENDOZA',
    address: '18 SAMPLE ST BRGY SAN ANTONIO PASIG CITY', zip: '1605', atc: 'WI010', nature: 'Professional fees (design)',
    note: 'Sworn declaration on file: gross income up to PHP 3M, non-VAT',
  },
  'TechHub Computer Center Inc.': { atc: null, reason: 'Purchase of goods: EWT (WC158) applies only when the payor is a top withholding agent' },
  'CloudCore Hosting Pte Ltd (Singapore)': { atc: null, reason: 'Non-resident foreign corporation: final withholding tax (1601-FQ), not expanded withholding' },
  'Bureau of Customs': { atc: null, reason: 'Duties and VAT paid on importation: not an income payment' },
  'Golden Grain Flour Mills': { atc: null, reason: 'Purchase of goods: EWT (WC158) applies only when the payor is a top withholding agent' },
};

export const SAMPLE_ORGS = {
  makati: { name: 'Makati Digital Services Inc. (sample)', docs: makatiDigitalDocs },
  bakeshop: { name: 'Dela Cruz Bakeshop (sample)', docs: bakeshopDocs },
};
