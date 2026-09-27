import { ItemBook } from './items.js';
import { value } from './rules-core.js';
import { toC, mulRate, fmt } from '../money.js';

// VAT path -> BIR Form 2550Q (April 2024 ENCS). Item numbers follow the form.

export const LABELS_2550Q = {
  '15': 'Net VAT Payable/(Excess Input Tax)',
  '16': 'Creditable VAT Withheld',
  '17': 'Advance VAT Payments',
  '18': 'VAT paid in return previously filed (amended return)',
  '19': 'Other Credits/Payment',
  '20': 'Total Tax Credits/Payment',
  '21': 'Tax Still Payable/(Excess Credits)',
  '22': 'Surcharge',
  '23': 'Interest',
  '24': 'Compromise',
  '25': 'Total Penalties',
  '26': 'TOTAL AMOUNT PAYABLE/(Excess Credits)',
  '31A': 'VATable Sales', '31B': 'Output Tax on VATable Sales',
  '32A': 'Zero-Rated Sales',
  '33A': 'Exempt Sales',
  '34A': 'Total Sales', '34B': 'Total Output Tax Due',
  '35B': 'Less: Output VAT on Uncollected Receivables',
  '36B': 'Add: Output VAT on Recovered Uncollected Receivables',
  '37B': 'Total Adjusted Output Tax Due',
  '38B': 'Input Tax Carried Over from Previous Quarter',
  '39B': 'Input Tax Deferred on Capital Goods > P1M from Previous Quarter',
  '40B': 'Transitional Input Tax',
  '41B': 'Presumptive Input Tax',
  '42B': 'Others',
  '43B': 'Total (Items 38B to 42B)',
  '44A': 'Domestic Purchases', '44B': 'Input Tax on Domestic Purchases',
  '45A': 'Services Rendered by Non-Residents', '45B': 'Input Tax on Services by Non-Residents',
  '46A': 'Importations', '46B': 'Input Tax on Importations',
  '47A': 'Other Purchases', '47B': 'Input Tax on Other Purchases',
  '48A': 'Domestic Purchases with No Input Tax',
  '49A': 'VAT-Exempt Importations',
  '50A': 'Total Current Purchases', '50B': 'Total Current Input Tax',
  '51B': 'Total Available Input Tax',
  '52B': 'Input Tax on Capital Goods > P1M Deferred',
  '53B': 'Input Tax Attributable to VAT Exempt Sales',
  '54B': 'VAT Refund/TCC Claimed',
  '55B': 'Input VAT on Unpaid Payables',
  '56B': 'Others',
  '57B': 'Total Deductions from Input Tax',
  '58B': 'Add: Input VAT on Settled Unpaid Payables Previously Deducted',
  '59B': 'Adjusted Deductions from Input Tax',
  '60B': 'Total Allowable Input Tax',
  '61B': 'Net VAT Payable/(Excess Input Tax)',
};

/**
 * @param lines   classified ledger lines for the period (ph_class attached)
 * @param inputs  user-supplied figures not in the ledger, in pesos
 *                { carriedOverInputTax, creditableVatWithheld, advanceVatPayments }
 */
