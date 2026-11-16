/**
 * الإجراءات العامة (أسنان) — جلسات، مستهلكات لكل جلسة، وعمولة الطبيب.
 *
 * القاعدة (commissionRule = 'cash_sessions_v1'):
 *   صافي الجلسة = المبلغ المحصّل فعلياً في الجلسة − مستهلكات تلك الجلسة
 *   عمولة الطبيب = صافي الجلسة ÷ 3 (ثلث بالضبط، لا 30٪ ولا 33.3٪)
 *
 * - لكل جلسة مستهلكاتها؛ إضافة مستهلك لجلسة لا تغيّر أي جلسة أخرى.
 * - الدفعات تُربط بالجلسة التي حُصّلت فيها (sessionId)، والعمولة لا تُحسب على غير المحصّل.
 * - تصحيح مستهلكات جلسة مغلقة: لمدير النظام فقط مع سبب، ويُسجَّل كتسوية صريحة بتاريخ التصحيح
 *   (فرق العمولة يظهر في يوم التصحيح، ولا تتغير أرقام الفترات السابقة بصمت).
 * - الإجراءات القديمة (بلا commissionRule) تبقى على قاعدتها السابقة دون إعادة احتساب.
 *
 * هذا الملف دوال صرفة (بلا قاعدة بيانات) حتى تُختبر مباشرة.
 */
import mongoose from 'mongoose'

export const GENERAL_PROCEDURE_COMMISSION_RULE = 'cash_sessions_v1'
/** نسبة عمولة الطبيب في الإجراءات العامة: ثلث بالضبط */
export const GENERAL_PROCEDURE_DOCTOR_SHARE_DENOMINATOR = 3

const YMD = /^\d{4}-\d{2}-\d{2}$/

function roundMoney(n) {
  return Math.round(Number(n) || 0)
}

function ymd(raw) {
  const s = String(raw || '').trim().slice(0, 10)
  return YMD.test(s) ? s : ''
}

function idOf(x) {
  if (x == null) return ''
  if (typeof x === 'string') return x
  if (x._id != null) return String(x._id)
  return String(x)
}

function newObjectId() {
  return new mongoose.Types.ObjectId()
}

export function isCashSessionRule(tr) {
  return String(tr?.commissionRule || '') === GENERAL_PROCEDURE_COMMISSION_RULE
}

/**
 * عمولة الطبيب = الصافي ÷ 3، تُقرَّب مرة واحدة فقط على دقة العملة.
 * decimals = 0 لليرة (الدقة المعتمدة في النظام)، 2 للدولار.
 */
export function doctorCommissionFromNet(net, { decimals = 0 } = {}) {
  const f = 10 ** Math.max(0, Math.min(6, Math.trunc(Number(decimals) || 0)))
  const v = Math.round(((Number(net) || 0) * f) / GENERAL_PROCEDURE_DOCTOR_SHARE_DENOMINATOR) / f
  return Object.is(v, -0) ? 0 : v
}

/** تكلفة المستهلك بالليرة = ل.س + دولار × سعر الصرف المحفوظ معه */
export function consumableCostSyp(c) {
  const syp = roundMoney(c?.amountSyp)
  const usd = Math.max(0, Number(c?.amountUsd) || 0)
  const rate = Math.max(0, Number(c?.costUsdSypRate) || 0)
  return syp + (usd > 0 && rate > 0 ? roundMoney(usd * rate) : 0)
}

function paymentAmountSyp(p) {
  return roundMoney(p?.amountSyp)
}

function isRemoved(c) {
  return Boolean(c?.removedAt)
}

function sessionIsClosed(s) {
  return Boolean(s?.closedAt)
}

function sortedSessions(tr) {
  const list = Array.isArray(tr?.sessions) ? [...tr.sessions] : []
  list.sort((a, b) => {
    const da = ymd(a?.sessionDate)
    const db = ymd(b?.sessionDate)
    if (da !== db) return da < db ? -1 : 1
    const ca = a?.createdAt ? new Date(a.createdAt).getTime() : 0
    const cb = b?.createdAt ? new Date(b.createdAt).getTime() : 0
    return ca - cb
  })
  return list
}

