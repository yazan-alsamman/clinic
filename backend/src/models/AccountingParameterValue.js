import mongoose from 'mongoose'

const accountingParameterValueSchema = new mongoose.Schema(
  {
    paramKey: { type: String, required: true, index: true, trim: true },
    scopeType: { type: String, enum: ['global', 'department', 'user'], required: true },
    /** department code e.g. laser, dermatology, dental — or User ObjectId string for user scope */
    scopeId: { type: String, default: '', trim: true },
    valueNumber: { type: Number, default: null },
    valueString: { type: String, default: '' },
    valueBoolean: { type: Boolean, default: null },
    validFrom: { type: Date, required: true, default: () => new Date(0) },
    validTo: { type: Date, default: null },
    setBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: '' },
  },
  { timestamps: true },
)

accountingParameterValueSchema.index({ paramKey: 1, scopeType: 1, scopeId: 1, validFrom: -1 })

export const AccountingParameterValue = mongoose.model(
  'AccountingParameterValue',
  accountingParameterValueSchema,
)
