import mongoose from 'mongoose'

/** إعدادات عامة لليزر — مستند واحد `_id: default` */
const laserSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    /** سعر الضربة بالدولار عند تفعيل «محاسبة على عدد الضربات» */
    pricePerPulseUsd: { type: Number, default: 0 },
  },
  { collection: 'lasersettings' },
)

export const LaserSettings = mongoose.model('LaserSettings', laserSettingsSchema)
