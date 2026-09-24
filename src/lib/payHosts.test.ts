import { expect, test } from 'bun:test'
import { isPaymentUrl } from './payHosts'

test('оплата открывается только у провайдеров и на сайте', () => {
  expect(isPaymentUrl('https://gate.antilopay.com/pay/x')).toBe(true)
  expect(isPaymentUrl('https://pay.enot.io/inv-1')).toBe(true)
  expect(isPaymentUrl('https://millida.net/profile#plus')).toBe(true)
  expect(isPaymentUrl('http://gate.antilopay.com/pay/x')).toBe(false)
  expect(isPaymentUrl('https://antilopay.com.evil.io/')).toBe(false)
  expect(isPaymentUrl('https://evilantilopay.com/')).toBe(false)
  expect(isPaymentUrl('javascript:alert(1)')).toBe(false)
  expect(isPaymentUrl(null)).toBe(false)
})
