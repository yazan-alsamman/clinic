import mongoose from 'mongoose'

const expenseLineSchema = new mongoose.Schema(
  {
    reason: { type: String, default: '' },
    amountUsd: { type: Number, default: 0 },
    amountSyp: { type: Number, default: 0 },
  },
  { _id: true },
)

/** مصاريف ليزر شهرية (مدير) — تُطرح من إيراد الجلسات في التقرير المالي الشهري */
const laserMonthlyExpensesSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true, index: true },
    lines: { type: [expenseLineSchema], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

export const LaserMonthlyExpenses = mongoose.model('LaserMonthlyExpenses', laserMonthlyExpensesSchema)
