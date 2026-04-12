import mongoose from 'mongoose'

const calculationStepSchema = new mongoose.Schema(
  {
    order: { type: Number, required: true },
    key: { type: String, required: true, trim: true },
    expression: { type: String, required: true },
    description: { type: String, default: '' },
  },
  { _id: false },
)

const calculationProfileSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, default: '' },
    /** primary department this profile targets (informational) */
    department: { type: String, default: '' },
    active: { type: Boolean, default: true },
    /** e.g. IFRS_MANAGEMENT, CASH_BASIS, LOCAL_SY */
    accountingStandardTags: [{ type: String, trim: true }],
    steps: { type: [calculationStepSchema], default: [] },
  },
  { timestamps: true },
)

export const CalculationProfile = mongoose.model('CalculationProfile', calculationProfileSchema)
