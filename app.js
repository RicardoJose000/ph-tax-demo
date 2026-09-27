// PH Tax Engine: interactive demo.
// Every figure on this page is produced by the engine's own modules (the
// same files the server imports). This file only holds demo state and UI.

import { SAMPLE_ORGS } from './src/connectors/sample-data.js';
import { normalizeXeroDocument } from './src/connectors/normalize-core.js';
import { classifyWithMap, defaultMappings } from './src/engine/classify-core.js';
import { assessThresholdCore } from './src/engine/threshold-core.js';
import { quarterBounds, segmentsFromHistory, computeReturn, registrationOn, chainToPayable, payableItem } from './src/engine/return-core.js';
import { validatePack, packLabel } from './src/engine/rules-core.js';
import { layoutForm, renderPdf } from './src/forms/fill-core.js';
import { workpaperCsv } from './src/forms/workpaper.js';
import { fmt } from './src/money.js';

// ---------------------------------------------------------------- helpers

const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (c) => `<span class="num">${esc(fmt(c))}</span>`;
const peso = (c) => `<span class="num">&#8369;&nbsp;${esc(fmt(c))}</span>`;
const pct = (r) => `${(r * 100).toFixed(1)}%`;
const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const monthName = (ym) => new Date(`${ym}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
const monthLabel = (ym) => `${monthName(ym)} ${ym.slice(2, 4)}`;
const monthEnd = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const niceDate = (iso) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtTin = (t) => `${t.slice(0, 3)}-${t.slice(3, 6)}-${t.slice(6, 9)}`;

const I = {
  overview: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
  data: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  form: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>',
  trace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v6a4 4 0 0 0 4 4h6"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  rules: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 7h6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v12M7 11l5 5 5-5M5 20h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// ---------------------------------------------------------------- engine data

const getJson = async (p) => {
  const r = await fetch(p);
  if (!r.ok) throw new Error(`Could not load ${p}`);
  return r.json();
};
const [pack, defaults, map2550Q, map2551Q] = await Promise.all([
  getJson('rules/ph/rule-pack.json'),
  getJson('rules/ph/default-tax-code-map.json'),
  getJson('src/forms/maps/2550Q.json'),
  getJson('src/forms/maps/2551Q.json'),
]);
validatePack(pack);
const MAPS = { '2550Q': map2550Q, '2551Q': map2551Q };
const PAGE_H = { '2550Q': 1008, '2551Q': 936 };

const LIVE = window.PH_MODE === 'live';
const titleCase = (v) => String(v ?? '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

const DEMO_TAXPAYERS = [
  {
    id: 1, org: 'makati', source: 'sample', display: 'Makati Digital Services Inc.', blurb: 'Software services, Makati City',
    tin: '009876543', branch_code: '00000', rdo_code: '047', registered_name: 'MAKATI DIGITAL SERVICES INC',
    address: 'UNIT 1203 SAMPLE BUILDING AYALA AVE MAKATI CITY METRO MANILA', zip: '1226', contact: '09990000001', email: 'makati.demo@example.com', classification: 'SMALL',
  },
  {
    id: 2, org: 'bakeshop', source: 'sample', display: 'Dela Cruz Bakeshop', blurb: 'Sole proprietor, Cebu City',
    tin: '123456789', branch_code: '00000', rdo_code: '081', registered_name: 'DELA CRUZ JUAN SANTOS',
    address: '45 COLON ST BRGY STO NINO CEBU CITY', zip: '6000', contact: '09990000002', email: 'bakeshop.demo@example.com', classification: 'MICRO',
  },
];
const DEMO_REGS = [
  { id: 1, taxpayer_id: 1, status: 'VAT', effective_from: '2019-03-01', cor_reference: 'COR OCN 2RC0000123456', source: 'BIR_2303', entered_by: 'M. Reyes (preparer)', entered_at: '2026-09-01T09:05:00Z', note: 'Head office' },
  { id: 2, taxpayer_id: 2, status: 'NON_VAT', effective_from: '2023-01-15', cor_reference: 'COR OCN 2RC0000654321', source: 'BIR_2303', entered_by: 'M. Reyes (preparer)', entered_at: '2026-09-01T09:12:00Z', note: 'Sole proprietor, 8% option not availed' },
];

// In live mode everything below comes from the local server (live Xero data);
// in demo mode it is built from the sample organisations.
let TAXPAYERS = [];
let SEED_REGS = [];
let LEDGER = {};
let SERVER = null;
let lineSeq = 0;

function docDateOf(doc) {
  if (doc.DateString) return doc.DateString.slice(0, 10);
  const m = /\/Date\((\d+)/.exec(doc.Date ?? '');
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(doc.Date ?? '').slice(0, 10);
}

function buildLedger(tpId, entries) {
  const docs = entries.map(({ doc, source, base }) => {
    const lines = normalizeXeroDocument(doc, base ?? 'PHP', source).map((l) => ({
      id: ++lineSeq, taxpayer_id: tpId, source: l.source, source_doc_id: l.sourceDocId, source_line_id: l.sourceLineId,
      doc_type: l.docType, doc_number: l.docNumber, doc_date: l.docDate, doc_status: l.docStatus, contact: l.contact,
      description: l.description, account_code: l.accountCode, source_tax_code: l.sourceTaxCode, net: l.net, tax: l.tax, gross: l.gross, currency: l.currency,
    }));
    return { doc, source, id: doc.InvoiceID ?? doc.CreditNoteID, number: doc.InvoiceNumber ?? doc.CreditNoteNumber ?? '(no number)', date: docDateOf(doc), lines };
  });
  docs.sort((a, b) => b.date.localeCompare(a.date) || String(b.number).localeCompare(String(a.number)));
  return { docs, lines: docs.flatMap((d) => d.lines).sort((a, b) => a.doc_date.localeCompare(b.doc_date) || a.id - b.id) };
}

async function loadData() {
  lineSeq = 0;
  LEDGER = {};
  if (!LIVE) {
    TAXPAYERS = DEMO_TAXPAYERS;
    SEED_REGS = DEMO_REGS;
    for (const tp of TAXPAYERS) LEDGER[tp.id] = buildLedger(tp.id, SAMPLE_ORGS[tp.org].docs().map((doc) => ({ doc, source: 'sample' })));
    return;
  }
  const r = await fetch('api/state', { cache: 'no-store' });
  if (!r.ok) throw new Error('Could not load workspace data from the server');
  SERVER = await r.json();
  TAXPAYERS = SERVER.taxpayers.map((t) => ({
    ...t,
    display: t.trade_name || titleCase(t.registered_name),
    blurb: [t.classification ? titleCase(t.classification) : null, t.connection ? (t.source === 'xero' ? `Xero: ${t.connection.org_name}` : 'Sample organisation') : 'No data source yet'].filter(Boolean).join(' · '),
  }));
  SEED_REGS = SERVER.registrations;
  for (const t of TAXPAYERS) {
    LEDGER[t.id] = buildLedger(t.id, (SERVER.documents[t.id] ?? []).map((d) => ({ doc: d.doc, source: d.source, base: t.connection?.base_currency || 'PHP' })));
  }
}
await loadData();
const isSampleTp = (tp) => !LIVE || tp?.source === 'sample';

const xeroUrl = (d) => {
  const id = encodeURIComponent(d.id);
  return {
    ACCREC: `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${id}`,
    ACCPAY: `https://go.xero.com/AccountsPayable/View.aspx?InvoiceID=${id}`,
    ACCRECCREDIT: `https://go.xero.com/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=${id}`,
    ACCPAYCREDIT: `https://go.xero.com/AccountsPayable/ViewCreditNote.aspx?creditNoteID=${id}`,
  }[d.doc.Type];
};
const DOC_TYPE = { ACCREC: 'Sales invoice', ACCPAY: 'Bill', ACCRECCREDIT: 'Sales credit note', ACCPAYCREDIT: 'Supplier credit note' };
const CLASSES = Object.keys(pack.classes);

// ---------------------------------------------------------------- state

