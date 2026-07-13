import crypto from 'node:crypto';

export type EcpayFields = Record<string, string>;

function ecpayUrlEncode(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, '+').replace(/~/g, '%7E').toLowerCase();
}

export function createEcpayCheckMacValue(fields: EcpayFields, hashKey: string, hashIv: string): string {
  const sorted = Object.entries(fields)
    .filter(([key]) => key.toLowerCase() !== 'checkmacvalue')
    .sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return crypto.createHash('sha256').update(ecpayUrlEncode(`HashKey=${hashKey}&${sorted}&HashIV=${hashIv}`)).digest('hex').toUpperCase();
}

export function verifyEcpayCheckMacValue(fields: EcpayFields, hashKey: string, hashIv: string): boolean {
  const supplied = fields.CheckMacValue;
  if (!supplied) return false;
  const expected = createEcpayCheckMacValue(fields, hashKey, hashIv);
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied.toUpperCase()), Buffer.from(expected));
}

export function ecpayCheckoutUrl(testMode: boolean): string {
  return testMode ? 'https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5' : 'https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5';
}
