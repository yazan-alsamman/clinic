import { useState } from 'react'
import { api, ApiError } from '../api/client'

export function AccountPassword() {
  const [current, setCurrent] = useState('')
  const [nextPwd, setNextPwd] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [pending, setPending] = useState(false)

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
      await api('/api/users/me/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: current, newPassword: nextPwd }),
      })
      setOk('تم تحديث كلمة المرور بنجاح.')
      setCurrent('')
      setNextPwd('')
      setConfirm('')
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message)
      else setErr('تعذر الحفظ')
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <h1 className="page-title">كلمة المرور</h1>
      <p className="page-desc">
        غيّر كلمة مرور حسابك في أي وقت. لن يُسمح لأحد بتجاوز كلمة المرور الحالية دون معرفتها.
      </p>
      <div className="card" style={{ maxWidth: 480 }}>
        <h2 className="card-title">تغيير كلمة المرور</h2>
        <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: '0.85rem' }}>
          <div>
            <label className="form-label" htmlFor="staff-cur">
              كلمة المرور الحالية
            </label>
            <input
              id="staff-cur"
              type="password"
              className="input"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="staff-nw">
              كلمة المرور الجديدة
            </label>
            <input
              id="staff-nw"
              type="password"
              className="input"
              autoComplete="new-password"
              value={nextPwd}
              onChange={(e) => setNextPwd(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label" htmlFor="staff-cf">
              تأكيد الجديدة
            </label>
            <input
              id="staff-cf"
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