/**
 * الجلسة التي تُنسب لها دفعة بتاريخ paidAt: جلسة بنفس اليوم فقط (آخرها إن تعددت)، وإلا لا شيء.
 * لا تُنسب دفعة يوم آخر لجلسة قديمة — قسط يوم جديد = جلسة جديدة.
 */
export function deriveSessionForDate(tr, paidAt) {
  const d = ymd(paidAt)
  if (!d) return null
  const sameDay = sortedSessions(tr).filter((s) => ymd(s.sessionDate) === d)
  return sameDay.length ? sameDay[sameDay.length - 1] : null
}

/** معرّف جلسة الدفعة: المحفوظ إن كان صالحاً، وإلا المشتق من التاريخ */
export function resolvePaymentSessionId(tr, payment) {
  const saved = payment?.sessionId ? String(payment.sessionId) : ''
  if (saved && (tr?.sessions || []).some((s) => idOf(s) === saved)) return saved
  const derived = deriveSessionForDate(tr, payment?.paidAt)
  return derived ? idOf(derived) : ''
}

function snapshotSessionFigures(tr, sessionId) {
  const view = buildGeneralTreatmentSessionsView(tr)
  const s = view.sessions.find((x) => x.id === sessionId)
  return {
    collectedSyp: s?.collectedSyp || 0,
    consumablesSyp: s?.consumablesSyp || 0,
    netSyp: s?.netSyp || 0,
    commissionSyp: s?.commissionSyp || 0,
  }
}

