/**
 * يحوّل مستخدمي دور «سولاريوم» إلى «استقبال» بعد إزالة الدور من النظام.
 * تشغيل: node backend/scripts/migrate-remove-solarium-user-role.js
 */
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { User } from '../src/models/User.js'

async function main() {
  const uri = process.env.MONGODB_URI || config.mongoUri
  if (!uri) {
    console.error('Missing MONGODB_URI')
    process.exit(1)
  }
  await mongoose.connect(uri)
  const r = await User.updateMany({ role: 'solarium' }, { $set: { role: 'reception' } })
  console.log('Updated users (solarium → reception):', r.modifiedCount)
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
