import mongoose from 'mongoose'

/** تفعيل يوم العمل وعدادات الليزر — المبالغ بالنظام بالليرة السورية فقط */
const businessDaySchema = new mongoose.Schema(
  {
    businessDate: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** قراءة عداد الليزر (غرفة 1 و 2) عند بداية اليوم ونهايته */
    room1MeterStart: { type: Number, default: null },
    room2MeterStart: { type: Number, default: null },
    room1MeterEnd: { type: Number, default: null },
    room2MeterEnd: { type: Number, default: null },
  },
  { timestamps: true },
)

export const BusinessDay = mongoose.model('BusinessDay', businessDaySchema)