const STORE = LIVE ? 'ph-tax-engine-live-v1' : 'ph-tax-engine-demo-v1';
const fresh = () => ({ view: 'overview', tp: 1, year: 2026, quarter: 3, regsAdded: [], acks: {}, mapOverrides: {}, inputs: {}, events: [], visited: [], seg: 0, page: {}, sel: {}, trace: {}, doc: {}, asOf: {}, regDraft: {} });
let S = (() => {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* storage unavailable */ }
  return fresh();
})();
if (!TAXPAYERS.some((t) => t.id === S.tp)) S.tp = TAXPAYERS[0]?.id ?? null;
const save = () => {
  try { localStorage.setItem(STORE, JSON.stringify(S)); } catch { /* storage unavailable */ }
};
const VIEWER = LIVE ? 'You' : 'You (demo viewer)';
function logEvent(action, entity, details) {
  if (LIVE) { api('events', { action, entity, details }).catch(() => {}); return; }
  S.events.push({ ts: new Date().toISOString(), actor: VIEWER, action, entity, details });
}
async function api(path, payload) {
  const r = await fetch(`api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
}
const acksMap = () => (LIVE ? SERVER.acks : S.acks);
const inputsMap = () => (LIVE ? SERVER.inputs : S.inputs);

// ---------------------------------------------------------------- engine calls

const tpById = (id) => TAXPAYERS.find((t) => t.id === id);
const byEff = (a, b) => a.effective_from.localeCompare(b.effective_from) || a.id - b.id;
const history = (id) => [...SEED_REGS, ...S.regsAdded].filter((r) => r.taxpayer_id === id).sort(byEff);

function mappingsFor(id) {
  if (LIVE) return SERVER.mappings[id] ?? [];
  const out = [];
  for (const m of defaultMappings(defaults, 'sample')) {
    const o = S.mapOverrides[`${id}|${m.source}|${m.source_tax_code}`];
    if (o === '') continue;
    out.push(o ? { ...m, ph_class: o } : m);
  }
  return out;
}
const classifyFor = (id) => (lines) => classifyWithMap(lines, mappingsFor(id));
const linesIn = (id, from, to) => (LEDGER[id]?.lines ?? []).filter((l) => l.doc_date >= from && l.doc_date <= to);

function thresholdAt(id, asOf) {
  const reg = registrationOn(history(id), asOf);
  if (!reg || reg.status !== 'NON_VAT') return null;
  return assessThresholdCore(pack, reg, classifyFor(id)(LEDGER[id]?.lines ?? []).classified, asOf);
}

function quarterRuns(id = S.tp, year = S.year, quarter = S.quarter) {
  const { start, end } = quarterBounds(year, quarter);
  const segs = segmentsFromHistory(history(id), start, end);
  if (!segs.length || segs.some((s) => !s.reg)) return { error: `No Form 2303 registration covers ${start} to ${end}. Record one on the Overview.`, runs: [] };
  const inputs = inputsMap()[`${id}|${year}Q${quarter}`] ?? {};
  const runs = segs.map((seg) => ({
    ...computeReturn({ pack, taxpayer: tpById(id), year, quarter, seg, split: segs.length > 1, lines: linesIn(id, seg.from, seg.to), classifyFn: classifyFor(id), inputs, threshold: thresholdAt(id, seg.to) }),
    runId: `demo-${id}-${seg.from}`,
  }));
  return { runs, start, end };
}

const findingKey = (id, run, f) => `${id}|${run.period.from}|${f.kind}|${hashStr(f.message)}`;
function openFindings(id, runs) {
  let n = 0;
  for (const r of runs) for (const f of r.findings) if (!acksMap()[findingKey(id, r, f)]) n++;
  return n;
}

// ---------------------------------------------------------------- walkthrough

function steps() {
  if (!LIVE) {
    return [
      { t: 'Xero data in', d: 'Invoices, bills and credit notes in Xero API format, normalized line by line.', tp: 1, view: 'data', focus: 'p-docs' },
      { t: 'Form 2303 picks the path', d: 'VAT goes to 2550Q, non-VAT to 2551Q. Only a 2303 record changes it.', tp: 1, view: 'overview', focus: 'p-registration' },
      { t: 'Threshold advisory', d: 'A non-VAT taxpayer passes PHP 3M. Flagged for review, status unchanged.', tp: 2, view: 'overview', focus: 'p-threshold' },
      { t: 'Invoice to official form', d: 'INV-0142 traced through every formula to item 26 on the 2550Q.', tp: 1, view: 'trace', focus: 'p-trace' },
    ];
  }
  const live = TAXPAYERS.find((t) => t.source === 'xero') ?? TAXPAYERS[0];
  const nonVat = TAXPAYERS.find((t) => history(t.id).some((r) => r.status === 'NON_VAT')) ?? live;
  if (!live) return [];
  const org = live.connection?.org_name ?? 'Xero';
  return [
    { t: 'Xero data in', d: `Invoices, bills and credit notes pulled live from ${org}, normalized line by line.`, tp: live.id, view: 'data', focus: 'p-docs' },
    { t: 'Form 2303 picks the path', d: 'VAT goes to 2550Q, non-VAT to 2551Q. Only a 2303 record changes it.', tp: live.id, view: 'overview', focus: 'p-registration' },
    { t: 'Threshold advisory', d: 'A non-VAT taxpayer passes PHP 3M. Flagged for review, status unchanged.', tp: nonVat.id, view: 'overview', focus: 'p-threshold' },
    { t: 'Invoice to official form', d: 'One invoice traced through every formula to the amount payable on the form.', tp: live.id, view: 'trace', focus: 'p-trace' },
  ];
}

/** A good document to show first: a multi-line sales invoice in the period, else any posted sale. */
function featuredDoc(tpId, from, to) {
  const docs = (LEDGER[tpId]?.docs ?? []).filter((d) => d.lines.length && (!from || (d.date >= from && d.date <= to)));
  return docs.find((d) => d.number === 'INV-0142') ?? docs.find((d) => d.doc.Type === 'ACCREC' && d.lines.length > 1) ?? docs.find((d) => d.doc.Type === 'ACCREC') ?? docs[0] ?? null;
}

function renderTour() {
  const STEPS = steps();
  const active = STEPS.findIndex((s) => s.view === S.view && s.tp === S.tp);
  $('#tour').innerHTML = STEPS.map((s, i) => `
    <button type="button" class="step${i === active ? ' active' : ''}${S.visited.includes(i) ? ' done' : ''}" data-act="step" data-i="${i}" aria-pressed="${i === active}">
      <span class="step-n">${S.visited.includes(i) && i !== active ? I.check.replace('<svg', '<svg width="14" height="14"') : i + 1}</span>
      <span><span class="step-t">${esc(s.t)}</span><span class="step-d">${esc(s.d)}</span></span>
    </button>`).join('');
}

// ---------------------------------------------------------------- rail

function statusChip(status) {
  if (status === 'VAT') return '<span class="chip vat">VAT-registered</span>';
  if (status === 'NON_VAT') return '<span class="chip nonvat">Non-VAT</span>';
  return '<span class="chip crit">No 2303 on file</span>';
}

function renderRail(ctx) {
  const { end } = quarterBounds(S.year, S.quarter);
  const views = [
    ['overview', 'Overview', I.overview],
    ['data', 'Xero data', I.data],
    ['return', 'Return &amp; form', I.form],
    ['trace', 'Trace', I.trace],
    ['audit', 'Audit trail', I.audit],
    ['rules', 'Rules &amp; mapping', I.rules],
  ];
  const quarters = [];
  for (const y of [2025, 2026]) for (const q of [1, 2, 3, 4]) quarters.push([y, q]);
  $('#rail').innerHTML = `
    <div class="rail-sec"><span class="eyebrow">Client workspace</span><div class="small" style="font-weight:500">${esc(LIVE ? SERVER.workspace : 'Demo Accounting Firm')}</div></div>
    <div class="rail-sec"><span class="eyebrow">Taxpayers</span>
      <div class="tps stack" style="gap:8px">${TAXPAYERS.map((t) => `
        <button type="button" class="tp${t.id === S.tp ? ' active' : ''}" data-act="tp" data-id="${t.id}">
          <span class="tp-name">${esc(t.display)}</span>
          <span class="tp-meta"><span class="num">${fmtTin(t.tin)}</span>${statusChip(registrationOn(history(t.id), end)?.status)}${LIVE && t.source === 'xero' ? '<span class="chip ok">Xero</span>' : ''}</span>
        </button>`).join('')}
        ${LIVE ? '<button type="button" class="btn ghost" style="justify-content:flex-start" data-act="view" data-v="add">+ Add taxpayer</button>' : ''}
      </div>
    </div>
    <div class="rail-sec"><label class="eyebrow" for="period">Return period</label>
      <div class="period"><select id="period" data-act="period">${quarters.map(([y, q]) => `<option value="${y}-${q}"${y === S.year && q === S.quarter ? ' selected' : ''}>${y} Q${q}</option>`).join('')}</select></div>
    </div>
    <nav class="rail-sec nav" aria-label="Views">${views.map(([k, label, icon]) => `
      <button type="button" class="${S.view === k ? 'active' : ''}" data-act="view" data-v="${k}" aria-current="${S.view === k ? 'page' : 'false'}">${icon}<span>${label}</span>${k === 'overview' && ctx.open ? `<span class="count">${ctx.open}</span>` : ''}</button>`).join('')}
    </nav>`;
}

// ---------------------------------------------------------------- overview

function routeGraphic(runs, current) {
  const has = (st) => runs.some((r) => r.registration.status === st);
  const range = (st) => runs.filter((r) => r.registration.status === st).map((r) => `${niceDate(r.period.from)} to ${niceDate(r.period.to)}`).join(', ');
  const on = (st) => (has(st) ? 'var(--accent)' : 'var(--line)');
  const dash = (st) => (has(st) ? '' : 'stroke-dasharray="4 4"');
  return `
    <div class="route" aria-label="Routing from Form 2303 status to the return">
      <div class="route-src">
        <div class="eyebrow">BIR Form 2303</div>
        <div style="margin:6px 0">${statusChip(current?.status)}</div>
        <div class="tiny mono muted">${esc(current?.cor_reference ?? 'none')}</div>
      </div>
      <div class="route-lines" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M0,50 C55,50 45,25 100,25" fill="none" stroke="${on('VAT')}" stroke-width="2.5" vector-effect="non-scaling-stroke" ${dash('VAT')}/>
        <path d="M0,50 C55,50 45,75 100,75" fill="none" stroke="${has('NON_VAT') ? 'var(--slate)' : 'var(--line)'}" stroke-width="2.5" vector-effect="non-scaling-stroke" ${dash('NON_VAT')}/>
      </svg></div>
      <div class="route-dst">
        <div class="dst${has('VAT') ? ' on' : ''}"><div class="t">VAT path &middot; BIR 2550Q</div><div class="small">Output VAT less allowable input VAT</div>${has('VAT') ? `<div class="tiny mono" style="margin-top:4px">${esc(range('VAT'))}</div>` : ''}</div>
        <div class="dst nv${has('NON_VAT') ? ' on' : ''}"><div class="t">Percentage tax path &middot; BIR 2551Q</div><div class="small">3% of gross sales, ATC PT010</div>${has('NON_VAT') ? `<div class="tiny mono" style="margin-top:4px">${esc(range('NON_VAT'))}</div>` : ''}</div>
      </div>
    </div>`;
}

function registrationPanel(tp, end) {
  const hist = history(tp.id);
  const current = registrationOn(hist, end);
  const draft = S.regDraft[tp.id] ?? { status: current?.status === 'VAT' ? 'NON_VAT' : 'VAT' };
  const items = hist.map((r) => `
    <li class="${current && r.id === current.id ? 'current' : ''}">
      <div class="tl-row">${statusChip(r.status)}<span class="num small">effective ${esc(r.effective_from)}</span>${current && r.id === current.id ? `<span class="chip ok">In force on ${esc(end)}</span>` : ''}</div>
      <div class="tl-meta mono">${esc(r.cor_reference)}</div>
      <div class="tl-meta">Entered by ${esc(r.entered_by)} &middot; ${esc(niceDate(r.entered_at))}${r.note ? ` &middot; ${esc(r.note)}` : ''}</div>
    </li>`).join('');
  return `
    <article class="panel" id="p-registration">
      <div class="panel-h"><div><h2>Registration status (BIR Form 2303)</h2><p class="small muted">Entered by a person from the Certificate of Registration. Effective-dated and append-only.</p></div></div>
      <ol class="tl">${items}</ol>
      <form class="rec" data-form="reg" novalidate>
        <div class="eyebrow">Record a 2303 update</div>
        <div class="rec-row">
          <div class="field"><span>New status</span><div class="seg" role="group" aria-label="New status">
            <button type="button" class="${draft.status === 'VAT' ? 'on' : ''}" data-act="draft" data-s="VAT">VAT</button>
            <button type="button" class="${draft.status === 'NON_VAT' ? 'on' : ''}" data-act="draft" data-s="NON_VAT">Non-VAT</button></div></div>
          <div class="field"><label for="reg-eff">Effective from</label><input id="reg-eff" type="date" value="${esc(draft.eff ?? '2026-08-01')}" required></div>
          <div class="field"><label for="reg-cor">2303 / COR reference</label><input id="reg-cor" placeholder="COR OCN 2RC0000999999" value="${esc(draft.cor ?? '')}" required></div>
        </div>
        <div class="field"><label for="reg-note">Note</label><input id="reg-note" placeholder="e.g. Updated after BIR Form 1905" value="${esc(draft.note ?? '')}"></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn primary" type="submit">Record 2303 update</button><span class="small muted">Returns recompute from the effective date. Earlier periods keep the status they had.</span></div>
        <div class="err-text" id="reg-err" hidden></div>
      </form>
    </article>`;
}

function pathPanel(tp, ctx) {
  const { runs, error, start, end } = ctx.q;
  const current = registrationOn(history(tp.id), end);
  if (error) return `<article class="panel" id="p-path"><h2>Tax path</h2><p class="err-text" style="margin-top:8px">${esc(error)}</p></article>`;
  return `
    <article class="panel" id="p-path">
      <div class="panel-h"><div><h2>Tax path for ${S.year} Q${S.quarter}</h2><p class="small muted">${esc(niceDate(start))} to ${esc(niceDate(end))}${runs.length > 1 ? ' &middot; split by a 2303 change inside the quarter' : ''}</p></div></div>
      ${routeGraphic(runs, current)}
      <div class="note">${I.info}<span>The path is read from the 2303 record in force for each date. Transaction totals never change it. Crossing the VAT threshold raises a review item and nothing else.</span></div>
      <div class="stack" style="margin-top:12px">${runs.map((r, i) => `
        <div class="finding" style="border-left-color:${r.registration.status === 'VAT' ? 'var(--accent)' : 'var(--slate)'};align-items:center">
          <span class="chip form">${r.form}</span>
          <div><div class="small">${esc(niceDate(r.period.from))} to ${esc(niceDate(r.period.to))}</div><div class="tiny muted">${r.lineCount.classified} ledger lines &middot; ${r.findings.length} finding${r.findings.length === 1 ? '' : 's'}</div></div>
          <div style="display:flex;gap:10px;align-items:center"><div style="text-align:right"><div class="tiny muted">Payable</div>${peso(r.items[payableItem(r.form)].value)}</div><button type="button" class="btn" data-act="open-return" data-seg="${i}">Open ${r.form}</button></div>
        </div>`).join('')}
      </div>
    </article>`;
}

function thresholdChart(series, threshold, advisory, sel) {
  const W = 1000, H = 290, L = 56, R = 34, T = 22, B = 36;
  const n = series.length;
  const maxV = Math.max(threshold * 1.12, ...series.map((s) => s.v * 1.06));
  const x = (i) => L + (n === 1 ? 0 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const ticks = [];
  for (let v = 0; v <= maxV; v += 100000000) ticks.push(v);
  const pts = series.map((s, i) => [x(i), y(s.v)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const step = (W - L - R) / Math.max(n - 1, 1);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trailing 12-month gross sales against the VAT threshold">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v === 0 ? '0' : `${(v / 100000000).toFixed(1)}M`}</text>`).join('')}
    <line class="thr" x1="${L}" x2="${W - R}" y1="${y(threshold)}" y2="${y(threshold)}"/>
    <text class="thr-l" x="${L + 8}" y="${y(threshold) - 7}">VAT threshold ${(threshold / 100000000).toFixed(1)}M</text>
    <line class="adv" x1="${L}" x2="${W - R}" y1="${y(advisory)}" y2="${y(advisory)}"/>
    <text class="adv-l" x="${L + 8}" y="${y(advisory) - 7}">Advisory ${(advisory / 100000000).toFixed(1)}M</text>
    <path class="area" d="${area}"/><path class="line" d="${line}"/>
    ${series.map((s, i) => `<text x="${x(i)}" y="${H - 12}" text-anchor="middle"${i % 2 && n > 8 ? ' opacity="0"' : ''}>${monthLabel(s.ym)}</text>`).join('')}
    ${series.map((s, i) => `<rect class="hit" x="${x(i) - step / 2}" y="${T}" width="${step}" height="${H - T - B}" data-act="asof" data-d="${s.d}"><title>${monthLabel(s.ym)}: ${fmt(s.v)}</title></rect>`).join('')}
    ${series.map((s, i) => `<circle class="pt${s.v > threshold ? ' over' : ''}${s.d === sel ? ' sel' : ''}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="${s.d === sel ? 6 : 3.5}" data-act="asof" data-d="${s.d}"/>`).join('')}
  </svg>`;
}

function thresholdPanel(tp, ctx) {
  const { end, runs } = ctx.q;
  const everNonVat = history(tp.id).some((r) => r.status === 'NON_VAT');
  const other = TAXPAYERS.find((t) => t.id !== tp.id && history(t.id).some((r) => r.status === 'NON_VAT'));
  if (!everNonVat) {
    return `<article class="panel" id="p-threshold"><div class="panel-h"><div><h2>VAT threshold monitor</h2><p class="small muted">Runs for non-VAT taxpayers only.</p></div><span class="chip neutral">Not applicable</span></div>
      <p class="small">${esc(tp.display)} is VAT-registered for the whole period, so there is no registration threshold to watch.${other ? ` Switch to <button type="button" class="btn ghost" style="padding:0 4px;color:var(--accent)" data-act="tp" data-id="${other.id}">${esc(other.display)}</button> to see the advisory.` : ''}</p></article>`;
  }
  if (!LEDGER[tp.id]?.lines.length) {
    return `<article class="panel" id="p-threshold"><div class="panel-h"><div><h2>VAT threshold monitor</h2><p class="small muted">No sales in the ledger yet.</p></div><span class="chip neutral">Waiting for data</span></div></article>`;
  }
  const lines = classifyFor(tp.id)(LEDGER[tp.id].lines).classified;
  const firstYm = LEDGER[tp.id].lines[0].doc_date.slice(0, 7);
  const months = [];
  for (let d = new Date(`${firstYm}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const probe = { id: 0, status: 'NON_VAT', cor_reference: '' };
  const series = months.map((ym) => {
    const d = monthEnd(ym);
    return { ym, d, v: assessThresholdCore(pack, probe, lines, d).grossSales };
  });
  const asOf = S.asOf[tp.id] && S.asOf[tp.id] <= end ? S.asOf[tp.id] : end;
  const th = thresholdAt(tp.id, asOf);
  const thrParam = assessThresholdCore(pack, probe, lines, asOf);
  const threshold = thrParam.threshold;
  const advisory = Math.round(threshold * thrParam.advisoryRatio);
  const reg = registrationOn(history(tp.id), asOf);
  const qRun = runs.find((r) => r.period.from <= asOf && r.period.to >= asOf) ?? runs[runs.length - 1];
  const sev = th ? (th.kind === 'VAT_THRESHOLD_CROSSED' ? 'crit' : th.kind === 'VAT_THRESHOLD_APPROACHING' ? 'warn' : 'ok') : 'neutral';
  const sevText = th ? (th.kind === 'VAT_THRESHOLD_CROSSED' ? 'Threshold crossed' : th.kind === 'VAT_THRESHOLD_APPROACHING' ? 'Approaching threshold' : 'Below advisory level') : 'Not monitored';
  const ratio = thrParam.ratio;
  const gaugeColor = ratio > 1 ? 'var(--crit)' : ratio >= thrParam.advisoryRatio ? 'var(--warn)' : 'var(--ok)';
  const chips = months.slice(-6).map((ym) => { const d = monthEnd(ym); return `<button type="button" class="${d === asOf ? 'on' : ''}" data-act="asof" data-d="${d}">${monthLabel(ym)}</button>`; }).join('');

  return `
    <article class="panel" id="p-threshold">
      <div class="panel-h"><div><h2>VAT threshold monitor</h2><p class="small muted">Trailing ${thrParam.window.months}-month gross sales, excluding VAT-exempt sales. Pick a month-end to see what the engine reported on that date.</p></div><span class="chip ${sev}">${sevText}</span></div>
      <div class="months" role="group" aria-label="As of month-end">${chips}</div>
      <div class="th-summary">
        <div class="kpi"><div class="eyebrow">Gross sales, 12 months to ${esc(asOf)}</div><div class="v">${peso(thrParam.grossSales)}</div></div>
        <div class="kpi"><div class="eyebrow">Share of &#8369;${esc(fmt(threshold).replace('.00', ''))} threshold</div><div class="v">${pct(ratio)}</div>
          <div class="gauge"><i style="width:${Math.min(ratio / 1.2, 1) * 100}%;background:${gaugeColor}"></i><b style="left:${(thrParam.advisoryRatio / 1.2) * 100}%;background:var(--warn)" title="Advisory"></b><b style="left:${(1 / 1.2) * 100}%" title="Threshold"></b></div></div>
        <div class="kpi"><div class="eyebrow">Registered status on ${esc(asOf)}</div><div class="v" style="font-size:15px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">${statusChip(reg?.status)}<span class="tiny muted" style="font-family:var(--f-body)">${reg?.status === 'NON_VAT' ? 'unchanged by the engine' : 'from a 2303 update'}</span></div></div>
      </div>
      ${thresholdChart(series, threshold, advisory, asOf)}
      <p class="tiny muted" style="margin:4px 0 12px">Ledger data starts in ${esc(monthLabel(firstYm))}, so points before ${esc(monthLabel(months[Math.min(11, months.length - 1)]))} cover fewer than 12 months.</p>
      ${th && th.kind !== 'VAT_THRESHOLD_OK' ? `<div class="finding ${th.severity}"><span class="chip ${sev}">${esc(th.severity)}</span><div><div class="k">${esc(th.kind)}</div><div class="m">${esc(th.message)}</div></div><span></span></div>` : ''}
      ${!th ? `<div class="note">${I.info}<span>The taxpayer is VAT-registered on ${esc(asOf)} per a 2303 record, so the monitor does not run for this date.</span></div>` : ''}
      <div class="norm-notes" style="margin-top:12px">
        <div>${I.check}<span>${th && th.kind !== 'VAT_THRESHOLD_OK' ? 'Raised an exception for human review in the review queue below.' : 'No exception needed at this date.'}</span></div>
        <div>${I.check}<span>Registration record untouched. The engine has no code path that writes to it.</span></div>
        ${qRun ? `<div>${I.check}<span>The ${S.year} Q${S.quarter} return for this date is still prepared on <b>${qRun.form}</b>, because that is what the 2303 record says.</span></div>` : ''}
      </div>
    </article>`;
}

