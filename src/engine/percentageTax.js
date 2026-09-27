import { ItemBook } from './items.js';
import { param } from './rules-core.js';
import { toC, mulRate, fmt } from '../money.js';

// Non-VAT path -> BIR Form 2551Q (January 2018 ENCS), ATC PT010 (Sec. 116).
// Schedule 1 has six rows; lines are grouped by ATC and rate, so a rate change
// inside a quarter produces two rows rather than a blended rate.

export const LABELS_2551Q = {
  'S1.1.base': 'Schedule 1 row 1 - Taxable Amount', 'S1.1.tax': 'Schedule 1 row 1 - Tax Due',
  'S1.2.base': 'Schedule 1 row 2 - Taxable Amount', 'S1.2.tax': 'Schedule 1 row 2 - Tax Due',
  'S1.3.base': 'Schedule 1 row 3 - Taxable Amount', 'S1.3.tax': 'Schedule 1 row 3 - Tax Due',
  'S1.4.base': 'Schedule 1 row 4 - Taxable Amount', 'S1.4.tax': 'Schedule 1 row 4 - Tax Due',
  'S1.5.base': 'Schedule 1 row 5 - Taxable Amount', 'S1.5.tax': 'Schedule 1 row 5 - Tax Due',
  'S1.6.base': 'Schedule 1 row 6 - Taxable Amount', 'S1.6.tax': 'Schedule 1 row 6 - Tax Due',
  'S1.7': 'Schedule 1 Item 7 - Total Tax Due',
  '14': 'Total Tax Due',
  '15': 'Creditable Percentage Tax Withheld per BIR Form No. 2307',
  '16': 'Tax Paid in Return Previously Filed (amended return)',
  '17': 'Other Tax Credit/Payment',
  '18': 'Total Tax Credits/Payments',
  '19': 'Tax Still Payable/(Overpayment)',
  '20': 'Surcharge',
  '21': 'Interest',
  '22': 'Compromise',
  '23': 'Total Penalties',
  '24': 'TOTAL AMOUNT PAYABLE/(Overpayment)',
};

const SUBJECT_TO_PT = new Set(['SALE_REGULAR', 'SALE_ZERO_RATED']);

export function compute2551Q(lines, pack, periodEnd, inputs = {}) {
  const b = new ItemBook(LABELS_2551Q);
  const findings = [];
  const rows = new Map(); // "ATC|rate" -> { atc, rate, ref, lines: [] }

  for (const l of lines) {
    if (!l.ph_class.startsWith('SALE')) continue;
    if (toC(l.tax) !== 0) {
      findings.push({
        kind: 'NON_VAT_CHARGED_VAT',
        severity: 'CRITICAL',
        message: `${l.doc_number} (${l.contact}, ${l.doc_date}): ledger shows tax of ${fmt(toC(l.tax))} on a sale, but the registered status is NON-VAT. A non-VAT taxpayer must not issue VAT invoices (NIRC Sec. 113(D)).`,
        details: { lineId: l.id },
      });
    }
    if (!SUBJECT_TO_PT.has(l.ph_class)) continue;
    const atc = 'PT010';
    const p = param(pack, `pt.rate.${atc}`, l.doc_date);
    const key = `${atc}|${p.value}`;
    const row = rows.get(key) ?? { atc, rate: p.value, ref: p.ref, lines: [] };
    row.lines.push(l);
    rows.set(key, row);
  }

  if (rows.size > 6) throw new Error('More than six ATC/rate rows; attach an additional Schedule 1 sheet');

  const schedule = [];
  [...rows.values()].forEach((row, i) => {
    const n = i + 1;
    for (const l of row.lines) {
      const net = toC(l.net);
      b.add(`S1.${n}.base`, l, net);
      b.add(`S1.${n}.tax`, l, mulRate(net, row.rate), `${row.rate * 100}% x ${fmt(net)}`);
    }
    schedule.push({ row: n, atc: row.atc, rate: row.rate, ref: row.ref, base: b.get(`S1.${n}.base`), tax: b.get(`S1.${n}.tax`) });
  });

  // Tax due per row is rate x row total, so the rounding matches what is printed on the form.
  for (const s of schedule) {
    const rowTax = mulRate(s.base, s.rate);
    b.setDerived(`S1.${s.row}.tax`, rowTax, `${s.rate * 100}% x S1.${s.row}.base`, [`S1.${s.row}.base`]);
    s.tax = rowTax;
  }

  const taxKeys = schedule.map((s) => [1, `S1.${s.row}.tax`]);
  b.derive('S1.7', taxKeys, taxKeys.length ? taxKeys.map(([, k]) => k).join(' + ') : '0');
  b.derive('14', [[1, 'S1.7']], 'Schedule 1 Item 7');
  if (inputs.creditablePtWithheld) b.input('15', toC(inputs.creditablePtWithheld), 'Creditable percentage tax withheld per BIR 2307 (entered by preparer)');
  b.derive('18', [[1, '15'], [1, '16'], [1, '17']], '15 + 16 + 17');
  b.derive('19', [[1, '14'], [-1, '18']], '14 - 18');
  b.derive('23', [[1, '20'], [1, '21'], [1, '22']], '20 + 21 + 22');
  b.derive('24', [[1, '19'], [1, '23']], '19 + 23');

  return { items: b.finish(), schedule, findings };
}
