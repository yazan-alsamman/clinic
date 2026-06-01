import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import { api, ApiError } from '../api/client'
import {
  PaymentChannelFields,
  usePaymentBankOptions,
  validatePaymentChannelBeforeSubmit,
  type PaymentChannel,
} from '../components/PaymentChannelFields'
import type { Role } from '../types'

type SolariumRegisterRow = {
  id: string
  businessDate: string
  createdAt: string | null
  kind: 'walk_in' | 'package' | 'other'
  procedureDescription: string
  patientName: string
  fileNumber: string
  amountSyp: number
  billingStatus: string
  receivedByName: string
  receivedAt: string | null
}

function kindLabelAr(kind: SolariumRegisterRow['kind']) {
  if (kind === 'walk_in') return 'جلسة زائر (6/12 د)'
  if (kind === 'package') return 'باكج مسبق الدفع'
  return 'أخرى'
}

function formatDt(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleString('ar-SY', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

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
  const registerInit = useRef(false)
  const [registerDate, setRegisterDate] = useState('')
  const [registerRows, setRegisterRows] = useState<SolariumRegisterRow[]>([])
  const [registerLoading, setRegisterLoading] = useState(false)
  const [registerErr, setRegisterErr] = useState('')
  const [payChannel, setPayChannel] = useState<PaymentChannel>('cash')
  const [payBankName, setPayBankName] = useState('')
  const { banks: paymentBanks, loading: paymentBanksLoading } = usePaymentBankOptions(allowed)

  const loadRegister = useCallback(async () => {
    if (role !== 'super_admin' || !registerDate.trim()) return
    setRegisterErr('')
    setRegisterLoading(true)
    try {
      const q = new URLSearchParams({ businessDate: registerDate.trim() })
      const d = await api<{ businessDate: string; rows: SolariumRegisterRow[] }>(
        `/api/solarium/daily-register?${q.toString()}`,
      )
      setRegisterRows(Array.isArray(d.rows) ? d.rows : [])
    } catch (e) {
      setRegisterErr(e instanceof ApiError ? e.message : 'تعذر تحميل السجل')
      setRegisterRows([])
    } finally {
      setRegisterLoading(false)
    }
  }, [role, registerDate])

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

  useEffect(() => {
    if (role !== 'super_admin' || registerInit.current) return
    registerInit.current = true
    const v = (businessDate || '').trim()
    setRegisterDate(v || new Date().toISOString().slice(0, 10))
  }, [role, businessDate])

  useEffect(() => {
    if (role !== 'super_admin' || !registerDate) return
    void loadRegister()
  }, [role, registerDate, loadRegister])

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
    const chErr = validatePaymentChannelBeforeSubmit(payChannel, payBankName)
    if (chErr) {
      setErr(chErr)
      return
    }
    setSaving(true)
    setErr('')
    setOk('')
    try {
      const body: {
        displayName: string
        sessionMinutes: number
        businessDate?: string
        paymentChannel: PaymentChannel
        bankName?: string
      } = {
        displayName: name,
        sessionMinutes,
        paymentChannel: payChannel,
      }
      if (payChannel === 'bank') body.bankName = payBankName.trim()
      const bd = businessDate?.trim()
      if (bd) body.businessDate = bd
      await api('/api/solarium/sessions/confirm', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      setOk('تم تسجيل الجلسة والتحصيل — يظهر المبلغ في الجرد المالي اليومي.')
      setDisplayName('')
      setPayChannel('cash')
      setPayBankName('')
      void loadSettings()
      if (role === 'super_admin') void loadRegister()
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
        حقل الاسم للعرض في السجل فقط — غير مرتبط ببحث المرضى أو ملفاتهم. عند التأكيد يُحصّل المبلغ (كاش أو بنك) باسم
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

      {role === 'super_admin' ? (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 className="card-title" style={{ marginTop: 0 }}>
            سجل السولاريوم اليومي
          </h2>
          <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginTop: 0 }}>
            جلسات الزائر (6/12 دقيقة) وباكجات السولاريوم المدفوعة مسبقاً من ملفات المرضى — حسب <strong>تاريخ العمل</strong> المسجّل
            على الجلسة. اختر أي تاريخ لعرض أيام سابقة.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginTop: '0.65rem' }}>
            <div>
              <label className="form-label">تاريخ العرض</label>
              <input
                className="input"
                type="date"
                dir="ltr"
                style={{ maxWidth: 200 }}
                value={registerDate}
                onChange={(e) => setRegisterDate(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-secondary" disabled={registerLoading} onClick={() => void loadRegister()}>
              {registerLoading ? 'جاري التحميل…' : 'تحديث'}
            </button>
          </div>
          {registerErr ? <p style={{ color: 'var(--danger)', marginTop: '0.75rem' }}>{registerErr}</p> : null}
          {registerLoading && registerRows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>جاري التحميل…</p>
          ) : registerRows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '0.75rem' }}>لا توجد عمليات مسجّلة في هذا التاريخ.</p>
          ) : (
            <div className="table-wrap" style={{ marginTop: '0.85rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>وقت التسجيل</th>
                    <th>النوع</th>
                    <th>المريض / الملف</th>
                    <th>الوصف</th>
                    <th>المبلغ (ل.س)</th>
                    <th>حصل بواسطة</th>
                    <th>حالة الفوترة</th>
                  </tr>
                </thead>
                <tbody>
                  {registerRows.map((r) => (
                    <tr key={r.id}>
                      <td>{formatDt(r.createdAt)}</td>
                      <td>{kindLabelAr(r.kind)}</td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{r.patientName}</span>
                        {r.fileNumber ? (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}> — {r.fileNumber}</span>
                        ) : null}
                      </td>
                      <td style={{ maxWidth: 280, whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>{r.procedureDescription}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.amountSyp.toLocaleString('ar-SY')}</td>
                      <td>{r.receivedByName}</td>
                      <td>{r.billingStatus || '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4} style={{ fontWeight: 700 }}>
                      الإجمالي
                    </td>
                    <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {registerRows.reduce((s, r) => s + (Number(r.amountSyp) || 0), 0).toLocaleString('ar-SY')}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
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
            <PaymentChannelFields
              channel={payChannel}
              bankName={payBankName}
              onChannelChange={setPayChannel}
              onBankNameChange={setPayBankName}
              disabled={confirmBlocked}
              namePrefix="sol-walkin"
              banks={paymentBanks}
              banksLoading={paymentBanksLoading}
            />
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