function reviewPanel(tp, runs) {
  const rows = runs.flatMap((r) => r.findings.map((f) => ({ r, f, key: findingKey(tp.id, r, f) })));
  const body = rows.length
    ? rows.map(({ r, f, key }) => {
        const ack = acksMap()[key];
        return `<div class="finding ${f.severity}">
          <span class="chip ${f.severity === 'CRITICAL' ? 'crit' : 'warn'}">${esc(f.severity)}</span>
          <div><div class="k">${esc(f.kind)} &middot; ${r.form} ${esc(r.period.from)} to ${esc(r.period.to)}</div><div class="m">${esc(f.message)}</div>
            ${ack ? `<div class="tiny muted" style="margin-top:6px">Reviewed by ${esc(ack.by)} on ${esc(niceDate(ack.at))}: ${esc(ack.note)}</div>` : ''}</div>
          ${ack ? '<span class="chip ok">Reviewed</span>' : `<form class="ack" data-form="ack" data-key="${esc(key)}" data-kind="${esc(f.kind)}"><input aria-label="Review note" placeholder="Review note" required><button class="btn" type="submit">Acknowledge</button></form>`}
        </div>`;
      }).join('')
    : '<p class="small muted">No findings for this quarter.</p>';
  return `<article class="panel" id="p-review"><div class="panel-h"><div><h2>Review queue</h2><p class="small muted">Findings from the ${S.year} Q${S.quarter} computation. Acknowledging records a note. It never changes a registration.</p></div></div><div class="stack">${body}</div></article>`;
}

