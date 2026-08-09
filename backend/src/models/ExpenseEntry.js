import mongoose from 'mongoose'

export const EXPENSE_CATEGORIES = ['laser', 'dermatology', 'skin', 'solarium', 'dental', 'general']

const expenseEntrySchema = new mongoose.Schema(
  {
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    /** الجزء المدخل بالليرة السورية */
    amountSyp: { type: Number, required: true, min: 0, default: 0 },
    /** الجزء المدخل بالدولار */
    amountUsd: { type: Number, min: 0, default: 0 },
    /** سعر الصرف المستخدم لجزء الدولار (ل.س لكل 1 USD) */
    usdSypRate: { type: Number, min: 0, default: 0 },
    /** تاريخ احتساب المصروف في التقارير المالية */
    businessDate: { type: String, required: true, index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

expenseEntrySchema.index({ category: 1, businessDate: -1 })

export const ExpenseEntry = mongoose.model('ExpenseEntry', expenseEntrySchema)

/** المكافئ بالليرة للتقارير = ل.س + دولار × سعر الصرف */
export function expenseEffectiveAmountSyp(entry) {
  const syp = Math.round(Number(entry?.amountSyp) || 0)
  const usd = Math.max(0, Number(entry?.amountUsd) || 0)
  const rate = Math.max(0, Number(entry?.usdSypRate) || 0)
  const fromUsd = usd > 0 && rate > 0 ? Math.round(usd * rate) : 0
  return syp + fromUsd
}
