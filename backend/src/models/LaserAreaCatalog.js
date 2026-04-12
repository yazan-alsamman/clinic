import mongoose from 'mongoose'

const laserAreaCatalogSchema = new mongoose.Schema(
  {
    categoryId: { type: String, required: true },
    categoryTitle: { type: String, required: true },
    areaId: { type: String, required: true, unique: true },
    label: { type: String, required: true },
    minutes: { type: Number, required: true },
    sortOrder: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const LaserAreaCatalog = mongoose.model('LaserAreaCatalog', laserAreaCatalogSchema)
