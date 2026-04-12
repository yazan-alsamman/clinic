import mongoose from 'mongoose'
import { config } from './config.js'

const mongooseOptions = {
  serverSelectionTimeoutMS: 15_000,
  connectTimeoutMS: 15_000,
}

export async function connectDb() {
  await mongoose.connect(config.mongoUri, mongooseOptions)
  return mongoose.connection
}
