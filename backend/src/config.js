import dotenv from 'dotenv'

dotenv.config()

export const config = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/dr_elias_clinic',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  jwtReceptionExpiresIn: process.env.JWT_RECEPTION_EXPIRES_IN || '6h',
  jwtPatientExpiresIn: process.env.JWT_PATIENT_EXPIRES_IN || '7d',
}