function viewOverview(ctx) {
  const tp = tpById(S.tp);
  const { end } = quarterBounds(S.year, S.quarter);
  return `
    <section class="vhead"><div><div class="eyebrow">Taxpayer</div><h1>${esc(tp.display)}</h1>
      <p class="sub small">TIN <span class="num">${fmtTin(tp.tin)}-${tp.branch_code}</span> &middot; RDO ${esc(tp.rdo_code)} &middot; ${esc(tp.classification.charAt(0) + tp.classification.slice(1).toLowerCase())} &middot; ${esc(tp.blurb)}</p></div>
      ${statusChip(registrationOn(history(tp.id), end)?.status)}</section>
    <div class="grid-2">${registrationPanel(tp, end)}${pathPanel(tp, ctx)}</div>
    ${thresholdPanel(tp, ctx)}
    ${reviewPanel(tp, ctx.q.runs)}`;
}

// ---------------------------------------------------------------- xero data

function jsonHTML(obj) {
  return esc(JSON.stringify(obj, null, 2)).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g, (m, str, colon, kw, num) => {
    if (str) return colon ? `<span class="k">${str}</span>${colon}` : `<span class="s">${str}</span>`;
    if (kw) return `<span class="b">${kw}</span>`;
    return `<span class="n">${num}</span>`;
  });
}

function normNotes(d) {
  const notes = [];
  const doc = d.doc;
  if (!d.lines.length) notes.push(`Status ${doc.Status}: not posted, so the normalizer skips it. Only AUTHORISED and PAID documents reach the ledger.`);
  if (doc.Type.endsWith('CREDIT')) notes.push('Credit note: amounts are stored as negatives so they reduce the period totals.');
  if (doc.CurrencyCode !== 'PHP') notes.push(`${doc.CurrencyCode} document converted to PHP at the document rate (${doc.CurrencyRate} ${doc.CurrencyCode} per PHP).`);
  notes.push(`Line amounts are tax-${doc.LineAmountTypes === 'Inclusive' ? 'inclusive, so tax is split out of each line' : 'exclusive, so net is the line amount'}.`);
  notes.push('Each line keeps its Xero LineItemID, so a re-sync updates it in place and a voided document is removed.');
  return notes;
}

function connectionPanel(tp, L) {
  const posted = L.docs.filter((d) => d.lines.length).length;
  const credits = L.docs.filter((d) => d.doc.Type.endsWith('CREDIT')).length;
  const kpis = `<div class="kpis" style="margin-top:14px">
        <div class="kpi"><div class="eyebrow">Documents pulled</div><div class="v">${L.docs.length}</div></div>
        <div class="kpi"><div class="eyebrow">Posted to ledger</div><div class="v">${posted}</div></div>
        <div class="kpi"><div class="eyebrow">Ledger lines</div><div class="v">${L.lines.length}</div></div>
        <div class="kpi"><div class="eyebrow">Credit notes</div><div class="v">${credits}</div></div>
      </div>`;
  const scopes = `<div>Scopes</div><div class="scopes">${['accounting.invoices.read', 'accounting.contacts.read', 'accounting.settings.read', 'offline_access'].map((x) => `<span class="chip neutral mono">${x}</span>`).join('')}</div>`;
  const endpoints = '<div>Endpoints</div><div class="mono small">GET /api.xro/2.0/Invoices, /CreditNotes, /Organisation, /TaxRates (paged, date-filtered)</div>';
  const synced = `<span class="chip ok">${I.check.replace('<svg', '<svg width="12" height="12"')} Synced</span>`;
  if (!LIVE || tp.source === 'sample') {
    return `<article class="panel" id="p-source">
      <div class="panel-h"><div><h2>Connection</h2><p class="small muted">${LIVE ? 'Sample organisation loaded offline in Xero API format.' : 'This demo loads a sample organisation. The installed version connects to your Xero organisation with OAuth 2.0 and read-only scopes.'}</p></div>${synced}</div>
      <div class="kv">${endpoints}${scopes}<div>Security</div><div class="small">Tokens encrypted at rest (AES-256-GCM), refreshed automatically, rate limits respected</div></div>${kpis}</article>`;
  }
  const c = tp.connection;
  if (!c || tp.source !== 'xero') {
    const action = SERVER.xero.configured
      ? `<a class="btn primary" href="connect/xero?taxpayer=${tp.id}">${I.data}Connect to Xero</a>`
      : '<p class="err-text">Xero is not configured on this server yet: add XERO_CLIENT_ID and XERO_CLIENT_SECRET to .env and restart.</p>';
    return `<article class="panel" id="p-source"><div class="panel-h"><div><h2>Connect to Xero</h2><p class="small muted">Authorise read access to this taxpayer's Xero organisation. You sign in on Xero's own page, so this app never sees your Xero password.</p></div></div>${action}</article>`;
  }
  const { end } = quarterBounds(S.year, S.quarter);
  const seed = SERVER.xero.writeEnabled
    ? '<div class="small muted" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">Demo organisation: <button type="button" class="btn" style="padding:3px 10px" data-act="seed-xero">Create sample PH invoices in this Xero org</button></div>'
    : '';
  return `<article class="panel" id="p-source">
      <div class="panel-h"><div><h2>Connected to ${esc(c.org_name)}</h2><p class="small muted">Live Xero organisation &middot; base currency ${esc(c.base_currency || 'shown after the first sync')} &middot; last sync ${esc(c.last_sync_at ? `${c.last_sync_at} UTC` : 'not yet')}</p></div><span class="chip ok">${I.check.replace('<svg', '<svg width="12" height="12"')} Connected</span></div>
      <div class="kv">${endpoints}<div>Security</div><div class="small">OAuth 2.0; tokens encrypted at rest (AES-256-GCM) and refreshed automatically</div></div>
      <form class="rec" data-form="sync" style="margin-top:12px"><div class="rec-row">
        <div class="field"><label for="sync-from">From</label><input id="sync-from" type="date" value="${esc(S.syncFrom ?? '2025-07-01')}"></div>
        <div class="field"><label for="sync-to">To</label><input id="sync-to" type="date" value="${esc(S.syncTo ?? end)}"></div>
        <div class="field"><span>&nbsp;</span><button class="btn primary" type="submit" id="sync-btn">${I.data}Sync from Xero now</button></div></div>
        ${seed}
      </form>${kpis}</article>`;
}

function mappingRows(tp, L) {
  const current = new Map(mappingsFor(tp.id).map((m) => [`${m.source}|${m.source_tax_code}`, m]));
  const keys = new Map();
  if (!LIVE) for (const m of defaultMappings(defaults, 'sample')) keys.set(`${m.source}|${m.source_tax_code}`, { source: m.source, key: m.source_tax_code });
  for (const m of current.values()) keys.set(`${m.source}|${m.source_tax_code}`, { source: m.source, key: m.source_tax_code });
  for (const l of L.lines) {
    const key = `${l.doc_type.startsWith('SALE') ? 'SALE' : 'PURCHASE'}:${l.source_tax_code}`;
    keys.set(`${l.source}|${key}`, { source: l.source, key });
  }
  const used = (k) => L.lines.filter((l) => `${l.source}|${l.doc_type.startsWith('SALE') ? 'SALE' : 'PURCHASE'}:${l.source_tax_code}` === k).length;
  const entries = [...keys.entries()].sort((a, b) => used(b[0]) - used(a[0]) || a[0].localeCompare(b[0]));
  const shown = entries.filter(([k]) => used(k));
  const hidden = entries.length - shown.length;
  return shown
    .map(([k, { source, key }]) => {
      const cur = current.get(k)?.ph_class ?? '';
      return `<tr><td class="num small">${esc(key)}${used(k) && !cur ? ' <span class="chip crit">unmapped</span>' : ''}</td><td class="r num small">${used(k)}</td>
      <td><select class="map${cur === '' ? ' unmapped' : ''}" data-act="map" data-tp="${tp.id}" data-source="${esc(source)}" data-key="${esc(key)}" aria-label="PH class for ${esc(key)}">
        <option value=""${cur === '' ? ' selected' : ''}>(unmapped: hold lines out)</option>
        ${CLASSES.map((c) => `<option${c === cur ? ' selected' : ''}>${c}</option>`).join('')}</select></td>
      <td class="small muted">${esc(pack.classes[cur] ?? 'Lines using this code are excluded and raised as a critical finding.')}</td></tr>`;
    }).join('') + (hidden ? `<tr><td colspan="4" class="tiny muted">${hidden} more default mapping${hidden === 1 ? '' : 's'} not used by this organisation's documents.</td></tr>` : '');
}

