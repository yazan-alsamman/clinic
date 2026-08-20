import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'

type LabWorkRow = {
  id: string
  patientId: string
  patientName: string
  fileNumber: string
  phone: string
  fdi: number
  isGeneral?: boolean
  labName: string
  procedureDescription: string
  amountSyp: number
  amountUsd: number
  usdSypRate: number
  effectiveSyp: number
  businessDate: string
  doctorName: string
}

type LabPaymentRow = {
  id: string
  amountSyp: number
  amountUsd: number
  usdSypRate: number
  effectiveSyp: number
  businessDate: string
  note: string
  createdByName: string
  createdAt: string | null
}

type LabAccount = {
  id: string
  name: string
  notes: string
  active: boolean
  sortOrder: number
  workCount: number
  totalSyp: number
  paidSyp: number
  remainingSyp: number
  works: LabWorkRow[]
  payments: LabPaymentRow[]
  orphan: boolean
}

type Payload = {
  labs: LabAccount[]
  totals: {
    labCount: number
    workCount: number
    totalSyp: number
    paidSyp: number
    remainingSyp: number
  }
}

function fmtSyp(n: number) {
  return `${new Intl.NumberFormat('ar-SY', { maximumFractionDigits: 0 }).format(Math.round(n || 0))} ل.س`
}

