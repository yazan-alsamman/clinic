import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import { api, ApiError } from '../api/client'
import type { Role } from '../types'

export function ReceptionSolariumPage() {
  const { user } = useAuth()
  const { dayActive, businessDate } = useClinic()
  const role = user?.role as Role | undefined
  const allowed = role === 'reception' || role === 'super_admin'
  const assignBlocked = role === 'reception' && !dayActive

  const [displayName, setDisplayName] = useState('')
  const [sessionMinutes, setSessionMinutes] = useState<6 | 12>(6)
  const [price6, setPrice6] = useState(0)
  const [price12, setPrice12] = useState(0)
  const [edit6, setEdit6] = useState('')
  const [edit12, setEdit12] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingPrices, setSavingPrices] = useState(false)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')

  const loadSettings = useCallback(async () => {
    if (!allowed) return
    setErr('')
    try {
      setLoading(true)
      const d = await api<{ price6MinSyp: number; price12MinSyp: number }>('/api/solarium/settings')
      setPrice6(d.price6MinSyp)
      setPrice12(d.price12MinSyp)
      setEdit6(String(d.price6MinSyp))
      setEdit12(String(d.price12MinSyp))
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الإعدادات')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  async function savePrices() {
    if (role !== 'super_admin') return
    setSavingPrices(true)
    setErr('')
    setOk('')
    try {
      const p6 = Math.max(0, Math.round(Number(String(edit6).replace(/[^\d]/g, '')) || 0))
      const p12 = Math.max(0, Math.round(Number(String(edit12).replace(/[^\d]/g, '')) || 0))
      const d = await api<{ price6MinSyp: number; price12MinSyp: number }>('/api/solarium/settings', {
        method: 'PUT',
        body: JSON.stringify({ price6MinSyp: p6, price12MinSyp: p12 }),
      })
      setPrice6(d.price6MinSyp)
      setPrice12(d.price12MinSyp)
      setEdit6(String(d.price6MinSyp))
      setEdit12(String(d.price12MinSyp))
      setOk('تم حفظ أسعار السولاريوم.')
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر حفظ الأسعار')
    } finally {
      setSavingPrices(false)
    }
  }

  async function confirmSession() {
    const name = displayName.trim()
    if (name.length < 1) {
      setErr('أدخل اسم المريض')
      return
    }
    setSaving(true)
    setErr('')
    setOk('')
    try {
      const body: { displayName: string; sessionMinutes: number; businessDate?: string } = {
        displayName: name,
        sessionMinutes,
      }
      const bd = businessDate?.trim()
      if (bd) body.businessDate = bd
      await api('/api/solarium/sessions/confirm', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setOk('تم تسجيل الجلسة والتحصيل النقدي — يظهر المبلغ في الجرد المالي اليومي.')
      setDisplayName('')
      void loadSettings()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذر التأكيد')
    } finally {
      setSaving(false)
    }
  }

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">سولاريوم</h1>
        <p className="page-desc">هذه الصفحة متاحة لقسم السكرتاريا ومدير النظام فقط.</p>
      </>
    )
  }

  const currentPrice = sessionMinutes === 12 ? price12 : price6
  const confirmBlocked = saving || (role === 'reception' && assignBlocked)

  return (
    <>
      <h1 className="page-title">سولاريوم</h1>
      <p className="page-desc">
        حقل الاسم للعرض في السجل فقط — غير مرتبط ببحث المرضى أو ملفاتهم. عند التأكيد يُحصّل المبلغ نقداً باسم
        المستخدم الذي يؤكد، ويُدمج مع الجرد المالي اليومي.
      </p>

      {assignBlocked ? (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }}>
          <p style={{ margin: 0, color: 'var(--amber)' }}>يوم العمل غير مفعّل — لا يمكن تسجيل جلسة من الاستقبال.</p>
        </div>
      ) : null}

      {role === 'super_admin' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>
            أسعار الجلسات (ل.س)
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 0 }}>
            يحددها مدير النظام؛ تُستخدم تلقائياً عند تأكيد الجلسة من السكرتاريا.
          </p>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <label className="form-label">6 دقائق</label>
              <input className="input" dir="ltr" value={edit6} onChange={(e) => setEdit6(e.target.value)} />
            </div>
            <div>
              <label className="form-label">12 دقيقة</label>
              <input className="input" dir="ltr" value={edit12} onChange={(e) => setEdit12(e.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" disabled={savingPrices} onClick={() => void savePrices()}>
              {savingPrices ? 'جاري الحفظ…' : 'حفظ الأسعار'}
            </button>
          </div>
        </div>
      ) : null}

      <div className="card">
        <h2 className="card-title" style={{ marginTop: 0 }}>
          تسجيل جلسة
        </h2>
        {loading ? (
          <p style={{ color: 'var(--text-muted)' }}>جاري التحميل…</p>
        ) : (
          <>
            <label className="form-label">اسم المريض (كتابة حرّة)</label>
            <input
              className="input"
              style={{ maxWidth: 420 }}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="مثال: فاطمة أحمد"
            />
            <label className="form-label" style={{ marginTop: '0.85rem' }}>
              نوع الجلسة
            </label>
            <select
              className="select"
              style={{ maxWidth: 360 }}
              value={sessionMinutes}
              onChange={(e) => setSessionMinutes(Number(e.target.value) === 12 ? 12 : 6)}
            >
              <option value={6}>6 دقائق — {price6.toLocaleString('ar-SY')} ل.س</option>
              <option value={12}>12 دقيقة — {price12.toLocaleString('ar-SY')} ل.س</option>
            </select>
            <p style={{ fontSize: '0.86rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              المستحق للتحصيل: <strong>{currentPrice.toLocaleString('ar-SY')} ل.س</strong>
            </p>
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              disabled={confirmBlocked}
              onClick={() => void confirmSession()}
            >
              {saving ? 'جاري التأكيد…' : 'تأكيد الجلسة والتحصيل'}
            </button>
          </>
        )}
      </div>

      {err ? <p style={{ color: 'var(--danger)', marginTop: '1rem' }}>{err}</p> : null}
      {ok ? <p style={{ color: 'var(--success)', marginTop: '1rem' }}>{ok}</p> : null}
    </>
  )
}