function viewData() {
  const tp = tpById(S.tp);
  if (!tp) return '<section class="vhead"><h1>No taxpayers yet</h1></section>';
  const L = LEDGER[tp.id] ?? { docs: [], lines: [] };
  const org = tp.source === 'xero' ? tp.connection?.org_name ?? tp.display : !LIVE ? SAMPLE_ORGS[tp.org].name.replace(' (sample)', '') : tp.display;
  if (!L.docs.length) {
    return `<section class="vhead"><div><div class="eyebrow">Accounting data</div><h1>${esc(org)}</h1><p class="sub small">No documents pulled yet.</p></div></section>${connectionPanel(tp, L)}`;
  }
  const selId = S.doc[tp.id] ?? featuredDoc(tp.id)?.id ?? L.docs[0].id;
  const sel = L.docs.find((d) => d.id === selId) ?? L.docs[0];
  const posted = L.docs.filter((d) => d.lines.length).length;
  const credits = L.docs.filter((d) => d.doc.Type.endsWith('CREDIT')).length;
  const mapRows = mappingRows(tp, L);

  return `
    <section class="vhead"><div><div class="eyebrow">Accounting data</div><h1>${esc(org)}</h1><p class="sub small">${tp.source === 'xero' ? 'Documents pulled live from the Xero Accounting API.' : 'Documents in Xero Accounting API format, base currency PHP.'}</p></div></section>
    ${connectionPanel(tp, L)}
    <div class="split" id="p-docs">
      <article class="panel"><div class="panel-h"><h2>Documents</h2><span class="small muted">Select one to see the raw record</span></div>
        <div class="scroll-x" id="doc-list" style="max-height:600px;overflow:auto"><table>
          <thead><tr><th>Document</th><th>Date</th><th class="r">Total</th></tr></thead>
          <tbody>${L.docs.map((d) => `<tr class="click${d.id === sel.id ? ' sel' : ''}" data-act="doc" data-id="${esc(d.id)}" tabindex="0">
            <td><div class="small" style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap"><b class="mono">${esc(d.number)}</b><span class="tiny muted">${esc(DOC_TYPE[d.doc.Type])}</span><span class="tiny mono status-${esc(d.doc.Status)}">${esc(d.doc.Status)}</span></div><div class="tiny muted">${esc(d.doc.Contact.Name)}</div></td>
            <td class="num small">${esc(d.date)}</td>
            <td class="r num small">${esc(d.doc.CurrencyCode)} ${esc(fmt(Math.round(d.doc.Total * 100)))}</td></tr>`).join('')}</tbody></table></div>
      </article>
      <article class="panel">
        <div class="panel-h"><div><h2>${esc(sel.number)} &middot; ${esc(DOC_TYPE[sel.doc.Type])}</h2><p class="small muted">${esc(sel.doc.Contact.Name)} &middot; ${esc(niceDate(sel.date))}</p></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${sel.source === 'xero' ? `<a class="btn" href="${xeroUrl(sel)}" target="_blank" rel="noopener">Open in Xero &#8599;</a>` : ''}${sel.lines.length ? `<button type="button" class="btn" data-act="trace-doc" data-n="${esc(sel.number)}">${I.trace}Trace to form</button>` : '<span class="chip warn">Not posted</span>'}</div></div>
        <div class="eyebrow" style="margin-bottom:6px">Xero payload</div>
        <pre class="json">${jsonHTML(sel.doc)}</pre>
        <div class="eyebrow" style="margin:14px 0 6px">Normalized ledger lines</div>
        ${sel.lines.length ? `<div class="scroll-x"><table><thead><tr><th>Description</th><th>Tax code</th><th class="r">Net (PHP)</th><th class="r">Tax</th></tr></thead><tbody>
          ${sel.lines.map((l) => `<tr><td class="small">${esc(l.description)}</td><td class="num small">${esc(l.source_tax_code)}</td><td class="r">${money(Math.round(l.net * 100))}</td><td class="r">${money(Math.round(l.tax * 100))}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">No ledger lines.</p>'}
        <div class="norm-notes">${normNotes(sel).map((n) => `<div>${I.check}<span>${esc(n)}</span></div>`).join('')}</div>
      </article>
    </div>
    <article class="panel" id="p-mapping">
      <div class="panel-h"><div><h2>Tax code mapping</h2><p class="small muted">How each ledger tax code is classified for Philippine tax. Try setting one to unmapped: its lines are held out of the return and raised as a critical finding, never guessed.</p></div></div>
      <div class="scroll-x"><table><thead><tr><th>Direction : code</th><th class="r">Lines</th><th>PH class</th><th>Meaning</th></tr></thead><tbody>${mapRows}</tbody></table></div>
    </article>`;
}

// ---------------------------------------------------------------- return + form

const SECTIONS = {
  '2550Q': [
    ['Part II &middot; Total tax payable', ['15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26'], 0],
    ['Part IV &middot; Sales and output tax', ['31A', '31B', '32A', '33A', '34A', '34B', '35B', '36B', '37B'], 1],
    ['Part IV &middot; Allowable input tax', ['38B', '39B', '40B', '41B', '42B', '43B', '44A', '44B', '45A', '45B', '46A', '46B', '47A', '47B', '48A', '49A', '50A', '50B', '51B'], 1],
    ['Part IV &middot; Deductions from input tax', ['52B', '53B', '54B', '55B', '56B', '57B', '58B', '59B', '60B', '61B'], 1],
  ],
  '2551Q': [
    ['Schedule 1 &middot; Computation of tax', ['S1.1.base', 'S1.1.tax', 'S1.2.base', 'S1.2.tax', 'S1.3.base', 'S1.3.tax', 'S1.4.base', 'S1.4.tax', 'S1.5.base', 'S1.5.tax', 'S1.6.base', 'S1.6.tax', 'S1.7'], 1],
    ['Part II &middot; Total tax payable', ['14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24'], 0],
  ],
};
const PAGE_TITLES = { '2550Q': ['Page 1 &middot; Parts I to III', 'Page 2 &middot; Parts IV and V'], '2551Q': ['Page 1 &middot; Parts I to III', 'Page 2 &middot; Schedule 1'] };

function itemPage(form, key) {
  const f = MAPS[form].fields.find((x) => x.type === 'amount' && x.item === key);
  return f ? f.page : null;
}

function sheetHTML(run, pageIdx, active, related = []) {
  const map = MAPS[run.form];
  const lay = layoutForm(run, map);
  const W = 612;
  const H = PAGE_H[run.form];
  const p = (v, d) => ((v / d) * 100).toFixed(3);
  const regions = lay.regions.filter((r) => r.page === pageIdx).map((r) => {
    const k = r.key.slice(5);
    const cls = k === active ? ' on' : related.includes(k) ? ' in' : '';
    return `<div class="rg${cls}" data-act="item" data-k="${esc(k)}" title="${esc(`${k} ${run.items[k]?.label ?? ''}`)}" style="left:${p(r.x0, W)}%;top:${p(r.y0, H)}%;width:${p(r.x1 - r.x0, W)}%;height:${p(r.y1 - r.y0, H)}%"></div>`;
  }).join('');
  const glyphs = lay.glyphs.filter((g) => g.page === pageIdx).map((g) =>
    `<span class="g${g.anchor === 'right' ? ' right' : ''}" style="left:${p(g.x, W)}%;top:${p(g.y, H)}%;font-size:${p(g.size, W)}cqw">${esc(g.text)}</span>`).join('');
  return `<div class="sheet"><img src="assets/forms/${run.form}-p${pageIdx + 1}.png" width="1224" height="${H * 2}" alt="Official BIR Form ${run.form}, page ${pageIdx + 1}, populated by the engine">${regions}${glyphs}${isSampleTp(tpById(S.tp)) ? '<div class="wm" aria-hidden="true"><span>SAMPLE DATA &middot; NOT FOR FILING</span></div>' : ''}</div>`;
}

function lineageHTML(run, it) {
  const parts = [];
  if (it.kind === 'derived') {
    parts.push(`<div class="formula">${esc(it.key)} = ${esc(it.formula)}</div>`);
    if (it.inputs?.length) parts.push(`<div class="inputs">${it.inputs.map((k) => `<button type="button" data-act="item" data-k="${esc(k)}">${esc(k)} ${esc(fmt(run.items[k]?.value ?? 0))}</button>`).join('')}</div>`);
  }
  if (it.kind === 'input') parts.push(`<div>${esc(it.note)}</div>`);
  if (it.sources?.length) {
    parts.push(`<div class="tiny muted">${it.sources.length} ledger line${it.sources.length === 1 ? '' : 's'}</div><div class="src-list">${it.sources.map((s) => `
      <button type="button" data-act="trace-doc" data-n="${esc(s.docNumber)}"><span class="doc">${esc(s.docNumber)}</span><span class="muted">${esc(s.contact)} &middot; ${esc(s.docDate)}${s.note ? ` &middot; ${esc(s.note)}` : ''}</span>${money(s.amount)}</button>`).join('')}</div>`);
  }
  if (!parts.length) parts.push('<div class="muted">Nothing contributed to this item for the period.</div>');
  const chain = chainToPayable(run, it.key);
  if (chain.length > 1) parts.push(`<div class="tiny muted">Carried to the payable: ${chain.map((c) => esc(c.key)).join(' &rarr; ')}</div>`);
  return `<div class="lineage">${parts.join('')}</div>`;
}

function prepInputs(run) {
  const key = `${S.tp}|${S.year}Q${S.quarter}`;
  const v = S.inputs[key] ?? {};
  const f = (name, label) => `<div class="field"><label for="in-${name}">${label}</label><input id="in-${name}" inputmode="decimal" data-act="input" data-name="${name}" placeholder="0.00" value="${v[name] ? esc(v[name]) : ''}"></div>`;
  return run.form === '2550Q'
    ? `${f('carriedOverInputTax', 'Item 38B &middot; Input tax carried over')}${f('creditableVatWithheld', 'Item 16 &middot; Creditable VAT withheld (2307)')}`
    : f('creditablePtWithheld', 'Item 15 &middot; Creditable PT withheld (2307)');
}

function viewReturn(ctx) {
  const tp = tpById(S.tp);
  const { runs, error } = ctx.q;
  if (error) return `<section class="vhead"><h1>Return &amp; form</h1></section><article class="panel"><p class="err-text">${esc(error)}</p></article>`;
  const segIdx = Math.min(S.seg, runs.length - 1);
  const run = runs[segIdx];
  const selKey = S.sel[run.form] && run.items[S.sel[run.form]] ? S.sel[run.form] : payableItem(run.form);
  const selItem = run.items[selKey];
  const related = [...(selItem.inputs ?? []), ...chainToPayable(run, selKey).map((c) => c.key).filter((k) => k !== selKey)];
  const page = S.page[run.form] ?? itemPage(run.form, selKey) ?? 0;
  const kp = run.form === '2550Q'
    ? [['Output tax due', run.items['37B'].value], ['Allowable input tax', run.items['60B'].value], ['Net VAT payable (item 26)', run.items['26'].value]]
    : [['Taxable gross sales', (run.schedule ?? []).reduce((s, x) => s + x.base, 0)], ['Rate', null, (run.schedule ?? []).map((x) => `${x.rate * 100}% ${x.atc}`).join(', ') || 'n/a'], ['Tax payable (item 24)', run.items['24'].value]];
  const lay = layoutForm(run, MAPS[run.form]);
  const groups = SECTIONS[run.form].map(([title, keys]) => `
    <div class="igroup"><h3>${title}</h3>${keys.map((k) => {
      const it = run.items[k];
      const zero = !it.value && !(it.sources?.length) && it.kind !== 'derived';
      const tag = it.kind === 'derived' ? 'formula' : it.kind === 'input' ? 'preparer input' : it.sources.length ? `${it.sources.length} line${it.sources.length === 1 ? '' : 's'}` : '';
      return `<div class="item${k === selKey ? ' on' : related.includes(k) ? ' in' : ''}${zero ? ' zero' : ''}" data-act="item" data-k="${esc(k)}" role="button" tabindex="0">
        <span class="key">${esc(k)}</span><span class="lab">${esc(it.label)}${tag ? `<span class="tag">${tag}</span>` : ''}</span><span>${money(it.value)}</span></div>${k === selKey ? lineageHTML(run, it) : ''}`;
    }).join('')}</div>`).join('');

  return `
    <section class="vhead"><div><div class="eyebrow">${esc(tp.display)} &middot; ${S.year} Q${S.quarter}</div><h1>BIR Form ${run.form}</h1>
      <p class="sub small">${esc(pack.paths[run.registration.status].description)} &middot; ${esc(niceDate(run.period.from))} to ${esc(niceDate(run.period.to))}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-act="dl-pdf">${I.download}Download populated PDF</button><button type="button" class="btn" data-act="dl-csv">${I.download}Working paper (CSV)</button></div></section>
    ${runs.length > 1 ? `<div class="segtabs" role="tablist" aria-label="Returns for this quarter">${runs.map((r, i) => `<button type="button" role="tab" aria-selected="${i === segIdx}" class="${i === segIdx ? 'on' : ''}" data-act="seg" data-i="${i}">${r.form} &middot; ${esc(r.period.from)} to ${esc(r.period.to)}</button>`).join('')}</div>` : ''}
    <div class="banner"><div class="route-mini"><span class="eyebrow">Routing</span> ${statusChip(run.registration.status)} <span class="mono tiny muted">${esc(run.registration.corReference)}</span> <span class="arrow">${I.arrow.replace('<svg', '<svg width="16" height="16"')}</span> <span class="chip form">${run.form}</span></div>
      <span class="small muted">${run.lineCount.classified} ledger lines used${run.lineCount.unmapped ? `, <b style="color:var(--crit)">${run.lineCount.unmapped} held out</b>` : ''} &middot; rule pack <span class="mono">${esc(run.rulePack)}</span></span></div>
    <div class="kpis">${kp.map(([l, v, t]) => `<div class="kpi"><div class="eyebrow">${l}</div><div class="v${l.includes('item') ? ' big' : ''}">${v == null ? esc(t) : peso(v)}</div></div>`).join('')}</div>
    ${run.findings.length ? `<div class="stack">${run.findings.map((f) => `<div class="finding ${f.severity}"><span class="chip ${f.severity === 'CRITICAL' ? 'crit' : 'warn'}">${esc(f.severity)}</span><div><div class="k">${esc(f.kind)}</div><div class="m">${esc(f.message)}</div></div><span></span></div>`).join('')}</div>` : ''}
    ${lay.overflow.length ? `<div class="note">${I.info}<span>${lay.overflow.map((o) => `"${esc(o.text)}" has ${o.text.length} characters but the form gives ${o.cells} cells for it; the form shows the first ${o.cells}. Abbreviate per BIR practice before filing.`).join(' ')}</span></div>` : ''}
    <div class="ret-grid">
      <article class="panel viewer" id="p-form">
        <div class="viewer-bar"><div class="pages" role="tablist" aria-label="Form page">${[0, 1].map((i) => `<button type="button" role="tab" aria-selected="${i === page}" class="${i === page ? 'on' : ''}" data-act="page" data-i="${i}">${PAGE_TITLES[run.form][i]}</button>`).join('')}</div>
          <span class="tiny muted">Blue = filled by the engine. The PDF prints it in black ink, as BIR requires.</span></div>
        <div class="sheet-wrap">${sheetHTML(run, page, selKey, related)}</div>
      </article>
      <article class="panel" id="p-items">
        <div class="panel-h"><div><h2>Line items</h2><p class="small muted">Click an item to see its formula and source documents. Its cells light up on the form.</p></div></div>
        <div class="items">${groups}</div>
        <div class="rec" style="margin-top:16px"><div class="eyebrow">Preparer inputs (not in the ledger)</div><div class="prep">${prepInputs(run)}</div></div>
      </article>
    </div>`;
}

// ---------------------------------------------------------------- trace

function viewTrace(ctx) {
  const tp = tpById(S.tp);
  const { runs, start, end } = ctx.q;
  const L = LEDGER[tp.id];
  const inQuarter = L.docs.filter((d) => start && d.date >= start && d.date <= end);
  const pick = S.trace[tp.id] ?? featuredDoc(tp.id, start, end)?.number ?? inQuarter[0]?.number;
  const d = inQuarter.find((x) => x.number === pick) ?? inQuarter[0];
  const options = inQuarter.map((x) => `<option value="${esc(x.number)}"${x === d ? ' selected' : ''}>${esc(x.number)} &middot; ${esc(x.doc.Contact.Name)}</option>`).join('');
  const head = `<section class="vhead"><div><div class="eyebrow">${esc(tp.display)} &middot; ${S.year} Q${S.quarter}</div><h1>Trace a transaction</h1><p class="sub small">Follow one document from the ledger to the populated official form.</p></div>
    <div class="field" style="min-width:260px"><label for="trace-pick">Document</label><select id="trace-pick" data-act="trace-pick">${options}</select></div></section>`;
  if (!d) return `${head}<article class="panel"><p class="muted">No documents in this quarter.</p></article>`;

  const run = runs.find((r) => d.date >= r.period.from && d.date <= r.period.to);
  const cls = classifyFor(tp.id)(d.lines);
  const hits = [];
  if (run) for (const it of Object.values(run.items)) for (const s of it.sources ?? []) if (d.lines.some((l) => l.id === s.lineId)) hits.push({ it, s });
  const mainHit = hits.find((h) => /B$|tax$/.test(h.it.key)) ?? hits[0];
  const chain = mainHit ? chainToPayable(run, mainHit.it.key) : [];
  const hitKeys = [...new Set(hits.map((h) => h.it.key))];
  const page = mainHit ? itemPage(run.form, mainHit.it.key) ?? 0 : 0;
  const reg = registrationOn(history(tp.id), d.date);

  const stage = (title, body) => `<li class="stage"><div class="stage-n" aria-hidden="true"></div><div class="panel"><h3>${title}</h3>${body}</div></li>`;
  const stages = [];
  stages.push(stage('Xero document', `<div class="kv">
      <div>Type</div><div>${esc(DOC_TYPE[d.doc.Type])} <span class="mono tiny muted">${esc(d.doc.Type)}</span></div>
      <div>Number</div><div class="mono">${esc(d.number)}</div><div>Contact</div><div>${esc(d.doc.Contact.Name)}</div>
      <div>Date</div><div>${esc(niceDate(d.date))}</div><div>Status</div><div class="mono small status-${esc(d.doc.Status)}">${esc(d.doc.Status)}</div>
      <div>Total</div><div class="num">${esc(d.doc.CurrencyCode)} ${esc(fmt(Math.round(d.doc.Total * 100)))}</div></div>
    <details style="margin-top:10px"><summary class="small" style="cursor:pointer;color:var(--accent)">Show the Xero payload</summary><pre class="json" style="margin-top:8px">${jsonHTML(d.doc)}</pre></details>`));
  if (!d.lines.length) {
    stages.push(stage('Normalized ledger lines', `<p class="small">${esc(normNotes(d)[0])} Nothing below applies to this document.</p>`));
  } else {
    stages.push(stage('Normalized ledger lines', `<div class="scroll-x"><table><thead><tr><th>Line</th><th>Description</th><th class="r">Net (PHP)</th><th class="r">Tax recorded</th></tr></thead><tbody>
      ${d.lines.map((l) => `<tr><td class="num small">#${l.id}</td><td class="small">${esc(l.description)}</td><td class="r">${money(Math.round(l.net * 100))}</td><td class="r">${money(Math.round(l.tax * 100))}</td></tr>`).join('')}</tbody></table></div>`));
    stages.push(stage('Classification', `<div class="stack" style="gap:6px">${[...cls.classified, ...cls.unmapped].map((l) => `<div class="small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="num">#${l.id}</span><span class="chip neutral mono">${esc(l.map_key)}</span><span class="arrow">&rarr;</span>${l.ph_class ? `<span class="chip vat mono">${esc(l.ph_class)}</span><span class="muted tiny">${esc(pack.classes[l.ph_class])}</span>` : '<span class="chip crit">Unmapped: held out</span>'}</div>`).join('')}</div>`));
    stages.push(stage('Registration and path', reg ? `<div class="small" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">Form 2303 in force on ${esc(niceDate(d.date))}: ${statusChip(reg.status)} <span class="mono tiny muted">${esc(reg.cor_reference)}, effective ${esc(reg.effective_from)}</span> <span class="arrow">&rarr;</span> <span class="chip form">${esc(pack.paths[reg.status].form)}</span></div>` : '<p class="err-text">No registration on this date.</p>'));
    stages.push(stage('Form items it feeds', hits.length ? `<div class="scroll-x"><table><thead><tr><th>Item</th><th>Description</th><th>How</th><th class="r">Contributes</th></tr></thead><tbody>
      ${hits.map((h) => `<tr class="click" data-act="goto-item" data-k="${esc(h.it.key)}"><td class="num"><b>${esc(h.it.key)}</b></td><td class="small">${esc(h.it.label)}</td><td class="small muted">${esc(h.s.note ?? 'net amount')}</td><td class="r">${money(h.s.amount)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="small muted">This line feeds no amount on the form (for example a purchase on the percentage-tax path).</p>'));
    if (chain.length > 1) {
      stages.push(stage('Carried to the amount payable', `<div class="chain">${chain.map((c, i) => `${i ? '<span class="arrow">&rarr;</span>' : ''}<button type="button" class="c${i === chain.length - 1 ? ' end' : ''}" data-act="goto-item" data-k="${esc(c.key)}"><b>${esc(c.key)}</b><span>${esc(fmt(c.value))}</span></button>`).join('')}</div>
        <p class="tiny muted" style="margin-top:8px">${chain.slice(1).map((c) => `${esc(c.key)} = ${esc(c.formula)}`).join(' &middot; ')}</p>`));
    }
    if (run && mainHit) {
      stages.push(stage(`On the official ${run.form}`, `<p class="small muted" style="margin-bottom:8px">Highlighted cells hold this document's contribution. Click any cell to open it in the form view.</p><div class="crop">${sheetHTML(run, page, mainHit.it.key, hitKeys.concat(chain.map((c) => c.key)))}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn primary" data-act="goto-item" data-k="${esc(chain[chain.length - 1]?.key ?? mainHit.it.key)}">${I.form}See item ${esc(chain[chain.length - 1]?.key ?? mainHit.it.key)} on the form</button><button type="button" class="btn" data-act="dl-pdf">${I.download}Download populated PDF</button></div>`));
    }
  }
  return `${head}<ol class="pipeline" id="p-trace">${stages.join('')}</ol>`;
}

// ---------------------------------------------------------------- audit

const demoSeedEvents = () => [
  { ts: '2026-09-01T09:00:00Z', actor: 'M. Reyes (preparer)', action: 'workspace.create', entity: 'workspace', details: { name: 'Demo Accounting Firm' } },
  ...TAXPAYERS.flatMap((t, i) => {
    const reg = SEED_REGS[i];
    const L = LEDGER[t.id];
    const m = String(5 + i * 7).padStart(2, '0');
    return [
      { ts: `2026-09-01T09:${m}:00Z`, actor: 'M. Reyes (preparer)', action: 'taxpayer.create', entity: `taxpayer ${t.id}`, details: { tin: fmtTin(t.tin), name: t.registered_name } },
      { ts: `2026-09-01T09:${m}:30Z`, actor: 'M. Reyes (preparer)', action: 'registration.record', entity: `taxpayer ${t.id}`, details: { status: reg.status, effectiveFrom: reg.effective_from, cor: reg.cor_reference, source: 'BIR_2303' } },
      { ts: `2026-09-01T09:${String(Number(m) + 1).padStart(2, '0')}:10Z`, actor: 'M. Reyes (preparer)', action: 'connection.authorise', entity: `taxpayer ${t.id}`, details: { provider: 'xero', org: SAMPLE_ORGS[t.org].name } },
      { ts: `2026-09-01T09:${String(Number(m) + 1).padStart(2, '0')}:40Z`, actor: 'system', action: 'sync.xero', entity: `taxpayer ${t.id}`, details: { documents: L.docs.length, lines: L.lines.length, skipped: L.docs.filter((d) => !d.lines.length).length } },
    ];
  }),
];

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function viewAudit() {
  if (LIVE) {
    const rows = [...SERVER.events].reverse().map((e) => `<tr><td class="num small">${e.id}</td><td class="num small">${esc(String(e.ts).replace('T', ' ').slice(0, 19))}</td><td class="small">${esc(e.actor)}</td><td class="ev-action">${esc(e.action)}</td><td class="small">${esc(e.entity)}<div class="tiny mono muted" style="word-break:break-word">${esc(JSON.stringify(e.details))}</div></td><td class="hash">${esc(e.hash.slice(0, 12))}</td></tr>`).join('');
    const chip = SERVER.chain.ok ? `<span class="chip ok">Hash chain verified \u00b7 ${SERVER.events.length} latest entries</span>` : `<span class="chip crit">Chain broken at entry ${SERVER.chain.brokenAt}</span>`;
    return `<section class="vhead"><div><div class="eyebrow">Traceability</div><h1>Audit trail</h1><p class="sub small">Every Xero connection and sync, 2303 record, mapping change, review and export is logged by the server. Each entry's SHA-256 covers the entry before it, and the database blocks edits and deletes.</p></div>${chip}</section>
      <article class="panel"><div class="scroll-x"><table><thead><tr><th>#</th><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Detail</th><th>Hash</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
  }
  const events = [...demoSeedEvents(), ...S.events];
  queueMicrotask(async () => {
    const el = $('#audit-body');
    if (!el || !crypto?.subtle) return;
    let prev = '0'.repeat(64);
    const rows = [];
    for (const [i, e] of events.entries()) {
      const hash = await sha256([prev, e.ts, e.actor, e.action, e.entity, JSON.stringify(e.details)].join('|'));
      rows.push(`<tr><td class="num small">${i + 1}</td><td class="num small">${esc(e.ts.replace('T', ' ').slice(0, 19))}</td><td class="small">${esc(e.actor)}</td><td class="ev-action">${esc(e.action)}</td><td class="small">${esc(e.entity)}<div class="tiny mono muted" style="word-break:break-word">${esc(JSON.stringify(e.details))}</div></td><td class="hash">${hash.slice(0, 12)}</td></tr>`);
      prev = hash;
    }
    el.innerHTML = rows.reverse().join('');
    const chip = $('#chain-chip');
    if (chip) { chip.className = 'chip ok'; chip.textContent = `Hash chain verified · ${events.length} entries`; }
  });
  return `<section class="vhead"><div><div class="eyebrow">Traceability</div><h1>Audit trail</h1><p class="sub small">Every sync, 2303 record, mapping change, review and export is logged. Each entry's SHA-256 covers the entry before it, so an edited entry breaks the chain. Your actions in this demo appear at the top.</p></div><span class="chip neutral" id="chain-chip">Verifying&hellip;</span></section>
    <article class="panel"><div class="scroll-x"><table><thead><tr><th>#</th><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Detail</th><th>Hash</th></tr></thead><tbody id="audit-body"><tr><td colspan="6" class="muted small">Computing hashes&hellip;</td></tr></tbody></table></div></article>`;
}

// ---------------------------------------------------------------- add taxpayer (live)

function viewAdd() {
  const f = (id, label, attrs = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" ${attrs}></div>`;
  return `<section class="vhead"><div><div class="eyebrow">Client workspace</div><h1>Add taxpayer</h1><p class="sub small">Enter the details as they appear on the taxpayer's BIR Form 2303. Next you record the registration status and connect Xero.</p></div></section>
    <article class="panel"><form class="rec" data-form="add" style="border-top:0;margin-top:0;padding-top:0" novalidate>
      <div class="rec-row">${f('add-name', 'Registered name', 'required placeholder="As on the 2303"')}${f('add-trade', 'Trade name (optional)')}${f('add-tin', 'TIN (9 digits)', 'required inputmode="numeric" placeholder="000-000-000"')}</div>
      <div class="rec-row">${f('add-branch', 'Branch code', 'value="00000"')}${f('add-rdo', 'RDO code', 'placeholder="e.g. 047"')}<div class="field"><label for="add-class">Classification</label><select id="add-class"><option>MICRO</option><option selected>SMALL</option><option>MEDIUM</option><option>LARGE</option></select></div></div>
      ${f('add-address', 'Registered address')}
      <div class="rec-row">${f('add-zip', 'ZIP code')}${f('add-contact', 'Contact number')}${f('add-email', 'Email')}</div>
      <div style="display:flex;gap:10px;align-items:center"><button class="btn primary" type="submit">Add taxpayer</button><button class="btn ghost" type="button" data-act="view" data-v="overview">Cancel</button></div>
      <div class="err-text" id="add-err" hidden></div>
    </form></article>`;
}

// ---------------------------------------------------------------- rules

function viewRules() {
  const rows = Object.entries(pack.params).flatMap(([k, vs]) => vs.map((v) => `<tr><td class="num small">${esc(k)}</td><td class="num small">${esc(v.from)}</td><td class="num small">${esc(v.to ?? '')}</td><td class="num small"><b>${esc(v.value)}</b></td><td class="small muted">${esc(v.ref ?? '')}</td></tr>`)).join('');
  const maps = Object.values(MAPS).map((m) => `<tr><td><span class="chip form">${esc(m.form)}</span></td><td class="small">${esc(m.version)}</td><td class="num small">${m.fields.filter((f) => f.type === 'amount').length}</td><td class="num small">${m.fields.length}</td><td class="small mono muted">${esc(m.template)}</td></tr>`).join('');
  return `<section class="vhead"><div><div class="eyebrow">Configuration</div><h1>Rules &amp; mapping</h1><p class="sub small">${esc(pack.note)}</p></div><span class="chip neutral mono">${esc(packLabel(pack))}</span></section>
    <article class="panel"><div class="panel-h"><div><h2>Effective-dated parameters</h2><p class="small muted">Each value applies from its start date, so past periods recompute with the rules in force at the time. The 1% CREATE percentage-tax window is an example.</p></div></div><div class="scroll-x"><table><thead><tr><th>Parameter</th><th>From</th><th>To</th><th>Value</th><th>Reference</th></tr></thead><tbody>${rows}</tbody></table></div></article>
    <div class="grid-2">
      <article class="panel"><h2 style="margin-bottom:10px">Paths</h2><table><tbody>${Object.entries(pack.paths).map(([s, p]) => `<tr><td>${statusChip(s)}</td><td><span class="chip form">${esc(p.form)}</span></td><td class="small">${esc(p.description)}</td></tr>`).join('')}</tbody></table>
        <p class="small muted" style="margin-top:10px">Adding a form means adding a path or schedule here and a coordinate map below. The engine code does not change.</p></article>
      <article class="panel"><h2 style="margin-bottom:10px">Form maps</h2><div class="scroll-x"><table><thead><tr><th>Form</th><th>Version</th><th>Amounts</th><th>Fields</th><th>Template</th></tr></thead><tbody>${maps}</tbody></table></div>
        <p class="small muted" style="margin-top:10px">Coordinates are measured from the official PDF's own vector grid, so values land inside the printed cells.</p></article>
    </div>
    <article class="panel"><h2 style="margin-bottom:10px">Tax classes</h2><div class="scroll-x"><table><tbody>${Object.entries(pack.classes).map(([k, v]) => `<tr><td class="num small">${esc(k)}</td><td class="small">${esc(v)}</td></tr>`).join('')}</tbody></table></div></article>`;
}

// ---------------------------------------------------------------- downloads

let dlCap;
const downloads = () => (dlCap ??= (async () => {
  try { return window.claude?.use ? await window.claude.use('downloads') : null; } catch { return null; }
})());

async function offerFile(filename, data, mime) {
  const cap = await downloads();
  if (cap) {
    try {
      await cap.save({ filename, data });
      toast(`Saved ${filename}`);
      return true;
    } catch (e) {
      toast(e?.code === 'declined' ? 'Download cancelled.' : `The file could not be saved here (${e?.code ?? 'error'}).`);
      return false;
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    toast('Downloads are not available in this view.');
    return false;
  }
}

const templates = {};
async function currentRun() {
  const { runs } = quarterRuns();
  return runs[Math.min(S.seg, runs.length - 1)] ?? null;
}
async function downloadPdf(btn) {
  const run = await currentRun();
  if (!run) return;
  if (!window.PDFLib) { toast('The PDF library did not load. Check your connection and reload.'); return; }
  btn.disabled = true;
  try {
    const map = MAPS[run.form];
    templates[run.form] ??= await (await fetch(map.template)).arrayBuffer();
    const sample = isSampleTp(tpById(S.tp));
    const bytes = await renderPdf(window.PDFLib, templates[run.form].slice(0), run, layoutForm(run, map), { watermark: sample ? 'SAMPLE DATA - NOT FOR FILING' : null, producer: 'PH Tax Engine' });
    const name = `BIR-${run.form}_${run.taxpayer.tin}_${run.year}Q${run.quarter}${run.period.split ? `_${run.period.from}` : ''}${sample ? '_SAMPLE' : '_FOR-REVIEW'}.pdf`;
    if (await offerFile(name, bytes, 'application/pdf')) { logEvent('form.download', `${run.form} ${run.period.from}..${run.period.to}`, { file: name }); save(); }
  } finally {
    btn.disabled = false;
  }
}
async function downloadCsv() {
  const run = await currentRun();
  if (!run) return;
  const { classified, unmapped } = classifyFor(S.tp)(linesIn(S.tp, run.period.from, run.period.to));
  const csv = workpaperCsv({ ...run, runId: 'demo' }, [...classified, ...unmapped]);
  const name = `workpaper_${run.form}_${run.taxpayer.tin}_${run.year}Q${run.quarter}${isSampleTp(tpById(S.tp)) ? '_SAMPLE' : ''}.csv`;
  if (await offerFile(name, csv, 'text/csv')) { logEvent('workpaper.download', `${run.form} ${run.period.from}..${run.period.to}`, { file: name }); save(); }
}

// ---------------------------------------------------------------- render + events

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function render(focus) {
  const q = quarterRuns();
  const ctx = { q, open: openFindings(S.tp, q.runs) };
  renderTour();
  renderRail(ctx);
  const views = { overview: viewOverview, data: viewData, return: viewReturn, trace: viewTrace, audit: viewAudit, rules: viewRules, add: viewAdd };
  $('#view').innerHTML = (views[S.view] ?? viewOverview)(ctx);
  save();
  const list = $("#doc-list");
  const selRow = list?.querySelector("tr.sel");
  if (list && selRow && (selRow.offsetTop < list.scrollTop || selRow.offsetTop > list.scrollTop + list.clientHeight - 40)) list.scrollTop = selRow.offsetTop - 48;
  if (focus) {
    const el = document.getElementById(focus);
    if (el) {
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
    }
  }
}

function go(patch, focus) {
  Object.assign(S, patch);
  render(focus);
}

const ACT = {
  step(el) {
    const i = Number(el.dataset.i);
    const s = steps()[i];
    if (!s) return;
    if (!S.visited.includes(i)) S.visited.push(i);
    const { start, end } = quarterBounds(2026, 3);
    const featured = featuredDoc(s.tp, start, end) ?? featuredDoc(s.tp);
    if (s.view === 'trace' && featured) S.trace[s.tp] = featured.number;
    if (s.view === 'data' && featured) S.doc[s.tp] = featured.id;
    go({ tp: s.tp, view: s.view, year: 2026, quarter: 3, seg: 0 }, s.focus);
  },
  tp(el) { go({ tp: Number(el.dataset.id), seg: 0 }); window.scrollTo({ top: 0 }); },
  view(el) { go({ view: el.dataset.v }); window.scrollTo({ top: 0 }); },
  draft(el) { S.regDraft[S.tp] = { ...(S.regDraft[S.tp] ?? {}), status: el.dataset.s }; render(); },
  asof(el) { S.asOf[S.tp] = el.dataset.d; render(); },
  'open-return'(el) { go({ view: 'return', seg: Number(el.dataset.seg) }); window.scrollTo({ top: 0 }); },
  doc(el) { S.doc[S.tp] = el.dataset.id; render(); },
  'trace-doc'(el) { S.trace[S.tp] = el.dataset.n; go({ view: 'trace' }); window.scrollTo({ top: 0 }); },
  seg(el) { go({ seg: Number(el.dataset.i) }); },
  page(el) {
    const { runs } = quarterRuns();
    const run = runs[Math.min(S.seg, runs.length - 1)];
    S.page[run.form] = Number(el.dataset.i);
    render();
  },
  item(el) {
    const { runs } = quarterRuns();
    const run = runs[Math.min(S.seg, runs.length - 1)];
    if (!run) return;
    S.sel[run.form] = el.dataset.k;
    const pg = itemPage(run.form, el.dataset.k);
    if (pg != null) S.page[run.form] = pg;
    if (S.view !== 'return') { go({ view: 'return' }); window.scrollTo({ top: 0 }); return; }
    render();
    $('.rg.on')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },
  'goto-item'(el) {
    const { runs } = quarterRuns();
    const d = LEDGER[S.tp].docs.find((x) => x.number === S.trace[S.tp]);
    const idx = d ? runs.findIndex((r) => d.date >= r.period.from && d.date <= r.period.to) : 0;
    const run = runs[Math.max(idx, 0)];
    S.seg = Math.max(idx, 0);
    S.sel[run.form] = el.dataset.k;
    const pg = itemPage(run.form, el.dataset.k);
    if (pg != null) S.page[run.form] = pg;
    go({ view: 'return' });
    window.scrollTo({ top: 0 });
  },
  'dl-pdf'(el) { downloadPdf(el); },
  async 'seed-xero'(el) {
    el.disabled = true;
    toast('Creating PH tax rates, invoices and bills in the Xero organisation...');
    try {
      const r = await api('seed-xero', { taxpayerId: S.tp });
      toast(`Created ${r.documentsCreated} documents in Xero. Syncing...`);
      const sy = await api('sync', { taxpayerId: S.tp, from: S.syncFrom ?? '2025-07-01', to: S.syncTo ?? quarterBounds(S.year, S.quarter).end });
      await loadData();
      render();
      toast(`Synced ${sy.documents} documents from ${sy.org}.`);
    } catch (err) {
      toast(err.message);
      el.disabled = false;
    }
  },
  'dl-csv'() { downloadCsv(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
  const fn = ACT[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act][tabindex]')) {
    e.preventDefault();
    ACT[e.target.dataset.act]?.(e.target, e);
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.act === 'period') {
    const [y, q] = el.value.split('-').map(Number);
    go({ year: y, quarter: q, seg: 0 });
  } else if (el.dataset.act === 'map') {
    const { tp: tpId, source, key: code } = el.dataset;
    const done = () => {
      toast(el.value ? `${code} now maps to ${el.value}. Returns recomputed.` : `${code} is unmapped. Its lines are held out and flagged.`);
      render();
    };
    if (LIVE) {
      api('mappings', { taxpayerId: Number(tpId), source, key: code, phClass: el.value }).then(loadData).then(done).catch((err) => toast(err.message));
      return;
    }
    S.mapOverrides[`${tpId}|${source}|${code}`] = el.value;
    logEvent('taxmap.set', `taxpayer ${tpId}`, { source, key: code, phClass: el.value || 'UNMAPPED' });
    done();
  } else if (el.dataset.act === 'trace-pick') {
    S.trace[S.tp] = el.value;
    render();
  } else if (el.dataset.act === 'input') {
    const key = `${S.tp}|${S.year}Q${S.quarter}`;
    const val = el.value.replace(/,/g, '').trim();
    if (val && !(Number(val) >= 0)) { toast('Enter an amount such as 12500.00'); return; }
    if (LIVE) {
      api('inputs', { taxpayerId: S.tp, period: `${S.year}Q${S.quarter}`, name: el.dataset.name, amount: val ? Number(val) : 0 }).then(loadData).then(() => render()).catch((err) => toast(err.message));
      return;
    }
    S.inputs[key] = { ...(S.inputs[key] ?? {}), [el.dataset.name]: val ? Number(val) : 0 };
    logEvent('inputs.set', `taxpayer ${S.tp} ${S.year}Q${S.quarter}`, { [el.dataset.name]: val || '0' });
    render();
  }
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (['reg-eff', 'reg-cor', 'reg-note'].includes(el.id)) {
    const k = { 'reg-eff': 'eff', 'reg-cor': 'cor', 'reg-note': 'note' }[el.id];
    S.regDraft[S.tp] = { ...(S.regDraft[S.tp] ?? {}), [k]: el.value };
    save();
  }
});
document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.dataset.form === 'reg') {
    const draft = S.regDraft[S.tp] ?? {};
    const status = draft.status ?? 'VAT';
    const eff = $('#reg-eff').value;
    const cor = $('#reg-cor').value.trim();
    const note = $('#reg-note').value.trim();
    const err = $('#reg-err');
    const problem = !/^\d{4}-\d{2}-\d{2}$/.test(eff) ? 'Enter the effective date from the updated 2303.' : !cor ? 'Enter the 2303 / COR reference. The engine will not record a status without it.' : null;
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    if (LIVE) {
      api('registrations', { taxpayerId: S.tp, status, effectiveFrom: eff, corReference: cor, note })
        .then(loadData)
        .then(() => { S.regDraft[S.tp] = {}; S.seg = 0; render('p-path'); toast(`Recorded ${status === 'VAT' ? 'VAT' : 'Non-VAT'} from ${eff}. Returns recomputed.`); })
        .catch((x) => { err.textContent = x.message; err.hidden = false; });
      return;
    }
    const id = Math.max(...SEED_REGS.map((r) => r.id), ...S.regsAdded.map((r) => r.id)) + 1;
    S.regsAdded.push({ id, taxpayer_id: S.tp, status, effective_from: eff, cor_reference: cor, source: 'BIR_2303', entered_by: VIEWER, entered_at: new Date().toISOString(), note: note || null });
    logEvent('registration.record', `taxpayer ${S.tp}`, { status, effectiveFrom: eff, cor, source: 'BIR_2303' });
    S.regDraft[S.tp] = {};
    S.seg = 0;
    render('p-path');
    toast(`Recorded ${status === 'VAT' ? 'VAT' : 'Non-VAT'} from ${eff}. Returns recomputed.`);
  } else if (form.dataset.form === 'ack') {
    const note = form.querySelector('input').value.trim();
    if (!note) { form.querySelector('input').focus(); return; }
    if (LIVE) {
      api('acks', { taxpayerId: S.tp, key: form.dataset.key, kind: form.dataset.kind, note })
        .then(loadData)
        .then(() => { render(); toast('Acknowledged. The registration status was not changed.'); })
        .catch((x) => toast(x.message));
      return;
    }
    S.acks[form.dataset.key] = { note, by: VIEWER, at: new Date().toISOString() };
    logEvent('exception.acknowledge', `taxpayer ${S.tp}`, { kind: form.dataset.kind, note });
    render();
    toast('Acknowledged. The registration status was not changed.');
  } else if (form.dataset.form === 'sync') {
    const from = $('#sync-from').value;
    const to = $('#sync-to').value;
    S.syncFrom = from;
    S.syncTo = to;
    const btn = $('#sync-btn');
    btn.disabled = true;
    btn.textContent = 'Syncing from Xero...';
    api('sync', { taxpayerId: S.tp, from, to })
      .then(async (r) => {
        await loadData();
        render();
        toast(`Synced ${r.documents} documents from ${r.org}: ${r.inserted} new, ${r.updated} updated, ${r.removed} removed.${r.baseCurrency !== 'PHP' ? ` Base currency is ${r.baseCurrency}, not PHP.` : ''}`);
      })
      .catch((x) => { toast(x.message); btn.disabled = false; btn.textContent = 'Sync from Xero now'; });
  } else if (form.dataset.form === 'add') {
    const v = (id) => $(id).value.trim();
    const err = $('#add-err');
    const payload = { registeredName: v('#add-name').toUpperCase(), tradeName: v('#add-trade'), tin: v('#add-tin'), branchCode: v('#add-branch') || '00000', rdoCode: v('#add-rdo'), classification: $('#add-class').value, address: v('#add-address').toUpperCase(), zip: v('#add-zip'), contact: v('#add-contact'), email: v('#add-email') };
    if (!payload.registeredName) { err.textContent = 'Enter the registered name.'; err.hidden = false; return; }
    api('taxpayers', payload)
      .then(async ({ id }) => {
        await loadData();
        go({ tp: id, view: 'overview', seg: 0 }, 'p-registration');
        toast('Taxpayer added. Record the Form 2303 status, then connect Xero on the Xero data page.');
      })
      .catch((x) => { err.textContent = x.message; err.hidden = false; });
  }
});

if (LIVE) {
  const xeroTp = TAXPAYERS.find((t) => t.source === 'xero');
  const pill = document.querySelector('.topbar .pill');
  if (pill) pill.innerHTML = `<span class="dot" style="background:var(--ok)"></span>Live${xeroTp ? ` \u00b7 Xero: ${esc(xeroTp.connection.org_name)}` : ' \u00b7 local server'}`;
  $('#reset').hidden = true;
  const qs = new URLSearchParams(location.search);
  if (qs.get('tp') && TAXPAYERS.some((t) => t.id === Number(qs.get('tp')))) { S.tp = Number(qs.get('tp')); S.view = 'data'; }
  const note = qs.get('msg') || qs.get('err');
  if (note) setTimeout(() => toast(note), 300);
  if (qs.toString()) window.history.replaceState(null, '', location.pathname + location.hash);
}

let resetArmed = false;
$('#reset').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!resetArmed) {
    resetArmed = true;
    b.textContent = 'Click again to reset';
    setTimeout(() => { resetArmed = false; b.textContent = 'Reset demo'; }, 3500);
    return;
  }
  resetArmed = false;
  b.textContent = 'Reset demo';
  S = fresh();
  render();
  window.scrollTo({ top: 0 });
  toast('Demo reset to the original sample data.');
});

// Deep links: #step1..#step4 open a walkthrough step; #overview, #data, #return, #trace, #audit, #rules open a view.
function applyHash() {
  const h = location.hash.slice(1);
  const step = ['step1', 'step2', 'step3', 'step4'].indexOf(h);
  if (step >= 0) return ACT.step({ dataset: { i: String(step) } });
  if (['overview', 'data', 'return', 'trace', 'audit', 'rules'].includes(h)) return go({ view: h });
  render();
}
window.addEventListener('hashchange', applyHash);
applyHash();
