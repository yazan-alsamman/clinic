import mongoose from 'mongoose'

const salaryPaymentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SalaryEmployee',
      required: true,
      index: true,
    },
    amountSyp: { type: Number, required: true, min: 0, default: 0 },
    amountUsd: { type: Number, min: 0, default: 0 },
    usdSypRate: { type: Number, min: 0, default: 0 },
    businessDate: { type: String, required: true, index: true },
    note: { type: String, trim: true, maxlength: 2000, default: '' },
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

salaryPaymentSchema.index({ employeeId: 1, businessDate: -1 })
salaryPaymentSchema.index({ businessDate: -1 })

export const SalaryPayment = mongoose.model('SalaryPayment', salaryPaymentSchema)