export function compute2550Q(lines, pack, periodEnd, inputs = {}) {
  const b = new ItemBook(LABELS_2550Q);
  const findings = [];
  const outputBasis = value(pack, 'vat.output_basis', periodEnd);
  const inputBasis = value(pack, 'vat.input_basis', periodEnd);
  const tolerance = toC(value(pack, 'recon.tolerance', periodEnd));
  const perDoc = new Map(); // doc -> { recorded, statutory }

  const track = (l, recorded, statutory) => {
    const k = l.source_doc_id;
    const d = perDoc.get(k) ?? { doc: l.doc_number, contact: l.contact, date: l.doc_date, recorded: 0, statutory: 0, cls: l.ph_class };
    d.recorded += recorded;
    d.statutory += statutory;
    perDoc.set(k, d);
  };

  for (const l of lines) {
    const net = toC(l.net);
    const recorded = toC(l.tax);
    const rate = value(pack, 'vat.rate', l.doc_date);
    const statutory = mulRate(net, rate);
    switch (l.ph_class) {
      case 'SALE_REGULAR':
        b.add('31A', l, net);
        b.add('31B', l, outputBasis === 'STATUTORY' ? statutory : recorded, `${rate * 100}% x ${fmt(net)}`);
        track(l, recorded, statutory);
        break;
      case 'SALE_ZERO_RATED':
        b.add('32A', l, net);
        track(l, recorded, 0);
        break;
      case 'SALE_EXEMPT':
        b.add('33A', l, net);
        track(l, recorded, 0);
        break;
      case 'PURCHASE_DOMESTIC':
        b.add('44A', l, net);
        b.add('44B', l, inputBasis === 'RECORDED' ? recorded : statutory);
        track(l, recorded, statutory);
        break;
      case 'PURCHASE_SERVICES_NONRES':
        // VAT on services of non-residents is withheld/self-assessed (BIR 1600) and claimable as input tax.
        b.add('45A', l, net);
        b.add('45B', l, statutory, `${rate * 100}% x ${fmt(net)} (self-assessed)`);
        break;
      case 'PURCHASE_IMPORT':
        b.add('46A', l, net);
        b.add('46B', l, recorded);
        break;
      case 'PURCHASE_NO_INPUT_TAX':
        b.add('48A', l, net);
        break;
      case 'PURCHASE_EXEMPT_IMPORT':
        b.add('49A', l, net);
        break;
      case 'OUT_OF_SCOPE':
        break;
      default:
        throw new Error(`Class ${l.ph_class} has no VAT treatment`);
    }
  }

  for (const d of perDoc.values()) {
    if (Math.abs(d.recorded - d.statutory) > tolerance) {
      findings.push({
        kind: 'TAX_AMOUNT_VARIANCE',
        severity: 'WARNING',
        message: `${d.doc} (${d.contact}, ${d.date}): tax recorded in ledger ${fmt(d.recorded)} differs from statutory ${fmt(d.statutory)} by ${fmt(d.recorded - d.statutory)}.`,
        details: d,
      });
    }
  }

  b.derive('34A', [[1, '31A'], [1, '32A'], [1, '33A']], '31A + 32A + 33A');
  b.derive('34B', [[1, '31B']], '31B');
  b.derive('37B', [[1, '34B'], [-1, '35B'], [1, '36B']], '34B - 35B + 36B');
  if (inputs.carriedOverInputTax) b.input('38B', toC(inputs.carriedOverInputTax), 'Excess input tax carried over from previous quarter (entered by preparer)');
  b.derive('43B', [[1, '38B'], [1, '39B'], [1, '40B'], [1, '41B'], [1, '42B']], '38B + 39B + 40B + 41B + 42B');
  b.derive('50A', [[1, '44A'], [1, '45A'], [1, '46A'], [1, '47A'], [1, '48A'], [1, '49A']], '44A + 45A + 46A + 47A + 48A + 49A');
  b.derive('50B', [[1, '44B'], [1, '45B'], [1, '46B'], [1, '47B']], '44B + 45B + 46B + 47B');
  b.derive('51B', [[1, '43B'], [1, '50B']], '43B + 50B');

  // Schedule 2: ratable input tax attributable to exempt sales.
  const totalSales = b.get('34A');
  if (b.get('33A') > 0 && totalSales > 0) {
    const share = Math.round((b.get('50B') * b.get('33A')) / totalSales);
    b.setDerived('53B', share, '50B x 33A / 34A (Schedule 2, ratable allocation)', ['50B', '33A', '34A']);
  }

  b.derive('57B', [[1, '52B'], [1, '53B'], [1, '54B'], [1, '55B'], [1, '56B']], '52B + 53B + 54B + 55B + 56B');
  b.derive('59B', [[1, '57B'], [1, '58B']], '57B + 58B');
  b.derive('60B', [[1, '51B'], [-1, '59B']], '51B - 59B');
  b.derive('61B', [[1, '37B'], [-1, '60B']], '37B - 60B');

  b.derive('15', [[1, '61B']], 'Part IV Item 61B');
  if (inputs.creditableVatWithheld) b.input('16', toC(inputs.creditableVatWithheld), 'Creditable VAT withheld per BIR 2307 (entered by preparer)');
  if (inputs.advanceVatPayments) b.input('17', toC(inputs.advanceVatPayments), 'Advance VAT payments (entered by preparer)');
  b.derive('20', [[1, '16'], [1, '17'], [1, '18'], [1, '19']], '16 + 17 + 18 + 19');
  b.derive('21', [[1, '15'], [-1, '20']], '15 - 20');
  b.derive('25', [[1, '22'], [1, '23'], [1, '24']], '22 + 23 + 24');
  b.derive('26', [[1, '21'], [1, '25']], '21 + 25');

  return { items: b.finish(), findings };
}
