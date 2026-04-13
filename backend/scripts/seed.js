/**
 * Seeder شامل لكل كيانات المشروع (MongoDB).
 *
 * استخدام:
 *   npm run seed          — بذور تدريجية (upsert)، لا يحذف البيانات الموجودة
 *   npm run seed:fresh    — حذف قاعدة البيانات بالكامل ثم إعادة البذر
 *
 * تسجيل الدخول الافتراضي لجميع المستخدمين النشطين: admin123
 */
import 'dotenv/config'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { User } from '../src/models/User.js'
import { Patient } from '../src/models/Patient.js'
import { BusinessDay } from '../src/models/BusinessDay.js'
import { LaserAreaCatalog } from '../src/models/LaserAreaCatalog.js'
import { Room } from '../src/models/Room.js'
import { InventoryItem } from '../src/models/InventoryItem.js'
import { LaserSession } from '../src/models/LaserSession.js'
import { DermatologyVisit } from '../src/models/DermatologyVisit.js'
import { DentalMasterPlan } from '../src/models/DentalMasterPlan.js'
import { AuditLog } from '../src/models/AuditLog.js'
import { Counter } from '../src/models/Counter.js'
import { ScheduleSlot } from '../src/models/ScheduleSlot.js'
import { todayBusinessDate } from '../src/utils/date.js'
import { CalculationProfile } from '../src/models/CalculationProfile.js'
import { AccountingParameterDefinition } from '../src/models/AccountingParameterDefinition.js'
import { GlAccount } from '../src/models/GlAccount.js'
import { backfillFinancialDocuments } from '../src/services/postingService.js'
import { provisionPortalCredentials } from '../src/utils/patientPortalCredentials.js'

const FRESH = process.argv.includes('--fresh')

function yesterdayBusinessDate() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** كتالوج مناطق ليزر — موسّع ليتوافق مع الواجهة والمواصفة */
const laserCatalog = [
  {
    id: 'f-upper',
    title: 'وجه علوي',
    areas: [
      { id: 'f-forehead', label: 'جبين', minutes: 10 },
      { id: 'f-chin', label: 'ذقن', minutes: 10 },
      { id: 'f-nose', label: 'أنف', minutes: 10 },
      { id: 'f-mustache', label: 'شارب', minutes: 10 },
    ],
  },
  {
    id: 'neck',
    title: 'الرقبة',
    areas: [
      { id: 'neck-full', label: 'رقبة كاملة', minutes: 5 },
      { id: 'neck-partial', label: 'رقبة نقرة', minutes: 5 },
    ],
  },
  {
    id: 'upper-limbs',
    title: 'أطراف علوية',
    areas: [
      { id: 'armpits', label: 'إبطين', minutes: 30 },
      { id: 'forearms', label: 'سواعد', minutes: 30 },
      { id: 'elbows', label: 'زنود', minutes: 30 },
      { id: 'hands', label: 'كفّي اليدين', minutes: 30 },
    ],
  },
  {
    id: 'torso',
    title: 'جذع',
    areas: [
      { id: 'chest-line', label: 'خط الصدر', minutes: 10 },
      { id: 'abdomen', label: 'بطن', minutes: 10 },
      { id: 'lower-back', label: 'أسفل الظهر', minutes: 5 },
    ],
  },
  {
    id: 'f-lower',
    title: 'سفلي / حساس',
    areas: [
      { id: 'f-bikini', label: 'حواف بيكيني', minutes: 10 },
      { id: 'f-buttocks', label: 'أرداف', minutes: 10 },
      { id: 'f-thigh-tri', label: 'مثلث فخذ', minutes: 10 },
    ],
  },
  {
    id: 'lower-limbs',
    title: 'أطراف سفلية',
    areas: [
      { id: 'legs-full', label: 'رجلين كامل', minutes: 45 },
      { id: 'thighs', label: 'فخذين', minutes: 20 },
      { id: 'knee-foot', label: 'ركبة + قدم مشط', minutes: 30 },
    ],
  },
  {
    id: 'm-upper',
    title: 'وجه علوي',
    areas: [
      { id: 'm-nose', label: 'أنف', minutes: 10 },
      { id: 'm-forehead', label: 'جبهة', minutes: 10 },
      { id: 'm-chin-u', label: 'ذقن أعلى', minutes: 10 },
      { id: 'm-ear', label: 'أذن', minutes: 10 },
    ],
  },
  {
    id: 'm-torso',
    title: 'جذع وأطراف علوية',
    areas: [
      { id: 'm-chest', label: 'صدر + كتف أمامي', minutes: 15 },
      { id: 'm-armpit', label: 'إبط', minutes: 15 },
      { id: 'm-back-shoulders', label: 'ظهر + أكتاف', minutes: 15 },
    ],
  },
]

