import { ItemBook } from './items.js';
import { param } from './rules-core.js';
import { toC, mulRate, fmt } from '../money.js';

// Expanded withholding tax (EWT). Pure: runs on the server and in the browser.
//
// Each purchase line is matched to its payee's withholding profile (ATC from
// the payee master data), the rate is looked up by ATC and payment date in the
// rule pack, and EWT is computed on the amount excluding VAT. Lines without an
// applicable ATC are listed with the reason, never guessed.

const monthOf = (d) => d.slice(0, 7);

function quarterMonths(from) {
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  return [0, 1, 2].map((i) => {
    const x = new Date(d);
    x.setUTCMonth(d.getUTCMonth() + i);
    return x.toISOString().slice(0, 7);
  });
}

/**
 * @param lines   classified ledger lines of the quarter (purchases are used)
 * @param payees  { contactName: { tin, branch, type, registeredName, address, zip, atc, nature, reason } }
 * @param from    first day of the quarter (YYYY-MM-DD)
 */
export function computeWithholding(pack, lines, payees, from) {
  const months = quarterMonths(from);
  const rows = [];
  const skipped = [];
  for (const l of lines) {
    if (!l.doc_type.startsWith('PURCHASE')) continue;
    const profile = payees[l.contact];
    if (!profile) {
      skipped.push({ line: l, reason: 'No withholding profile for this payee yet' });
      continue;
    }
    if (!profile.atc) {
      skipped.push({ line: l, reason: profile.reason ?? 'Not subject to expanded withholding' });
      continue;
    }
    const p = param(pack, `ewt.rate.${profile.atc}`, l.doc_date);
    const base = toC(l.net);
    rows.push({ line: l, payee: l.contact, profile, atc: profile.atc, rate: p.value, ref: p.ref, base, ewt: mulRate(base, p.value), month: monthOf(l.doc_date), monthIndex: months.indexOf(monthOf(l.doc_date)) });
  }

  const byMonth = Object.fromEntries(months.map((m) => [m, rows.filter((r) => r.month === m).reduce((s, r) => s + r.ewt, 0)]));

  const certificates = [];
  for (const payee of [...new Set(rows.map((r) => r.payee))]) {
    const mine = rows.filter((r) => r.payee === payee);
    const atcs = [...new Set(mine.map((r) => r.atc))].map((atc) => {
      const rs = mine.filter((r) => r.atc === atc);
      const m = [0, 1, 2].map((i) => rs.filter((r) => r.monthIndex === i).reduce((s, r) => s + r.base, 0));
      return { atc, description: pack.atc?.[atc] ?? atc, rate: rs[0].rate, months: m, total: m[0] + m[1] + m[2], tax: rs.reduce((s, r) => s + r.ewt, 0), rows: rs };
    });
    certificates.push({ payee, profile: mine[0].profile, atcs, total: atcs.reduce((s, a) => s + a.total, 0), tax: atcs.reduce((s, a) => s + a.tax, 0) });
  }

  return { months, rows, skipped, byMonth, certificates, total: rows.reduce((s, r) => s + r.ewt, 0) };
}

export const LABELS_0619E = {
  '14': 'Amount of Remittance',
  '15': 'Less: Amount Remitted from Previously Filed Form (amended form)',
  '16': 'Net Amount of Remittance',
  '17A': 'Surcharge',
  '17B': 'Interest',
  '17C': 'Compromise',
  '17D': 'Total Penalties',
  '18': 'Total Amount of Remittance',
};

/**
 * 0619-E covers the first two months of a quarter; the third month is
 * reported on 1601-EQ. Item 14 keeps the withheld lines as its sources.
 */
export function compute0619E(withholding, month) {
  const b = new ItemBook(LABELS_0619E);
  for (const r of withholding.rows.filter((x) => x.month === month)) {
    b.add('14', r.line, r.ewt, `${r.atc} ${Math.round(r.rate * 1000) / 10}% x ${fmt(r.base)}`);
  }
  b.derive('16', [[1, '14'], [-1, '15']], '14 - 15');
  b.derive('17D', [[1, '17A'], [1, '17B'], [1, '17C']], '17A + 17B + 17C');
  b.derive('18', [[1, '16'], [1, '17D']], '16 + 17D');
  return { month, items: b.finish(), monthIndex: withholding.months.indexOf(month) };
}

/** Due date of a 0619-E for a month: the 10th of the following month (manual filers). */
export function dueDate0619E(month) {
  const d = new Date(`${month}-10T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
