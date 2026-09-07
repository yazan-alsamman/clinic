import mongoose from 'mongoose'

const salaryEmployeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    title: { type: String, trim: true, maxlength: 200, default: '' },
    monthlySalarySyp: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

salaryEmployeeSchema.index({ name: 1 })

export const SalaryEmployee = mongoose.model('SalaryEmployee', salaryEmployeeSchema)
