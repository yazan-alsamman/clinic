import { useEffect, useState } from 'react'
import { patientApi } from '../../api/client'
import type { Patient } from '../../types'
import './patient-portal.css'

const GENDER: Record<string, string> = {
  male: 'ذكر',
  female: 'أنثى',
  '': '—',
}

export function PatientPortalProfile() {
  const [patient, setPatient] = useState<Patient | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const d = await patientApi<{ patient: Patient }>('/api/patient-portal/profile')
        if (!cancelled) {
          setPatient(d.patient)
          setErr('')
        }
      } catch {
        if (!cancelled) setErr('تعذر تحميل البيانات')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (err) {
    return <div className="card"><p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p></div>
  }
  if (!patient) {
    return <div style={{ color: 'var(--text-muted)' }}>جاري التحميل…</div>
  }

  const rows: [string, string][] = [
    ['الاسم الكامل', patient.name],
    ['تاريخ الميلاد', patient.dob?.trim() || '—'],
    ['الجنس', GENDER[patient.gender || ''] ?? '—'],
    ['الهاتف', patient.phone?.trim() || '—'],
    ['الحالة الاجتماعية', patient.marital?.trim() || '—'],
    ['المهنة', patient.occupation?.trim() || '—'],
    ['سوابق مرضية', patient.medicalHistory?.trim() || '—'],
    ['سوابق جراحية', patient.surgicalHistory?.trim() || '—'],
    ['تحسس', patient.allergies?.trim() || '—'],
    ['آخر زيارة مسجّلة', patient.lastVisit?.trim() || '—'],
  ]

  return (
    <>
      <div className="patient-hero" style={{ marginBottom: '1rem' }}>
        <h1>ملفي الشخصي</h1>
        <p>البيانات المعروضة من سجل العيادة. لتحديثها يُرجى التواصل مع الاستقبال.</p>
      </div>
      <div className="card">
        <h2 className="card-title">البيانات الديموغرافية والصحية</h2>
        <div style={{ display: 'grid', gap: '0.65rem' }}>
          {rows.map(([k, v]) => (
            <div
              key={k}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(7rem, 140px) 1fr',
                gap: '0.75rem',
                fontSize: '0.9rem',
                alignItems: 'start',
              }}
            >
              <span style={{ color: 'var(--text-muted)' }}>{k}</span>
              <span style={{ lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{v}</span>
            </div>
          ))}
        </div>
        {patient.departments?.length ? (
          <div style={{ marginTop: '1rem' }}>
            <span className="form-label">أقسام مرتبطة</span>
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.35rem' }}>
              {patient.departments.includes('laser') && <span className="chip chip-laser">ليزر</span>}
              {patient.departments.includes('dermatology') && <span className="chip chip-derm">جلدية</span>}
              {patient.departments.includes('dental') && <span className="chip chip-dental">أسنان</span>}
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
