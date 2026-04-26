import mongoose from 'mongoose'

const billingPaymentSchema = new mongoose.Schema(
  {
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', required: true, unique: true, index: true },
    /** المبلغ المطبّق على بند الفاتورة (لا يتجاوز المستحق) — ليرة سورية */
    amountSyp: { type: Number, required: true, min: 0 },
    /** المبلغ المستلم فعلياً من المريض */
    receivedAmountSyp: { type: Number, default: 0, min: 0 },
    /** الفرق: موجب = رصيد إضافي، سالب = ذمة */
    settlementDeltaSyp: { type: Number, default: 0 },
    /** عملة التحصيل الفعلية من المريض */
    payCurrency: { type: String, enum: ['SYP', 'USD'], default: 'SYP' },
    /** عند الدفع بالدولار: المبلغ المستلم بالدولار (للتقارير) */
    receivedAmountUsd: { type: Number, default: 0, min: 0 },
    /** عند التحصيل بالدولار: ما رُدّ للمريض نقداً (توثيق — ل.س أو USD حسب الحقل غير الصفري) */
    patientRefundSyp: { type: Number, default: 0, min: 0 },
    patientRefundUsd: { type: Number, default: 0, min: 0 },
    /** كاش أو بنك — للتقارير المالية */
    paymentChannel: { type: String, enum: ['cash', 'bank'], default: 'cash' },
    /** اسم البنك عند paymentChannel === bank (نسخة وقت الدفع) */
    bankName: { type: String, default: '', trim: true },
    method: { type: String, enum: ['cash', 'card', 'transfer', 'other', 'bank'], default: 'cash' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receivedAt: { type: Date, default: () => new Date() },
    /** يُملأ بعد نجاح الترحيل المحاسبي */
    financialDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialDocument', default: null },
  },
  { timestamps: true },
)

export const BillingPayment = mongoose.model('BillingPayment', billingPaymentSchema)
