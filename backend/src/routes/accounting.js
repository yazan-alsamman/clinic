import { Router } from 'express'
import mongoose from 'mongoose'
import { authMiddleware, requireRoles } from '../middleware/auth.js'
import { AccountingParameterDefinition } from '../models/AccountingParameterDefinition.js'
import { AccountingParameterValue } from '../models/AccountingParameterValue.js'
import { CalculationProfile } from '../models/CalculationProfile.js'
import { GlAccount } from '../models/GlAccount.js'
import { FinancialDocument } from '../models/FinancialDocument.js'
import { writeAudit } from '../utils/audit.js'
import { backfillFinancialDocuments, repostSource } from '../services/postingService.js'
import {
  buildParamBagForCalculation,
  snapshotParamsForKeys,
  TRACKED_PARAM_KEYS,
} from '../services/parameterService.js'

export const accountingRouter = Router()
accountingRouter.use(authMiddleware)

const ADMIN = ['super_admin']

accountingRouter.get('/parameter-definitions', requireRoles(...ADMIN), async (_req, res) => {
  try {
    const rows = await AccountingParameterDefinition.find({}).sort({ key: 1 }).lean()
    res.json({ definitions: rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.post('/parameter-definitions', requireRoles(...ADMIN), async (req, res) => {
  try {
    const body = req.body ?? {}
    const key = String(body.key || '').trim()
    if (!key) {
      res.status(400).json({ error: 'key مطلوب' })
      return
    }
    const doc = await AccountingParameterDefinition.findOneAndUpdate(
      { key },
      {
        $set: {
          key,
          label: String(body.label || ''),
          description: String(body.description || ''),
          dataType: body.dataType || 'number',
          allowedScopes: Array.isArray(body.allowedScopes) ? body.allowedScopes : ['global', 'department', 'user'],
          defaultNumber: body.defaultNumber != null ? Number(body.defaultNumber) : null,
          defaultString: body.defaultString != null ? String(body.defaultString) : '',
          active: body.active !== false,
        },
      },
      { upsert: true, new: true },
    )
    await writeAudit({
      user: req.user,
      action: 'تعريف معامل محاسبي',
      entityType: 'AccountingParameterDefinition',
      entityId: doc._id,
      details: { key },
    })
    res.json({ definition: doc })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.get('/parameter-values', requireRoles(...ADMIN), async (req, res) => {
  try {
    const q = {}
    if (req.query.paramKey) q.paramKey = String(req.query.paramKey)
    const rows = await AccountingParameterValue.find(q).sort({ paramKey: 1, validFrom: -1 }).limit(500).lean()
    res.json({ values: rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.post('/parameter-values', requireRoles(...ADMIN), async (req, res) => {
  try {
    const body = req.body ?? {}
    const paramKey = String(body.paramKey || '').trim()
    const scopeType = String(body.scopeType || 'global')
    if (!paramKey || !['global', 'department', 'user'].includes(scopeType)) {
      res.status(400).json({ error: 'paramKey أو scopeType غير صالح' })
      return
    }
    const scopeId = String(body.scopeId ?? '').trim()
    if (scopeType !== 'global' && !scopeId) {
      res.status(400).json({ error: 'scopeId مطلوب لهذا النطاق' })
      return
    }
    if (scopeType === 'global' && !scopeId) {
      /* ok */
    }
    const doc = await AccountingParameterValue.create({
      paramKey,
      scopeType,
      scopeId: scopeType === 'global' ? '' : scopeId,
      valueNumber: body.valueNumber != null ? Number(body.valueNumber) : null,
      valueString: body.valueString != null ? String(body.valueString) : '',
      valueBoolean: typeof body.valueBoolean === 'boolean' ? body.valueBoolean : null,
      validFrom: body.validFrom ? new Date(body.validFrom) : new Date(),
      validTo: body.validTo ? new Date(body.validTo) : null,
      setBy: req.user._id,
      notes: String(body.notes || ''),
    })
    await writeAudit({
      user: req.user,
      action: 'قيمة معامل محاسبي',
      entityType: 'AccountingParameterValue',
      entityId: doc._id,
      details: { paramKey, scopeType, scopeId },
    })
    res.status(201).json({ value: doc })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.get('/profiles', requireRoles(...ADMIN), async (_req, res) => {
  try {
    const rows = await CalculationProfile.find({}).sort({ code: 1 }).lean()
    res.json({ profiles: rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.get('/profiles/:code', requireRoles(...ADMIN), async (req, res) => {
  try {
    const code = String(req.params.code || '')
      .trim()
      .toUpperCase()
    const p = await CalculationProfile.findOne({ code }).lean()
    if (!p) {
      res.status(404).json({ error: 'غير موجود' })
      return
    }
    res.json({ profile: p })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.put('/profiles/:code', requireRoles(...ADMIN), async (req, res) => {
  try {
    const code = String(req.params.code || '')
      .trim()
      .toUpperCase()
    const body = req.body ?? {}
    const p = await CalculationProfile.findOneAndUpdate(
      { code },
      {
        $set: {
          code,
          name: String(body.name || code),
          department: String(body.department || ''),
          active: body.active !== false,
          accountingStandardTags: Array.isArray(body.accountingStandardTags) ? body.accountingStandardTags : [],
          steps: Array.isArray(body.steps) ? body.steps : [],
        },
      },
      { upsert: true, new: true },
    )
    await writeAudit({
      user: req.user,
      action: 'تحديث ملف حساب (خطوات التسوية)',
      entityType: 'CalculationProfile',
      entityId: p._id,
      details: { code },
    })
    res.json({ profile: p })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.get('/gl-accounts', requireRoles(...ADMIN), async (_req, res) => {
  try {
    const rows = await GlAccount.find({ active: true }).sort({ code: 1 }).lean()
    res.json({ accounts: rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.get('/documents', requireRoles(...ADMIN), async (req, res) => {
  try {
    const q = { status: 'posted' }
    if (req.query.businessDate) q.businessDate = String(req.query.businessDate)
    if (req.query.department) q.department = String(req.query.department)
    if (req.query.sourceType) q.sourceType = String(req.query.sourceType)
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || '50'), 10) || 50))
    const rows = await FinancialDocument.find(q)
      .sort({ businessDate: -1, createdAt: -1 })
      .limit(limit)
      .populate('patientId', 'name')
      .populate('providerUserId', 'name role doctorSharePercent')
      .lean()
    res.json({ documents: rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.get('/documents/:id', requireRoles(...ADMIN), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ error: 'معرّف غير صالح' })
      return
    }
    const doc = await FinancialDocument.findById(req.params.id)
      .populate('patientId', 'name')
      .populate('providerUserId', 'name role doctorSharePercent')
      .populate('postedBy', 'name')
      .lean()
    if (!doc) {
      res.status(404).json({ error: 'غير موجود' })
      return
    }
    res.json({ document: doc })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})

accountingRouter.post('/backfill', requireRoles(...ADMIN), async (req, res) => {
  try {
    const r = await backfillFinancialDocuments(req.user._id)
    await writeAudit({
      user: req.user,
      action: 'مزامنة ترحيل محاسبي (backfill)',
      entityType: 'FinancialDocument',
      entityId: 'batch',
      details: r,
    })
    res.json({ result: r })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e?.message || e) })
  }
})

accountingRouter.post('/repost', requireRoles(...ADMIN), async (req, res) => {
  try {
    const body = req.body ?? {}
    const sourceType = String(body.sourceType || '')
    const sourceId = String(body.sourceId || '')
    const r = await repostSource(sourceType, sourceId, req.user._id)
    await writeAudit({
      user: req.user,
      action: 'إعادة ترحيل مستند مالي',
      entityType: sourceType,
      entityId: sourceId,
    })
    res.json({ result: r })
  } catch (e) {
    console.error(e)
    res.status(400).json({ error: String(e?.message || e) })
  }
})

/** لقطة معاملات لنطاق (معاينة) */
accountingRouter.get('/snapshot', requireRoles(...ADMIN), async (req, res) => {
  try {
    const department = String(req.query.department || 'laser')
    const userId = String(req.query.userId || '').trim()
    const snap = await snapshotParamsForKeys(TRACKED_PARAM_KEYS, { department, userId })
    const { param } = await buildParamBagForCalculation({ department, userId })
    res.json({ keys: TRACKED_PARAM_KEYS, snapshot: snap, paramBag: param })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'خطأ في الخادم' })
  }
})
