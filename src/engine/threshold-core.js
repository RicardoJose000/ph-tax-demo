import { param, value } from './rules-core.js';
import { toC, fmt } from '../money.js';

// VAT registration threshold monitor. Pure: runs on the server and in the browser.
//
// Advisory only. It takes the registered status (Form 2303) and ledger lines
// and returns a finding for human review. It returns data and nothing else:
// it cannot change a registration, and its output never selects the tax path.

const COUNTED = new Set(['SALE_REGULAR', 'SALE_ZERO_RATED']); // exempt sales (Sec. 109, other than BB) are excluded

function monthStart(date, monthsBack) {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - monthsBack);
  return d.toISOString().slice(0, 10);
}

export function thresholdWindow(pack, asOf) {
  const months = value(pack, 'vat.threshold_window_months', asOf);
  return { from: monthStart(asOf, months - 1), to: asOf, months };
}

/**
 * @param reg    registration in force on asOf: { id, status, cor_reference }
 * @param lines  classified ledger lines (ph_class attached); lines outside the window are ignored
 */
export function assessThresholdCore(pack, reg, lines, asOf) {
  if (!reg || reg.status !== 'NON_VAT') return null;

  const window = thresholdWindow(pack, asOf);
  const thresholdParam = param(pack, 'vat.registration_threshold', asOf);
  const threshold = toC(thresholdParam.value);
  const advisoryRatio = value(pack, 'vat.threshold_advisory_ratio', asOf);

  const byMonth = new Map();
  let total = 0;
  for (const l of lines) {
    if (!COUNTED.has(l.ph_class) || l.doc_date < window.from || l.doc_date > asOf) continue;
    const c = toC(l.net);
    total += c;
    const ym = l.doc_date.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + c);
  }

  let running = 0;
  const monthly = [...byMonth.entries()].sort().map(([month, amount]) => {
    running += amount;
    return { month, amount, cumulative: running };
  });
  const crossedIn = monthly.find((m) => m.cumulative > threshold)?.month ?? null;
  const ratio = total / threshold;

  const base = {
    asOf,
    window,
    grossSales: total,
    threshold,
    thresholdRef: thresholdParam.ref,
    advisoryRatio,
    ratio: Math.round(ratio * 10000) / 10000,
    monthly,
    registeredStatus: reg.status,
    registrationId: reg.id,
    corReference: reg.cor_reference,
    statusChanged: false,
  };
  const statusLine = `Registered status stays NON-VAT per Form 2303 (${reg.cor_reference}); tax treatment has not been changed.`;

  if (total > threshold) {
    return {
      ...base,
      kind: 'VAT_THRESHOLD_CROSSED',
      severity: 'CRITICAL',
      message: `Gross sales for the ${window.months} months to ${asOf} are ${fmt(total)}, above the ${fmt(threshold)} VAT threshold (crossed in ${crossedIn}). ${statusLine} Review whether the taxpayer must update registration (BIR Form 1905).`,
    };
  }
  if (ratio >= advisoryRatio) {
    return {
      ...base,
      kind: 'VAT_THRESHOLD_APPROACHING',
      severity: 'WARNING',
      message: `Gross sales for the ${window.months} months to ${asOf} are ${fmt(total)}, ${(ratio * 100).toFixed(1)}% of the ${fmt(threshold)} VAT threshold. ${statusLine}`,
    };
  }
  return { ...base, kind: 'VAT_THRESHOLD_OK', severity: 'INFO', message: `Gross sales ${fmt(total)} are ${(ratio * 100).toFixed(1)}% of the VAT threshold.` };
}
