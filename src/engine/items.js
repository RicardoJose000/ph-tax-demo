// Form items with full lineage. A "source" item sums ledger lines and keeps
// each contributing line; a "derived" item keeps its formula and inputs. This
// is what lets any figure on a return be traced back to the Xero document.

export class ItemBook {
  constructor(labels) {
    this.labels = labels;
    this.items = {};
  }

  #item(key) {
    if (!this.labels[key]) throw new Error(`Unknown form item ${key}`);
    return (this.items[key] ??= { key, label: this.labels[key], value: 0, kind: 'source', sources: [] });
  }

  /** Add a ledger line's contribution to an item. */
  add(key, line, amountC, note) {
    const it = this.#item(key);
    it.value += amountC;
    it.sources.push({ lineId: line.id, docNumber: line.doc_number, docDate: line.doc_date, contact: line.contact, amount: amountC, ...(note ? { note } : {}) });
  }

  /** Set an item from a user-supplied input (e.g. prior-quarter carry-over). */
  input(key, amountC, note) {
    const it = this.#item(key);
    it.value = amountC;
    it.kind = 'input';
    it.note = note;
  }

  /** Define an item from other items. `terms` is [[sign, key], ...]. */
  derive(key, terms, formula) {
    const it = this.#item(key);
    it.kind = 'derived';
    it.formula = formula;
    it.inputs = terms.map(([, k]) => k);
    it.value = terms.reduce((s, [sign, k]) => s + sign * this.get(k), 0);
  }

  setDerived(key, valueC, formula, inputs) {
    const it = this.#item(key);
    Object.assign(it, { kind: 'derived', value: valueC, formula, inputs });
  }

  get(key) {
    return this.items[key]?.value ?? 0;
  }

  /** Make sure every labelled item exists (zero if nothing contributed). */
  finish() {
    for (const key of Object.keys(this.labels)) this.#item(key);
    return this.items;
  }
}
