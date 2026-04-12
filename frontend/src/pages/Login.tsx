import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { ApiError, getPatientToken, patientApi, setPatientToken } from '../api/client'
import { useAuth } from '../context/AuthContext'

const prodMissingApiBase =
  import.meta.env.PROD && !(import.meta.env.VITE_API_BASE_URL ?? '').toString().trim()

export function Login() {
  const { user, loading: staffLoading, login } = useAuth()
  const nav = useNavigate()
  const [identifier, setIdentifier] = useState('elias@clinic.local')
  const [password, setPassword] = useState('admin123')
  const [err, setErr] = useState('')
  const [pending, setPending] = useState(false)
  const [patientGate, setPatientGate] = useState<'pending' | 'yes' | 'no'>(() =>
    getPatientToken() ? 'pending' : 'no',
  )

  useEffect(() => {
    if (patientGate !== 'pending') return
    let cancelled = false
    ;(async () => {
      try {
        await patientApi('/api/patient-auth/me')
        if (!cancelled) setPatientGate('yes')
      } catch {
        if (!cancelled) {
          setPatientToken(null)
          setPatientGate('no')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [patientGate])

  if (patientGate === 'pending') {
    return (
      <div
        className="app-layout"
        style={{ minHeight: '100vh', placeItems: 'center', display: 'grid', color: 'var(--text-muted)' }}
      >
        جاري التحقق من الجلسة…
      </div>
    )
  }

  if (patientGate === 'yes') {
    return <Navigate to="/patient" replace />
  }

  if (staffLoading) {
    return (
      <div
        className="app-layout"
        style={{ minHeight: '100vh', placeItems: 'center', display: 'grid', color: 'var(--text-muted)' }}
      >
        جاري التحميل…
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setPending(true)
    try {
      const result = await login(identifier.trim(), password)
      if (result.accountType === 'patient') {
        nav(result.mustChangePassword ? '/patient/security' : '/patient', { replace: true })
      } else {
        nav('/', { replace: true })
      }
    } catch (e) {
      if (e instanceof ApiError) {
        setErr(e.message || 'فشل تسجيل الدخول — تحقق من البيانات')
      } else {
        const msg = String((e as Error)?.message || '')
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          const apiBase = import.meta.env.VITE_API_BASE_URL?.trim()
          setErr(
            apiBase
              ? `تعذر الاتصال بـ API (${apiBase}). تحقق أن الباكند يعمل وأن المتصفح يسمح بالطلبات (CORS/HTTPS).`
              : 'تعذر الاتصال بالخادم. للتطوير المحلي: شغّل الباكند من مجلد backend بـ npm run dev (منفذ 5000). أو أنشئ ملف .env في مجلد الواجهة يحتوي VITE_API_BASE_URL=https://رابط-الباكند',
          )
        } else {
          setErr('فشل تسجيل الدخول — تحقق من البيانات')
        }
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      className="app-layout"
      style={{ minHeight: '100vh', placeItems: 'center', display: 'grid', padding: '2rem' }}
    >
      <div className="card" style={{ maxWidth: 420, width: '100%' }}>
        <div className="sidebar-brand" style={{ marginBottom: '1.25rem' }}>
          <div className="sidebar-brand-mark">ED</div>
          <div className="sidebar-brand-title">مركز الدكتور إلياس دحدل</div>
          <div className="sidebar-brand-sub">تسجيل الدخول — موظفون ومرضى</div>
        </div>
        {prodMissingApiBase ? (
          <p
            role="alert"
            style={{
              margin: '0 0 1rem',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              fontSize: '0.85rem',
              lineHeight: 1.55,
              background: 'rgba(220, 53, 69, 0.12)',
              border: '1px solid rgba(220, 53, 69, 0.35)',
              color: '#f8a8b2',
            }}
          >
            <strong>إعداد النشر:</strong> الواجهة بُنيت بدون عنوان الـ API. في لوحة Hostinger → Environment
            variables للتطبيق <strong>frontend</strong> أضف{' '}
            <code style={{ wordBreak: 'break-all' }}>VITE_API_BASE_URL</code> = رابط الباكند كاملاً (مثال:{' '}
            <code style={{ wordBreak: 'break-all' }}>https://your-api.hostingersite.com</code>) ثم{' '}
            <strong>أعد النشر</strong> حتى يُعاد بناء المشروع.
          </p>
        ) : null}
        <p
          style={{
            margin: '0 0 1rem',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            lineHeight: 1.55,
          }}
        >
          أدخل <strong>البريد الإلكتروني</strong> إن كنت من فريق العيادة، أو <strong>اسم المستخدم</strong> كما
          في ملفك إن كنت مريضاً — ثم كلمة المرور. يتم توجيهك تلقائياً للوحة المناسبة.
        </p>
        <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: '1rem' }}>
          <div>
            <label className="form-label" htmlFor="login-id">
              البريد أو اسم المستخدم
            </label>
            <input
              id="login-id"
              className="input"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="password">
              كلمة المرور
            </label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {err ? (
            <p style={{ margin: 0, color: 'var(--danger)', fontSize: '0.9rem' }}>{err}</p>
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'جاري الدخول…' : 'دخول'}
          </button>
        </form>
        {import.meta.env.DEV ? (
          <p
            style={{
              margin: '1rem 0 0',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              lineHeight: 1.5,
            }}
          >
            للتجربة: موظف — البريد <span dir="ltr">elias@clinic.local</span> وكلمة المرور{' '}
            <span dir="ltr">admin123</span>. مريض (بعد seed) — اسم المستخدم مثل اسم السجل (مثلاً نورا فهد) وكلمة
            المرور <span dir="ltr">client1234</span>.
          </p>
        ) : null}
      </div>
    </div>
  )
}
