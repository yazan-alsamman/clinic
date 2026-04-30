import mongoose from 'mongoose'

const dermatologyBoardSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true, unique: true, min: 1, max: 3 },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    assignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

export const DermatologyBoard = mongoose.model('DermatologyBoard', dermatologyBoardSchema)
