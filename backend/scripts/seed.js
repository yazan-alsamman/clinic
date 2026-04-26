/**
 * بذر بسيط: مستخدم واحد (مدير النظام) + مرضى من ملف Excel.
 *
 * الأعمدة المتوقعة في أول ورقة (عناوين عربية كما في الملف المرفوع مع المستودع):
 *   - رقم الفايل
 *   - اسم المريض
 *   - رقم الهاتف
 *   (عمود «الملاحظات» يُتجاهل في البذر)
 *
 * مسار الملف الافتراضي (نسبةً إلى هذا السكربت في scripts/):
 *   backend/data/ملف تعريف المريضات.xlsx
 * يمكن تجاوزه بـ: SEED_PATIENTS_XLSX=مسار_كامل_للملف
 *
 * الاستخدام:
 *   npm run seed:fresh   — يثبت التبعيات (npm install) ثم يمسح القاعدة ويبذر المدير + المرضى من Excel
 *   npm run seed         — تحديث/إدراج المدير والمرضى من Excel دون مسح بقية الجداول (شغّل npm install في backend إن ظهر خطأ xlsx)
 *
 * تسجيل الدخول بعد البذر:
 *   elias@clinic.local / admin123
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import fs from 'fs'
import mongoose from 'mongoose'
import path from 'path'
import { fileURLToPath } from 'url'
import xlsx from 'xlsx'
import { config } from '../src/config.js'
import { User } from '../src/models/User.js'
import { Patient } from '../src/models/Patient.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRESH = process.argv.includes('--fresh')

const KEY_FILE = 'رقم الفايل'
const KEY_NAME = 'اسم المريض'
const KEY_PHONE = 'رقم الهاتف'

const INSERT_BATCH = 400

/** الملف الافتراضي المرفوع مع المستودع: backend/data/ملف تعريف المريضات.xlsx */
function defaultWorkbookPath() {
  return path.resolve(__dirname, '..', 'data', 'ملف تعريف المريضات.xlsx')
}

function resolvePatientWorkbookPath() {
  if (process.env.SEED_PATIENTS_XLSX) {
    const p = path.resolve(process.env.SEED_PATIENTS_XLSX)
    if (!fs.existsSync(p)) throw new Error(`SEED_PATIENTS_XLSX غير موجود: ${p}`)
    return p
  }
  const def = defaultWorkbookPath()
  if (fs.existsSync(def)) return def
  throw new Error(
    `ملف البذر غير موجود: ${def}\n` +
      'ضع ملف Excel في المسار أعلاه (أو عيّن SEED_PATIENTS_XLSX).',
  )
}

function cellToPlainString(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  return String(v).trim()
}

function loadPatientRowsFromXlsx(workbookPath) {
  console.log('قراءة Excel:', workbookPath)
  const wb = xlsx.readFile(workbookPath, { cellDates: true, sheetRows: 200000 })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const out = []
  const seen = new Set()
  for (const row of rows) {
    const fileNumber = cellToPlainString(row[KEY_FILE])
    const name = cellToPlainString(row[KEY_NAME])
    const phone = cellToPlainString(row[KEY_PHONE])
    if (!fileNumber || !name) continue
    if (seen.has(fileNumber)) continue
    seen.add(fileNumber)
    out.push({ fileNumber, name, phone })
  }
  return out
}

async function seed() {
  const workbookPath = resolvePatientWorkbookPath()
  const patientRows = loadPatientRowsFromXlsx(workbookPath)
  console.log('صفوف مرضى (بعد التصفية):', patientRows.length)

  await mongoose.connect(config.mongoUri)
  console.log('Connected →', config.mongoUri.replace(/\/\/.*@/, '//***@'))

  if (FRESH) {
    await mongoose.connection.dropDatabase()
    console.log('تم مسح قاعدة البيانات (--fresh)')
  } else {
    console.log('بدون --fresh: لن تُحذف بقية الجداول أو المستخدمين الآخرون — لقاعدة «نظيفة» استخدم npm run seed:fresh')
  }

  const passwordHash = await bcrypt.hash('admin123', 10)
  await User.findOneAndUpdate(
    { email: 'elias@clinic.local' },
    {
      $set: {
        email: 'elias@clinic.local',
        name: 'د. إلياس دحدل',
        role: 'super_admin',
        active: true,
        passwordHash,
        doctorSharePercent: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  console.log('User: elias@clinic.local (super_admin) — admin123')

  if (FRESH) {
    await Patient.deleteMany({})
    for (let i = 0; i < patientRows.length; i += INSERT_BATCH) {
      const chunk = patientRows.slice(i, i + INSERT_BATCH).map((r) => ({
        fileNumber: r.fileNumber,
        name: r.name,
        phone: r.phone,
      }))
      if (chunk.length) await Patient.insertMany(chunk, { ordered: false })
      console.log('  … مرضى', Math.min(i + INSERT_BATCH, patientRows.length), '/', patientRows.length)
    }
  } else {
    for (const r of patientRows) {
      await Patient.findOneAndUpdate(
        { fileNumber: r.fileNumber },
        { $set: { name: r.name, phone: r.phone } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
    }
  }
  console.log('Patients:', patientRows.length)

  await mongoose.disconnect()
  console.log('')
  console.log('✓ اكتمل البذر.')
  console.log('  تسجيل الدخول: elias@clinic.local / admin123')
  console.log('  إن كانت القاعدة جديدة: فعّل يوم عمل من واجهة المدير إن لزم.')
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
