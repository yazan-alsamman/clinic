/**
 * بعد إزالة دور skin_specialist: حوّل المستخدمين القدامى إلى reception،
 * وحدّث اسم مقدّم مواعيد البشرة القديمة.
 * من مجلد backend: node scripts/migrate-skin-specialist-role.js
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { ScheduleSlot } from '../src/models/ScheduleSlot.js'

const uri = process.env.MONGO_URI || process.env.DATABASE_URL
if (!uri) {
  console.error('Set MONGO_URI or DATABASE_URL')
  process.exit(1)
}

await mongoose.connect(uri)
const users = await mongoose.connection.db
  .collection('users')
  .updateMany({ role: 'skin_specialist' }, { $set: { role: 'reception' } })
console.log('users skin_specialist → reception:', users.matchedCount, users.modifiedCount)

const slots = await ScheduleSlot.updateMany(
  { serviceType: 'skin', providerName: 'أخصائي بشرة' },
  { $set: { providerName: 'قسم البشرة' } },
)
console.log('skin slots provider rename:', slots.matchedCount, slots.modifiedCount)

await mongoose.disconnect()
