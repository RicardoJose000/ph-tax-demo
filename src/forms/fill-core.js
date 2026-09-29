import { fmt } from '../money.js';

// Form layout for the official BIR PDFs. Pure: runs on the server and in the
// browser. layoutForm() turns a computed return plus a coordinate map
// (forms/maps/<form>.json, measured from the PDF's own vector grid) into glyph
// placements; renderPdf() draws them onto the unmodified template with pdf-lib.

const ALWAYS_PRINT = { '2550Q': ['15', '21', '26'], '2551Q': ['14', '19', '24', 'S1.7'], '0619-E': ['14', '16', '18'] };

const pad2 = (n) => String(n).padStart(2, '0');
const mmddyyyy = (iso) => `${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(0, 4)}`;

function splitAddress(address = '', firstCells = 40, secondCells = 32) {
  const words = String(address ?? '').toUpperCase().split(/\s+/).filter(Boolean);
  let a = '';
  let i = 0;
  for (; i < words.length; i++) {
    const next = a ? `${a} ${words[i]}` : words[i];
    if (next.length > firstCells) break;
    a = next;
  }
  return [a, words.slice(i).join(' ').slice(0, secondCells)];
}

/** Flatten a computed run into the values the map refers to. */
export function formContext(run) {
  const t = run.taxpayer;
  const [addr1, addr2] = splitAddress(t.address);
  const tin = t.tin.padStart(9, '0');
  const hdr = {
    calendar: true,
    yearEnded: `12${run.year}`,
    quarter: run.quarter,
    periodFrom: mmddyyyy(run.period.from),
    periodTo: mmddyyyy(run.period.to),
    amended: false,
    shortPeriod: run.period.split === true,
    taxRelief: false,
    tin9: tin,
    tin1: tin.slice(0, 3),
    tin2: tin.slice(3, 6),
    tin3: tin.slice(6, 9),
    branch: t.branchCode ?? '00000',
    rdo: t.rdoCode ?? '',
    name: String(t.name).toUpperCase(),
    addr1,
    addr2,
    zip: t.zip ?? '',
    contact: t.contact ?? '',
    email: String(t.email ?? '').toUpperCase(),
    classification: t.classification,
  };
  const sched = {};
  for (const s of run.schedule ?? []) sched[s.row] = { atc: s.atc, rate: String(Math.round(s.rate * 10000) / 100) };
  // 2550Q Part V Schedule 2, printed only when there is an exempt-sales allocation.
  const i = run.items;
  const sched2 = i['53B']?.value
    ? { direct: 0, exempt: i['33A'].value, total: i['34A'].value, notDirect: i['50B'].value, ratable: i['53B'].value, result: i['53B'].value }
    : {};
  return { hdr, sched, sched2, items: run.items };
}

const get = (ctx, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), ctx);

function cellBounds(map, field) {
  if (field.xs) return field.xs.slice(0, -1).map((x, i) => [x, field.xs[i + 1]]);
  const g = map.grids[field.grid];
  const out = [];
  for (let i = field.cells[0]; i <= field.cells[1]; i++) out.push([g[i], g[i + 1]]);
  return out;
}

/**
 * @returns {{ glyphs: Array<{page,x,y,text,size,anchor,key}>, regions: Array<{page,key,x0,y0,x1,y1}>, overflow: Array }}
 *   x/y are PDF points from the top-left; y is the text baseline. anchor is
 *   'center' (x is the cell centre) or 'right' (x is the right edge).
 *   key names what the glyph shows: "item:31A", "hdr.name", ...
 */
export function layoutForm(run, map, ctx = formContext(run)) {
  const always = new Set(ALWAYS_PRINT[run.form] ?? []);
  const glyphs = [];
  const regions = [];
  const overflow = [];
  const put = (page, x, y, text, size, key, anchor = 'center') => glyphs.push({ page, x, y, text, size, anchor, key });

  for (const field of map.fields) {
    const v = field.type === 'amount' ? ctx.items[field.item]?.value : get(ctx, field.value);

    if (field.type === 'check') {
      if (v === field.equals) {
        const [x0, , x1, y1] = field.box;
        put(field.page, (x0 + x1) / 2, y1 - 2.5, 'X', 10, field.value);
      }
      continue;
    }

    if (field.type === 'comb') {
      if (v == null || v === '') continue;
      const cells = cellBounds(map, field);
      let text = String(v);
      if (text.length > cells.length) {
        overflow.push({ field: field.value, text, cells: cells.length });
        text = text.slice(0, cells.length);
      }
      const offset = field.align === 'right' ? cells.length - text.length : 0;
      [...text].forEach((ch, i) => {
        const [a, b] = cells[offset + i];
        if (ch !== ' ') put(field.page, (a + b) / 2, field.y, ch, 9, field.value);
      });
      continue;
    }

    if (field.type === 'textAmount') {
      if (v == null) continue;
      put(field.page, field.xRight, field.y, fmt(Number(v)), field.size, field.value, 'right');
      continue;
    }

    if (field.type === 'text') {
      if (v == null || v === '') continue;
      let text = String(v);
      if (field.maxChars && text.length > field.maxChars) {
        overflow.push({ field: field.value, text, cells: field.maxChars });
        text = text.slice(0, field.maxChars);
      }
      put(field.page, field.x, field.y, text, field.size ?? 9, field.value, field.anchor ?? 'left');
      continue;
    }

    if (field.type === 'amount') {
      const key = `item:${field.item}`;
      const cw = map.cellWidth;
      const [dotX0, dotX1] = field.dot;
      regions.push({ page: field.page, key, x0: dotX0 - cw * map.intCells, y0: field.y - 15.5, x1: dotX1 + cw * 2, y1: field.y });
      const c = Number(v ?? 0);
      if (c === 0 && !always.has(field.item)) continue;
      const base = field.y - 4;
      const abs = Math.abs(c);
      const digits = String(Math.floor(abs / 100));
      const cents = pad2(abs % 100);
      if (digits.length > map.intCells) throw new Error(`Amount for ${field.item} does not fit the form`);
      [...digits].reverse().forEach((d, i) => put(field.page, dotX0 - cw * (i + 0.5), base, d, 10, key));
      [...cents].forEach((d, i) => put(field.page, dotX1 + cw * (i + 0.5), base, d, 10, key));
      if (c < 0) {
        put(field.page, dotX0 - cw * (digits.length + 0.5), base, '(', 10, key);
        put(field.page, dotX1 + cw * 2 + 3, base, ')', 10, key);
      }
    }
  }
  return { glyphs, regions, overflow };
}