const inventorySeed = [
  { sku: 'LAS-GEL-001', name: 'جيل ليزر', department: 'laser', unit: 'عبوة', quantity: 40, safetyStockLevel: 10, unitCost: 8 },
  { sku: 'LAS-CRYO-001', name: 'كريم تبريد ليزر', department: 'laser', unit: 'عبوة', quantity: 20, safetyStockLevel: 6, unitCost: 10 },
  { sku: 'DERM-BOT-001', name: 'بوتوكس وحدة', department: 'dermatology', unit: 'وحدة', quantity: 24, safetyStockLevel: 6, unitCost: 85 },
  { sku: 'DERM-FILL-001', name: 'فيلر شفاه (أمبول)', department: 'dermatology', unit: 'أمبول', quantity: 12, safetyStockLevel: 5, unitCost: 120 },
  { sku: 'DERM-GLOW-001', name: 'مادة نضارة', department: 'dermatology', unit: 'جلسة', quantity: 18, safetyStockLevel: 6, unitCost: 35 },
  { sku: 'SKIN-MASK-001', name: 'ماسك علاجي للبشرة', department: 'skin', unit: 'علبة', quantity: 30, safetyStockLevel: 8, unitCost: 14 },
  { sku: 'SKIN-PEEL-001', name: 'محلول تقشير بارد', department: 'skin', unit: 'عبوة', quantity: 16, safetyStockLevel: 5, unitCost: 22 },
  { sku: 'SOL-LOTION-001', name: 'لوشن سولاريوم', department: 'solarium', unit: 'عبوة', quantity: 22, safetyStockLevel: 7, unitCost: 11 },
  { sku: 'SOL-EYE-001', name: 'نظارات حماية سولاريوم', department: 'solarium', unit: 'قطعة', quantity: 35, safetyStockLevel: 10, unitCost: 4 },
  { sku: 'DEN-FILL-001', name: 'حشوة مركبة', department: 'dental', unit: 'جرعة', quantity: 40, safetyStockLevel: 10, unitCost: 12 },
  { sku: 'DEN-BOND-001', name: 'لاصق سنّي', department: 'dental', unit: 'عبوة', quantity: 15, safetyStockLevel: 4, unitCost: 28 },
  { sku: 'WIPES-001', name: 'مناديل تعقيم', department: 'dermatology', unit: 'علبة', quantity: 18, safetyStockLevel: 6, unitCost: 3 },
  { sku: 'NEEDLE-001', name: 'إبر تعقيم', department: 'dermatology', unit: 'علبة', quantity: 50, safetyStockLevel: 15, unitCost: 2 },
]

