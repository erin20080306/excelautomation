import { describe, expect, it } from 'vitest';
import { createEcpayCheckMacValue, verifyEcpayCheckMacValue } from './ecpay.js';

describe('ECPay CheckMacValue', () => {
  const fields = {
    TradeDesc: '促銷方案', PaymentType: 'aio', MerchantTradeDate: '2023/03/12 15:30:23',
    MerchantTradeNo: 'ecpay20230312153023', MerchantID: '3002607', ReturnURL: 'https://www.ecpay.com.tw/receive.php',
    ItemName: 'Apple iphone 15', TotalAmount: '30000', ChoosePayment: 'ALL', EncryptType: '1'
  };

  it('matches the official SHA-256 example', () => {
    expect(createEcpayCheckMacValue(fields, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs')).toBe('6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840');
  });

  it('rejects a modified callback', () => {
    const CheckMacValue = createEcpayCheckMacValue(fields, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs');
    expect(verifyEcpayCheckMacValue({ ...fields, CheckMacValue }, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs')).toBe(true);
    expect(verifyEcpayCheckMacValue({ ...fields, TotalAmount: '1', CheckMacValue }, 'pwFHCqoQZGmho4w6', 'EkRm7iFT261dpevs')).toBe(false);
  });
});
