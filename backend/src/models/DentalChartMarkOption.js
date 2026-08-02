import mongoose from 'mongoose'

const SHAPES = ['fill', 'outline', 'cross', 'stripe', 'dot']
const CATEGORIES = ['baseline', 'clinic', 'both']

const dentalChartMarkOptionSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    color: { type: String, required: true, trim: true, maxlength: 20, default: '#0d9488' },
    shape: { type: String, enum: SHAPES, default: 'fill' },
    category: { type: String, enum: CATEGORIES, default: 'both' },
    active: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
)

dentalChartMarkOptionSchema.index({ name: 1 }, { unique: true })

export const DentalChartMarkOption = mongoose.model('DentalChartMarkOption', dentalChartMarkOptionSchema)
export const DENTAL_CHART_MARK_SHAPES = SHAPES
export const DENTAL_CHART_MARK_CATEGORIES = CATEGORIES