async function seed() {
  await mongoose.connect(config.mongoUri)
  console.log('Connected →', config.mongoUri.replace(/\/\/.*@/, '//***@'))

  if (FRESH) {
    await mongoose.connection.dropDatabase()
    console.log('🗑  تم مسح قاعدة البيانات (--fresh)')
  }

  const passwordHash = await bcrypt.hash('admin123', 10)

  const usersData = [
    { email: 'elias@clinic.local', name: 'د. إلياس دحدل', role: 'super_admin', active: true, doctorSharePercent: 0 },
    { email: 'reception@clinic.local', name: 'سكرتيرة — ريم', role: 'reception', active: true, doctorSharePercent: 0 },
    { email: 'laser1@clinic.local', name: 'أخصائية — سارة', role: 'laser', active: true, doctorSharePercent: 30 },
    { email: 'laser2@clinic.local', name: 'أخصائية — نور', role: 'laser', active: true, doctorSharePercent: 30 },
    { email: 'laura@clinic.local', name: 'د. لورا', role: 'dermatology', active: true, doctorSharePercent: 40 },
    { email: 'samy@clinic.local', name: 'د. سامي', role: 'dermatology', active: true, doctorSharePercent: 40 },
    {
      email: 'dental@clinic.local',
      name: 'د. أسنان — فرع',
      role: 'dental_branch',
      active: true,
      doctorSharePercent: 35,
    },
    {
      email: 'dental2@clinic.local',
      name: 'د. يمان — فرع',
      role: 'dental_branch',
      active: true,
      doctorSharePercent: 35,
    },
    {
      email: 'solarium@clinic.local',
      name: 'أخصائية — سولاريوم',
      role: 'solarium',
      active: true,
      doctorSharePercent: 35,
    },
    {
      email: 'frozen@clinic.local',
      name: 'موظف — مجمّد (تجريبي)',
      role: 'reception',
      active: false,
      doctorSharePercent: 0,
    },
  ]

  const userByEmail = new Map()
  for (const u of usersData) {
    const doc = await User.findOneAndUpdate(
      { email: u.email },
      {
        $set: {
          email: u.email,
          name: u.name,
          role: u.role,
          active: u.active,
          passwordHash,
          doctorSharePercent: u.doctorSharePercent ?? 0,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    userByEmail.set(u.email, doc)
    console.log('User:', u.email, u.active ? '' : '(مجمّد)')
  }

  const admin = userByEmail.get('elias@clinic.local')
  const laser1 = userByEmail.get('laser1@clinic.local')
  const laser2 = userByEmail.get('laser2@clinic.local')
  const reception = userByEmail.get('reception@clinic.local')

  const patientsData = [
    {
      name: 'سارة أحمد المحمد',
      dob: '1992-03-15',
      marital: 'متزوجة',
      occupation: 'مهندسة',
      medicalHistory: 'ضغط خفيف — تحت المتابعة',
      surgicalHistory: 'لا يوجد',
      allergies: 'البنسلين',
      departments: ['laser', 'dermatology'],
      lastVisit: new Date(),
      phone: '+963930000001',
    },
    {
      name: 'Lina K. Mansour',
      dob: '1988-11-02',
      marital: 'عزباء',
      occupation: 'محاسبة',
      medicalHistory: 'سليمة',
      surgicalHistory: 'استئصال زائدة (2010)',
      allergies: 'لا يوجد',
      departments: ['dental', 'laser'],
      lastVisit: new Date(),
      phone: '+963930000002',
    },
    {
      name: 'خالد يوسف',
      dob: '1975-07-22',
      marital: 'متزوج',
      occupation: 'تاجر',
      medicalHistory: 'سكري النوع الثاني',
      surgicalHistory: 'لا يوجد',
      allergies: 'لا يوجد',
      departments: ['dermatology'],
      lastVisit: new Date(Date.now() - 86400000),
      phone: '+963930000003',
    },
    {
      name: 'رنا صالح',
      dob: '1995-06-01',
      marital: 'عزباء',
      occupation: 'مصممة',
      medicalHistory: 'لا يوجد',
      surgicalHistory: 'لا يوجد',
      allergies: 'لا يوجد',
      departments: ['laser'],
      lastVisit: new Date(Date.now() - 2 * 86400000),
      phone: '+963930000004',
    },
    {
      name: 'محمد علي الحسن',
      dob: '1982-12-20',
      marital: 'متزوج',
      occupation: 'موظف بنك',
      medicalHistory: 'ارتجاع معدي',
      surgicalHistory: 'لا يوجد',
      allergies: 'الإيبوبروفين',
      departments: ['dental', 'dermatology'],
      lastVisit: new Date(Date.now() - 3 * 86400000),
      phone: '+963930000005',
    },
    {
      name: 'نورا فهد',
      dob: '1990-04-18',
      marital: 'متزوجة',
      occupation: 'ربة منزل',
      medicalHistory: 'ربو خفيف',
      surgicalHistory: 'قيصرية (2018)',
      allergies: 'لا يوجد',
      departments: ['laser', 'dermatology', 'dental'],
      lastVisit: new Date(),
      phone: '+963930000006',
    },
  ]

  const patientByName = new Map()
  for (const p of patientsData) {
    const doc = await Patient.findOneAndUpdate(
      { name: p.name },
      { $set: p },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    patientByName.set(p.name, doc)
    console.log('Patient:', p.name)
  }

  const portalDemo = patientByName.get('نورا فهد')
  if (portalDemo) {
    await Patient.updateOne(
      { _id: portalDemo._id },
      { $unset: { portalUsername: 1, portalPasswordHash: 1 } },
    )
    const fresh = await Patient.findById(portalDemo._id)
    const { username, plainPassword } = await provisionPortalCredentials(fresh)
    console.log('بوابة مريض (تجريبي — نورا فهد):', username, plainPassword)
  }

  let sortOrder = 0
  for (const cat of laserCatalog) {
    for (const a of cat.areas) {
      await LaserAreaCatalog.findOneAndUpdate(
        { areaId: a.id },
        {
          categoryId: cat.id,
          categoryTitle: cat.title,
          areaId: a.id,
          label: a.label,
          minutes: a.minutes,
          sortOrder: sortOrder++,
          active: true,
        },
        { upsert: true },
      )
    }
  }
  console.log('LaserAreaCatalog:', sortOrder, 'منطقة')

  for (const i of inventorySeed) {
    await InventoryItem.findOneAndUpdate(
      { sku: i.sku },
      { $set: i },
      { upsert: true, new: true },
    )
  }
  console.log('InventoryItem:', inventorySeed.length, 'صنف')

  await Room.findOneAndUpdate(
    { number: 1 },
    { assignedUserId: laser1._id },
    { upsert: true, new: true },
  )
  await Room.findOneAndUpdate(
    { number: 2 },
    { assignedUserId: laser2._id },
    { upsert: true, new: true },
  )
  await Room.findOneAndUpdate({ number: 3 }, { assignedUserId: null }, { upsert: true, new: true })
  console.log('Room: 1, 2, 3')

  const businessDate = todayBusinessDate()
  const yDate = yesterdayBusinessDate()

  await BusinessDay.findOneAndUpdate(
    { businessDate: yDate },
    {
      active: false,
      exchangeRate: 14700,
      rateSetBy: admin._id,
      rateSetAt: new Date(Date.now() - 86400000),
      closedAt: new Date(Date.now() - 43200000),
      closedBy: admin._id,
    },
    { upsert: true },
  )
  console.log('BusinessDay (أمس، مغلق):', yDate)

  await BusinessDay.findOneAndUpdate(
    { businessDate },
    {
      active: true,
      exchangeRate: 14850,
      rateSetBy: admin._id,
      rateSetAt: new Date(),
      closedAt: null,
      closedBy: null,
    },
    { upsert: true },
  )
  console.log('BusinessDay (اليوم، نشط):', businessDate, 'سعر 14850')

  const sarah = patientByName.get('سارة أحمد المحمد')
  const lina = patientByName.get('Lina K. Mansour')
  const rana = patientByName.get('رنا صالح')

  await ScheduleSlot.deleteMany({ businessDate, patientId: null })
  const scheduleRows = [
    {
      providerName: 'د. لورا',
      time: '09:30',
      endTime: '10:00',
      procedureType: 'كشف',
      patientId: sarah._id,
      patientName: sarah.name,
    },
    {
      providerName: 'أخصائية ليزر',
      time: '10:00',
      endTime: '10:45',
      procedureType: 'جلسة ليزر',
      patientId: lina._id,
      patientName: lina.name,
    },
  ]
  for (const row of scheduleRows) {
    await ScheduleSlot.findOneAndUpdate(
      { businessDate, time: row.time, providerName: row.providerName },
      {
        $set: {
          businessDate,
          time: row.time,
          endTime: row.endTime,
          providerName: row.providerName,
          procedureType: row.procedureType || '',
          patientId: row.patientId,
          patientName: row.patientName || '',
        },
      },
      { upsert: true },
    )
  }
  console.log('ScheduleSlot: مواعيد محجوزة فقط', businessDate, `(${scheduleRows.length})`)

  const shouldSeedLaserDemo = FRESH || (await LaserSession.countDocuments()) === 0
  if (shouldSeedLaserDemo) {
    if (!FRESH) await LaserSession.deleteMany({})

    const startOfDay = new Date()
    startOfDay.setHours(8, 0, 0, 0)
    const t1 = new Date(startOfDay.getTime() + 1 * 3600000)
    const t2 = new Date(startOfDay.getTime() + 2 * 3600000)

    const sessions = [
      {
        treatmentNumber: 1,
        patientId: sarah._id,
        operatorUserId: laser1._id,
        room: '1',
        laserType: 'Alex',
        pw: '12',
        pulse: '10',
        shotCount: '450',
        notes: 'بشرة حساسة — تخفيف الطاقة',
        areaIds: ['f-forehead', 'armpits'],
        status: 'completed',
        costUsd: 180,
        discountPercent: 0,
        createdAt: t1,
      },
      {
        treatmentNumber: 2,
        patientId: lina._id,
        operatorUserId: laser2._id,
        room: '2',
        laserType: 'Mix',
        pw: '15',
        pulse: '8',
        shotCount: '320',
        notes: '',
        areaIds: ['armpits', 'forearms'],
        status: 'scheduled',
        costUsd: 0,
        discountPercent: 0,
        createdAt: t2,
      },
      {
        treatmentNumber: 3,
        patientId: rana._id,
        operatorUserId: laser1._id,
        room: '1',
        laserType: 'Yag',
        pw: '10',
        pulse: '12',
        shotCount: '200',
        notes: 'متابعة بعد أسبوعين',
        areaIds: ['neck-full'],
        status: 'scheduled',
        costUsd: 0,
        discountPercent: 0,
        createdAt: new Date(startOfDay.getTime() + 30 * 60000),
      },
    ]

    for (const s of sessions) {
      await LaserSession.create(s)
    }
    await Counter.findOneAndUpdate(
      { _id: 'laserTreatment' },
      { $set: { seq: sessions.length } },
      { upsert: true },
    )
    console.log('LaserSession:', sessions.length, 'جلسة (اليوم)')
  } else {
    console.log('LaserSession: تخطي (يوجد بيانات — استخدم npm run seed:fresh)')
  }

  const laura = userByEmail.get('laura@clinic.local')
  await DermatologyVisit.findOneAndUpdate(
    { businessDate, patientId: lina._id },
    {
      $set: {
        businessDate,
        patientId: lina._id,
        areaTreatment: 'فيلر شفاه',
        sessionType: 'جلدية / تجميل',
        costUsd: 350,
        discountPercent: 10,
        providerUserId: laura._id,
        notes: 'خصم عرض',
      },
    },
    { upsert: true },
  )
  console.log('DermatologyVisit: صف تجريبي (فيلر شفاه) ليوم', businessDate)

  const samy = userByEmail.get('samy@clinic.local')
  await DermatologyVisit.findOneAndUpdate(
    { businessDate, patientId: sarah._id, providerUserId: samy._id },
    {
      $set: {
        businessDate,
        patientId: sarah._id,
        areaTreatment: 'مادة نضارة',
        sessionType: 'جلدية / تجميل',
        costUsd: 200,
        discountPercent: 0,
        providerUserId: samy._id,
        notes: '',
      },
    },
    { upsert: true },
  )
  console.log('DermatologyVisit: صف تجريبي (نضارة — د. سامي)')

  const khaled = patientByName.get('خالد يوسف')
  const mohammad = patientByName.get('محمد علي الحسن')

  await DentalMasterPlan.findOneAndUpdate(
    { patientId: lina._id },
    {
      $set: {
        status: 'approved',
        items: [
          { label: 'تقويم للفكين', tooth: null },
          { label: 'حشو 11، 12', tooth: 11 },
          { label: 'متابعة تنظيف دوري', tooth: null },
        ],
        createdBy: admin._id,
        approvedBy: admin._id,
        approvedAt: new Date(Date.now() - 86400000),
      },
    },
    { upsert: true },
  )
  console.log('DentalMasterPlan: Lina (معتمدة)')

  await DentalMasterPlan.findOneAndUpdate(
    { patientId: khaled._id },
    {
      $set: {
        status: 'draft',
        items: [{ label: 'مراجعة تصبغات — جلسة نضارة تجريبية', note: 'مسودة' }],
        createdBy: userByEmail.get('laura@clinic.local')._id,
        approvedBy: null,
        approvedAt: null,
      },
    },
    { upsert: true },
  )
  console.log('DentalMasterPlan: خالد (مسودة)')

  await DentalMasterPlan.findOneAndUpdate(
    { patientId: mohammad._id },
    {
      $set: {
        status: 'approved',
        items: [
          { label: 'خلع 28', tooth: 28 },
          { label: 'تاج 36', tooth: 36 },
        ],
        createdBy: admin._id,
        approvedBy: admin._id,
        approvedAt: new Date(),
      },
    },
    { upsert: true },
  )
  console.log('DentalMasterPlan: محمد (معتمدة)')

  const shouldSeedAudit = FRESH || (await AuditLog.countDocuments()) === 0
  if (shouldSeedAudit) {
    if (!FRESH) await AuditLog.deleteMany({})

    const samples = [
      {
        userId: admin._id,
        userName: admin.name,
        action: 'تعديل سعر الصرف',
        entityType: 'BusinessDay',
        entityId: yDate,
        details: { rate: 14700 },
        createdAt: new Date(Date.now() - 86400000),
      },
      {
        userId: reception._id,
        userName: reception.name,
        action: 'إنشاء زيارة / تحديث مريض',
        entityType: 'Patient',
        entityId: String(sarah._id),
        details: null,
        createdAt: new Date(Date.now() - 3600000),
      },
      {
        userId: admin._id,
        userName: admin.name,
        action: 'اعتماد الخطة العلاجية الرئيسية',
        entityType: 'DentalMasterPlan',
        entityId: String(lina._id),
        details: null,
        createdAt: new Date(Date.now() - 80000000),
      },
      {
        userId: admin._id,
        userName: admin.name,
        action: 'إعادة تعيين غرفة ليزر',
        entityType: 'Room',
        entityId: '1',
        details: { assignedUserId: String(laser1._id) },
        createdAt: new Date(Date.now() - 7200000),
      },
      {
        userId: userByEmail.get('laura@clinic.local')._id,
        userName: 'د. لورا',
        action: 'تحديث خطة علاج أسنان',
        entityType: 'DentalMasterPlan',
        entityId: String(khaled._id),
        details: null,
        createdAt: new Date(Date.now() - 5400000),
      },
    ]

    for (const a of samples) {
      await AuditLog.create(a)
    }
    console.log('AuditLog:', samples.length, 'سجل')
  } else {
    console.log('AuditLog: تخطي (يوجد بيانات — استخدم npm run seed:fresh)')
  }

  const clinicNetShareSteps = [
    {
      order: 0,
      key: 'net_gross',
      expression:
        'round2(input.gross_usd * (1 - min(input.discount_percent, param.discount_percent_cap) / 100))',
      description: 'صافي الإيراد بعد الحسم (مع سقف حسم من المعاملات)',
    },
    {
      order: 1,
      key: 'net_after_material',
      expression: 'round2(step.net_gross - input.material_cost_usd)',
      description: 'بعد خصم تكلفة المواد',
    },
    {
      order: 2,
      key: 'doctor_share_usd',
      expression: 'round2(step.net_after_material * input.doctor_share_percent / 100)',
      description: 'حصة الطبيب/الأخصائي',
    },
    {
      order: 3,
      key: 'clinic_net_usd',
      expression: 'round2(step.net_after_material - step.doctor_share_usd)',
      description: 'صافي العيادة',
    },
  ]

  /** مسار أسنان عام: المواد «ممتصة من المركز» — لا تُخصم من صافي العيادة (المواصفات §13.1). التقويم يستخدم CLINIC_NET_SHARE. */
  const shareOnGrossSteps = [
    {
      order: 0,
      key: 'net_gross',
      expression:
        'round2(input.gross_usd * (1 - min(input.discount_percent, param.discount_percent_cap) / 100))',
      description: 'صافي الإيراد بعد الحسم',
    },
    {
      order: 1,
      key: 'doctor_share_usd',
      expression: 'round2(step.net_gross * input.doctor_share_percent / 100)',
      description: 'حصة الطبيب من صافي الإيراد بعد الحسم',
    },
    {
      order: 2,
      key: 'clinic_net_usd',
      expression: 'round2(step.net_gross - step.doctor_share_usd)',
      description: 'صافي العيادة — بدون خصم مواد (تُحتسب على حساب المركز)',
    },
  ]

  await CalculationProfile.findOneAndUpdate(
    { code: 'CLINIC_NET_SHARE' },
    {
      $set: {
        code: 'CLINIC_NET_SHARE',
        name: 'صافي العيادة — حصة من صافي بعد المواد (جلدية / ليزر)',
        department: 'multi',
        active: true,
        accountingStandardTags: ['MANAGEMENT', 'ACCRUAL_CLINIC'],
        steps: clinicNetShareSteps,
      },
    },
    { upsert: true },
  )
  await CalculationProfile.findOneAndUpdate(
    { code: 'CLINIC_SHARE_ON_GROSS' },
    {
      $set: {
        code: 'CLINIC_SHARE_ON_GROSS',
        name: 'أسنان عام — حصة من صافي الإيراد؛ المواد غير مخصومة من صافي العيادة',
        department: 'dental',
        active: true,
        accountingStandardTags: ['MANAGEMENT', 'CASH_HELPER'],
        steps: shareOnGrossSteps,
      },
    },
    { upsert: true },
  )
  console.log('CalculationProfile: CLINIC_NET_SHARE, CLINIC_SHARE_ON_GROSS')

  const paramDefs = [
    {
      key: 'discount_percent_cap',
      label: 'سقف نسبة الحسم %',
      dataType: 'number',
      allowedScopes: ['global', 'department'],
      defaultNumber: 100,
    },
    {
      key: 'doctor_share_percent',
      label: 'تجاوز نسبة استحقاق (مستخدم/قسم)',
      dataType: 'number',
      allowedScopes: ['global', 'department', 'user'],
      defaultNumber: null,
    },
    {
      key: 'calc.profile.laser',
      label: 'رمز ملف حساب الليزر',
      dataType: 'string',
      allowedScopes: ['global', 'department'],
      defaultString: 'CLINIC_NET_SHARE',
    },
    {
      key: 'calc.profile.dermatology',
      label: 'رمز ملف حساب الجلدية',
      dataType: 'string',
      allowedScopes: ['global', 'department'],
      defaultString: 'CLINIC_NET_SHARE',
    },
    {
      key: 'calc.profile.dental_general',
      label: 'رمز ملف حساب أسنان — عام',
      dataType: 'string',
      allowedScopes: ['global'],
      defaultString: 'CLINIC_SHARE_ON_GROSS',
    },
    {
      key: 'calc.profile.dental_ortho',
      label: 'رمز ملف حساب أسنان — تقويم',
      dataType: 'string',
      allowedScopes: ['global'],
      defaultString: 'CLINIC_NET_SHARE',
    },
  ]
  for (const p of paramDefs) {
    await AccountingParameterDefinition.findOneAndUpdate(
      { key: p.key },
      { $set: { ...p, active: true, description: '' } },
      { upsert: true },
    )
  }
  console.log('AccountingParameterDefinition:', paramDefs.length)

  const glRows = [
    { code: '4100', name: 'إيرادات — ليزر', accountType: 'revenue', frameworkTags: ['IFRS_MANAGEMENT'] },
    { code: '4200', name: 'إيرادات — جلدية', accountType: 'revenue', frameworkTags: ['IFRS_MANAGEMENT'] },
    { code: '4300', name: 'إيرادات — أسنان', accountType: 'revenue', frameworkTags: ['IFRS_MANAGEMENT'] },
    { code: '5000', name: 'تكلفة مواد مستهلكة', accountType: 'expense', frameworkTags: ['IFRS_MANAGEMENT'] },
    { code: '2100', name: 'مستحقات أطباء/أخصائيين', accountType: 'liability', frameworkTags: ['IFRS_MANAGEMENT'] },
    { code: '5900', name: 'هامش عيادة (داخلي)', accountType: 'memo', frameworkTags: ['MANAGEMENT'] },
  ]
  for (const g of glRows) {
    await GlAccount.findOneAndUpdate({ code: g.code }, { $set: { ...g, active: true } }, { upsert: true })
  }
  console.log('GlAccount:', glRows.length)

  try {
    const bf = await backfillFinancialDocuments(admin._id)
    console.log('FinancialDocument backfill:', bf)
  } catch (e) {
    console.warn('FinancialDocument backfill skipped:', e?.message || e)
  }

  await mongoose.disconnect()
  console.log('')
  console.log('✓ اكتمل البذر.')
  console.log('  تسجيل الدخول (النشطون): أي بريد من القائمة + كلمة المرور: admin123')
  console.log('  إعادة بذر كاملة: npm run seed:fresh')
}

seed().catch((e) => {
  console.error(e)
  process.exit(1)
})
