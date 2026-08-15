import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

type ProcedureRow = {
  id: string
  fdi: number
  isGeneral?: boolean
  businessDate: string
  procedureDescription: string
  doctorName: string
  noShare: boolean
  totalCostSyp: number
  totalCostUsd: number
  paidSyp: number
  remainingSyp: number
  billingStatus: string | null
}

type PatientRow = {
  patientId: string
  patientName: string
  fileNumber: string
  phone: string
  procedureCount: number
  totalCostSyp: number
  paidSyp: number
  remainingSyp: number
  procedures: ProcedureRow[]
}

type Payload = {
  patients: PatientRow[]
  totals: {
    patientCount: number
    procedureCount: number
    totalCostSyp: number
    paidSyp: number
    remainingSyp: number
  }
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(Math.round(n || 0))} ل.س`
}

function isMongoId(id: string) {
  return /^[a-f0-9]{24}$/i.test(String(id || '').trim())
}

export function AdminDentalPatientsPage() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin' || user?.role === 'dental_assistant'
  const showFinancialSummary = user?.role === 'super_admin'
  const canDelete = user?.role === 'super_admin'

  const [q, setQ] = useState('')
  const [qDraft, setQDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [okMsg, setOkMsg] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    setErr('')
    try {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
      const res = await api<Payload>(`/api/dental/admin/patients${qs}`)
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل مرضى الأسنان')
    } finally {
      setLoading(false)
    }
  }, [allowed, q])

  useEffect(() => {
    void load()
  }, [load])

  async function deleteProcedure(patient: PatientRow, proc: ProcedureRow) {
    if (!canDelete || !isMongoId(proc.id)) return
    const toothLabel = proc.isGeneral ? 'إجراء عام' : `السن ${proc.fdi || '—'}`
    const ok = window.confirm(
      `حذف هذا الإجراء نهائياً؟\n\n${patient.patientName} — ${toothLabel}\n${proc.procedureDescription || 'إجراء'}\nالتكلفة: ${fmtSyp(proc.totalCostSyp)}\n\nسيُحذف التحصيل من الجرد اليومي واللوحة المالية، وتُزال علامته من مخطط الأسنان.`,
    )
    if (!ok) return
    setDeletingId(proc.id)
    setErr('')
    setOkMsg('')
    try {
      await api(
        `/api/dental/admin/patients/${encodeURIComponent(patient.patientId)}/treatments/${encodeURIComponent(proc.id)}`,
        { method: 'DELETE' },
      )
      setOkMsg('تم حذف الإجراء وسجلاته المالية.')
      await load()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حذف الإجراء')
    } finally {
      setDeletingId(null)
    }
  }

  const patients = data?.patients || []
  const totals = data?.totals
  const procedureColSpan = canDelete ? 7 : 6

  const flatRows = useMemo(() => {
    const out: Array<{ patient: PatientRow; procedure: ProcedureRow | null; isFirst: boolean }> = []
    for (const p of patients) {
      const open = expanded[p.patientId] !== false
      if (!open || p.procedures.length === 0) {
        out.push({ patient: p, procedure: null, isFirst: true })
        continue
      }
      p.procedures.forEach((proc, idx) => {
        out.push({ patient: p, procedure: proc, isFirst: idx === 0 })
      })
    }
    return out
  }, [patients, expanded])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">مرضى الأسنان</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام ومساعدي الأسنان.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">مرضى الأسنان</h1>
      <p className="page-desc">
        {showFinancialSummary
          ? 'حساب كل مريض أسنان: الإجمالي، المسدّد، المتبقي، وجميع الإجراءات مع الطبيب المعالج. يمكن لمدير النظام حذف أي إجراء مع سجلاته المالية وعلامته على مخطط الأسنان.'
          : 'قائمة مرضى الأسنان وإجراءاتهم مع الطبيب المعالج.'}
      </p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px' }}>
            <label className="form-label">بحث (اسم / إضبارة / هاتف)</label>
            <input
              className="input"
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQ(qDraft.trim())
              }}
              placeholder="ابحث…"
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setQ(qDraft.trim())}>
            بحث
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setQDraft('')
              setQ('')
            }}
          >
            مسح
          </button>
          <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load()}>
            {loading ? 'جاري التحديث…' : 'تحديث'}
          </button>
        </div>
      </div>

      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}
      {okMsg ? <p style={{ color: 'var(--success)' }}>{okMsg}</p> : null}

      {showFinancialSummary && totals ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.65rem',
            marginBottom: '1rem',
          }}
        >
          <div className="stat-card">
            <div className="lbl">المرضى</div>
            <div className="val">{totals.patientCount}</div>
          </div>
          <div className="stat-card">
            <div className="lbl">الإجراءات</div>
            <div className="val">{totals.procedureCount}</div>
          </div>
          <div className="stat-card">
            <div className="lbl">الإجمالي</div>
            <div className="val" style={{ fontSize: '0.95rem' }}>
              {fmtSyp(totals.totalCostSyp)}
            </div>
          </div>
          <div className="stat-card">
            <div className="lbl">المسدّد</div>
            <div className="val" style={{ fontSize: '0.95rem' }}>
              {fmtSyp(totals.paidSyp)}
            </div>
          </div>
          <div className="stat-card">
            <div className="lbl">المتبقي</div>
            <div className="val" style={{ fontSize: '0.95rem' }}>
              {fmtSyp(totals.remainingSyp)}
            </div>
          </div>
        </div>
      ) : null}

      <div className="card">
        {loading && !data ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
        ) : patients.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا مرضى أسنان للعرض.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>المريض</th>
                  <th>حسابه الكامل</th>
                  <th>المسدّد</th>
                  <th>المتبقي</th>
                  <th>السن</th>
                  <th>التاريخ</th>
                  <th>الإجراء</th>
                  <th>الطبيب المعالج</th>
                  <th>تكلفة الإجراء</th>
                  <th>مسدد / متبقي</th>
                  {canDelete ? <th>حذف</th> : null}
                </tr>
              </thead>
              <tbody>
                {flatRows.map(({ patient: p, procedure: proc, isFirst }) => (
                  <tr key={proc ? `${p.patientId}-${proc.id}` : p.patientId}>
                    {isFirst ? (
                      <td rowSpan={Math.max(1, expanded[p.patientId] === false ? 1 : p.procedures.length || 1)}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <Link to={`/patients/${p.patientId}?tab=dental`}>{p.patientName}</Link>
                          {p.fileNumber ? (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              إضبارة {p.fileNumber}
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontSize: '0.72rem', alignSelf: 'flex-start', padding: '0.15rem 0.35rem' }}
                            onClick={() =>
                              setExpanded((prev) => ({
                                ...prev,
                                [p.patientId]: prev[p.patientId] === false,
                              }))
                            }
                          >
                            {expanded[p.patientId] === false
                              ? `عرض الإجراءات (${p.procedureCount})`
                              : 'طي الإجراءات'}
                          </button>
                        </div>
                      </td>
                    ) : null}
                    {isFirst ? (
                      <td
                        rowSpan={Math.max(1, expanded[p.patientId] === false ? 1 : p.procedures.length || 1)}
                        dir="ltr"
                      >
                        <strong>{fmtSyp(p.totalCostSyp)}</strong>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {p.procedureCount} إجراء
                        </div>
                      </td>
                    ) : null}
                    {isFirst ? (
                      <td
                        rowSpan={Math.max(1, expanded[p.patientId] === false ? 1 : p.procedures.length || 1)}
                        dir="ltr"
                      >
                        {fmtSyp(p.paidSyp)}
                      </td>
                    ) : null}
                    {isFirst ? (
                      <td
                        rowSpan={Math.max(1, expanded[p.patientId] === false ? 1 : p.procedures.length || 1)}
                        dir="ltr"
                        style={{ color: p.remainingSyp > 0 ? 'var(--warning)' : undefined, fontWeight: 700 }}
                      >
                        {fmtSyp(p.remainingSyp)}
                      </td>
                    ) : null}
                    {proc && expanded[p.patientId] !== false ? (
                      <>
                        <td dir="ltr">{proc.isGeneral ? 'عام' : proc.fdi || '—'}</td>
                        <td dir="ltr">{proc.businessDate}</td>
                        <td>{proc.procedureDescription}</td>
                        <td>
                          {proc.doctorName}
                          {proc.noShare ? (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>بدون نسبة</div>
                          ) : null}
                        </td>
                        <td dir="ltr">
                          {fmtSyp(proc.totalCostSyp)}
                          {proc.totalCostUsd > 0 ? (
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {proc.totalCostUsd} USD
                            </div>
                          ) : null}
                        </td>
                        <td dir="ltr">
                          <div>{fmtSyp(proc.paidSyp)}</div>
                          <div
                            style={{
                              fontSize: '0.78rem',
                              color: proc.remainingSyp > 0 ? 'var(--warning)' : 'var(--success)',
                            }}
                          >
                            متبقي {fmtSyp(proc.remainingSyp)}
                          </div>
                        </td>
                        {canDelete ? (
                          <td>
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem' }}
                              disabled={deletingId === proc.id || !isMongoId(proc.id)}
                              onClick={() => void deleteProcedure(p, proc)}
                            >
                              {deletingId === proc.id ? 'جاري الحذف…' : 'حذف'}
                            </button>
                          </td>
                        ) : null}
                      </>
                    ) : isFirst && (expanded[p.patientId] === false || p.procedures.length === 0) ? (
                      <>
                        <td colSpan={procedureColSpan} style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {p.procedures.length === 0 ? 'لا إجراءات مسجّلة.' : 'الإجراءات مطوية — اضغط للعرض.'}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
