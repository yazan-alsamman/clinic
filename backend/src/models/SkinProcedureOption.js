import mongoose from 'mongoose'

const skinProcedureOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    priceSyp: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

skinProcedureOptionSchema.index({ name: 1 }, { unique: true })

export const SkinProcedureOption = mongoose.model('SkinProcedureOption', skinProcedureOptionSchema)
