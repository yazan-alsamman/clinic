/** فهرس MongoDB فريد — تعارض إدراج متزامن (مثلاً billingItemId على BillingPayment) */
export function isMongoDuplicateKeyError(err) {
  const code = err?.code
  return code === 11000 || code === 11001
}

export const BILLING_PAYMENT_DUPLICATE_MSG = 'تم تسجيل دفعة لهذا البند مسبقاً'
