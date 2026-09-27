// Effective-dated rule lookups. Pure: runs on the server and in the browser.
// Every rate/threshold is looked up by the date of the transaction (or period
// end), so historical periods recompute with the values in force at the time.

export function param(pack, key, date) {
  const versions = pack.params[key];
  if (!versions) throw new Error(`Unknown rule parameter: ${key}`);
  const hit = versions.find((v) => v.from <= date && (!v.to || date <= v.to));
  if (!hit) throw new Error(`No value for ${key} effective ${date}`);
  return hit;
}

export const value = (pack, key, date) => param(pack, key, date).value;

export function packLabel(pack) {
  return `${pack.id}@${pack.version}`;
}

export function validatePack(pack) {
  for (const [key, versions] of Object.entries(pack.params)) {
    for (const v of versions) {
      if (!v.from) throw new Error(`rule ${key}: every version needs "from"`);
    }
  }
  return pack;
}
