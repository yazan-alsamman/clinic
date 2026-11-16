import { useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'

export type LaserVisitDeductionArea = {
  key: string
  label: string
  sessionsTotal: number
  usedSessions: number
  remainingSessions: number
  treatedInVisit: boolean
  alreadyDeductedForVisit: boolean
}

export type LaserVisitDeductionPreview = {
  laserSessionId: string
  packages: { packageId: string; title: string; areas: LaserVisitDeductionArea[] }[]
  pendingAreaCount: number
  allDeducted: boolean
  uncoveredAreaLabels?: string[]
  addonServices?: {
    lines: { label: string; priceSyp: number }[]
    bills: { billingItemId: string; label: string; amountDueSyp: number; status: string }[]
  }
}

function newRequestId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

function money(n: number) {
  return `${Math.round(Number(n) || 0).toLocaleString('ar-SY')} ل.س`
}

const selKey = (packageId: string, areaKey: string) => `${packageId}|${areaKey}`

/** تُحدَّد مسبقاً المناطق المعالجة في الزيارة والتي لها رصيد ولم تُنقص بعد */
function preselect(p: LaserVisitDeductionPreview) {
  const out = new Set<string>()
  for (const pkg of p.packages)
    for (const a of pkg.areas)
      if (a.treatedInVisit && !a.alreadyDeductedForVisit && a.remainingSessions > 0) out.add(selKey(pkg.packageId, a.key))
  return out
}

/**
 * إنقاص جلسات مناطق الباكج لزيارة ليزر: تُعرض المناطق ورصيدها قبل التأكيد،
 * وتُحدَّد مسبقاً المناطق المعالجة فقط. جلسة واحدة لكل منطقة مختارة.
 * الخدمات خارج الباكج تُعرض للعلم فقط — لها بند تحصيل مستقل ولا تمس الرصيد.
 */
export function LaserAreaDeductionModal({
  patientId,
  patientName,
  laserSessionId,
  preview: initialPreview,
  onClose,
  onBusy,
  onDone,
}: {
  patientId: string
  patientName?: string
  laserSessionId: string
  preview: LaserVisitDeductionPreview
  onClose: () => void
  onBusy?: (busy: boolean) => void
  onDone: () => void | Promise<void>
}) {
  const [preview, setPreview] = useState<LaserVisitDeductionPreview>(initialPreview)
  const [selected, setSelected] = useState<Set<string>>(() => preselect(initialPreview))
  const [requestId] = useState(newRequestId)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  /** أحدث رصيد من الخادم عند الفتح (قد تكون القائمة قديمة) */
  useEffect(() => {
    let alive = true
    api<LaserVisitDeductionPreview>(
      `/api/patients/${encodeURIComponent(patientId)}/laser-visits/${encodeURIComponent(laserSessionId)}/area-deduction-preview`,
    )
      .then((fresh) => {
        if (!alive) return
        setPreview(fresh)
        setSelected(preselect(fresh))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [patientId, laserSessionId])

  const chosen = useMemo(
    () =>
      preview.packages.flatMap((p) =>
        p.areas.filter((a) => selected.has(selKey(p.packageId, a.key))).map((a) => ({ pkg: p, area: a })),
      ),
    [preview, selected],
  )

  function toggle(packageId: string, areaKey: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      const k = selKey(packageId, areaKey)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  async function confirm() {
    if (!chosen.length) {
      setErr('اختر منطقة واحدة على الأقل.')
      return
    }
    setErr('')
    setBusy(true)
    onBusy?.(true)
    try {
      const byPkg = new Map<string, string[]>()
      for (const c of chosen) byPkg.set(c.pkg.packageId, [...(byPkg.get(c.pkg.packageId) || []), c.area.key])
      await api(
        `/api/patients/${encodeURIComponent(patientId)}/laser-visits/${encodeURIComponent(laserSessionId)}/deduct-areas`,
        {
          method: 'POST',
          body: JSON.stringify({
            requestId,
            selections: [...byPkg.entries()].map(([packageId, areaKeys]) => ({ packageId, areaKeys })),
          }),
        },
      )
      await onDone()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر إنقاص جلسات المناطق')
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  const addons = preview.addonServices

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>إنقاص جلسات مناطق الباكج</h3>
        {patientName ? <p style={{ color: 'var(--text-muted)', marginTop: '-0.2rem' }}>{patientName}</p> : null}
        <p style={{ fontSize: '0.86rem', lineHeight: 1.6 }}>
          تُنقص <strong>جلسة واحدة</strong> من كل منطقة مختارة فقط. المناطق غير المعالجة في هذه الزيارة لا تُنقص.
        </p>
        {preview.packages.length === 0 ? (
          <p style={{ color: 'var(--warning)' }}>لا يوجد باكج ليزر فعّال مرتبط بهذه الزيارة.</p>
        ) : null}
        {preview.packages.map((pkg) => (
          <div key={pkg.packageId} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.55rem 0.65rem', marginBottom: '0.6rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{pkg.title}</div>
            <div style={{ display: 'grid', gap: '0.3rem' }}>
              {pkg.areas.map((a) => {
                const k = selKey(pkg.packageId, a.key)
                const checked = selected.has(k)
                const disabled = busy || a.alreadyDeductedForVisit || !a.treatedInVisit || a.remainingSessions < 1
                return (
                  <label key={a.key} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem', opacity: disabled && !a.alreadyDeductedForVisit ? 0.65 : 1 }}>
                    <input type="checkbox" checked={checked || a.alreadyDeductedForVisit} disabled={disabled} onChange={() => toggle(pkg.packageId, a.key)} />
                    <span style={{ minWidth: 70, fontWeight: 600 }}>{a.label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {a.alreadyDeductedForVisit
                        ? 'أُنقصت لهذه الزيارة مسبقاً'
                        : checked
                          ? `المتبقي ${a.remainingSessions} ← ${a.remainingSessions - 1} من ${a.sessionsTotal}`
                          : !a.treatedInVisit
                            ? `لم تُعالَج في هذه الزيارة — يبقى ${a.remainingSessions} من ${a.sessionsTotal}`
                            : a.remainingSessions < 1
                              ? 'لا رصيد متبقٍ'
                              : `يبقى ${a.remainingSessions} من ${a.sessionsTotal}`}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
        {(preview.uncoveredAreaLabels?.length ?? 0) > 0 ? (
          <p style={{ color: 'var(--danger)', fontSize: '0.84rem' }}>
            مسجّل كمنطقة باكج بلا رصيد: {preview.uncoveredAreaLabels!.join('، ')} — لا يُنقص؛ عدّل الجلسة لتسجيلها خارج الباكج.
          </p>
        ) : null}
        {addons && (addons.lines.length > 0 || addons.bills.length > 0) ? (
          <div style={{ background: 'var(--surface-2, var(--surface))', borderRadius: 8, padding: '0.5rem 0.65rem', fontSize: '0.84rem', marginBottom: '0.6rem' }}>
            <strong>خدمات خارج الباكج في هذه الزيارة</strong> (لا تُنقص من الباكج — تُحصّل في بند مستقل):
            <ul style={{ margin: '0.3rem 0 0', paddingInlineStart: '1.1rem' }}>
              {addons.lines.map((l, i) => (
                <li key={i}>
                  {l.label} — {money(l.priceSyp)}
                </li>
              ))}
            </ul>
            {addons.bills.map((b) => (
              <div key={b.billingItemId} style={{ color: 'var(--text-muted)' }}>
                بند الإضافات: {money(b.amountDueSyp)} — {b.status === 'paid' ? 'مدفوع' : 'بانتظار التحصيل'}
              </div>
            ))}
          </div>
        ) : null}
        {chosen.length > 0 ? (
          <p style={{ fontSize: '0.86rem' }}>
            سيتم إنقاص: <strong>{chosen.map((c) => c.area.label).join('، ')}</strong>
          </p>
        ) : null}
        {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || chosen.length === 0} onClick={() => void confirm()}>
            {busy ? 'جاري الإنقاص…' : `تأكيد إنقاص ${chosen.length} منطقة`}
          </button>
        </div>
      </div>
    </div>
  )
}
