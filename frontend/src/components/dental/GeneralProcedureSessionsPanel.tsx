import { useState } from 'react'
import { api, ApiError } from '../../api/client'
import {
  roundUsd,
  type DentalChartDto,
  type DentalToothTreatment,
  type GeneralTreatmentSession,
} from './dentalChartTypes'

type Props = {
  patientId: string
  treatment: DentalToothTreatment
  canEdit: boolean
  isSuperAdmin: boolean
  /** تاريخ يوم العمل الافتراضي للجلسة الجديدة */
  defaultDate: string
  onChart: (chart: DentalChartDto) => void
}

function fmt(n: number) {
  return `${Math.round(Number(n) || 0).toLocaleString('ar-SY')} ل.س`
}

/**
 * جلسات الإجراء العام: لكل جلسة المحصّل فيها ومستهلكاتها والصافي وعمولة الطبيب (ثلث الصافي).
 * المستهلك يُضاف للجلسة المختارة فقط؛ الجلسة المغلقة لا تُعدّل إلا من مدير النظام مع سبب.
 */
export function GeneralProcedureSessionsPanel({
  patientId,
  treatment,
  canEdit,
  isSuperAdmin,
  defaultDate,
  onChart,
}: Props) {
  const view = treatment.sessionsView
  const tid = treatment.id ? String(treatment.id) : ''
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [newDate, setNewDate] = useState(defaultDate)
  /** الجلسة التي فُتح فيها نموذج إضافة مستهلك */
  const [formFor, setFormFor] = useState('')
  const [name, setName] = useState('')
  const [amountSyp, setAmountSyp] = useState(0)
  const [amountUsd, setAmountUsd] = useState(0)
  const [reason, setReason] = useState('')

  if (!view || !tid) return null
  const base = `/api/dental/chart/${encodeURIComponent(patientId)}/general/${encodeURIComponent(tid)}`

  async function call(path: string, body: Record<string, unknown>) {
    setBusy(true)
    setErr('')
    try {
      const res = await api<{ chart: DentalChartDto }>(`${base}${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (res.chart) onChart(res.chart)
      return true
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر الحفظ')
      return false
    } finally {
      setBusy(false)
    }
  }

  function openForm(s: GeneralTreatmentSession) {
    setFormFor(s.id)
    setName('')
    setAmountSyp(0)
    setAmountUsd(0)
    setReason('')
    setErr('')
  }

  async function submitConsumable(s: GeneralTreatmentSession) {
    if (!name.trim()) {
      setErr('أدخل اسم المستهلك')
      return
    }
    if (!(amountSyp > 0) && !(amountUsd > 0)) {
      setErr('أدخل تكلفة المستهلك')
      return
    }
    if (s.closed && !reason.trim()) {
      setErr('اذكر سبب تعديل مستهلكات جلسة مغلقة')
      return
    }
    const ok = await call(`/sessions/${encodeURIComponent(s.id)}/consumables`, {
      name: name.trim(),
      amountSyp,
      amountUsd,
      reason: reason.trim(),
    })
    if (ok) setFormFor('')
  }

  async function removeRow(s: GeneralTreatmentSession, consumableId: string) {
    let why = ''
    if (s.closed) {
      why = window.prompt('سبب حذف المستهلك من جلسة مغلقة (يُسجَّل في سجل التدقيق):', '') || ''
      if (!why.trim()) return
    } else if (!window.confirm('حذف هذا المستهلك من الجلسة؟ يبقى ظاهراً في السجل كمحذوف.')) {
      return
    }
    await call(`/sessions/${encodeURIComponent(s.id)}/consumables/${encodeURIComponent(consumableId)}/remove`, {
      reason: why.trim(),
    })
  }

  const t = view.totals
  return (
    <div
      style={{
        marginTop: '0.5rem',
        padding: '0.65rem',
        borderRadius: 10,
        border: '1px dashed var(--border)',
        background: 'var(--surface-2)',
        fontSize: '0.84rem',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.5rem' }}>
        <strong>الجلسات</strong>
        <span>السعر {fmt(t.priceSyp)}</span>
        <span>المحصّل {fmt(t.collectedSyp)}</span>
        <span>المتبقي {fmt(t.remainingSyp)}</span>
        <span>المستهلكات {fmt(t.consumablesSyp)}</span>
        <span>الصافي {fmt(t.netSyp)}</span>
        <span>عمولة الطبيب (⅓) {fmt(t.sessionsCommissionSyp + t.unassignedCommissionSyp)}</span>
      </div>
      <p style={{ margin: '0 0 0.5rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        عمولة كل جلسة = (المبلغ المحصّل في الجلسة − مستهلكات الجلسة) ÷ 3. لا تُحسب على السعر الكامل ولا على غير
        المحصّل.
      </p>
      {err ? <p style={{ color: 'var(--danger)', margin: '0 0 0.5rem' }}>{err}</p> : null}

      {view.sessions.length === 0 ? (
        <p style={{ margin: '0 0 0.5rem', color: 'var(--text-muted)' }}>
          لا جلسات بعد — افتح جلسة لتسجيل مستهلكاتها. التحصيل من الاستقبال يُنشئ جلسة اليوم تلقائياً.
        </p>
      ) : (
        <div className="table-wrap" style={{ marginBottom: '0.5rem' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>الجلسة</th>
                <th>المحصّل</th>
                <th>المستهلكات</th>
                <th>الصافي</th>
                <th>العمولة</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {view.sessions.map((s, idx) => {
                const canAdd = canEdit && (!s.closed || isSuperAdmin)
                return (
                  <tr key={s.id}>
                    <td>
                      <div>
                        جلسة {idx + 1} — <span dir="ltr">{s.sessionDate || '—'}</span>
                      </div>
                      {s.autoCreated ? (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>أُنشئت عند التحصيل</div>
                      ) : null}
                    </td>
                    <td>{fmt(s.collectedSyp)}</td>
                    <td>
                      {s.consumables.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>—</span> : null}
                      {s.consumables.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            textDecoration: c.removed ? 'line-through' : undefined,
                            color: c.removed ? 'var(--text-muted)' : undefined,
                          }}
                        >
                          {c.name} — {fmt(c.costSyp)}
                          {c.amountUsd > 0 ? ` (${c.amountUsd} USD)` : ''}
                          {c.addedAfterClose ? (
                            <span style={{ fontSize: '0.72rem', color: 'var(--warning)' }}>
                              {' '}
                              · تصحيح {c.effectiveDate} ({c.addedByName}){c.correctionReason ? `: ${c.correctionReason}` : ''}
                            </span>
                          ) : null}
                          {c.removed ? (
                            <span style={{ fontSize: '0.72rem' }}>
                              {' '}
                              · حُذف ({c.removedByName}){c.removedReason ? `: ${c.removedReason}` : ''}
                            </span>
                          ) : canEdit && (!s.closed || isSuperAdmin) ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.72rem', padding: '0 0.35rem' }}
                              disabled={busy}
                              onClick={() => void removeRow(s, c.id)}
                            >
                              حذف
                            </button>
                          ) : null}
                        </div>
                      ))}
                      <div style={{ fontWeight: 700 }}>{fmt(s.consumablesSyp)}</div>
                      {s.adjustments.length > 0 ? (
                        <details style={{ fontSize: '0.74rem' }}>
                          <summary>سجل التصحيحات ({s.adjustments.length})</summary>
                          {s.adjustments.map((a) => (
                            <div key={a.id} style={{ marginTop: '0.2rem' }}>
                              {a.businessDate} — {a.byName}:{' '}
                              {a.action === 'consumable_added' ? 'إضافة' : 'حذف'} «{a.consumableName}» {fmt(a.amountSyp)} ·
                              المستهلكات {fmt(a.previousConsumablesSyp)} ← {fmt(a.newConsumablesSyp)} · العمولة{' '}
                              {fmt(a.previousCommissionSyp)} ← {fmt(a.newCommissionSyp)} (فرق {fmt(a.commissionDeltaSyp)})
                              {a.reason ? ` · السبب: ${a.reason}` : ''}
                            </div>
                          ))}
                        </details>
                      ) : null}
                      {canAdd && formFor !== s.id ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}
                          disabled={busy}
                          onClick={() => openForm(s)}
                        >
                          {s.closed ? 'تعديل مستهلكات الجلسة' : '+ مستهلك'}
                        </button>
                      ) : null}
                      {formFor === s.id ? (
                        <div style={{ display: 'grid', gap: '0.35rem', marginTop: '0.35rem', minWidth: 220 }}>
                          {s.closed ? (
                            <p style={{ margin: 0, color: 'var(--warning)', fontSize: '0.75rem' }}>
                              جلسة مغلقة: يُسجَّل التعديل كتسوية بتاريخ اليوم مع اسمك والسبب، ولا تتغير أرقام الفترة
                              السابقة.
                            </p>
                          ) : null}
                          <input
                            className="input"
                            placeholder="اسم المستهلك (قفازات، خيوط…)"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            disabled={busy}
                          />
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <input
                              className="input"
                              inputMode="numeric"
                              placeholder="ل.س"
                              value={amountSyp ? String(amountSyp) : ''}
                              onChange={(e) =>
                                setAmountSyp(Math.max(0, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)))
                              }
                              disabled={busy}
                            />
                            <input
                              className="input"
                              inputMode="decimal"
                              placeholder="USD"
                              value={amountUsd ? String(amountUsd) : ''}
                              onChange={(e) =>
                                setAmountUsd(Math.max(0, roundUsd(Number(e.target.value.replace(/[^\d.]/g, '')) || 0)))
                              }
                              disabled={busy}
                            />
                          </div>
                          {s.closed ? (
                            <input
                              className="input"
                              placeholder="سبب التصحيح (إلزامي)"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              disabled={busy}
                            />
                          ) : null}
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className="btn btn-primary"
                              style={{ fontSize: '0.78rem' }}
                              disabled={busy}
                              onClick={() => void submitConsumable(s)}
                            >
                              حفظ المستهلك
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.78rem' }}
                              disabled={busy}
                              onClick={() => setFormFor('')}
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td>{fmt(s.netSyp)}</td>
                    <td>{fmt(s.commissionSyp)}</td>
                    <td>
                      {s.closed ? (
                        <span title={s.closedAt || ''}>مغلقة{s.closedByName ? ` (${s.closedByName})` : ''}</span>
                      ) : (
                        <>
                          <span style={{ color: 'var(--success)' }}>مفتوحة</span>
                          {canEdit ? (
                            <button
                              type="button"
                              className="btn btn-ghost"
                              style={{ fontSize: '0.72rem', display: 'block' }}
                              disabled={busy}
                              onClick={() => {
                                if (window.confirm('إغلاق الجلسة؟ بعدها لا تُعدّل مستهلكاتها إلا من مدير النظام.')) {
                                  void call(`/sessions/${encodeURIComponent(s.id)}/close`, {})
                                }
                              }}
                            >
                              إغلاق الجلسة
                            </button>
                          ) : null}
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {view.unassignedPayments.length > 0 ? (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          دفعات بلا جلسة بنفس اليوم: {view.unassignedPayments.map((p) => `${fmt(p.amountSyp)} (${p.paidAt})`).join('، ')} —
          عمولتها ثلث المبلغ بلا خصم مستهلكات.
        </p>
      ) : null}

      {canEdit ? (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            disabled={busy}
            style={{ maxWidth: 170 }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.8rem' }}
            disabled={busy}
            onClick={() => void call('/sessions', { sessionDate: newDate })}
          >
            + فتح جلسة جديدة
          </button>
        </div>
      ) : null}
    </div>
  )
}
