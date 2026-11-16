/**
 * رصيد جلسات مستقل لكل منطقة في باكج الليزر.
 *
 * - كل منطقة في الباكج لها: إجمالي الجلسات، المستهلك، المتبقي، وسجل الاستهلاك.
 * - الإنقاص يكون للمناطق المختارة فقط (جلسة واحدة لكل منطقة مُعالَجة في الزيارة).
 * - المناطق خارج الباكج لا تظهر هنا إطلاقاً — لها بند تحصيل مستقل.
 *
 * البيانات القديمة: جلسة باكج «مُثبَّتة» بالنظام القديم كانت تُنقص الباكج كاملاً (كل المناطق معاً)،
 * فتُحسب جلسة مستهلكة من كل منطقة كي لا يتغيّر الرصيد القديم. إن كانت جلسة الليزر المرتبطة تُثبت
 * المنطقة تُعرض موثّقة، وإلا تُعرض «قديمة غير محددة المناطق» دون اختراع تاريخ علاج.
 *
 * هذا الملف دوال صرفة بلا قاعدة بيانات (للاختبار).
 */
import { normalizePackageAreaLabel, splitLaserOfferAreaLabels } from './laserPackageAreaBreakdown.js'

/** @typedef {{ name: string, kind?: string }} LaserOptionMeta */
/** @typedef {{ key: string, procedureOptionId: string, label: string, sessionsTotal: number }} PackageAreaDef */

export function packageAreaKey(optionId, occurrence, part) {
  return `${String(optionId || '').trim()}:${Math.max(0, Math.trunc(occurrence) || 0)}:${Math.max(0, Math.trunc(part) || 0)}`
}

function packageSessionsTotal(pkg) {
  return Math.max(0, Math.trunc(Number(pkg?.sessionsCount) || 0))
}

/**
 * تعريف مناطق الباكج: من النسخة المحفوظة إن وُجدت، وإلا تُشتق من procedureOptionIds
 * (العرض متعدد المناطق مثل «إبطين و بكيني» = منطقتان مستقلتان).
 * @param {object} pkg
 * @param {Map<string, LaserOptionMeta>} [optionMetaById]
 * @returns {PackageAreaDef[]}
 */
export function derivePackageAreaDefinitions(pkg, optionMetaById = new Map()) {
  const saved = Array.isArray(pkg?.areaSessions) ? pkg.areaSessions : []
  if (saved.length > 0) {
    return saved.map((a) => ({
      key: String(a.key),
      procedureOptionId: String(a.procedureOptionId || ''),
      label: String(a.label || '').trim() || 'منطقة',
      sessionsTotal: Math.max(0, Math.trunc(Number(a.sessionsTotal) || 0)),
    }))
  }
  const total = packageSessionsTotal(pkg)
  const ids = (Array.isArray(pkg?.procedureOptionIds) ? pkg.procedureOptionIds : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean)
  const occurrences = new Map()
  /** @type {PackageAreaDef[]} */
  const out = []
  for (const optionId of ids) {
    const occ = occurrences.get(optionId) || 0
    occurrences.set(optionId, occ + 1)
    const meta = optionMetaById.get(optionId)
    const name = String(meta?.name || '').trim() || 'منطقة'
    const parts = String(meta?.kind || 'area') === 'offer' ? splitLaserOfferAreaLabels(name) : []
    const labels = parts.length > 0 ? parts : [name]
    labels.forEach((label, part) => {
      out.push({ key: packageAreaKey(optionId, occ, part), procedureOptionId: optionId, label, sessionsTotal: total })
    })
  }
  return out
}

/**
 * يطابق سطور الجلسة غير الإضافية مع مناطق الباكج.
 * @returns {{ keys: string[], usedLineIndexes: number[] }}
 */
export function matchTreatedPackageAreas(lineItems, areas, optionMetaById = new Map(), skipLineIndexes = new Set()) {
  const rows = Array.isArray(lineItems) ? lineItems : []
  const free = [...(Array.isArray(areas) ? areas : [])]
  const keys = []
  const usedLineIndexes = []
  const take = (pred) => {
    const idx = free.findIndex(pred)
    if (idx < 0) return false
    keys.push(free[idx].key)
    free.splice(idx, 1)
    return true
  }
  rows.forEach((row, lineIdx) => {
    if (!row || row.isAddon === true || skipLineIndexes.has(lineIdx)) return
    const oid = String(row?.procedureOptionId || '').trim()
    let hit = false
    // نفس الخيار المحفوظ في الباكج: كل أجزائه (للعرض متعدد المناطق) عولجت
    const sameOption = oid ? free.find((a) => a.procedureOptionId === oid) : null
    if (sameOption) {
      const occ = sameOption.key.split(':')[1]
      for (const a of free.filter((x) => x.procedureOptionId === oid && x.key.split(':')[1] === occ)) {
        take((x) => x.key === a.key)
      }
      hit = true
    } else {
      const meta = oid ? optionMetaById.get(oid) : null
      const labels = []
      if (meta && String(meta.kind || '') === 'offer') labels.push(...splitLaserOfferAreaLabels(meta.name))
      const own = String(row?.areaLabel || meta?.name || '').trim()
      if (own) labels.push(own)
      for (const label of labels) {
        const norm = normalizePackageAreaLabel(label)
        if (norm && take((a) => normalizePackageAreaLabel(a.label) === norm)) hit = true
      }
    }
    if (hit) usedLineIndexes.push(lineIdx)
  })
  return { keys, usedLineIndexes }
}

