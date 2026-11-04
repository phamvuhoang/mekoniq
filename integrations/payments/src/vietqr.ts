/**
 * VietQR (NAPAS) payload, an EMV merchant-presented QR with the "A000000727" account-info template. Showing this QR asks the customer to pay; it is NOT a payment. Whether the customer
 * paid is known only from a verified provider/bank fact, never from this code or from "I paid".
 * Structure (TLV, tags ascending): 00 version, 01 initiation (11 static / 12 dynamic = amount present), 38 account (00 GUI, 01 {00 BIN, 01 account}, 02 service QRIBFTTA|QRIBFTTC),
 * 53 currency 704, 54 amount, 58 country VN, 62 additional {08 purpose}, 63 CRC-16/CCITT-FALSE over everything up to and including "6304".
 * ponytail: structure follows the public NAPAS/EMVCo layout; it has not been accepted by a bank app in this repository (see docs/integrations/payment-acceptance.md).
 */
export function crc16ccitt(text: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(text)) { crc ^= byte << 8; for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
const tlv = (id: string, value: string): string => {
  if (value.length < 1 || value.length > 99) throw new Error('VIETQR_FIELD_LENGTH');
  return id + String(value.length).padStart(2, '0') + value;
};
export type VietQrInput = { bin: string; account: string; amountMinor?: string; purpose?: string; toCard?: boolean };
export function vietQrPayload(i: VietQrInput): string {
  if (!/^[0-9]{6}$/.test(i.bin) || !/^[A-Za-z0-9]{1,19}$/.test(i.account)) throw new Error('VIETQR_INVALID_PAYEE');
  if (i.amountMinor !== undefined && !/^[1-9][0-9]{0,11}$/.test(i.amountMinor)) throw new Error('VIETQR_INVALID_AMOUNT'); // VND has no minor unit: whole dong
  if (i.purpose !== undefined && !/^[A-Za-z0-9 ]{1,25}$/.test(i.purpose)) throw new Error('VIETQR_INVALID_PURPOSE');
  const account = tlv('38', tlv('00', 'A000000727') + tlv('01', tlv('00', i.bin) + tlv('01', i.account)) + tlv('02', i.toCard ? 'QRIBFTTC' : 'QRIBFTTA'));
  const body = tlv('00', '01') + tlv('01', i.amountMinor ? '12' : '11') + account + tlv('53', '704') + (i.amountMinor ? tlv('54', i.amountMinor) : '') + tlv('58', 'VN') + (i.purpose ? tlv('62', tlv('08', i.purpose)) : '') + '6304';
  return body + crc16ccitt(body);
}
function fields(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < text.length;) {
    const id = text.slice(i, i + 2), len = Number(text.slice(i + 2, i + 4));
    if (!/^[0-9]{2}$/.test(id) || !Number.isInteger(len) || text.length < i + 4 + len) throw new Error('VIETQR_MALFORMED');
    out.set(id, text.slice(i + 4, i + 4 + len)); i += 4 + len;
  }
  return out;
}
/** Parse and verify (CRC, template, currency, country). Throws on anything that is not a well-formed VietQR payload. */
export function parseVietQr(payload: string): { bin: string; account: string; amountMinor?: string; purpose?: string; dynamic: boolean; toCard: boolean } {
  if (payload.length < 8 || payload.slice(-8, -4) !== '6304' || crc16ccitt(payload.slice(0, -4)) !== payload.slice(-4)) throw new Error('VIETQR_BAD_CRC');
  const top = fields(payload.slice(0, -8)), info = fields(top.get('38') ?? ''), consumer = fields(info.get('01') ?? '');
  if (top.get('00') !== '01' || info.get('00') !== 'A000000727' || top.get('53') !== '704' || top.get('58') !== 'VN') throw new Error('VIETQR_NOT_VIETQR');
  const service = info.get('02');
  if (service !== 'QRIBFTTA' && service !== 'QRIBFTTC') throw new Error('VIETQR_NOT_VIETQR');
  const amount = top.get('54'), purpose = top.get('62') ? fields(top.get('62')!).get('08') : undefined;
  return { bin: consumer.get('00') ?? '', account: consumer.get('01') ?? '', ...(amount ? { amountMinor: amount } : {}), ...(purpose ? { purpose } : {}), dynamic: top.get('01') === '12', toCard: service === 'QRIBFTTC' };
}
