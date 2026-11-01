import type { Receipt } from './receipt';
/** ESC/POS command bytes used here (Epson-compatible subset; model specifics are a printer profile concern, validated on the venue's device in W11). */
export const ESC = { init: [0x1b, 0x40], left: [0x1b, 0x61, 0], center: [0x1b, 0x61, 1], boldOn: [0x1b, 0x45, 1], boldOff: [0x1b, 0x45, 0], dbl: [0x1d, 0x21, 0x11], normal: [0x1d, 0x21, 0x00], feed: [0x1b, 0x64, 4], cut: [0x1d, 0x56, 0x42, 0x00] } as const;
/**
 * Printer text is folded to ASCII: Vietnamese code pages (TCVN3/CP1258) differ by printer model and are only usable once verified on the real device,
 * so the unverified default never sends bytes the printer may render as garbage.
 */
export const fold = (t: string): string => t.normalize('NFD').replace(/\p{M}+/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^\x20-\x7e]/g, '?');
const grouped = (minor: string, currency: string): string => { const n = BigInt(minor), digits = (n < 0n ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.'); return (n < 0n ? '-' : '') + digits + (currency === 'VND' ? 'd' : ' ' + currency); };
const row = (left: string, right: string, width: number): string => { const l = fold(left), r = fold(right); return l.slice(0, Math.max(0, width - r.length - 1)).padEnd(Math.max(0, width - r.length), ' ') + r; };
export type RenderOptions = { columns: number; reprint?: { number: number } };
/** Receipt model -> ESC/POS bytes. A reprint carries a visible "REPRINT / IN LAI" mark at the top and bottom. */
export function renderEscPos(r: Receipt, o: RenderOptions): Uint8Array {
  const w = o.columns, out: number[] = [], text = (t: string) => out.push(...Buffer.from(fold(t) + '\n', 'ascii')), put = (...b: readonly (readonly number[])[]) => b.forEach(x => out.push(...x));
  const mark = () => { put(ESC.center, ESC.boldOn); text(`*** IN LAI / REPRINT #${o.reprint!.number} ***`); put(ESC.boldOff, ESC.left); };
  put(ESC.init, ESC.center, ESC.boldOn, ESC.dbl); text(r.kind === 'bill' ? 'TAM TINH' : 'HOA DON'); put(ESC.normal, ESC.boldOff, ESC.left);
  if (o.reprint) mark();
  text(`Bill: ${r.billId}`); text('-'.repeat(w));
  for (const l of r.lines) { text(row(`${l.quantity} x ${l.name}`, grouped(l.totalMinor, r.currency), w)); for (const m of l.modifiers) text('  + ' + m); }
  text('-'.repeat(w));
  const c = r.charges, line = (label: string, minor: string) => { if (BigInt(minor) !== 0n) text(row(label, grouped(minor, r.currency), w)); };
  line('Tam tinh', c.subtotalMinor); line('Giam gia', String(-BigInt(c.discountMinor))); line('Phi dich vu', c.serviceMinor); line('Thue', c.taxMinor); line('Thue (da gom)', c.taxIncludedMinor);
  put(ESC.boldOn); text(row('TONG', grouped(r.totalMinor, r.currency), w)); put(ESC.boldOff);
  for (const p of r.payments) { text(row(`Thu ${p.method}`, grouped(p.tenderedMinor, r.currency), w)); if (BigInt(p.changeMinor) !== 0n) text(row('  Tien thoi', grouped(p.changeMinor, r.currency), w)); }
  for (const f of r.refunds) text(row(`Hoan ${f.method}`, grouped(f.amountMinor, r.currency), w));
  if (BigInt(r.dueMinor) !== 0n) text(row('Con phai thu', grouped(r.dueMinor, r.currency), w));
  if (o.reprint) mark();
  put(ESC.feed, ESC.cut);
  return Uint8Array.from(out);
}
