import mongoose from 'mongoose'

const cashMovementSchema = new mongoose.Schema(
  {
    businessDate: { type: String, required: true, trim: true, index: true },
    kind: { type: String, enum: ['expense', 'receipt'], required: true, index: true },
    reason: { type: String, required: true, trim: true },
    amountSyp: { type: Number, default: 0, min: 0 },
    amountUsd: { type: Number, default: 0, min: 0 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

cashMovementSchema.index({ businessDate: 1, kind: 1, createdAt: 1 })

export const CashMovement = mongoose.model('CashMovement', cashMovementSchema)
