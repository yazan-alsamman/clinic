import mongoose from 'mongoose'

const GROUP_IDS = ['face', 'upper', 'lower', 'offers']
const KIND_IDS = ['area', 'offer']

const laserProcedureOptionSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    groupId: { type: String, required: true, enum: GROUP_IDS },
    groupTitle: { type: String, required: true, trim: true, maxlength: 120 },
    kind: { type: String, required: true, enum: KIND_IDS, default: 'area' },
    /** Deprecated: kept for backward compatibility with older rows/clients */
    priceSyp: { type: Number, required: true, min: 0, default: 0 },
    /** السعر بحسب جنس المريض */
    priceMaleSyp: { type: Number, required: true, min: 0, default: 0 },
    priceFemaleSyp: { type: Number, required: true, min: 0, default: 0 },
    /** عدد المناطق التي يمثلها العرض (يفيد في إنشاء أسطر الجلسة تلقائياً) */
    areaCount: { type: Number, required: true, min: 1, max: 20, default: 1 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

laserProcedureOptionSchema.index({ groupId: 1, active: 1, sortOrder: 1, name: 1 })

export const LaserProcedureOption = mongoose.model('LaserProcedureOption', laserProcedureOptionSchema)
