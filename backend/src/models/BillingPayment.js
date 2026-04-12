import mongoose from 'mongoose'

const billingPaymentSchema = new mongoose.Schema(
  {
    billingItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'BillingItem', required: true, unique: true, index: true },
    amountUsd: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'card', 'transfer', 'other'], default: 'cash' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    receivedAt: { type: Date, default: () => new Date() },
    /** يُملأ بعد نجاح الترحيل المحاسبي */
    financialDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'FinancialDocument', default: null },
  },
  { timestamps: true },
)

export const BillingPayment = mongoose.model('BillingPayment', billingPaymentSchema)
