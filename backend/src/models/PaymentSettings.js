import mongoose from 'mongoose'

const bankEntrySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { _id: true },
)

/** إعدادات تحصيل — قائمة البنوك (مستند واحد default) */
const paymentSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    banks: { type: [bankEntrySchema], default: [] },
  },
  { collection: 'paymentsettings' },
)

export const PaymentSettings = mongoose.model('PaymentSettings', paymentSettingsSchema)
