import mongoose from 'mongoose'

const dentalLabPaymentSchema = new mongoose.Schema(
  {
    amountSyp: { type: Number, default: 0, min: 0 },
    amountUsd: { type: Number, default: 0, min: 0 },
    /** ل.س لكل 1 USD لجزء الدولار */
    usdSypRate: { type: Number, default: 0, min: 0 },
    businessDate: { type: String, default: '', trim: true },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: '', trim: true, maxlength: 160 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

const dentalLabSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    notes: { type: String, default: '', trim: true, maxlength: 1000 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    /** دفعات مسدّدة للمخبر (تُخصم من إجمالي الأعمال) */
    payments: { type: [dentalLabPaymentSchema], default: [] },
  },
  { timestamps: true },
)

dentalLabSchema.index({ name: 1 }, { unique: true })

export const DentalLab = mongoose.model('DentalLab', dentalLabSchema)