function findSession(tr, sessionId) {
  const sid = String(sessionId || '')
  return (tr?.sessions || []).find((s) => idOf(s) === sid) || null
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/**
 * فتح جلسة جديدة للإجراء العام. الجلسات المفتوحة السابقة تُغلق تلقائياً
 * حتى لا تُضاف مستهلكات لاحقة إلى جلسة قديمة بالخطأ.
 */
export function openSession(tr, { sessionDate, actor = null, now = new Date(), note = '', autoCreated = false } = {}) {
  if (!isCashSessionRule(tr)) throw httpError(400, 'هذا الإجراء مسجّل على القاعدة القديمة — لا يدعم الجلسات')
  const d = ymd(sessionDate)
  if (!d) throw httpError(400, 'تاريخ الجلسة غير صالح')
  if (!Array.isArray(tr.sessions)) tr.sessions = []
  for (const s of tr.sessions) {
    if (!sessionIsClosed(s)) {
      s.closedAt = now
      s.closedByUserId = actor?._id || null
      s.closedByName = actor?.name ? String(actor.name) : ''
      s.closedAutomatically = true
    }
  }
  const session = {
    _id: newObjectId(),
    sessionDate: d,
    note: String(note || '').trim().slice(0, 500),
    autoCreated: Boolean(autoCreated),
    consumables: [],
    adjustments: [],
    createdAt: now,
    createdByUserId: actor?._id || null,
    createdByName: actor?.name ? String(actor.name) : '',
    closedAt: null,
    closedByUserId: null,
    closedByName: '',
    closedAutomatically: false,
  }
  tr.sessions.push(session)
  return tr.sessions[tr.sessions.length - 1]
}

/** الجلسة التي تُسجَّل فيها دفعة جديدة — تُنشأ تلقائياً إن لم توجد جلسة لذلك اليوم */
export function sessionForIncomingPayment(tr, paidAt, { now = new Date() } = {}) {
  if (!isCashSessionRule(tr)) return null
  const existing = deriveSessionForDate(tr, paidAt)
  if (existing) return existing
  const d = ymd(paidAt)
  if (!d) return null
  return openSession(tr, { sessionDate: d, now, autoCreated: true })
}

export function closeSession(tr, sessionId, { actor = null, now = new Date() } = {}) {
  const s = findSession(tr, sessionId)
  if (!s) throw httpError(404, 'الجلسة غير موجودة')
  if (sessionIsClosed(s)) return s
  s.closedAt = now
  s.closedByUserId = actor?._id || null
  s.closedByName = actor?.name ? String(actor.name) : ''
  s.closedAutomatically = false
  return s
}

function normalizeConsumableInput(input, fallbackRate = 0) {
  const name = String(input?.name || '').trim().slice(0, 200)
  const amountSyp = Math.max(0, roundMoney(input?.amountSyp))
  const amountUsd = Math.max(0, Math.round((Number(input?.amountUsd) || 0) * 1e6) / 1e6)
  let costUsdSypRate = Math.max(0, Number(input?.costUsdSypRate) || 0)
  if (amountUsd > 0 && !(costUsdSypRate > 0)) costUsdSypRate = Math.max(0, Number(fallbackRate) || 0)
  if (!(amountUsd > 0)) costUsdSypRate = 0
  const quantity = Math.max(0, Number(input?.quantity) || 0) || 1
  if (!name) throw httpError(400, 'أدخل اسم المستهلك')
  if (!(amountSyp > 0) && !(amountUsd > 0)) throw httpError(400, 'أدخل تكلفة المستهلك')
  if (amountUsd > 0 && !(costUsdSypRate > 0)) throw httpError(400, 'سعر صرف الدولار غير متوفر لتكلفة المستهلك')
  return { name, quantity, amountSyp, amountUsd, costUsdSypRate }
}

/**
 * إضافة مستهلك إلى جلسة محددة فقط.
 * جلسة مغلقة: مدير النظام فقط + سبب، ويُسجَّل الأثر المالي بتاريخ التصحيح كتسوية صريحة.
 */
export function addConsumable(
  tr,
  sessionId,
  input,
  { actor = null, now = new Date(), businessDate, canCorrectClosed = false, reason = '', fallbackRate = 0 } = {},
) {
  if (!isCashSessionRule(tr)) throw httpError(400, 'هذا الإجراء مسجّل على القاعدة القديمة — لا يدعم المستهلكات لكل جلسة')
  const s = findSession(tr, sessionId)
  if (!s) throw httpError(404, 'الجلسة غير موجودة')
  const data = normalizeConsumableInput(input, fallbackRate)
  const closed = sessionIsClosed(s)
  const correctionReason = String(reason || '').trim().slice(0, 500)
  if (closed) {
    if (!canCorrectClosed) throw httpError(403, 'الجلسة مغلقة — تعديل مستهلكاتها لمدير النظام فقط')
    if (!correctionReason) throw httpError(400, 'اذكر سبب تعديل مستهلكات جلسة مغلقة')
  }
  const correctionDate = ymd(businessDate) || ymd(now.toISOString())
  const before = closed ? snapshotSessionFigures(tr, idOf(s)) : null
  if (!Array.isArray(s.consumables)) s.consumables = []
  const row = {
    _id: newObjectId(),
    ...data,
    /** تاريخ الأثر المالي: تاريخ الجلسة، أو تاريخ التصحيح إن أُضيف بعد الإغلاق */
    effectiveDate: closed ? correctionDate : ymd(s.sessionDate),
    addedAfterClose: closed,
    addedAt: now,
    addedByUserId: actor?._id || null,
    addedByName: actor?.name ? String(actor.name) : '',
    correctionReason: closed ? correctionReason : '',
    removedAt: null,
    removedByUserId: null,
    removedByName: '',
    removedReason: '',
    removedAfterClose: false,
    removedEffectiveDate: '',
  }
  s.consumables.push(row)
  if (closed) {
    const after = snapshotSessionFigures(tr, idOf(s))
    if (!Array.isArray(s.adjustments)) s.adjustments = []
    s.adjustments.push({
      _id: newObjectId(),
      action: 'consumable_added',
      consumableId: row._id,
      consumableName: row.name,
      amountSyp: consumableCostSyp(row),
      businessDate: correctionDate,
      reason: correctionReason,
      at: now,
      byUserId: actor?._id || null,
      byName: actor?.name ? String(actor.name) : '',
      previousConsumablesSyp: before.consumablesSyp,
      newConsumablesSyp: after.consumablesSyp,
      previousNetSyp: before.netSyp,
      newNetSyp: after.netSyp,
      previousCommissionSyp: before.commissionSyp,
      newCommissionSyp: after.commissionSyp,
      commissionDeltaSyp: roundMoney(after.commissionSyp - before.commissionSyp),
    })
  }
  return s.consumables[s.consumables.length - 1]
}

/**
 * إزالة مستهلك (حذف منطقي — يبقى في السجل).
 * جلسة مغلقة: مدير النظام فقط + سبب، وعكس الأثر يُسجَّل بتاريخ التصحيح.
 */
export function removeConsumable(
  tr,
  sessionId,
  consumableId,
  { actor = null, now = new Date(), businessDate, canCorrectClosed = false, reason = '' } = {},
) {
  const s = findSession(tr, sessionId)
  if (!s) throw httpError(404, 'الجلسة غير موجودة')
  const cid = String(consumableId || '')
  const row = (s.consumables || []).find((c) => idOf(c) === cid)
  if (!row) throw httpError(404, 'المستهلك غير موجود في هذه الجلسة')
  if (isRemoved(row)) throw httpError(409, 'المستهلك محذوف سابقاً')
  const closed = sessionIsClosed(s)
  const removalReason = String(reason || '').trim().slice(0, 500)
  if (closed) {
    if (!canCorrectClosed) throw httpError(403, 'الجلسة مغلقة — تعديل مستهلكاتها لمدير النظام فقط')
    if (!removalReason) throw httpError(400, 'اذكر سبب تعديل مستهلكات جلسة مغلقة')
  }
  const correctionDate = ymd(businessDate) || ymd(now.toISOString())
  const before = closed ? snapshotSessionFigures(tr, idOf(s)) : null
  row.removedAt = now
  row.removedByUserId = actor?._id || null
  row.removedByName = actor?.name ? String(actor.name) : ''
  row.removedReason = removalReason
  row.removedAfterClose = closed
  row.removedEffectiveDate = closed ? correctionDate : ''
  if (closed) {
    const after = snapshotSessionFigures(tr, idOf(s))
    if (!Array.isArray(s.adjustments)) s.adjustments = []
    s.adjustments.push({
      _id: newObjectId(),
      action: 'consumable_removed',
      consumableId: row._id,
      consumableName: row.name,
      amountSyp: consumableCostSyp(row),
      businessDate: correctionDate,
      reason: removalReason,
      at: now,
      byUserId: actor?._id || null,
      byName: actor?.name ? String(actor.name) : '',
      previousConsumablesSyp: before.consumablesSyp,
      newConsumablesSyp: after.consumablesSyp,
      previousNetSyp: before.netSyp,
      newNetSyp: after.netSyp,
      previousCommissionSyp: before.commissionSyp,
      newCommissionSyp: after.commissionSyp,
      commissionDeltaSyp: roundMoney(after.commissionSyp - before.commissionSyp),
    })
  }
  return row
}

/** هل يُحتسب المستهلك ضمن مستهلكات الجلسة الحالية؟ (المحذوف لا يُحتسب) */
function consumableActive(c) {
  return !isRemoved(c)
}

/**
 * عرض جلسات الإجراء العام: لكل جلسة المحصّل والمستهلكات والصافي والعمولة.
 * العرض تجميعي فقط — لا يُنشئ أي خصم إضافي.
 */
export function buildGeneralTreatmentSessionsView(tr, { decimals = 0 } = {}) {
  const sessions = sortedSessions(tr)
  const bySession = new Map(
    sessions.map((s) => [
      idOf(s),
      {
        id: idOf(s),
        sessionDate: ymd(s.sessionDate),
        note: String(s.note || ''),
        autoCreated: Boolean(s.autoCreated),
        closed: sessionIsClosed(s),
        closedAt: s.closedAt ? new Date(s.closedAt).toISOString() : null,
        closedByName: String(s.closedByName || ''),
        closedAutomatically: Boolean(s.closedAutomatically),
        createdByName: String(s.createdByName || ''),
        payments: [],
        consumables: (s.consumables || []).map((c) => ({
          id: idOf(c),
          name: String(c.name || ''),
          quantity: Number(c.quantity) || 1,
          amountSyp: roundMoney(c.amountSyp),
          amountUsd: Math.max(0, Number(c.amountUsd) || 0),
          costUsdSypRate: Math.max(0, Number(c.costUsdSypRate) || 0),
          costSyp: consumableCostSyp(c),
          effectiveDate: ymd(c.effectiveDate),
          addedAfterClose: Boolean(c.addedAfterClose),
          addedAt: c.addedAt ? new Date(c.addedAt).toISOString() : null,
          addedByName: String(c.addedByName || ''),
          correctionReason: String(c.correctionReason || ''),
          removed: isRemoved(c),
          removedAt: c.removedAt ? new Date(c.removedAt).toISOString() : null,
          removedByName: String(c.removedByName || ''),
          removedReason: String(c.removedReason || ''),
          removedAfterClose: Boolean(c.removedAfterClose),
        })),
        adjustments: (s.adjustments || []).map((a) => ({
          id: idOf(a),
          action: String(a.action || ''),
          consumableName: String(a.consumableName || ''),
          amountSyp: roundMoney(a.amountSyp),
          businessDate: ymd(a.businessDate),
          reason: String(a.reason || ''),
          at: a.at ? new Date(a.at).toISOString() : null,
          byName: String(a.byName || ''),
          previousConsumablesSyp: roundMoney(a.previousConsumablesSyp),
          newConsumablesSyp: roundMoney(a.newConsumablesSyp),
          previousNetSyp: roundMoney(a.previousNetSyp),
          newNetSyp: roundMoney(a.newNetSyp),
          previousCommissionSyp: roundMoney(a.previousCommissionSyp),
          newCommissionSyp: roundMoney(a.newCommissionSyp),
          commissionDeltaSyp: roundMoney(a.commissionDeltaSyp),
        })),
        collectedSyp: 0,
        consumablesSyp: 0,
        netSyp: 0,
        commissionSyp: 0,
      },
    ]),
  )
  const unassignedPayments = []
  for (const p of tr?.payments || []) {
    const sid = resolvePaymentSessionId(tr, p)
    const row = {
      id: idOf(p),
      amountSyp: paymentAmountSyp(p),
      amountUsd: Math.max(0, Number(p?.amountUsd) || 0),
      currency: p?.currency === 'usd' ? 'usd' : 'syp',
      paidAt: ymd(p?.paidAt),
      note: String(p?.note || ''),
    }
    const target = sid ? bySession.get(sid) : null
    if (target) target.payments.push(row)
    else unassignedPayments.push(row)
  }
  for (const s of sessions) {
    const v = bySession.get(idOf(s))
    v.collectedSyp = v.payments.reduce((a, p) => a + p.amountSyp, 0)
    v.consumablesSyp = (s.consumables || []).filter(consumableActive).reduce((a, c) => a + consumableCostSyp(c), 0)
    v.netSyp = v.collectedSyp - v.consumablesSyp
    v.commissionSyp = doctorCommissionFromNet(v.netSyp, { decimals })
  }
  const list = sessions.map((s) => bySession.get(idOf(s)))
  const priceSyp = roundMoney(tr?.totalCostSyp) +
    (Number(tr?.totalCostUsd) > 0 && Number(tr?.costUsdSypRate) > 0
      ? roundMoney(Number(tr.totalCostUsd) * Number(tr.costUsdSypRate))
      : 0)
  const collectedSyp = (tr?.payments || []).reduce((a, p) => a + paymentAmountSyp(p), 0)
  const unassignedSyp = unassignedPayments.reduce((a, p) => a + p.amountSyp, 0)
  const consumablesSyp = list.reduce((a, s) => a + s.consumablesSyp, 0)
  const netSyp = collectedSyp - consumablesSyp
  return {
    rule: isCashSessionRule(tr) ? GENERAL_PROCEDURE_COMMISSION_RULE : 'legacy',
    sessions: list,
    unassignedPayments,
    totals: {
      priceSyp,
      collectedSyp,
      remainingSyp: Math.max(0, priceSyp - collectedSyp),
      consumablesSyp,
      netSyp,
      /** مجموع عمولات الجلسات كما تظهر في كل جلسة */
      sessionsCommissionSyp: list.reduce((a, s) => a + s.commissionSyp, 0),
      /** دفعات لم تُربط بجلسة: عمولتها تُحسب على المبلغ كاملاً بتاريخ الدفع */
      unassignedCommissionSyp: doctorCommissionFromNet(unassignedSyp, { decimals }),
      commissionSyp: doctorCommissionFromNet(netSyp, { decimals }),
    },
  }
}

/**
 * قيود الأثر المالي المؤرخة للإجراء العام (قاعدة الجلسات):
 *   + كل دفعة محصّلة بتاريخ تحصيلها
 *   − كل مستهلك بتاريخ جلسته (أو بتاريخ التصحيح إن أضيف بعد الإغلاق)
 *   + عكس مستهلك حُذف بعد الإغلاق بتاريخ الحذف
 * مستهلك حُذف قبل الإغلاق لا أثر له إطلاقاً.
 * مجموع القيود ÷ 3 = عمولة الطبيب، فلا خصم مكرر ولا تغيير صامت للفترات السابقة.
 */
export function generalTreatmentCommissionEntries(tr) {
  if (!isCashSessionRule(tr)) return []
  const entries = []
  for (const p of tr.payments || []) {
    const amt = paymentAmountSyp(p)
    const d = ymd(p?.paidAt)
    if (!(amt > 0) || !d) continue
    entries.push({ kind: 'payment', date: d, amountSyp: amt, sessionId: resolvePaymentSessionId(tr, p) })
  }
  for (const s of tr.sessions || []) {
    const sid = idOf(s)
    for (const c of s.consumables || []) {
      const cost = consumableCostSyp(c)
      if (!(cost > 0)) continue
      if (isRemoved(c) && !c.removedAfterClose) continue
      const d = ymd(c.effectiveDate) || ymd(s.sessionDate)
      if (!d) continue
      entries.push({
        kind: c.addedAfterClose ? 'consumable_correction' : 'consumable',
        date: d,
        amountSyp: -cost,
        sessionId: sid,
        consumableId: idOf(c),
        name: String(c.name || ''),
      })
      if (isRemoved(c) && c.removedAfterClose) {
        const rd = ymd(c.removedEffectiveDate)
        if (rd) {
          entries.push({
            kind: 'consumable_reversal',
            date: rd,
            amountSyp: cost,
            sessionId: sid,
            consumableId: idOf(c),
            name: String(c.name || ''),
          })
        }
      }
    }
  }
  return entries
}

/** مجموع القيود ضمن نطاق تاريخ: { collectedSyp, consumablesSyp, netSyp } */
export function generalTreatmentNetInRange(tr, from, to) {
  let collectedSyp = 0
  let consumablesSyp = 0
  for (const e of generalTreatmentCommissionEntries(tr)) {
    if (e.date < from || e.date > to) continue
    if (e.kind === 'payment') collectedSyp += e.amountSyp
    else consumablesSyp -= e.amountSyp
  }
  return { collectedSyp, consumablesSyp, netSyp: collectedSyp - consumablesSyp }
}

/**
 * التقرير النهائي للمريض (الإجراءات العامة): كل الجلسات بتواريخها، المحصّل والمستهلكات لكل جلسة،
 * الإجماليات، المتبقي، وعمولة كل جلسة. تجميع للعرض فقط — لا يُنشئ أي خصم.
 */
export function buildGeneralProceduresReport(chart) {
  const treatments = []
  const totals = {
    priceSyp: 0,
    collectedSyp: 0,
    remainingSyp: 0,
    consumablesSyp: 0,
    netSyp: 0,
    commissionSyp: 0,
    sessionCount: 0,
    legacyTreatmentCount: 0,
  }
  for (const tr of chart?.generalTreatments || []) {
    if (!isCashSessionRule(tr)) {
      totals.legacyTreatmentCount += 1
      continue
    }
    const view = buildGeneralTreatmentSessionsView(tr)
    treatments.push({
      id: idOf(tr),
      procedureDescription: String(tr.procedureDescription || ''),
      doctorName: String(tr.doctorName || ''),
      businessDate: ymd(tr.businessDate),
      ...view,
    })
    totals.priceSyp += view.totals.priceSyp
    totals.collectedSyp += view.totals.collectedSyp
    totals.remainingSyp += view.totals.remainingSyp
    totals.consumablesSyp += view.totals.consumablesSyp
    totals.netSyp += view.totals.netSyp
    totals.commissionSyp += view.totals.sessionsCommissionSyp + view.totals.unassignedCommissionSyp
    totals.sessionCount += view.sessions.length
  }
  return { treatments, totals }
}
