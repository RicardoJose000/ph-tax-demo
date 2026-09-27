import { fmt } from '../money.js';

// Working paper for a computed return: lead schedule (every form item with its
// formula) and detail (every ledger line with the items it fed). CSV so it
// opens directly in Excel for the reviewer.

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (...cols) => cols.map(cell).join(',');
const amt = (c) => (c / 100).toFixed(2);

export function workpaperCsv(run, lines) {
  const out = [];
  out.push(row('WORKING PAPER', `BIR Form ${run.form}`));
  out.push(row('Taxpayer', run.taxpayer.name), row('TIN', `${run.taxpayer.tin}-${run.taxpayer.branchCode}`));
  out.push(row('Period', `${run.period.from} to ${run.period.to}`), row('Run', run.runId), row('Rule pack', run.rulePack));
  out.push(row('Registration used', `${run.registration.status} per Form 2303 ${run.registration.corReference} effective ${run.registration.effectiveFrom}`));
  out.push(row('Routing', run.routing));
  out.push('');

  out.push(row('LEAD SCHEDULE'));
  out.push(row('Item', 'Description', 'Amount', 'Basis', 'Formula / note', 'Source lines'));
  for (const it of Object.values(run.items)) {
    out.push(row(it.key, it.label, amt(it.value), it.kind, it.formula ?? it.note ?? '', it.sources?.length ?? 0));
  }
  out.push('');

  const hits = new Map();
  for (const it of Object.values(run.items)) for (const s of it.sources ?? []) hits.set(s.lineId, [...(hits.get(s.lineId) ?? []), `${it.key}=${fmt(s.amount)}`]);
  out.push(row('DETAIL'));
  out.push(row('Line ID', 'Source', 'Source document ID', 'Doc no.', 'Date', 'Type', 'Contact', 'Description', 'Ledger tax code', 'PH class', 'Net', 'Recorded tax', 'Form items'));
  for (const l of lines) {
    out.push(row(l.id, l.source, l.source_doc_id, l.doc_number, l.doc_date, l.doc_type, l.contact, l.description, l.source_tax_code, l.ph_class ?? 'UNMAPPED', l.net.toFixed(2), l.tax.toFixed(2), (hits.get(l.id) ?? []).join(' | ')));
  }
  out.push('');

  out.push(row('EXCEPTIONS FOR REVIEW'));
  out.push(row('Severity', 'Kind', 'Message'));
  for (const f of run.findings) out.push(row(f.severity, f.kind, f.message));
  return '﻿' + out.join('\r\n');
}
