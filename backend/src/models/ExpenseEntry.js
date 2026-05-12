import mongoose from 'mongoose'

export const EXPENSE_CATEGORIES = ['laser', 'dermatology', 'skin', 'solarium', 'dental', 'general']

const expenseEntrySchema = new mongoose.Schema(
  {
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 2000 },
    amountSyp: { type: Number, required: true, min: 0 },
    /** تاريخ احتساب المصروف في التقارير المالية */
    businessDate: { type: String, required: true, index: true },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

expenseEntrySchema.index({ category: 1, businessDate: -1 })

export const ExpenseEntry = mongoose.model('ExpenseEntry', expenseEntrySchema)
