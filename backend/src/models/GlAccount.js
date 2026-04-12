import mongoose from 'mongoose'

const glAccountSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true },
    /** revenue | expense | asset | liability | equity | memo */
    accountType: { type: String, default: 'memo' },
    /** which reporting packs include this line */
    frameworkTags: [{ type: String, trim: true }],
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
)

export const GlAccount = mongoose.model('GlAccount', glAccountSchema)