/** المناطق المذكورة في سطور الجلسة غير الإضافية، مطابقةً لمناطق الباكج */
export function matchTreatedPackageAreaKeys(lineItems, areas, optionMetaById = new Map()) {
  return matchTreatedPackageAreas(lineItems, areas, optionMetaById).keys
}

/**
 * توزيع مناطق الزيارة على باكجات المريض بالترتيب (الباكج المرتبط بالزيارة أولاً):
 * كل سطر يُحتسب لباكج واحد فقط، ولمنطقة فيها رصيد (أو أُنقصت مسبقاً لنفس الزيارة).
 * يمنع إنقاص المنطقة نفسها من باكجين لعلاج واحد.
 * @param {{ pkg: object, ledger: object, alreadyDeducted?: Set<string> }[]} orderedPackages
 * @returns {{ byPackageId: Map<string, Set<string>>, uncoveredLineIndexes: number[] }}
 */
export function allocateVisitTreatedAreas(orderedPackages, lineItems, optionMetaById = new Map()) {
  const used = new Set()
  const byPackageId = new Map()
  for (const { pkg, ledger, alreadyDeducted } of orderedPackages || []) {
    const done = alreadyDeducted || new Set()
    const eligible = (ledger?.areas || []).filter((a) => a.remainingSessions > 0 || done.has(a.key))
    const r = matchTreatedPackageAreas(lineItems, eligible, optionMetaById, used)
    for (const i of r.usedLineIndexes) used.add(i)
    byPackageId.set(String(pkg?._id || ''), new Set(r.keys))
  }
  const uncoveredLineIndexes = []
  ;(Array.isArray(lineItems) ? lineItems : []).forEach((row, i) => {
    if (row && row.isAddon !== true && !used.has(i)) uncoveredLineIndexes.push(i)
  })
  return { byPackageId, uncoveredLineIndexes }
}

function iso(d) {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

function isActiveDeduction(d) {
  return d && !d.reversedAt
}

/**
 * رصيد كل منطقة وسجلها.
 * @param {object} pkg
 * @param {{ optionMetaById?: Map<string, LaserOptionMeta>, laserSessionsById?: Map<string, object> }} [ctx]
 */
export function computePackageAreaLedger(pkg, ctx = {}) {
  const optionMetaById = ctx.optionMetaById || new Map()
  const laserSessionsById = ctx.laserSessionsById || new Map()
  const areas = derivePackageAreaDefinitions(pkg, optionMetaById)
  const byKey = new Map(
    areas.map((a) => [
      a.key,
      {
        ...a,
        usedSessions: 0,
        legacyUsedSessions: 0,
        legacyUnverifiedSessions: 0,
        remainingSessions: 0,
        history: [],
      },
    ]),
  )

  /** جلسات النظام القديم المُثبَّتة: جلسة من كل منطقة */
  const legacySlots = (Array.isArray(pkg?.sessions) ? pkg.sessions : []).filter((s) => s?.completedByReception === true)
  for (const slot of legacySlots) {
    const lsId = slot.linkedLaserSessionId ? String(slot.linkedLaserSessionId) : ''
    const ls = lsId ? laserSessionsById.get(lsId) : null
    const treated = new Set(ls ? matchTreatedPackageAreaKeys(ls.lineItems, areas, optionMetaById) : [])
    for (const row of byKey.values()) {
      const verified = treated.has(row.key)
      row.usedSessions += 1
      row.legacyUsedSessions += 1
      if (!verified) row.legacyUnverifiedSessions += 1
      row.history.push({
        id: `legacy:${String(slot._id || '')}`,
        source: 'legacy_session',
        legacyUnverified: !verified,
        laserSessionId: lsId || null,
        date: iso(slot.completedAt) || (ls ? iso(ls.createdAt) : null),
        label: String(slot.label || ''),
        reversed: false,
      })
    }
  }

  for (const d of Array.isArray(pkg?.areaDeductions) ? pkg.areaDeductions : []) {
    const row = byKey.get(String(d?.areaKey || ''))
    if (!row) continue
    const reversed = !isActiveDeduction(d)
    if (!reversed) row.usedSessions += 1
    row.history.push({
      id: String(d._id || ''),
      source: String(d.source || 'laser_visit'),
      legacyUnverified: false,
      laserSessionId: d.laserSessionId ? String(d.laserSessionId) : null,
      billingItemId: d.billingItemId ? String(d.billingItemId) : null,
      date: iso(d.deductedAt),
      visitDate: String(d.visitDate || ''),
      byName: String(d.deductedByName || ''),
      requestId: String(d.requestId || ''),
      note: String(d.note || ''),
      reversed,
      reversedAt: iso(d.reversedAt),
      reverseReason: String(d.reverseReason || ''),
    })
  }

  const out = [...byKey.values()].map((row) => ({
    ...row,
    remainingSessions: Math.max(0, row.sessionsTotal - row.usedSessions),
    history: row.history.sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))),
  }))

  return {
    packageId: String(pkg?._id || ''),
    title: String(pkg?.title || '').trim() || 'باكج ليزر',
    suspended: pkg?.suspended === true,
    sessionsCount: packageSessionsTotal(pkg),
    hasSavedAreas: Array.isArray(pkg?.areaSessions) && pkg.areaSessions.length > 0,
    legacyCompletedSessions: legacySlots.length,
    areas: out,
    anyRemaining: out.some((a) => a.remainingSessions > 0),
  }
}

