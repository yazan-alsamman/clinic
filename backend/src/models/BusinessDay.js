import mongoose from 'mongoose'

/** تفعيل يوم العمل وعدادات الليزر — سعر الصرف: ليرة سورية لكل 1 USD عند بدء اليوم */
const businessDaySchema = new mongoose.Schema(
  {
    businessDate: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false },
    closedAt: { type: Date, default: null },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /** ليرة سورية لكل 1 دولار أمريكي — يُلزم عند بدء يوم العمل */
    usdSypRate: { type: Number, default: null, min: 0 },
    /** قراءة عداد الليزر (غرفة 1 و 2) عند بداية اليوم ونهايته */
    room1MeterStart: { type: Number, default: null },
    room2MeterStart: { type: Number, default: null },
    room1MeterEnd: { type: Number, default: null },
    room2MeterEnd: { type: Number, default: null },
  },
  { timestamps: true },
)

export const BusinessDay = mongoose.model('BusinessDay', businessDaySchema)
