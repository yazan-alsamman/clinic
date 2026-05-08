import mongoose from 'mongoose'

/** إعدادات عامة لليزر — مستند واحد `_id: default` */
const laserSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    /** سعر الضربة بالليرة السورية */
    pricePerPulseSyp: { type: Number, default: 0 },
    /** سعر خيار «كفر ليزر» يُضاف للفاتورة عند اختياره من الأخصائي */
    laserCoverSyp: { type: Number, default: 0 },
  },
  { collection: 'lasersettings' },
)

export const LaserSettings = mongoose.model('LaserSettings', laserSettingsSchema)
