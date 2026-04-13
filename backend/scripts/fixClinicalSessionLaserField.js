/**
 * يزيل laserSessionId: null من وثائق ClinicalSession القديمة.
 * السبب: فهرس unique + sparse كان يعتبر كل null قيمة مفهرسة، فيسمح بجلسة واحدة فقط «غير ليزر».
 *
 * تشغيل مرة واحدة بعد نشر التعديل على النموذج:
 *   node scripts/fixClinicalSessionLaserField.js
 */
import 'dotenv/config'
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { ClinicalSession } from '../src/models/ClinicalSession.js'

async function main() {
  await mongoose.connect(config.mongoUri)
  const r = await ClinicalSession.collection.updateMany(
    { laserSessionId: null },
    { $unset: { laserSessionId: '' } },
  )
  console.log('ClinicalSession: unset laserSessionId where null — matched:', r.matchedCount, 'modified:', r.modifiedCount)
  await mongoose.disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
