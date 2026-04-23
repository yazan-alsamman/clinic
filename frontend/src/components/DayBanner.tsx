import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { useClinic } from '../context/ClinicContext'
import { useAuth } from '../context/AuthContext'
import { normalizeDecimalDigits } from '../utils/normalizeDigits'

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
  const [startStep, setStartStep] = useState<'rate' | 'meters'>('rate')
  const [savedRate, setSavedRate] = useState<number | null>(null)
  const [rateInput, setRateInput] = useState(String(usdSypRate ?? ''))
  const [room1Input, setRoom1Input] = useState('')
  const [room2Input, setRoom2Input] = useState('')
  const [busy, setBusy] = useState(false)
  const [startErr, setStartErr] = useState('')

  useEffect(() => {
    setRateInput(String(usdSypRate ?? ''))
  }, [usdSypRate])

  useEffect(() => {
    if (!showStart) {
      setStartErr('')
      setStartStep('rate')
      setSavedRate(null)
      setRoom1Input('')
      setRoom2Input('')
    }
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
                setStartStep('rate')
                setSavedRate(null)
                setRoom1Input('')
                setRoom2Input('')
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
              {startStep === 'rate' ? (
                <>
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
                </>
              ) : (
                <>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    أدخل قراءة عداد الجهاز لكل غرفة في <strong>بداية</strong> هذا اليوم
                    (قبل أول جلسة).
                  </p>
                  <label className="form-label" htmlFor="meter-r1">
                    عداد الجهاز — غرفة 1 (Room 1)
                  </label>
                  <input
                    id="meter-r1"
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    value={room1Input}
                    onChange={(e) => {
                      setStartErr('')
                      setRoom1Input(e.target.value)
                    }}
                  />
                  <label className="form-label" htmlFor="meter-r2" style={{ marginTop: '0.75rem' }}>
                    عداد الجهاز — غرفة 2 (Room 2)
                  </label>
                  <input
                    id="meter-r2"
                    className="input"
                    inputMode="decimal"
                    dir="ltr"
                    value={room2Input}
                    onChange={(e) => {
                      setStartErr('')
                      setRoom2Input(e.target.value)
                    }}
                  />
                </>
              )}
              {startErr ? (
                <p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>{startErr}</p>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  marginTop: '1rem',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setStartErr('')
                    if (startStep === 'meters') {
                      setStartStep('rate')
                      return
                    }
                    setShowStart(false)
                  }}
                >
                  {startStep === 'meters' ? 'رجوع' : 'إلغاء'}
                </button>
                {startStep === 'rate' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => {
                      setStartErr('')
                      const normalized = normalizeDecimalDigits(rateInput)
                      const n = parseFloat(normalized)
                      if (!Number.isFinite(n) || n <= 0) {
                        setStartErr('أدخل سعراً صالحاً (رقم أكبر من صفر). يمكن استخدام الأرقام 0–9 أو العربية ٠–٩.')
                        return
                      }
                      setSavedRate(n)
                      setStartStep('meters')
                    }}
                  >
                    التالي
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy || savedRate == null}
                    onClick={async () => {
                      setStartErr('')
                      const m1 = parseFloat(normalizeDecimalDigits(room1Input))
                      const m2 = parseFloat(normalizeDecimalDigits(room2Input))
                      if (!Number.isFinite(m1) || m1 < 0) {
                        setStartErr('أدخل قراءة صالحة لعداد غرفة 1 (رقم ≥ 0).')
                        return
                      }
                      if (!Number.isFinite(m2) || m2 < 0) {
                        setStartErr('أدخل قراءة صالحة لعداد غرفة 2 (رقم ≥ 0).')
                        return
                      }
                      setBusy(true)
                      try {
                        await startDay({
                          rate: savedRate!,
                          room1MeterStart: m1,
                          room2MeterStart: m2,
                        })
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
                )}
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
