import mongoose from 'mongoose'

/** Daily ignition + single FX rate for that calendar day (spec §3, §3.3) */
const businessDaySchema = new mongoose.Schema(
  {
    businessDate: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false },
    exchangeRate: { type: Number, default: null },
    rateSetBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    rateSetAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

export const BusinessDay = mongoose.model('BusinessDay', businessDaySchema)
