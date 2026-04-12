import { useEffect, useState } from 'react'
import { patientApi } from '../../api/client'
import './patient-portal.css'

const LASER_STATUS_AR: Record<string, string> = {
  scheduled: 'مجدولة',
  in_progress: 'قيد التنفيذ',
  completed_pending_collection: 'تمت بدون تحصيل',
  completed: 'مكتمل',
}

type Clinical = {
  laserSessions: {
    id: string
    treatmentNumber: number
    createdAt: string
    laserType: string
    room: string
    status: string
    operatorName: string
    notes: string
  }[]
  dermatologyVisits: {
    id: string
    businessDate: string
    areaTreatment: string
    sessionType: string
    providerName: string
    notes: string
  }[]
  dentalPlan: { status: string; items: { label?: string; note?: string }[] } | null
}

export function PatientPortalRecords() {
  const [data, setData] = useState<Clinical | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await patientApi<Clinical>('/api/patient-portal/clinical')
        if (!cancelled) {
          setData(d)
          setErr('')
        }
      } catch {
        if (!cancelled) setErr('تعذر تحميل السجل')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (err) {
    return <div className="card"><p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p></div>
  }
  if (!data) {
    return <div style={{ color: 'var(--text-muted)' }}>جاري التحميل…</div>
  }

  return (
    <>
      <div className="patient-hero" style={{ marginBottom: '1rem' }}>
        <h1>السجل الطبي</h1>
        <p>جلسات الليزر، الزيارات الجلدية، وملخص خطة الأسنان — لقراءتك فقط.</p>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title">جلسات الليزر</h2>
        {data.laserSessions.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>لا جلسات مسجّلة.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>رقم المعالجة</th>
                  <th>التاريخ</th>
                  <th>النوع / الغرفة</th>
                  <th>الحالة</th>
                  <th>المعالج</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {data.laserSessions.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.treatmentNumber}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {new Date(s.createdAt).toLocaleString('ar-SY', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </td>
                    <td>
                      {s.laserType} — غرفة {s.room}
                    </td>
                    <td>{LASER_STATUS_AR[s.status] ?? s.status}</td>
                    <td>{s.operatorName}</td>
                    <td style={{ fontSize: '0.85rem', maxWidth: 220 }}>{s.notes?.trim() || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 className="card-title">الجلدية والتجميل</h2>
        {data.dermatologyVisits.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>لا زيارات مسجّلة.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>نوع الجلسة</th>
                  <th>المنطقة</th>
                  <th>المقدّم</th>
                  <th>ملاحظات</th>
                </tr>
              </thead>
              <tbody>
                {data.dermatologyVisits.map((v) => (
                  <tr key={v.id}>
                    <td>{v.businessDate}</td>
                    <td>{v.sessionType || '—'}</td>
                    <td>{v.areaTreatment || '—'}</td>
                    <td>{v.providerName}</td>
                    <td style={{ fontSize: '0.85rem' }}>{v.notes?.trim() || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">خطة الأسنان (ملخص)</h2>
        {!data.dentalPlan ? (
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>لا خطة أسنان مسجّلة.</p>
        ) : (
          <>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem' }}>
              الحالة:{' '}
              <strong>
                {data.dentalPlan.status === 'approved' ? 'معتمدة' : data.dentalPlan.status === 'draft' ? 'مسودة' : data.dentalPlan.status}
              </strong>
            </p>
            <ul style={{ margin: 0, paddingRight: '1.25rem', fontSize: '0.9rem' }}>
              {(data.dentalPlan.items || []).map((it, i) => (
                <li key={i} style={{ marginBottom: '0.35rem' }}>
                  {it.label || it.note || 'بند'}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </>
  )
}
