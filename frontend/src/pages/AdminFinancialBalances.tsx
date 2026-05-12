import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'

type DeptFilter = '' | 'laser' | 'dermatology' | 'dental'

type FinLine = {
  patientId: string
  fileNumber: string
  name: string
  paymentEntryId: string
  billingItemId: string
  clinicalSessionId: string
  department: string | null
  businessDate: string
  procedureLabel: string
  amountSyp: number
  synthetic?: boolean
  /** من الخادم: billing | package | synthetic */
  source?: 'billing' | 'package' | 'synthetic'
  patientPackageId?: string
}

type PatientWipeHit = {
  id: string
  fileNumber: string
  name: string
  outstandingDebtSyp?: number
  prepaidCreditSyp?: number
}

type PackageDetailPayload = {
  package: {
    id: string
    department: string
    title: string
    sessionsCount: number
    packageTotalSyp: number
    paidAmountSyp: number
    settlementDeltaSyp: number
    notes: string
    createdAt: string | null
    sessions: Array<{
      id: string
      label: string
      completedByReception: boolean
      completedAt: string | null
      completedByUserId: string | null
      linkedLaserSessionId: string | null
      linkedBillingItemId: string | null
    }>
  }
}

type DetailTarget =
  | { kind: 'billing'; patientId: string; billingItemId: string }
  | { kind: 'package'; patientId: string; packageId: string }

type DetailPayload =
  | { kind: 'billing'; data: BillingDetailPayload }
  | { kind: 'package'; data: PackageDetailPayload }

type BillingDetailPayload = {
  billingItem: {
    id: string
    department: string
    procedureLabel: string
    amountDueSyp: number
    businessDate: string
    status: string
    paidAt: string | null
  }
  clinicalSession: {
    id: string
    procedureDescription: string
    sessionFeeSyp: number
    businessDate: string
    notes: string
    materialCostSypTotal: number
    materialChargeSypTotal: number
    materials: Array<{
      name?: string
      sku?: string
      quantity?: number
      lineChargeSyp?: number
      lineCostSyp?: number
    }>
    providerName: string
    isPackageSession: boolean
  } | null
  laserSession: {
    id: string
    laserType: string
    pw: string
    pulse: string
    shotCount: string
    notes: string
    areaIds: string[]
    manualAreaLabels: string[]
    room: string
    sessionTypeLabel: string
    discountPercent: number
    costSyp: number
    status: string
    operatorName: string
    treatmentNumber: number
  } | null
}

function MoneySyp({ amountSyp, tone }: { amountSyp: number; tone: 'debt' | 'credit' | 'neutral' }) {
  const n = Math.round(Number(amountSyp) || 0)
  const color = tone === 'debt' ? 'var(--danger)' : tone === 'credit' ? 'var(--success)' : 'var(--text)'
  return (
    <strong style={{ color, fontVariantNumeric: 'tabular-nums' }}>{n.toLocaleString('ar-SY')} ل.س</strong>
  )
}

function deptLabel(d: string | null | undefined) {
  if (!d) return '—'
  const m: Record<string, string> = {
    laser: 'الليزر',
    dermatology: 'الجلدية',
    dental: 'الأسنان',
    solarium: 'سولاريوم',
  }
  return m[d] ?? d
}

function rowKey(prefix: string, r: FinLine, idx: number) {
  const src = r.source || 'billing'
  const pkg = r.patientPackageId || ''
  return `${prefix}-${r.patientId}-${src}-${r.billingItemId || ''}-${pkg}-${r.paymentEntryId || 'p'}-${idx}`
}