/** زيارات الباكج: كل زيارة والمناطق التي أُنقصت فيها */
export function groupPackageVisits(ledger) {
  const byVisit = new Map()
  for (const area of ledger?.areas || []) {
    for (const h of area.history || []) {
      const key =
        h.source === 'legacy_session'
          ? h.id
          : h.laserSessionId
            ? `ls:${h.laserSessionId}`
            : h.requestId
              ? `req:${h.requestId}`
              : `${h.source}:${h.id}`
      if (!byVisit.has(key)) {
        byVisit.set(key, {
          key,
          source: h.source,
          laserSessionId: h.laserSessionId || null,
          date: h.date,
          visitDate: h.visitDate || '',
          byName: h.byName || '',
          note: h.note || '',
          areas: [],
        })
      }
      byVisit.get(key).areas.push({
        key: area.key,
        label: area.label,
        deductionId: h.source === 'legacy_session' ? null : h.id,
        reversed: h.reversed === true,
        reverseReason: h.reverseReason || '',
        legacyUnverified: h.legacyUnverified === true,
      })
    }
  }
  return [...byVisit.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
}

/** المناطق التي أُنقصت سابقاً لنفس زيارة الليزر (يشمل جلسة قديمة مثبّتة مرتبطة بها) */
export function areaKeysAlreadyDeductedForVisit(pkg, ledger, laserSessionId) {
  const lsId = String(laserSessionId || '').trim()
  const done = new Set()
  if (!lsId) return done
  for (const d of Array.isArray(pkg?.areaDeductions) ? pkg.areaDeductions : []) {
    if (isActiveDeduction(d) && d.laserSessionId && String(d.laserSessionId) === lsId) done.add(String(d.areaKey))
  }
  const legacyLinked = (Array.isArray(pkg?.sessions) ? pkg.sessions : []).some(
    (s) => s?.completedByReception === true && s.linkedLaserSessionId && String(s.linkedLaserSessionId) === lsId,
  )
  if (legacyLinked) for (const a of ledger?.areas || []) done.add(a.key)
  return done
}

export class AreaDeductionError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

/**
 * يتحقق من طلب الإنقاص ويعيد أسطر السجل الجديدة (بدون كتابة).
 * - لا إنقاص بلا منطقة مختارة، ولا لمنطقة خارج الباكج.
 * - لا إنقاص مزدوج لنفس المنطقة في نفس الزيارة، ولا بإعادة إرسال نفس الطلب.
 * - لا رصيد سالب.
 * @returns {{ duplicateRequest: boolean, rows: object[], ledger: object }}
 */
export function planPackageAreaDeduction({
  pkg,
  areaKeys,
  laserSessionId = null,
  billingItemId = null,
  requestId = '',
  visitDate = '',
  note = '',
  source = 'laser_visit',
  user = null,
  now = new Date(),
  optionMetaById = new Map(),
}) {
  if (!pkg) throw new AreaDeductionError('الباكج غير موجود', 404)
  if (String(pkg.department || 'laser') !== 'laser') throw new AreaDeductionError('إنقاص المناطق خاص بباكجات الليزر.')
  const ledger = computePackageAreaLedger(pkg, { optionMetaById })
  const title = ledger.title
  const reqId = String(requestId || '').trim().slice(0, 80)
  if (reqId) {
    const seen = (Array.isArray(pkg.areaDeductions) ? pkg.areaDeductions : []).some(
      (d) => String(d?.requestId || '') === reqId,
    )
    if (seen) return { duplicateRequest: true, rows: [], ledger }
  }
  if (pkg.suspended === true) throw new AreaDeductionError(`الباكج «${title}» موقوف مؤقتاً. فعّله قبل الإنقاص.`)
  const keys = [...new Set((Array.isArray(areaKeys) ? areaKeys : []).map((k) => String(k || '').trim()).filter(Boolean))]
  if (!keys.length) throw new AreaDeductionError(`اختر منطقة واحدة على الأقل من «${title}».`)
  const areaByKey = new Map(ledger.areas.map((a) => [a.key, a]))
  const unknown = keys.filter((k) => !areaByKey.has(k))
  if (unknown.length) throw new AreaDeductionError(`منطقة غير موجودة ضمن «${title}» — المناطق خارج الباكج لا تُنقص من رصيده.`)
  if (source === 'laser_visit' && !laserSessionId) throw new AreaDeductionError('زيارة الليزر غير محددة.')
  const already = areaKeysAlreadyDeductedForVisit(pkg, ledger, laserSessionId)
  const dup = keys.filter((k) => already.has(k))
  if (dup.length) {
    throw new AreaDeductionError(
      `تم إنقاص هذه المنطقة لهذه الزيارة مسبقاً: ${dup.map((k) => areaByKey.get(k).label).join('، ')}`,
      409,
    )
  }
  const empty = keys.filter((k) => areaByKey.get(k).remainingSessions < 1)
  if (empty.length) {
    throw new AreaDeductionError(
      `لا يوجد رصيد متبقٍ في «${title}» للمنطقة: ${empty.map((k) => areaByKey.get(k).label).join('، ')}. سجّلها كخدمة خارج الباكج.`,
    )
  }
  const rows = keys.map((k) => ({
    areaKey: k,
    areaLabel: areaByKey.get(k).label,
    source,
    laserSessionId: laserSessionId || null,
    billingItemId: billingItemId || null,
    visitDate: String(visitDate || ''),
    deductedAt: now,
    deductedByUserId: user?._id || null,
    deductedByName: String(user?.name || ''),
    requestId: reqId,
    note: String(note || '').trim().slice(0, 500),
    reversedAt: null,
  }))
  return { duplicateRequest: false, rows, ledger }
}

/** هل في الباكج رصيد لأي منطقة؟ (بدون أسماء المناطق — يكفي للحجز) */
export function packageHasRemainingAreaSessions(pkg) {
  if (Array.isArray(pkg?.areaSessions) && pkg.areaSessions.length > 0) {
    return computePackageAreaLedger(pkg).anyRemaining
  }
  const completed = (Array.isArray(pkg?.sessions) ? pkg.sessions : []).filter((s) => s?.completedByReception === true).length
  return packageSessionsTotal(pkg) - completed > 0
}

/** هل استُهلك من الباكج شيء (جلسة قديمة أو إنقاص منطقة فعّال)؟ */
export function packageHasAreaDeductions(pkg) {
  return (Array.isArray(pkg?.areaDeductions) ? pkg.areaDeductions : []).some(isActiveDeduction)
}

/**
 * مناطق باكج جديد عند البيع: عدد جلسات مختلف لكل منطقة ممكن (overrides حسب المفتاح)،
 * وما لم يُحدَّد يأخذ عدد جلسات الباكج الافتراضي.
 * @param {PackageAreaDef[]} defs
 * @param {number} defaultSessions
 * @param {Record<string, unknown>|null|undefined} overrides
 */
export function applyAreaSessionCounts(defs, defaultSessions, overrides) {
  const base = Math.max(1, Math.min(200, Math.trunc(Number(defaultSessions) || 0)))
  const map = overrides && typeof overrides === 'object' ? overrides : {}
  const known = new Set((defs || []).map((d) => d.key))
  const unknown = Object.keys(map).filter((k) => !known.has(k))
  if (unknown.length) throw new AreaDeductionError('منطقة غير موجودة في الباكج المختار — حدّث الصفحة وأعد المحاولة.')
  return (defs || []).map((d) => {
    const raw = map[d.key]
    if (raw === undefined || raw === null || raw === '') return { ...d, sessionsTotal: base }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      throw new AreaDeductionError(`عدد جلسات منطقة «${d.label}» يجب أن يكون رقماً صحيحاً بين 1 و 200.`)
    }
    return { ...d, sessionsTotal: n }
  })
}
