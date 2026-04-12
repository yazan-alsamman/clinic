import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useClinic } from '../context/ClinicContext'
import { useAuth } from '../context/AuthContext'

/** تحويل الأرقام العربية/الفارسية إلى أرقام لاتينية ليقبلها parseFloat */
function normalizeRateDigits(raw: string) {
  let s = raw.replace(/,/g, '').replace(/\s/g, '').trim()
  for (let i = 0; i < 10; i++) {
    const ar = String.fromCharCode(0x0660 + i)
    const ext = String.fromCharCode(0x06f0 + i)
    s = s.split(ar).join(String(i)).split(ext).join(String(i))
  }
  return s
}

export function DayBanner() {
  const { user, sessionMinutesLeft } = useAuth()
  const role = user?.role
  const {
    dayActive,
    startDay,
    usdSypRate,
    updateExchangeRate,
    systemLoading,
  } = useClinic()
  const [showStart, setShowStart] = useState(false)
  const [rateInput, setRateInput] = useState(String(usdSypRate ?? ''))
  const [busy, setBusy] = useState(false)
  const [startErr, setStartErr] = useState('')

  useEffect(() => {
    setRateInput(String(usdSypRate ?? ''))
  }, [usdSypRate])

  useEffect(() => {
    if (!showStart) setStartErr('')
  }, [showStart])

  const isReception = role === 'reception'

  if (systemLoading && usdSypRate == null && !dayActive) {
    return (
      <div className="day-banner locked" role="status">
        جاري مزامنة حالة اليوم…
      </div>
    )
  }

  if (!dayActive) {
    return (
      <>
        <div className="day-banner locked" role="status">
          <div>
            <strong>اليوم غير مفعّل.</strong>{' '}
            {role === 'super_admin'
              ? 'ابدأ يوم العمل وأدخل سعر الصرف ليتمكن الفريق من العمل.'
              : 'لا يمكن تنفيذ العمليات حتى يفعّل المدير يوم العمل من حسابه.'}
          </div>
          {role === 'super_admin' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setStartErr('')
                setShowStart(true)
              }}
            >
              بدء يوم العمل
            </button>
          )}
        </div>
        {showStart && role === 'super_admin' && (
          <div
            className="modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-day-title"
          >
            <div className="modal">
              <h3 id="start-day-title">تفعيل يوم العمل</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                أدخل سعر صرف USD/SYP لهذا اليوم. ستُحسب جميع الفواتير والأرباح
                بناءً عليه.
              </p>
              <label className="form-label" htmlFor="rate">
                سعر الصرف (ليرة / دولار)
              </label>
              <input
                id="rate"
                className="input"
                inputMode="decimal"
                dir="ltr"
                value={rateInput}
                onChange={(e) => {
                  setStartErr('')
                  setRateInput(e.target.value)
                }}
              />
              {startErr ? (
                <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{startErr}</p>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  marginTop: '1rem',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setStartErr('')
                    setShowStart(false)
                  }}
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={async () => {
                    setStartErr('')
                    const normalized = normalizeRateDigits(rateInput)
                    const n = parseFloat(normalized)
                    if (!Number.isFinite(n) || n <= 0) {
                      setStartErr('أدخل سعراً صالحاً (رقم أكبر من صفر). يمكن استخدام الأرقام 0–9 أو العربية ٠–٩.')
                      return
                    }
                    setBusy(true)
                    try {
                      await startDay(n)
                      setShowStart(false)
                    } catch (e) {
                      setStartErr(e instanceof ApiError ? e.message : 'تعذر تفعيل اليوم. تحقق من الاتصال بالخادم.')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {busy ? 'جاري التفعيل…' : 'تأكيد والبدء'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className="day-banner active" role="status">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <span className="chip chip-day-live">يوم العمل قيد التنفيذ</span>
        {usdSypRate != null && (
          <span className="fx-chip">USD/SYP = {usdSypRate.toLocaleString('ar-SY')}</span>
        )}
        {role === 'super_admin' && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.85rem' }}
            onClick={() => {
              const next = window.prompt('سعر الصرف الجديد', String(usdSypRate ?? ''))
              if (next == null) return
              const n = parseFloat(next.replace(/,/g, ''))
              if (Number.isFinite(n) && n > 0) void updateExchangeRate(n)
            }}
          >
            تعديل السعر
          </button>
        )}
      </div>
      {isReception && sessionMinutesLeft != null && (
        <span className="session-hint">
          تنتهي جلسة الاستقبال تلقائياً خلال ~{sessionMinutesLeft} دقيقة
        </span>
      )}
    </div>
  )
}
