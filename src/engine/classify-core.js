// Ledger tax code -> Philippine class. Pure: runs on the server and in the browser.

export const direction = (docType) => (docType.startsWith('SALE') ? 'SALE' : 'PURCHASE');

/**
 * Attach a PH class to each ledger line. Lines whose code is unmapped are
 * returned separately and never guessed.
 * @param mappings [{ source, source_tax_code: "SALE:OUTPUT", ph_class }]
 */
export function classifyWithMap(lines, mappings) {
  const map = new Map(mappings.map((m) => [`${m.source}|${m.source_tax_code}`, m.ph_class]));
  const classified = [];
  const unmapped = [];
  for (const l of lines) {
    const key = `${direction(l.doc_type)}:${l.source_tax_code}`;
    const phClass = map.get(`${l.source}|${key}`);
    if (phClass) classified.push({ ...l, ph_class: phClass, map_key: key });
    else unmapped.push({ ...l, map_key: key });
  }
  return { classified, unmapped };
}

/** Default map entries for a source, from rules/ph/default-tax-code-map.json. */
export function defaultMappings(defaults, source) {
  const map = defaults[source === 'sample' ? 'xero' : source] ?? {};
  return Object.entries(map).map(([code, cls]) => ({ source, source_tax_code: code, ph_class: cls }));
}
