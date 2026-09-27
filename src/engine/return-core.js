import { compute2550Q } from './vat.js';
import { compute2551Q } from './percentageTax.js';
import { packLabel } from './rules-core.js';
import { fmt, toC } from '../money.js';

// Registration routing and return assembly. Pure: runs on the server and in
// the browser. The tax path comes only from the Form 2303 registration record.

export function quarterBounds(year, quarter) {
  const m0 = (quarter - 1) * 3 + 1;
  const start = `${year}-${String(m0).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(year, m0 + 2, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

const byEffective = (a, b) => a.effective_from.localeCompare(b.effective_from) || a.id - b.id;

/** Registration in force on `date` from a taxpayer's history, or null. */
export function registrationOn(history, date) {
  const eligible = history.filter((r) => r.effective_from <= date).sort(byEffective);
  return eligible[eligible.length - 1] ?? null;
}

/**
 * Split [start, end] by the registration records in force. Normally one
 * segment; two if a Form 2303 update takes effect inside the period.
 */
export function segmentsFromHistory(history, start, end) {
  const first = registrationOn(history, start);
  const changes = history.filter((r) => r.effective_from > start && r.effective_from <= end).sort(byEffective);
  const points = [];
  if (first) points.push({ from: start, reg: first });
  for (const r of changes) points.push({ from: r.effective_from, reg: r });
  if (!points.length) return [];
  if (points[0].from !== start) points.unshift({ from: start, reg: null }); // gap before first registration
  const out = [];
  points.forEach((p, i) => {
    const to = i + 1 < points.length ? dayBefore(points[i + 1].from) : end;
    const prev = out[out.length - 1];
    if (prev && prev.reg && p.reg && prev.reg.status === p.reg.status) prev.to = to;
    else out.push({ from: p.from, to, reg: p.reg });
  });
  return out;
}

export function unmappedFindings(unmapped) {
  const groups = new Map();
  for (const l of unmapped) {
    const k = `${l.source}|${l.map_key}`;
    const g = groups.get(k) ?? { source: l.source, key: l.map_key, lines: 0, net: 0, docs: new Set() };
    g.lines++;
    g.net += toC(l.net);
    g.docs.add(l.doc_number);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({
    kind: 'UNMAPPED_TAX_CODE',
    severity: 'CRITICAL',
    message: `${g.lines} ledger line(s) use ${g.source} tax code ${g.key} (${fmt(g.net)}) which has no PH classification. They are excluded until mapped: ${[...g.docs].join(', ')}.`,
    details: { source: g.source, key: g.key, docs: [...g.docs] },
  }));
}

/**
 * Compute one return for one registration segment.
 * @param taxpayer  taxpayer row (snake_case, as stored)
 * @param seg       { from, to, reg } from segmentsFromHistory
 * @param lines     ledger lines dated within the segment
 * @param classifyFn lines -> { classified, unmapped }
 * @param threshold  advisory result for seg.to (or null)
 */
export function computeReturn({ pack, taxpayer, year, quarter, seg, split, lines, classifyFn, inputs = {}, threshold = null }) {
  const { start, end } = quarterBounds(year, quarter);
  const path = pack.paths[seg.reg.status];
  const { classified, unmapped } = classifyFn(lines);
  const computed = path.form === '2550Q' ? compute2550Q(classified, pack, seg.to, inputs) : compute2551Q(classified, pack, seg.to, inputs);

  const findings = [...unmappedFindings(unmapped), ...computed.findings];
  if (threshold && threshold.kind !== 'VAT_THRESHOLD_OK') findings.push({ kind: threshold.kind, severity: threshold.severity, message: threshold.message, details: threshold });

  return {
    form: path.form,
    year,
    quarter,
    period: { from: seg.from, to: seg.to, quarterStart: start, quarterEnd: end, split },
    taxpayer: {
      tin: taxpayer.tin, branchCode: taxpayer.branch_code, rdoCode: taxpayer.rdo_code, name: taxpayer.registered_name,
      address: taxpayer.address, zip: taxpayer.zip, contact: taxpayer.contact, email: taxpayer.email, classification: taxpayer.classification,
    },
    registration: { id: seg.reg.id, status: seg.reg.status, effectiveFrom: seg.reg.effective_from, corReference: seg.reg.cor_reference, source: seg.reg.source ?? 'BIR_2303' },
    routing: `Registered status ${seg.reg.status} (Form 2303 ${seg.reg.cor_reference}, effective ${seg.reg.effective_from}) -> ${path.form} ${path.description}`,
    rulePack: packLabel(pack),
    inputs,
    items: computed.items,
    schedule: computed.schedule ?? null,
    threshold,
    findings,
    lineCount: { total: lines.length, classified: classified.length, unmapped: unmapped.length },
  };
}

export const payableItem = (form) => (form === '2550Q' ? '26' : '24');

/** Shortest chain of derived items from `start` to the payable item, e.g. 31B > 34B > 37B > 61B > 15 > 21 > 26. */
export function chainToPayable(run, start) {
  const target = payableItem(run.form);
  const users = new Map();
  for (const it of Object.values(run.items)) for (const k of it.inputs ?? []) users.set(k, [...(users.get(k) ?? []), it.key]);
  const prev = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const k = queue.shift();
    if (k === target) break;
    for (const u of users.get(k) ?? []) {
      if (!prev.has(u)) {
        prev.set(u, k);
        queue.push(u);
      }
    }
  }
  if (!prev.has(target)) return [];
  const path = [];
  for (let k = target; k; k = prev.get(k)) path.unshift({ key: k, value: run.items[k].value, formula: run.items[k].formula });
  return path;
}
