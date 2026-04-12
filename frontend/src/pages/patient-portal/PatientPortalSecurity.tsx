import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, patientApi, setPatientToken } from '../../api/client'
import './patient-portal.css'

export function PatientPortalSecurity() {
  const nav = useNavigate()
  const [current, setCurrent] = useState('')
  const [nextPwd, setNextPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [pending, setPending] = useState(false)
  const [forced, setForced] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await patientApi<{ patient: { mustChangePassword?: boolean } }>(
          '/api/patient-auth/me',
        )
        if (!cancelled) setForced(data.patient?.mustChangePassword === true)
      } catch {
        if (!cancelled) setForced(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setOk('')
    if (nextPwd.length < 8) {
      setErr('كلمة المرور الجديدة يجب ألا تقل عن ٨ أحرف')
      return
    }
    if (nextPwd !== confirm) {
      setErr('تأكيد كلمة المرور غير متطابق')
      return
    }
    setPending(true)
    try {
      const data = await patientApi<{ token: string }>('/api/patient-auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: current, newPassword: nextPwd }),
      })
      setPatientToken(data.token)
      setOk('تم تحديث كلمة المرور بنجاح.')
      setCurrent('')
      setNextPwd('')
      setConfirm('')
      setTimeout(() => nav('/patient', { replace: true }), 800)
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr('تعذر الحفظ')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      {forced ? (
        <div
          role="alert"
          style={{
            marginBottom: '1rem',
            padding: '0.9rem 1.1rem',
            borderRadius: '10px',
            background: 'rgba(220, 53, 69, 0.12)',
            border: '1px solid rgba(220, 53, 69, 0.35)',
            color: '#f8a8b2',
            fontSize: '0.92rem',
            lineHeight: 1.55,
          }}
        >
          <strong>تنبيه أمني:</strong> هذه أول مرة تدخل فيها إلى بوابتك أو تم إعادة تعيين كلمة المرور من العيادة.
          يجب اختيار كلمة مرور جديدة الآن — لن تتمكن من فتح بقية الصفحات قبل إكمال ذلك.
        </div>
      ) : null}
      <div className="patient-hero" style={{ marginBottom: '1rem' }}>
        <h1>الأمان وكلمة المرور</h1>
        <p>يُنصح بكلمة مرور قوية لا تستخدمها في مواقع أخرى.</p>
      </div>
      <div className="card" style={{ maxWidth: 480 }}>
        <h2 className="card-title">تغيير كلمة المرور</h2>
        <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: '0.85rem' }}>
          <div>
            <label className="form-label" htmlFor="cur">
              كلمة المرور الحالية
            </label>
            <input
              id="cur"
              type="password"
              className="input"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="nw">
              كلمة المرور الجديدة
            </label>
            <input
              id="nw"
              type="password"
              className="input"
              autoComplete="new-password"
              value={nextPwd}
              onChange={(e) => setNextPwd(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="cf">
              تأكيد الجديدة
            </label>
            <input
              id="cf"
              type="password"
              className="input"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {err ? <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.9rem' }}>{err}</p> : null}
          {ok ? <p style={{ margin: 0, color: 'var(--success)', fontSize: '0.9rem' }}>{ok}</p> : null}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'جاري الحفظ…' : 'حفظ كلمة المرور'}
          </button>
        </form>
      </div>
    </>
  )
}
