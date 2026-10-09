/** Number with up to `d` decimals and no trailing zeros. */
export const fmt = (n: number, d = 2) => (Number.isInteger(n) ? String(n) : n.toFixed(d).replace(/\.?0+$/, ''))
