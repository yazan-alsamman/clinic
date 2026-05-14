import mongoose from 'mongoose'

/**
 * تعريف باكج ليزر من لوحة المدير — يُنسخ إلى ملف المريض عند البيع.
 */
const laserPackageTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    /** معرفات LaserProcedureOption (كسلسلة) */
    procedureOptionIds: [{ type: String, trim: true }],
    /** يجب أن يطابق عدد procedureOptionIds ما لم يُستخدم عرض متعدد المناطق */
    areaCount: { type: Number, required: true, min: 1, max: 40 },
    /** سعر الباكج المرجعي في القائمة */
    listPriceSyp: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

laserPackageTemplateSchema.index({ sortOrder: 1, name: 1 })

export const LaserPackageTemplate = mongoose.model('LaserPackageTemplate', laserPackageTemplateSchema)
