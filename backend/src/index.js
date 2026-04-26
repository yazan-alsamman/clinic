import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import { connectDb } from './db.js'
import { authRouter } from './routes/auth.js'
import { systemRouter } from './routes/system.js'
import { patientsRouter } from './routes/patients.js'
import { laserRouter } from './routes/laser.js'
import { usersRouter } from './routes/users.js'
import { auditRouter } from './routes/audit.js'
import { roomsRouter } from './routes/rooms.js'
import { dentalRouter } from './routes/dental.js'
import { inventoryRouter } from './routes/inventory.js'
import { scheduleRouter } from './routes/schedule.js'
import { dermatologyRouter } from './routes/dermatology.js'
import { reportsRouter } from './routes/reports.js'
import { accountingRouter } from './routes/accounting.js'
import { clinicalRouter } from './routes/clinical.js'
import { billingRouter } from './routes/billing.js'
import { notificationsRouter } from './routes/notifications.js'
import { patientAuthRouter } from './routes/patientAuth.js'
import { patientPortalRouter } from './routes/patientPortal.js'

let dbConnected = false

const app = express()

// Cross-origin (SPA on another *.hostingersite.com): echo Origin; JWT is in Authorization, not cookies.
const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true)
    callback(null, origin)
  },
  credentials: false,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: dbConnected })
})

app.use('/api/auth', authRouter)
app.use('/api/patient-auth', patientAuthRouter)
app.use('/api/patient-portal', patientPortalRouter)
app.use('/api/system', systemRouter)
app.use('/api/patients', patientsRouter)
app.use('/api/laser', laserRouter)
app.use('/api/users', usersRouter)
app.use('/api/audit', auditRouter)
app.use('/api/rooms', roomsRouter)
app.use('/api/dental', dentalRouter)
app.use('/api/inventory', inventoryRouter)
app.use('/api/schedule', scheduleRouter)
app.use('/api/dermatology', dermatologyRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/accounting', accountingRouter)
app.use('/api/clinical', clinicalRouter)
app.use('/api/billing', billingRouter)
app.use('/api/notifications', notificationsRouter)

app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(500).json({ error: 'خطأ في الخادم' })
})

const host = process.env.HOST || '0.0.0.0'

app.listen(config.port, host, () => {
  console.log(
    `API listening on http://${host}:${config.port} (process.env.PORT=${process.env.PORT ?? 'unset'})`,
  )
})

connectDb()
  .then(() => {
    dbConnected = true
    console.log('MongoDB connected')
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err?.message || err)
    const code = err?.code ?? err?.cause?.code
    if (code != null) console.error('MongoDB error code:', code)
  })