/**
 * Draw a layout onto the official template.
 * @param PDFLib    the pdf-lib namespace (node import or window.PDFLib)
 * @param watermark optional text stamped diagonally on every page
 */
export async function renderPdf(PDFLib, templateBytes, run, layout, { watermark = null, producer = 'PH Tax Compliance Engine' } = {}) {
  const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
  const pdf = await PDFDocument.load(templateBytes);
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  const ink = rgb(0, 0, 0);

  for (const g of layout.glyphs) {
    const page = pages[g.page];
    const w = font.widthOfTextAtSize(g.text, g.size);
    const x = g.anchor === 'right' ? g.x - w : g.anchor === 'left' ? g.x : g.x - w / 2;
    page.drawText(g.text, { x, y: page.getHeight() - g.y, size: g.size, font, color: ink });
  }

  if (watermark) {
    for (const page of pages) {
      const size = 44;
      const w = font.widthOfTextAtSize(watermark, size);
      const { width, height } = page.getSize();
      const angle = 52;
      const rad = (angle * Math.PI) / 180;
      page.drawText(watermark, {
        x: width / 2 - (w / 2) * Math.cos(rad),
        y: height / 2 - (w / 2) * Math.sin(rad),
        size, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.16, rotate: degrees(angle),
      });
    }
  }

  pdf.setTitle(`BIR Form ${run.form} - ${run.taxpayer.name} - ${run.year} Q${run.quarter}`);
  pdf.setSubject(`Prepared${run.runId ? ` from run #${run.runId}` : ''} with rule pack ${run.rulePack}. For review before filing.`);
  pdf.setProducer(producer);
  return pdf.save();
}

// ---------------------------------------------------------------- withholding forms

const TIN = (t) => String(t ?? '').replace(/\D/g, '').padStart(9, '0');
const upper = (v) => String(v ?? '').toUpperCase();

function partyContext(prefix, p) {
  const tin = TIN(p.tin);
  return {
    [`${prefix}Tin1`]: tin.slice(0, 3), [`${prefix}Tin2`]: tin.slice(3, 6), [`${prefix}Tin3`]: tin.slice(6, 9),
    [`${prefix}Branch`]: p.branch ?? p.branch_code ?? '00000',
    [`${prefix}Name`]: upper(p.registeredName ?? p.registered_name ?? p.name),
    [`${prefix}Address`]: upper(p.address), [`${prefix}Zip`]: p.zip ?? '',
  };
}

/** BIR 2307 for one payee and quarter. Up to 10 ATC rows fit the form. */
export function context2307(taxpayer, cert, from, to) {
  const rows = cert.atcs.slice(0, 10).map((a) => ({
    desc: cert.profile.nature || a.description, atc: a.atc, m1: a.months[0] || null, m2: a.months[1] || null, m3: a.months[2] || null, total: a.total, tax: a.tax,
  }));
  const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  return {
    hdr: { from: mmddyyyy(from), to: mmddyyyy(to), ...partyContext('payee', cert.profile), ...partyContext('payor', taxpayer) },
    rows,
    totals: { m1: sum('m1') || null, m2: sum('m2') || null, m3: sum('m3') || null, total: sum('total'), tax: sum('tax') },
    items: {},
  };
}

/** BIR 0619-E for one month. */
export function context0619E(taxpayer, remittance, dueDate) {
  const tin = TIN(taxpayer.tin);
  const [addr1, addr2] = splitAddress(taxpayer.address);
  const m = remittance.month;
  return {
    hdr: {
      month: `${m.slice(5, 7)}${m.slice(0, 4)}`, due: mmddyyyy(dueDate), amended: false, withheld: remittance.items['14'].value > 0,
      tin1: tin.slice(0, 3), tin2: tin.slice(3, 6), tin3: tin.slice(6, 9), branch: taxpayer.branch_code ?? '00000', rdo: taxpayer.rdo_code ?? '',
      name: upper(taxpayer.registered_name), addr1, addr2, zip: taxpayer.zip ?? '', contact: taxpayer.contact ?? '', email: upper(taxpayer.email), category: 'PRIVATE',
    },
    items: remittance.items,
  };
}
