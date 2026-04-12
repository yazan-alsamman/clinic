import mongoose from 'mongoose'

const roomSchema = new mongoose.Schema(
  {
    number: { type: Number, required: true, unique: true, min: 1, max: 99 },
    assignedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
)

export const Room = mongoose.model('Room', roomSchema)
