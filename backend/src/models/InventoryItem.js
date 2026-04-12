import mongoose from 'mongoose'

const inventoryItemSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true },
    unit: { type: String, default: 'unit' },
    safetyStockLevel: { type: Number, default: 5 },
    quantity: { type: Number, default: 0 },
    unitCost: { type: Number, default: 0 },
  },
  { timestamps: true },
)

export const InventoryItem = mongoose.model('InventoryItem', inventoryItemSchema)