function todayIsoDate() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function AdminDentalLabsPage() {
  const { user } = useAuth()
  const { usdSypRate } = useClinic()
  const allowed = user?.role === 'super_admin' || user?.role === 'dental_branch'

  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [data, setData] = useState<Payload | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [newName, setNewName] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [saving, setSaving] = useState('')
  const [payDraft, setPayDraft] = useState<
    Record<string, { amountSyp: string; amountUsd: string; businessDate: string; note: string }>
  >({})

  const load = useCallback(async () => {
    if (!allowed) return
    setLoading(true)
    setErr('')
    try {
      const res = await api<Payload>('/api/dental/labs/accounts')
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل حسابات المخابر')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  const labs = data?.labs || []
  const totals = data?.totals

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">المخابر</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام وأطباء الأسنان.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">المخابر</h1>
      <p className="page-desc">
        أضف أسماء المخابر هنا. عند تسجيل عمل مخبر على سن المريض يُحسب تلقائياً على حساب المخبر المحدد —
        مع إجمالي الأعمال، المسدّد، والمتبقي.
      </p>

      {err ? <p style={{ color: 'var(--danger)' }}>{err}</p> : null}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>إضافة مخبر</h3>
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label className="form-label">اسم المخبر</label>
            <input
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="مثال: مخبر النور"
            />
          </div>
          <div style={{ flex: '2 1 260px' }}>
            <label className="form-label">ملاحظات (اختياري)</label>
            <input className="input" value={newNotes} onChange={(e) => setNewNotes(e.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving === 'new' || !newName.trim()}
            onClick={async () => {
              setSaving('new')
              setErr('')
              try {
                await api('/api/dental/labs', {
                  method: 'POST',
                  body: JSON.stringify({ name: newName.trim(), notes: newNotes.trim() }),
                })
                setNewName('')
                setNewNotes('')
                await load()
              } catch (e) {
                setErr(e instanceof ApiError ? e.message : 'فشل إضافة المخبر')
              } finally {
                setSaving('')
              }
            }}
          >
            {saving === 'new' ? 'جاري الحفظ…' : 'إضافة مخبر'}
          </button>
          <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => void load()}>
            {loading ? 'جاري التحديث…' : 'تحديث'}
          </button>
        </div>
      </div>

      {totals ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.65rem',
            marginBottom: '1rem',
          }}
        >
          <div className="stat-card">
            <div className="lbl">المخابر</div>
            <div className="val">{totals.labCount}</div>
          </div>
          <div className="stat-card">
            <div className="lbl">أعمال المسجّلة</div>
            <div className="val">{totals.workCount}</div>
          </div>
          <div className="stat-card">
            <div className="lbl">إجمالي الحسابات</div>
            <div className="val" style={{ fontSize: '0.95rem' }}>
              {fmtSyp(totals.totalSyp)}
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
        ) : labs.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا مخابر بعد — أضف مخبراً أعلاه.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.85rem' }}>
            {labs.map((lab) => {
              const open = expanded[lab.id] === true
              const draft = payDraft[lab.id] || {
                amountSyp: '',
                amountUsd: '',
                businessDate: todayIsoDate(),
                note: '',
              }
              return (
                <div
                  key={lab.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    padding: '0.85rem 1rem',
                    background: lab.orphan ? 'var(--warning-dim)' : 'var(--surface-1)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.75rem 1.25rem',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: '1.05rem' }}>{lab.name}</strong>
                        {lab.orphan ? (
                          <span style={{ fontSize: '0.78rem', color: 'var(--amber)' }}>غير مسجّل</span>
                        ) : !lab.active ? (
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>موقوف</span>
                        ) : null}
                      </div>
                      {lab.notes ? (
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                          {lab.notes}
                        </p>
                      ) : null}
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, minmax(90px, auto))',
                        gap: '0.65rem 1rem',
                        fontSize: '0.88rem',
                      }}
                    >
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>الأعمال</div>
                        <div>{lab.workCount}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>الحساب</div>
                        <div dir="ltr">{fmtSyp(lab.totalSyp)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>المسدّد</div>
                        <div dir="ltr">{fmtSyp(lab.paidSyp)}</div>
                      </div>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>المتبقي</div>
                        <div dir="ltr" style={{ fontWeight: 700, color: lab.remainingSyp > 0 ? 'var(--amber)' : undefined }}>
                          {fmtSyp(lab.remainingSyp)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.82rem' }}
                        onClick={() => setExpanded((prev) => ({ ...prev, [lab.id]: !open }))}
                      >
                        {open ? 'إخفاء التفاصيل' : 'تفاصيل الحساب'}
                      </button>
                      {!lab.orphan ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ fontSize: '0.82rem' }}
                          disabled={saving === `toggle-${lab.id}`}
                          onClick={async () => {
                            setSaving(`toggle-${lab.id}`)
                            setErr('')
                            try {
                              await api(`/api/dental/labs/${lab.id}`, {
                                method: 'PATCH',
                                body: JSON.stringify({ active: !lab.active }),
                              })
                              await load()
                            } catch (e) {
                              setErr(e instanceof ApiError ? e.message : 'فشل التحديث')
                            } finally {
                              setSaving('')
                            }
                          }}
                        >
                          {lab.active ? 'إيقاف' : 'تفعيل'}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {open ? (
                    <div style={{ marginTop: '1rem', display: 'grid', gap: '1rem' }}>
                      <div>
                        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.92rem' }}>أعمال المخبر على المرضى</h4>
                        {lab.works.length === 0 ? (
                          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                            لا أعمال مسجّلة بعد.
                          </p>
                        ) : (
                          <div className="table-wrap">
                            <table className="data-table" style={{ minWidth: 720 }}>
                              <thead>
                                <tr>
                                  <th>التاريخ</th>
                                  <th>المريض</th>
                                  <th>السن</th>
                                  <th>الإجراء</th>
                                  <th>الطبيب</th>
                                  <th>المبلغ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {lab.works.map((w) => (
                                  <tr key={w.id}>
                                    <td dir="ltr">{w.businessDate || '—'}</td>
                                    <td>
                                      <Link to={`/patients/${w.patientId}?tab=dental`}>{w.patientName}</Link>
                                      {w.fileNumber ? (
                                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                          إضبارة {w.fileNumber}
                                        </span>
                                      ) : null}
                                    </td>
                                    <td>{w.isGeneral ? 'عام' : w.fdi || '—'}</td>
                                    <td>{w.procedureDescription || '—'}</td>
                                    <td>{w.doctorName || '—'}</td>
                                    <td dir="ltr">{fmtSyp(w.effectiveSyp)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {!lab.orphan ? (
                        <div>
                          <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.92rem' }}>الدفعات للمخبر</h4>
                          {lab.payments.length === 0 ? (
                            <p style={{ margin: '0 0 0.65rem', color: 'var(--text-muted)', fontSize: '0.86rem' }}>
                              لا دفعات مسجّلة.
                            </p>
                          ) : (
                            <div className="table-wrap" style={{ marginBottom: '0.75rem' }}>
                              <table className="data-table" style={{ minWidth: 560 }}>
                                <thead>
                                  <tr>
                                    <th>التاريخ</th>
                                    <th>المبلغ</th>
                                    <th>ملاحظة</th>
                                    <th>بواسطة</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {lab.payments.map((p) => (
                                    <tr key={p.id}>
                                      <td dir="ltr">{p.businessDate || '—'}</td>
                                      <td dir="ltr">{fmtSyp(p.effectiveSyp)}</td>
                                      <td>{p.note || '—'}</td>
                                      <td>{p.createdByName || '—'}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="btn btn-ghost"
                                          style={{ fontSize: '0.75rem' }}
                                          disabled={saving === `delpay-${p.id}`}
                                          onClick={async () => {
                                            if (!window.confirm('حذف هذه الدفعة؟')) return
                                            setSaving(`delpay-${p.id}`)
                                            setErr('')
                                            try {
                                              await api(`/api/dental/labs/${lab.id}/payments/${p.id}`, {
                                                method: 'DELETE',
                                              })
                                              await load()
                                            } catch (e) {
                                              setErr(e instanceof ApiError ? e.message : 'فشل الحذف')
                                            } finally {
                                              setSaving('')
                                            }
                                          }}
                                        >
                                          حذف
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '0.5rem',
                              alignItems: 'flex-end',
                              padding: '0.75rem',
                              borderRadius: 10,
                              border: '1px dashed var(--border)',
                              background: 'var(--bg)',
                            }}
                          >
                            <div>
                              <label className="form-label">مبلغ (ل.س)</label>
                              <input
                                className="input"
                                dir="ltr"
                                inputMode="numeric"
                                style={{ width: 120 }}
                                value={draft.amountSyp}
                                onChange={(e) =>
                                  setPayDraft((prev) => ({
                                    ...prev,
                                    [lab.id]: { ...draft, amountSyp: e.target.value },
                                  }))
                                }
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label className="form-label">مبلغ (USD)</label>
                              <input
                                className="input"
                                dir="ltr"
                                inputMode="decimal"
                                style={{ width: 100 }}
                                value={draft.amountUsd}
                                onChange={(e) =>
                                  setPayDraft((prev) => ({
                                    ...prev,
                                    [lab.id]: { ...draft, amountUsd: e.target.value },
                                  }))
                                }
                                placeholder="0"
                              />
                            </div>
                            <div>
                              <label className="form-label">التاريخ</label>
                              <input
                                className="input"
                                type="date"
                                dir="ltr"
                                value={draft.businessDate}
                                onChange={(e) =>
                                  setPayDraft((prev) => ({
                                    ...prev,
                                    [lab.id]: { ...draft, businessDate: e.target.value },
                                  }))
                                }
                              />
                            </div>
                            <div style={{ flex: '1 1 160px' }}>
                              <label className="form-label">ملاحظة</label>
                              <input
                                className="input"
                                value={draft.note}
                                onChange={(e) =>
                                  setPayDraft((prev) => ({
                                    ...prev,
                                    [lab.id]: { ...draft, note: e.target.value },
                                  }))
                                }
                              />
                            </div>
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={saving === `pay-${lab.id}`}
                              onClick={async () => {
                                setSaving(`pay-${lab.id}`)
                                setErr('')
                                try {
                                  await api(`/api/dental/labs/${lab.id}/payments`, {
                                    method: 'POST',
                                    body: JSON.stringify({
                                      amountSyp: Number(String(draft.amountSyp).replace(/[^\d]/g, '')) || 0,
                                      amountUsd: Number(String(draft.amountUsd).replace(/[^\d.]/g, '')) || 0,
                                      usdSypRate: usdSypRate || 0,
                                      businessDate: draft.businessDate,
                                      note: draft.note,
                                    }),
                                  })
                                  setPayDraft((prev) => ({
                                    ...prev,
                                    [lab.id]: {
                                      amountSyp: '',
                                      amountUsd: '',
                                      businessDate: todayIsoDate(),
                                      note: '',
                                    },
                                  }))
                                  await load()
                                } catch (e) {
                                  setErr(e instanceof ApiError ? e.message : 'فشل تسجيل الدفعة')
                                } finally {
                                  setSaving('')
                                }
                              }}
                            >
                              {saving === `pay-${lab.id}` ? 'جاري…' : 'تسجيل دفعة'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
