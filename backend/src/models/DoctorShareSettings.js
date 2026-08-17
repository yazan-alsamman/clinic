import mongoose from 'mongoose'

/** نسب الحصص الافتراضية للأقسام + مقدّمون افتراضيون (د. الياس) — مستند واحد */
const doctorShareSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    departmentDefaults: {
      laser: { type: Number, default: 0, min: 0, max: 100 },
      dermatology: { type: Number, default: 50, min: 0, max: 100 },
      dental: { type: Number, default: 40, min: 0, max: 100 },
      skin: { type: Number, default: 0, min: 0, max: 100 },
      solarium: { type: Number, default: 0, min: 0, max: 100 },
    },
    virtualProviders: {
      elias: { type: Number, default: 0, min: 0, max: 100 },
    },
    /** بذرة لمرة واحدة: ملء نسب الأسنان/الجلدية من الافتراضي بدل 0 المخزّن سابقاً */
    seededClinicalDefaults: { type: Boolean, default: false },
  },
  { collection: 'doctorsharesettings' },
)

export const DoctorShareSettings = mongoose.model('DoctorShareSettings', doctorShareSettingsSchema)
