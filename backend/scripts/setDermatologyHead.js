import 'dotenv/config'
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { User } from '../src/models/User.js'

async function run() {
  await mongoose.connect(config.mongoUri)
  const email = 'lora@eliasdahdal.clinic'
  const user = await User.findOneAndUpdate(
    { email },
    { $set: { role: 'dermatology_manager', active: true } },
    { new: true },
  )
  if (!user) {
    console.log('NOT_FOUND')
  } else {
    console.log(`UPDATED ${user.email} => ${user.role}`)
  }
  await mongoose.disconnect()
}

run().catch(async (e) => {
  console.error(e)
  try {
    await mongoose.disconnect()
  } catch {}
  process.exit(1)
})