export function AdminFinancialBalances() {
  const { user } = useAuth()
  const allowed = user?.role === 'super_admin'
  const [debtDept, setDebtDept] = useState<DeptFilter>('')
  const [creditDept, setCreditDept] = useState<DeptFilter>('')
  const [debtLines, setDebtLines] = useState<FinLine[]>([])
  const [creditLines, setCreditLines] = useState<FinLine[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailErr, setDetailErr] = useState('')
  const [detailPayload, setDetailPayload] = useState<DetailPayload | null>(null)

  const [wipeFileNumber, setWipeFileNumber] = useState('')
  const [wipePatient, setWipePatient] = useState<PatientWipeHit | null>(null)
  const [wipeErr, setWipeErr] = useState('')
  const [wipeOk, setWipeOk] = useState('')
  const [wipeSearchBusy, setWipeSearchBusy] = useState(false)
  const [wipeActionBusy, setWipeActionBusy] = useState(false)

  const load = useCallback(async () => {
    if (!allowed) return
    setErr('')
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (debtDept) qs.set('debtDepartment', debtDept)
      if (creditDept) qs.set('creditDepartment', creditDept)
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      const data = await api<{
        debtLines: FinLine[]
        creditLines: FinLine[]
      }>(`/api/patients/financial-balances${suffix}`)
      setDebtLines(Array.isArray(data.debtLines) ? data.debtLines : [])
      setCreditLines(Array.isArray(data.creditLines) ? data.creditLines : [])
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر التحميل')
      setDebtLines([])
      setCreditLines([])
    } finally {
      setLoading(false)
    }
  }, [allowed, debtDept, creditDept])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!detailTarget) return
    let cancelled = false
    setDetailErr('')
    setDetailLoading(true)
    setDetailPayload(null)
    ;(async () => {
      try {
        if (detailTarget.kind === 'billing') {
          const d = await api<BillingDetailPayload>(
            `/api/patients/${encodeURIComponent(detailTarget.patientId)}/financial-billing-detail/${encodeURIComponent(detailTarget.billingItemId)}`,
          )
          if (!cancelled) setDetailPayload({ kind: 'billing', data: d })
        } else {
          const d = await api<PackageDetailPayload>(
            `/api/patients/${encodeURIComponent(detailTarget.patientId)}/financial-package-detail/${encodeURIComponent(detailTarget.packageId)}`,
          )
          if (!cancelled) setDetailPayload({ kind: 'package', data: d })
        }
      } catch (e) {
        if (!cancelled) setDetailErr(e instanceof ApiError ? e.message : 'تعذر تحميل التفاصيل')
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [detailTarget])

  const debtTotal = useMemo(
    () => debtLines.reduce((s, r) => s + (Number(r.amountSyp) || 0), 0),
    [debtLines],
  )
  const creditTotal = useMemo(
    () => creditLines.reduce((s, r) => s + (Number(r.amountSyp) || 0), 0),
    [creditLines],
  )

  const filterSelect = (value: DeptFilter, onChange: (v: DeptFilter) => void) => (
    <select
      className="input"
      style={{ minWidth: '11rem', fontSize: '0.9rem' }}
      value={value}
      onChange={(e) => onChange(e.target.value as DeptFilter)}
    >
      <option value="">كل الأقسام</option>
      <option value="laser">الليزر</option>
      <option value="dental">الأسنان</option>
      <option value="dermatology">الجلدية</option>
    </select>
  )

  const openBillingDetail = (patientId: string, billingItemId: string) => {
    setDetailTarget({ kind: 'billing', patientId, billingItemId })
  }

  const openPackageDetail = (patientId: string, packageId: string) => {
    setDetailTarget({ kind: 'package', patientId, packageId })
  }

  const closeDetail = () => {
    setDetailTarget(null)
    setDetailPayload(null)
    setDetailErr('')
  }

  async function searchPatientForWipe() {
    const raw = wipeFileNumber.trim()
    setWipeErr('')
    setWipeOk('')
    setWipePatient(null)
    if (!raw) {
      setWipeErr('أدخل رقم الإضبارة.')
      return
    }
    setWipeSearchBusy(true)
    try {
      const data = await api<{ patients: PatientWipeHit[] }>(
        `/api/patients?q=${encodeURIComponent(raw)}&pageSize=30`,
      )
      const list = Array.isArray(data.patients) ? data.patients : []
      const exact = list.filter((x) => String(x.fileNumber || '').trim() === raw)
      if (exact.length === 1) {
        setWipePatient(exact[0])
        return
      }
      if (exact.length > 1) {
        setWipeErr('تعارض: أكثر من ملف بنفس رقم الإضبارة — راجع البيانات.')
        return
      }
      if (list.length === 1) {
        setWipePatient(list[0])
        setWipeErr('تنبيه: لم يُعثر على تطابق تام لرقم الإضبارة — عُرض أقرب نتيجة واحدة.')
        return
      }
      setWipeErr('لم يُعثر على مريض بهذا الرقم.')
    } catch (e) {
      setWipeErr(e instanceof ApiError ? e.message : 'تعذر البحث')
    } finally {
      setWipeSearchBusy(false)
    }
  }

  async function clearStoredBalance(kind: 'debt' | 'credit') {
    if (!wipePatient) return
    const debt = Math.round(Number(wipePatient.outstandingDebtSyp) || 0)
    const credit = Math.round(Number(wipePatient.prepaidCreditSyp) || 0)
    const label =
      kind === 'debt'
        ? `مسح الذمة المخزّنة على المريض (${debt.toLocaleString('ar-SY')} ل.س)؟ لا يُعدّل بنود الفوترة في النظام.`
        : `مسح الرصيد الإضافي المخزّن (${credit.toLocaleString('ar-SY')} ل.س)؟`
    if (!window.confirm(label)) return
    setWipeActionBusy(true)
    setWipeErr('')
    setWipeOk('')
    try {
      const d = await api<{ summary: { outstandingDebtSyp: number; prepaidCreditSyp: number } }>(
        `/api/patients/${encodeURIComponent(wipePatient.id)}/financial-clear-balance`,
        { method: 'POST', body: JSON.stringify({ kind }) },
      )
      setWipePatient((prev) =>
        prev
          ? {
              ...prev,
              outstandingDebtSyp: Number(d.summary?.outstandingDebtSyp) || 0,
              prepaidCreditSyp: Number(d.summary?.prepaidCreditSyp) || 0,
            }
          : prev,
      )
      setWipeOk(kind === 'debt' ? 'تم مسح الذمة المخزّنة.' : 'تم مسح الرصيد الإضافي المخزّن.')
      void load()
    } catch (e) {
      setWipeErr(e instanceof ApiError ? e.message : 'تعذر التنفيذ')
    } finally {
      setWipeActionBusy(false)
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">ذمم مالية</h1>
        <p className="page-desc">هذه الصفحة لمدير النظام فقط.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">ذمم مالية</h1>
      <p className="page-desc">
        كل سطر يمثل ذمة أو رصيداً إضافياً من التحصيل أو من باكج ليزر. اضغط «التفاصيل» لعرض الجلسة/البند أو تفاصيل
        الباكج. يمكن لمدير النظام فقط تصفية الذمة أو الرصيد الإضافي <strong>المخزّن على ملف المريض</strong> من القسم
        أدناه (لا يُلغى بنود الفوترة غير المطابقة).
      </p>

      <section className="card" style={{ marginTop: '1rem', borderColor: 'var(--border)' }}>
        <h2 className="card-title" style={{ marginTop: 0 }}>
          تصفية ذمة أو رصيد إضافي (مخزّن على المريض)
        </h2>
        <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 0 }}>
          أدخل رقم الإضبارة ثم «بحث». يُصفّر الحقل المعني على سجل المريض فقط ويُسجَّل في سجل التدقيق. أسطر الجدول
          المرتبطة ببنود تحصيل لا تُحذف تلقائياً.
        </p>
        <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">رقم الإضبارة</label>
            <input
              className="input"
              dir="ltr"
              style={{ minWidth: '10rem' }}
              value={wipeFileNumber}
              onChange={(e) => setWipeFileNumber(e.target.value)}
              placeholder="مثال: 1024"
            />
          </div>
          <button type="button" className="btn btn-secondary" disabled={wipeSearchBusy} onClick={() => void searchPatientForWipe()}>
            {wipeSearchBusy ? 'جاري البحث…' : 'بحث'}
          </button>
        </div>
        {wipeErr ? <p style={{ color: 'var(--danger)', marginTop: '0.65rem' }}>{wipeErr}</p> : null}
        {wipeOk ? <p style={{ color: 'var(--success)', marginTop: '0.65rem' }}>{wipeOk}</p> : null}
        {wipePatient ? (
          <div style={{ marginTop: '1rem', padding: '0.85rem', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>{wipePatient.name}</div>
            <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '0.65rem' }}>
              الإضبارة: <span dir="ltr">{wipePatient.fileNumber || '—'}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div>
                <span className="form-label">ذمة مخزّنة</span>
                <div style={{ fontWeight: 700, color: 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}>
                  {(Math.round(Number(wipePatient.outstandingDebtSyp) || 0)).toLocaleString('ar-SY')} ل.س
                </div>
              </div>
              <div>
                <span className="form-label">رصيد إضافي مخزّن</span>
                <div style={{ fontWeight: 700, color: 'var(--success)', fontVariantNumeric: 'tabular-nums' }}>
                  {(Math.round(Number(wipePatient.prepaidCreditSyp) || 0)).toLocaleString('ar-SY')} ل.س
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                disabled={wipeActionBusy || (Math.round(Number(wipePatient.outstandingDebtSyp) || 0) <= 0)}
                onClick={() => void clearStoredBalance('debt')}
              >
                مسح الذمة المخزّنة
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={wipeActionBusy || (Math.round(Number(wipePatient.prepaidCreditSyp) || 0) <= 0)}
                onClick={() => void clearStoredBalance('credit')}
              >
                مسح الرصيد الإضافي المخزّن
              </button>
              <Link className="btn btn-primary" to={`/patients/${wipePatient.id}`}>
                فتح ملف المريض
              </Link>
            </div>
          </div>
        ) : null}
      </section>

      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.75rem' }}>
        <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
          تحديث
        </button>
        {err ? (
          <span style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{err}</span>
        ) : null}
      </div>

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <h2 className="card-title" style={{ margin: 0 }}>
            الذمم المالية
          </h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>تصفية قسم المصدر</span>
            {filterSelect(debtDept, setDebtDept)}
          </label>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
          <div style={{ marginBottom: '0.25rem', fontWeight: 600 }}>إجمالي الظاهر</div>
          <MoneySyp amountSyp={debtTotal} tone="neutral" />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الإضبارة</th>
                <th>الاسم</th>
                <th>البيان</th>
                <th>مصدر الذمة</th>
                <th>المبلغ (ل.س)</th>
                <th>الملف</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>جاري التحميل…</td>
                </tr>
              ) : debtLines.length === 0 ? (
                <tr>
                  <td colSpan={6}>لا توجد ذمم ضمن التصفية الحالية.</td>
                </tr>
              ) : (
                debtLines.map((r, idx) => {
                  const canBilling =
                    (r.source === 'billing' || (!r.source && !!r.billingItemId)) &&
                    !!r.billingItemId &&
                    !r.synthetic
                  const canPackage = r.source === 'package' && !!r.patientPackageId
                  return (
                    <tr key={rowKey('d', r, idx)}>
                      <td>{r.fileNumber || '—'}</td>
                      <td>{r.name || '—'}</td>
                      <td style={{ fontSize: '0.88rem', maxWidth: '14rem' }}>
                        {r.procedureLabel || '—'}
                        {r.businessDate ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.businessDate}</div>
                        ) : null}
                      </td>
                      <td>
                        {canPackage ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontWeight: 600, padding: '0.15rem 0.4rem' }}
                            onClick={() => openPackageDetail(r.patientId, r.patientPackageId!)}
                          >
                            باكج {deptLabel(r.department)} — التفاصيل
                          </button>
                        ) : canBilling ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontWeight: 600, padding: '0.15rem 0.4rem' }}
                            onClick={() => openBillingDetail(r.patientId, r.billingItemId)}
                          >
                            {deptLabel(r.department)} — التفاصيل
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>{deptLabel(r.department)}</span>
                        )}
                      </td>
                      <td>
                        <MoneySyp amountSyp={r.amountSyp} tone="debt" />
                      </td>
                      <td>
                        <Link to={`/patients/${r.patientId}`} style={{ fontSize: '0.88rem' }}>
                          فتح الملف
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: '1.25rem' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.75rem',
            marginBottom: '0.75rem',
          }}
        >
          <h2 className="card-title" style={{ margin: 0 }}>
            الرصيد الإضافي
          </h2>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>تصفية قسم المصدر</span>
            {filterSelect(creditDept, setCreditDept)}
          </label>
        </div>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>
          <div style={{ marginBottom: '0.25rem', fontWeight: 600 }}>إجمالي الظاهر</div>
          <MoneySyp amountSyp={creditTotal} tone="neutral" />
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الإضبارة</th>
                <th>الاسم</th>
                <th>البيان</th>
                <th>مصدر الرصيد</th>
                <th>المبلغ (ل.س)</th>
                <th>الملف</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>جاري التحميل…</td>
                </tr>
              ) : creditLines.length === 0 ? (
                <tr>
                  <td colSpan={6}>لا يوجد رصيد إضافي ضمن التصفية الحالية.</td>
                </tr>
              ) : (
                creditLines.map((r, idx) => {
                  const canBilling =
                    (r.source === 'billing' || (!r.source && !!r.billingItemId)) &&
                    !!r.billingItemId &&
                    !r.synthetic
                  const canPackage = r.source === 'package' && !!r.patientPackageId
                  return (
                    <tr key={rowKey('c', r, idx)}>
                      <td>{r.fileNumber || '—'}</td>
                      <td>{r.name || '—'}</td>
                      <td style={{ fontSize: '0.88rem', maxWidth: '14rem' }}>
                        {r.procedureLabel || '—'}
                        {r.businessDate ? (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{r.businessDate}</div>
                        ) : null}
                      </td>
                      <td>
                        {canPackage ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontWeight: 600, padding: '0.15rem 0.4rem' }}
                            onClick={() => openPackageDetail(r.patientId, r.patientPackageId!)}
                          >
                            باكج {deptLabel(r.department)} — التفاصيل
                          </button>
                        ) : canBilling ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            style={{ fontWeight: 600, padding: '0.15rem 0.4rem' }}
                            onClick={() => openBillingDetail(r.patientId, r.billingItemId)}
                          >
                            {deptLabel(r.department)} — التفاصيل
                          </button>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>{deptLabel(r.department)}</span>
                        )}
                      </td>
                      <td>
                        <MoneySyp amountSyp={r.amountSyp} tone="credit" />
                      </td>
                      <td>
                        <Link to={`/patients/${r.patientId}`} style={{ fontSize: '0.88rem' }}>
                          فتح الملف
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {detailTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" onClick={closeDetail}>
          <div
            className="modal"
            style={{ maxWidth: '32rem', maxHeight: '90vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>
              {detailTarget.kind === 'package' ? 'تفاصيل الباكج' : 'تفاصيل الجلسة والتحصيل'}
            </h3>
            {detailLoading ? <p>جاري التحميل…</p> : null}
            {detailErr ? <p style={{ color: 'var(--danger)' }}>{detailErr}</p> : null}
            {detailPayload && !detailLoading && detailPayload.kind === 'billing' ? (
              <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {(() => {
                  const detailData = detailPayload.data
                  return (
                    <>
                      <section>
                        <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>بند التحصيل</h4>
                        <ul style={{ margin: 0, paddingRight: '1.1rem', color: 'var(--text-muted)' }}>
                          <li>القسم: {deptLabel(detailData.billingItem.department)}</li>
                          <li>البيان: {detailData.billingItem.procedureLabel || '—'}</li>
                          <li>
                            المستحق على البند:{' '}
                            {Math.round(Number(detailData.billingItem.amountDueSyp) || 0).toLocaleString('ar-SY')} ل.س
                          </li>
                          <li>تاريخ العمل: {detailData.billingItem.businessDate || '—'}</li>
                          <li>الحالة: {detailData.billingItem.status}</li>
                        </ul>
                      </section>
                      {detailData.clinicalSession ? (
                        <section>
                          <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>الجلسة السريرية</h4>
                          <ul style={{ margin: 0, paddingRight: '1.1rem', color: 'var(--text-muted)' }}>
                            <li>الوصف: {detailData.clinicalSession.procedureDescription || '—'}</li>
                            <li>
                              أجرة الجلسة:{' '}
                              {Math.round(Number(detailData.clinicalSession.sessionFeeSyp) || 0).toLocaleString('ar-SY')}{' '}
                              ل.س
                            </li>
                            <li>المعالج: {detailData.clinicalSession.providerName || '—'}</li>
                            <li>التاريخ: {detailData.clinicalSession.businessDate || '—'}</li>
                            {detailData.clinicalSession.isPackageSession ? <li>جلسة ضمن باكج</li> : null}
                            {detailData.clinicalSession.notes ? (
                              <li>
                                ملاحظات:{' '}
                                <span style={{ whiteSpace: 'pre-wrap' }}>{detailData.clinicalSession.notes}</span>
                              </li>
                            ) : null}
                            <li>
                              مواد: تكلفة{' '}
                              {Math.round(Number(detailData.clinicalSession.materialCostSypTotal) || 0).toLocaleString(
                                'ar-SY',
                              )}{' '}
                              ل.س — محسوبة على المريض{' '}
                              {Math.round(Number(detailData.clinicalSession.materialChargeSypTotal) || 0).toLocaleString(
                                'ar-SY',
                              )}{' '}
                              ل.س
                            </li>
                          </ul>
                          {detailData.clinicalSession.materials?.length ? (
                            <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
                              <table className="data-table" style={{ fontSize: '0.82rem' }}>
                                <thead>
                                  <tr>
                                    <th>المادة</th>
                                    <th>الكمية</th>
                                    <th>التحصيل</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detailData.clinicalSession.materials.map((mat, mi) => (
                                    <tr key={mi}>
                                      <td>{mat.name || mat.sku || '—'}</td>
                                      <td>{mat.quantity ?? '—'}</td>
                                      <td>
                                        {Math.round(Number(mat.lineChargeSyp || 0) || 0).toLocaleString('ar-SY')} ل.س
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                        </section>
                      ) : (
                        <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد جلسة سريرية مرتبطة بهذا البند.</p>
                      )}
                      {detailData.laserSession ? (
                        <section>
                          <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>جلسة الليزر</h4>
                          <ul style={{ margin: 0, paddingRight: '1.1rem', color: 'var(--text-muted)' }}>
                            <li>رقم العلاج: {detailData.laserSession.treatmentNumber}</li>
                            <li>نوع الليزر: {detailData.laserSession.laserType}</li>
                            <li>الغرفة: {detailData.laserSession.room || '—'}</li>
                            <li>
                              التشغيل: PW {detailData.laserSession.pw || '—'} — Pulse {detailData.laserSession.pulse || '—'}
                            </li>
                            <li>الطلقات: {detailData.laserSession.shotCount || '—'}</li>
                            <li>المشغّل: {detailData.laserSession.operatorName || '—'}</li>
                            <li>المناطق (معرّفات): {(detailData.laserSession.areaIds || []).join('، ') || '—'}</li>
                            <li>مناطق يدوية: {(detailData.laserSession.manualAreaLabels || []).join('، ') || '—'}</li>
                            <li>نوع الجلسة: {detailData.laserSession.sessionTypeLabel || '—'}</li>
                            <li>
                              حسم: {detailData.laserSession.discountPercent}% — كلفة الجلسة{' '}
                              {Math.round(Number(detailData.laserSession.costSyp) || 0).toLocaleString('ar-SY')} ل.س
                            </li>
                            <li>حالة الجلسة: {detailData.laserSession.status}</li>
                            {detailData.laserSession.notes ? (
                              <li>
                                ملاحظات:{' '}
                                <span style={{ whiteSpace: 'pre-wrap' }}>{detailData.laserSession.notes}</span>
                              </li>
                            ) : null}
                          </ul>
                        </section>
                      ) : null}
                    </>
                  )
                })()}
              </div>
            ) : null}
            {detailPayload && !detailLoading && detailPayload.kind === 'package' ? (
              <div style={{ fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {(() => {
                  const pkg = detailPayload.data.package
                  const delta = Number(pkg.settlementDeltaSyp) || 0
                  return (
                    <>
                      <section>
                        <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>الباكج</h4>
                        <ul style={{ margin: 0, paddingRight: '1.1rem', color: 'var(--text-muted)' }}>
                          <li>العنوان: {pkg.title || '—'}</li>
                          <li>القسم: {deptLabel(pkg.department)}</li>
                          <li>عدد الجلسات: {pkg.sessionsCount}</li>
                          <li>
                            إجمالي الباكج: {Math.round(Number(pkg.packageTotalSyp) || 0).toLocaleString('ar-SY')} ل.س
                          </li>
                          <li>
                            المدفوع عند الشراء: {Math.round(Number(pkg.paidAmountSyp) || 0).toLocaleString('ar-SY')} ل.س
                          </li>
                          <li>
                            الفرق عند الإنشاء: {Math.round(delta).toLocaleString('ar-SY')} ل.س
                            {delta < -0.0001 ? ' (ذمة على المريض)' : delta > 0.0001 ? ' (رصيد إضافي)' : ''}
                          </li>
                          {pkg.createdAt ? <li>تاريخ الإنشاء: {pkg.createdAt.slice(0, 10)}</li> : null}
                          {pkg.notes ? (
                            <li>
                              ملاحظات: <span style={{ whiteSpace: 'pre-wrap' }}>{pkg.notes}</span>
                            </li>
                          ) : null}
                        </ul>
                      </section>
                      <section>
                        <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>الجلسات ضمن الباكج</h4>
                        <div className="table-wrap">
                          <table className="data-table" style={{ fontSize: '0.82rem' }}>
                            <thead>
                              <tr>
                                <th>الجلسة</th>
                                <th>الإتمام</th>
                                <th>ربط تحصيل</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pkg.sessions.length === 0 ? (
                                <tr>
                                  <td colSpan={3}>لا جلسات</td>
                                </tr>
                              ) : (
                                pkg.sessions.map((s) => (
                                  <tr key={s.id}>
                                    <td>{s.label || '—'}</td>
                                    <td>{s.completedByReception ? 'مكتمل' : 'معلّق'}</td>
                                    <td style={{ fontSize: '0.78rem', wordBreak: 'break-all' }}>
                                      {s.linkedBillingItemId || '—'}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    </>
                  )
                })()}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-secondary" onClick={closeDetail}>
                إغلاق
              </button>
              <Link className="btn btn-primary" to={`/patients/${detailTarget.patientId}`} onClick={closeDetail}>
                ملف المريض
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
