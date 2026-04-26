import mongoose from 'mongoose'

const userNotificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, trim: true, default: 'appointment_cancelled' },
    read: { type: Boolean, default: false, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
)

userNotificationSchema.index({ userId: 1, createdAt: -1 })
userNotificationSchema.index({ userId: 1, read: 1, createdAt: -1 })

export const UserNotification = mongoose.model('UserNotification', userNotificationSchema)
