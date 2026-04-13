import mongoose from 'mongoose'

const inventoryItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    active: { type: Boolean, default: true, index: true },
    department: {
      type: String,
      enum: ['laser', 'dermatology', 'dental', 'skin', 'solarium'],
      default: 'dermatology',
      index: true,
    },
    unit: { type: String, default: 'unit' },
    safetyStockLevel: { type: Number, default: 5 },
    quantity: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const InventoryItem = mongoose.model('InventoryItem', inventoryItemSchema)
