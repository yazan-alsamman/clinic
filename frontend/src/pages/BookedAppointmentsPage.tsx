import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import {
  BOOKED_PAGE_PROCEDURE_FILTERS,
  inferProcedureCategory,
  PROCEDURE_FILTER_LABELS,
  type ProcedureCategoryFilter,
} from '../utils/procedureCategory'

type SlotRow = {
  id: string
  businessDate: string
  time: string
  endTime?: string
  providerName: string
  procedureType?: string
  patientName: string
}

function todayYmd() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const canOpenPage = (role: string | undefined) =>
  role === 'super_admin' ||
  role === 'reception' ||
  role === 'laser' ||
  role === 'dermatology' ||
  role === 'dental_branch'

function fullScheduleRoles(role: string | undefined) {
  return role === 'super_admin' || role === 'reception'
}

export function BookedAppointmentsPage() {
  const { user } = useAuth()
  const { businessDate: clinicBusinessDate } = useClinic()
  const allowed = canOpenPage(user?.role)
  const fullView = fullScheduleRoles(user?.role)

  const [viewDate, setViewDate] = useState(todayYmd)
  const [procedureFilter, setProcedureFilter] = useState<ProcedureCategoryFilter>('all')
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    setLoading(true)
    try {
      const q = fullView
        ? new URLSearchParams({ date: viewDate })
        : new URLSearchParams()
      const data = await api<{ slots: SlotRow[] }>(`/api/schedule/booked?${q.toString()}`)
      setSlots(data.slots)
    } catch (e) {
      setSlots([])
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل المواعيد')
    } finally {
      setLoading(false)
    }
  }, [allowed, fullView, viewDate, clinicBusinessDate])

  useEffect(() => {
    void load()
  }, [load])

  const sorted = useMemo(() => {
    const filtered = fullView
      ? procedureFilter === 'all'
        ? slots
        : slots.filter(
            (s) => inferProcedureCategory(s.procedureType ?? '', s.providerName) === procedureFilter,
          )
      : slots

    return [...filtered].sort((a, b) => {
      const c = a.businessDate.localeCompare(b.businessDate)
      if (c !== 0) return c
      const p = a.providerName.localeCompare(b.providerName, 'ar')
      if (p !== 0) return p
      return a.time.localeCompare(b.time, undefined, { numeric: true })
    })
  }, [slots, procedureFilter, fullView])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">المواعيد المحجوزة</h1>
        <p className="page-desc">هذه الصفحة غير متاحة لدورك الحالي.</p>
      </>
    )
  }

  return (
    <>
      <h1 className="page-title">المواعيد المحجوزة</h1>
      <p className="page-desc">
        {fullView ? (
          <>
            عرض المواعيد المحجوزة ليوم واحد تختاره (أو نطاق للمدير/الاستقبال). لحجز موعد جديد استخدم{' '}
            <Link to="/reception/appointment" style={{ color: 'var(--cyan)' }}>
              إضافة موعد
            </Link>
            .
          </>
        ) : (
          <>
            مواعيدك المحجوزة لـ <strong>يوم العمل الحالي</strong> فقط — حسب اسمك كمقدّم في النظام. يجب أن يطابق
            الاسم في الملف الشخصي حقل «المقدّم» عند الحجز. لا يمكنك عرض مواعيد باقي المقدّمين أو تغيير التاريخ من
            هنا.
          </>
        )}
      </p>

      {!fullView ? (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--border)' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            التاريخ المعروض: <strong dir="ltr">{clinicBusinessDate ?? todayYmd()}</strong>
            {' — '}
            إن لم يظهر شيء، تأكد أن اسمك في الإعدادات يطابق «المقدّم» عند الاستقبال.
          </p>
        </div>
      ) : null}

      {fullView ? (
        <div
          className="toolbar"
          style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', alignItems: 'flex-end' }}
        >
          <div>
            <label className="form-label" htmlFor="booked-day" style={{ display: 'block' }}>
              تاريخ اليوم
            </label>
            <input
              id="booked-day"
              type="date"
              className="input"
              value={viewDate}
              onChange={(e) => setViewDate(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="booked-procedure" style={{ display: 'block' }}>
              نوع الإجراء
            </label>
            <select
              id="booked-procedure"
              className="input"
              style={{ minWidth: '11rem' }}
              value={procedureFilter}
              onChange={(e) => setProcedureFilter(e.target.value as ProcedureCategoryFilter)}
            >
              {BOOKED_PAGE_PROCEDURE_FILTERS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
            تحديث
          </button>
        </div>
      ) : (
        <div style={{ marginBottom: '1rem' }}>
          <button type="button" className="btn btn-secondary" disabled={loading} onClick={() => void load()}>
            تحديث
          </button>
        </div>
      )}

      <div className="card">
        {err ? (
          <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
        ) : loading ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
        ) : slots.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>لا توجد مواعيد محجوزة في هذا اليوم.</p>
        ) : sorted.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>
            {fullView
              ? `لا توجد مواعيد تطابق فلتر «${PROCEDURE_FILTER_LABELS[procedureFilter]}» في هذا اليوم.`
              : 'لا توجد مواعيد باسمك في يوم العمل هذا.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المقدّم</th>
                  <th>نوع الإجراء</th>
                  <th>من — إلى</th>
                  <th>المريض</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.businessDate}</td>
                    <td>{s.providerName}</td>
                    <td>{s.procedureType?.trim() ? s.procedureType : '—'}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {s.time}
                      {s.endTime ? ` — ${s.endTime}` : ''}
                    </td>
                    <td>{s.patientName || '—'}</td>
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
