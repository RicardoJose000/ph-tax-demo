// All tax arithmetic is done in integer centavos to avoid float drift.

export const toC = (pesos) => Math.round(Number(pesos) * 100);
export const fromC = (c) => c / 100;

export function fmt(c) {
  const neg = c < 0;
  const abs = Math.abs(c);
  const pesos = Math.floor(abs / 100).toLocaleString('en-US');
  const cents = String(abs % 100).padStart(2, '0');
  return `${neg ? '(' : ''}${pesos}.${cents}${neg ? ')' : ''}`;
}

export const mulRate = (c, rate) => Math.round(c * rate);
