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
    /** قراءة نصف اليوم — بعد انتهاء وردية الصباح (عدّاد الجهاز عند خروج أخصائي الصباح) */
    room1MeterHalfDay: { type: Number, default: null },
    room2MeterHalfDay: { type: Number, default: null },
    room1HalfDayCapturedAt: { type: Date, default: null },
    room2HalfDayCapturedAt: { type: Date, default: null },
    /** السكرتاريا مطالبون بإدخال قراءة نصف اليوم بعد إعلان خروج أخصائي الصباح */
    room1HalfDayPending: { type: Boolean, default: false },
    room2HalfDayPending: { type: Boolean, default: false },
    room1MeterEnd: { type: Number, default: null },
    room2MeterEnd: { type: Number, default: null },
  },
  { timestamps: true },
)

export const BusinessDay = mongoose.model('BusinessDay', businessDaySchema)
