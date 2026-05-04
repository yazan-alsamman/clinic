/**
 * بذر: حساب super_admin + مرضى من ملف Excel (الملف الطبي: الإضبارة، الاسم، الهاتف، الجنس).
 *
 * الأعمدة في أول ورقة (عربي؛ يُقبل مرادف لرقم الملف):
 *   - رقم الفايل أو رقم الإضبارة
 *   - اسم المريض
 *   - رقم الهاتف
 *   - الجنس (مثلاً: ذكر / انثى — يُخزَّن كـ male / female)
 *   (عمود «الملاحظات» يُتجاهل)
 *
 * ترتيب البحث عن الملف:
 *   1) متغير البيئة SEED_PATIENTS_XLSX
 *   2) backend/data/ملف تعريف المريضات.xlsx
 *   3) جذر المستودع: ملف تعريف المريضات.xlsx
 *
 * الاستخدام:
 *   npm run seed:fresh   — تثبيت التبعيات ثم مسح القاعدة وبذر المدير + المرضى
 *   npm run seed         — تحديث المدير والمرضى دون مسح القاعدة بالكامل
 *
 * تسجيل الدخول بعد البذر:
 *   elias@clinic.local / elias123
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

const KEY_FILE_PRIMARY = 'رقم الفايل'
const KEY_FILE_ALT = 'رقم الإضبارة'
const KEY_NAME = 'اسم المريض'
const KEY_PHONE = 'رقم الهاتف'
const KEY_GENDER = 'الجنس'

const SUPERADMIN_EMAIL = 'elias@clinic.local'
const SUPERADMIN_PASSWORD = 'elias123'

const INSERT_BATCH = 400

const WORKBOOK_NAME = 'ملف تعريف المريضات.xlsx'

/** backend/data/ملف تعريف المريضات.xlsx */
function dataDirWorkbookPath() {
  return path.resolve(__dirname, '..', 'data', WORKBOOK_NAME)
}

/** جذر المستودع (backend/scripts → .. → backend → .. → root) */
function repoRootWorkbookPath() {
  return path.resolve(__dirname, '..', '..', WORKBOOK_NAME)
}

function resolvePatientWorkbookPath() {
  if (process.env.SEED_PATIENTS_XLSX) {
    const p = path.resolve(process.env.SEED_PATIENTS_XLSX)
    if (!fs.existsSync(p)) throw new Error(`SEED_PATIENTS_XLSX غير موجود: ${p}`)
    return p
  }
  const inData = dataDirWorkbookPath()
  if (fs.existsSync(inData)) return inData
  const inRoot = repoRootWorkbookPath()
  if (fs.existsSync(inRoot)) return inRoot
  throw new Error(
    `ملف البذر غير موجود. جرّب أحد المسارين:\n` +
      `  - ${inData}\n` +
      `  - ${inRoot}\n` +
      'أو عيّن SEED_PATIENTS_XLSX.',
  )
}

function cellToPlainString(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(Math.trunc(v))
  return String(v).trim()
}

/** يطابق مخزن النظام: male | female | '' */
function normalizeGenderFromExcel(raw) {
  const s = cellToPlainString(raw).toLowerCase()
  if (!s) return ''
  if (s === 'male' || s === 'm' || s.includes('ذكر')) return 'male'
  if (s === 'female' || s === 'f' || s.includes('انث') || s.includes('أنث') || s.includes('انثي')) return 'female'
  return ''
}

function fileNumberFromRow(row) {
  const a = cellToPlainString(row[KEY_FILE_PRIMARY])
  if (a) return a
  return cellToPlainString(row[KEY_FILE_ALT])
}

function loadPatientRowsFromXlsx(workbookPath) {
  console.log('قراءة Excel:', workbookPath)
  const wb = xlsx.readFile(workbookPath, { cellDates: true, sheetRows: 200000 })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false })
  const out = []
  const seen = new Set()
  for (const row of rows) {
    const fileNumber = fileNumberFromRow(row)
    const name = cellToPlainString(row[KEY_NAME])
    const phone = cellToPlainString(row[KEY_PHONE])
    const gender = normalizeGenderFromExcel(row[KEY_GENDER])
    if (!fileNumber || !name) continue
    if (seen.has(fileNumber)) continue
    seen.add(fileNumber)
    out.push({ fileNumber, name, phone, gender })
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

  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, 10)
  await User.findOneAndUpdate(
    { email: SUPERADMIN_EMAIL },
    {
      $set: {
        email: SUPERADMIN_EMAIL,
        name: 'د. إلياس دحدل',
        role: 'super_admin',
        active: true,
        passwordHash,
        doctorSharePercent: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )
  console.log(`User: ${SUPERADMIN_EMAIL} (super_admin) — ${SUPERADMIN_PASSWORD}`)

  if (FRESH) {
    await Patient.deleteMany({})
    for (let i = 0; i < patientRows.length; i += INSERT_BATCH) {
      const chunk = patientRows.slice(i, i + INSERT_BATCH).map((r) => ({
        fileNumber: r.fileNumber,
        name: r.name,
        phone: r.phone,
        gender: r.gender,
      }))
      if (chunk.length) await Patient.insertMany(chunk, { ordered: false })
      console.log('  … مرضى', Math.min(i + INSERT_BATCH, patientRows.length), '/', patientRows.length)
    }
  } else {
    for (const r of patientRows) {
      await Patient.findOneAndUpdate(
        { fileNumber: r.fileNumber },
        { $set: { name: r.name, phone: r.phone, gender: r.gender } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
    }
  }
  console.log('Patients:', patientRows.length)

  await mongoose.disconnect()
  console.log('')
  console.log('✓ اكتمل البذر.')
  console.log(`  تسجيل الدخول: ${SUPERADMIN_EMAIL} / ${SUPERADMIN_PASSWORD}`)
  console.log('  إن كانت القاعدة جديدة: فعّل يوم عمل من واجهة المدير إن لزم.')
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
