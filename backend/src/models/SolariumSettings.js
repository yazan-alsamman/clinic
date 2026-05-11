import mongoose from 'mongoose'

const solariumSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: 'default' },
  /** سعر جلسة 6 دقائق بالليرة */
  price6MinSyp: { type: Number, default: 0, min: 0 },
  /** سعر جلسة 12 دقيقة بالليرة */
  price12MinSyp: { type: Number, default: 0, min: 0 },
})

export const SolariumSettings = mongoose.model('SolariumSettings', solariumSettingsSchema)
