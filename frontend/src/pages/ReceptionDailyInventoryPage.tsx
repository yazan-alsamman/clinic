import { useCallback, useEffect, useMemo, useState } from 'react'
import { ReceptionInventoryDetailBody } from '../components/ReceptionInventoryDetailBody'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useClinic } from '../context/ClinicContext'
import type { InventoryApiPayload, InventoryPayload, TxRow } from '../types/receptionDailyInventory'
import type { Role } from '../types'

const ACCESS: Role[] = ['reception', 'super_admin']

export function ReceptionDailyInventoryPage() {
  const { user } = useAuth()
  const { businessDate: ctxDate, usdSypRate: ctxRate, refreshSystem } = useClinic()
  const allowed = user?.role && ACCESS.includes(user.role as Role)
  const canBrowseOperationsHistory = user?.role === 'super_admin'

  const [data, setData] = useState<InventoryApiPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [operationsLogDate, setOperationsLogDate] = useState('')
  const [operationsLogRows, setOperationsLogRows] = useState<TxRow[]>([])
  const [operationsLogLoading, setOperationsLogLoading] = useState(false)
  const [operationsLogErr, setOperationsLogErr] = useState('')

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false)
      return
    }
    setErr('')
    try {
      setLoading(true)
      const res = await api<InventoryApiPayload>('/api/billing/reception-daily-inventory')
      setData(res)
    } catch (e) {
      setData(null)
      setErr(e instanceof ApiError ? e.message : 'تعذر تحميل الجرد')
    } finally {
      setLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (canBrowseOperationsHistory) return
    setOperationsLogDate('')
  }, [canBrowseOperationsHistory])

  useEffect(() => {
    if (!allowed || !data?.businessDate) return
    if (data.inventoryMode === 'admin_split') return
    const picked = operationsLogDate.trim()
    const invDay = String(data.businessDate).trim()
    const viewingHistorical = Boolean(picked && picked !== invDay)
    if (viewingHistorical && canBrowseOperationsHistory) return

    setOperationsLogRows(data.transactions || [])
    setOperationsLogErr('')
    setOperationsLogLoading(false)
  }, [allowed, canBrowseOperationsHistory, operationsLogDate, data?.businessDate, data?.transactions, data?.inventoryMode])

  useEffect(() => {
    if (!allowed || !canBrowseOperationsHistory || !data?.businessDate) return
    const picked = operationsLogDate.trim()
    const invDay = String(data.businessDate).trim()
    if (!picked || picked === invDay) return

    let cancelled = false
    ;(async () => {
      setOperationsLogLoading(true)
      setOperationsLogErr('')
      try {
        const res = await api<{ businessDate: string; transactions: TxRow[] }>(
          `/api/billing/reception-collection-log?date=${encodeURIComponent(picked)}`,
          { cache: 'no-store' },
        )
        if (!cancelled) setOperationsLogRows(res.transactions || [])
      } catch (e) {
        if (!cancelled) {
          setOperationsLogRows([])
          setOperationsLogErr(e instanceof ApiError ? e.message : 'تعذر تحميل سجل العمليات لهذا التاريخ')
        }
      } finally {
        if (!cancelled) setOperationsLogLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [allowed, canBrowseOperationsHistory, operationsLogDate, data?.businessDate])

  /** يجب أن تبقى كل الـ hooks فوق أي return — وإلا يحدث تعطل عند انتقال allowed من false إلى true */
  const apiDataForHooks = data as InventoryApiPayload | null

  const mergedAdminSplitRows = useMemo(() => {
    if (!apiDataForHooks || apiDataForHooks.inventoryMode !== 'admin_split' || !apiDataForHooks.morning || !apiDataForHooks.evening)
      return []
    return [
      ...apiDataForHooks.morning.transactions,
      ...apiDataForHooks.evening.transactions,
      ...(apiDataForHooks.outsideShift?.transactions ?? []),
    ]
  }, [data])

  const adminHistoricalOpsRows = useMemo(() => {
    if (!apiDataForHooks || apiDataForHooks.inventoryMode !== 'admin_split') return []
    const picked = operationsLogDate.trim()
    const invDay = String(apiDataForHooks.businessDate || '').trim()
    if (!picked || picked === invDay) return mergedAdminSplitRows
    return operationsLogRows
  }, [data, apiDataForHooks?.inventoryMode, apiDataForHooks?.businessDate, operationsLogDate, mergedAdminSplitRows, operationsLogRows])

  if (!allowed) {
    return (
      <>
        <h1 className="page-title">جرد مالي يومي</h1>
        <p className="page-desc">
          هذه الصفحة متاحة لدور <strong>استقبال</strong> من القائمة الجانبية، ولمدير النظام عند فتح الرابط مباشرة
          للدعم الفني.
        </p>
      </>
    )
  }

  const d = data
  const apiData = data as InventoryApiPayload
  const rate = d?.usdSypRate ?? ctxRate
  const dateLabel = d?.businessDate
    ? new Date(d.businessDate + 'T12:00:00').toLocaleDateString('ar-SY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—'

  const pendingBannerCount =
    apiData?.inventoryMode === 'admin_split'
      ? apiData.pendingCollectionCount ?? 0
      : apiData?.summary?.pendingCollectionCount ?? 0

  const rawOpsDate = (operationsLogDate || d?.businessDate || '').trim()
  const effectiveOperationsLogDate = /^\d{4}-\d{2}-\d{2}$/.test(rawOpsDate) ? rawOpsDate : ''

  const operationsLogDateLabel = effectiveOperationsLogDate
    ? new Date(effectiveOperationsLogDate + 'T12:00:00').toLocaleDateString('ar-SY', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : ''

  const stubInv = apiData.morning ?? apiData.evening ?? (apiData as InventoryPayload)

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto' }}>
      <header
        style={{
          position: 'relative',
          borderRadius: 'var(--radius)',
          padding: '1.35rem 1.5rem 1.5rem',
          marginBottom: '1.25rem',
          overflow: 'hidden',
          color: '#fff',
          background: 'linear-gradient(135deg, #0369a1 0%, #4f46e5 42%, #7c3aed 88%)',
          boxShadow: 'var(--glow-cyan), 0 4px 0 rgba(0,0,0,0.06) inset',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse 70% 120% at 100% 0%, rgba(255,255,255,0.18), transparent 50%)',
            pointerEvents: 'none',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p style={{ margin: 0, opacity: 0.92, fontSize: '0.82rem', letterSpacing: '0.02em' }}>استقبال — تسوية يومية</p>
          <h1 className="page-title" style={{ margin: '0.2rem 0 0.35rem', color: '#fff', border: 'none' }}>
            جرد مالي يومي
          </h1>
          <p style={{ margin: 0, fontSize: '0.95rem', opacity: 0.95, lineHeight: 1.65 }}>
            <strong>{dateLabel}</strong>
            <span style={{ opacity: 0.85 }}>
              {' '}
              — يُحسب تلقائياً ليوم التقويم الحالي فقط؛ لا يمكن عرض يوم سابق من هذه الصفحة.
            </span>
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem', alignItems: 'center' }}>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.25rem 0.65rem',
                borderRadius: 999,
                fontSize: '0.8rem',
                fontWeight: 600,
                background: d?.dayActive ? 'rgba(34,197,94,0.25)' : 'rgba(251,191,36,0.3)',
                border: '1px solid rgba(255,255,255,0.35)',
              }}
            >
              {d?.dayActive ? 'يوم عمل نشط' : 'يوم غير مفعّل أو مغلق'}
            </span>
            {ctxDate && d?.businessDate && ctxDate === d.businessDate ? (
              <span
                style={{
                  fontSize: '0.78rem',
                  opacity: 0.9,
                  padding: '0.2rem 0.55rem',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.12)',
                }}
              >
                يطابق يوم النظام في الواجهة
              </span>
            ) : null}
            {rate != null && rate > 0 ? (
              <span
                style={{
                  fontSize: '0.78rem',
                  opacity: 0.95,
                  padding: '0.2rem 0.55rem',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.12)',
                }}
                dir="ltr"
              >
                سعر اليوم المحفوظ: {rate.toLocaleString('ar-SY')} ل.س / 1 USD
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', marginBottom: '1rem', alignItems: 'center' }}>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void load()}>
          {loading ? 'جاري التحديث…' : 'تحديث الجرد'}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void refreshSystem()}>
          تحديث حالة اليوم
        </button>
      </div>

      {err ? (
        <p className="card" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>
          {err}
        </p>
      ) : null}

      {loading && !d ? (
        <div className="card">
          <p style={{ margin: 0 }}>جاري تحميل تفاصيل التحصيل…</p>
        </div>
      ) : null}

      {d && !loading ? (
        <>
          {pendingBannerCount > 0 ? (
            <div
              className="card"
              style={{
                marginBottom: '1rem',
                borderRight: '4px solid var(--warning)',
                background: 'var(--warning-bg)',
              }}
            >
              <p style={{ margin: 0, fontWeight: 700, color: 'var(--amber)' }}>
                تنبيه: {pendingBannerCount.toLocaleString('ar-SY')} بنداً ما زال بانتظار التحصيل لهذا اليوم
              </p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                أغلق البنود من صفحة «التحصيل» ليتطابق النقد الفعلي مع الجرد بعد اكتمال اليوم.
              </p>
            </div>
          ) : null}

          {apiData.inventoryMode === 'admin_split' && apiData.morning && apiData.evening ? (
            <>
              <div
                className="card"
                style={{
                  marginBottom: '1rem',
                  padding: '0.85rem 1rem',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                }}
              >
                <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.55 }}>
                  <strong>مدير النظام:</strong> يعرض أدناه جردان كاملان منفصلان حسب{' '}
                  <strong>وقت تسجيل التحصيل</strong> (توقيت دمشق): الصباح من {apiData.shiftBounds?.morning.start} إلى{' '}
                  {apiData.shiftBounds?.morning.end}، والمساء من {apiData.shiftBounds?.evening.start} إلى{' '}
                  {apiData.shiftBounds?.evening.end}. أي مبالغ خارج هاتين الفترتين تظهر أدناه إن وُجدت.
                </p>
              </div>

              <div style={{ marginBottom: '2rem' }}>
                <ReceptionInventoryDetailBody
                  variant="full"
                  inv={apiData.morning}
                  sectionTitle={`الوردية الصباحية (${apiData.shiftBounds?.morning.start}–${apiData.shiftBounds?.morning.end})`}
                  opsRows={apiData.morning.transactions}
                  opsLoading={false}
                  opsErr=""
                  showOpsDatePicker={false}
                  sectionKey="am"
                  businessDateStr={apiData.morning.businessDate}
                  dateLabel={dateLabel}
                  operationsLogDate={operationsLogDate}
                  onOperationsLogDateChange={setOperationsLogDate}
                  operationsLogDateLabel={operationsLogDateLabel}
                  canBrowseOperationsHistory={false}
                />
              </div>

              <div style={{ marginBottom: apiData.outsideShift ? '2rem' : 0 }}>
                <ReceptionInventoryDetailBody
                  variant="full"
                  inv={apiData.evening}
                  sectionTitle={`الوردية المسائية (${apiData.shiftBounds?.evening.start}–${apiData.shiftBounds?.evening.end})`}
                  opsRows={apiData.evening.transactions}
                  opsLoading={false}
                  opsErr=""
                  showOpsDatePicker={false}
                  sectionKey="pm"
                  businessDateStr={apiData.evening.businessDate}
                  dateLabel={dateLabel}
                  operationsLogDate={operationsLogDate}
                  onOperationsLogDateChange={setOperationsLogDate}
                  operationsLogDateLabel={operationsLogDateLabel}
                  canBrowseOperationsHistory={false}
                />
              </div>

              {apiData.outsideShift ? (
                <div style={{ marginBottom: '2rem' }}>
                  <ReceptionInventoryDetailBody
                    variant="full"
                    inv={apiData.outsideShift}
                    sectionTitle="خارج نطاق الورديات (وقت التحصيل خارج الفترتين أعلاه)"
                    opsRows={apiData.outsideShift.transactions}
                    opsLoading={false}
                    opsErr=""
                    showOpsDatePicker={false}
                    sectionKey="out"
                    businessDateStr={apiData.outsideShift.businessDate}
                    dateLabel={dateLabel}
                    operationsLogDate={operationsLogDate}
                    onOperationsLogDateChange={setOperationsLogDate}
                    operationsLogDateLabel={operationsLogDateLabel}
                    canBrowseOperationsHistory={false}
                  />
                </div>
              ) : null}

              {canBrowseOperationsHistory ? (
                <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '2px dashed var(--border)' }}>
                  <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem', color: 'var(--text)' }}>
                    استعلام سجل التحصيل حسب التاريخ
                  </h2>
                  <p className="page-desc" style={{ marginBottom: '0.75rem' }}>
                    الجرد أعلاه مقسّم للورديتين. هنا يمكنك اختيار أي تاريخ لعرض <strong>كامل</strong> سجل التحصيل لذلك اليوم
                    (مثل السابق قبل التقسيم).
                  </p>
                  <ReceptionInventoryDetailBody
                    variant="operationsOnly"
                    inv={stubInv}
                    opsRows={adminHistoricalOpsRows}
                    opsLoading={operationsLogLoading}
                    opsErr={operationsLogErr}
                    showOpsDatePicker
                    sectionKey="hist"
                    businessDateStr={apiData.businessDate || ''}
                    dateLabel={dateLabel}
                    operationsLogDate={operationsLogDate}
                    onOperationsLogDateChange={setOperationsLogDate}
                    operationsLogDateLabel={operationsLogDateLabel}
                    canBrowseOperationsHistory
                  />
                </div>
              ) : null}
            </>
          ) : apiData.inventoryMode === 'reception_unassigned' ? (
            <>
              <div
                className="card"
                style={{
                  marginBottom: '1rem',
                  borderRight: '4px solid var(--warning)',
                  background: 'var(--warning-bg)',
                }}
              >
                <p style={{ margin: 0, fontWeight: 700, color: 'var(--amber)' }}>لم يُحدَّد لك دور في الوردية</p>
                <p style={{ margin: '0.35rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                  من «الغرف وتعيين أخصائيي الليزر» ← «ورديات سكرتارية الاستقبال» يحدد المدير من على الصباح ومن على المساء.
                </p>
              </div>
              <ReceptionInventoryDetailBody
                variant="full"
                inv={apiData as InventoryPayload}
                opsRows={[]}
                opsLoading={false}
                opsErr=""
                showOpsDatePicker={false}
                sectionKey="na"
                businessDateStr={apiData.businessDate || ''}
                dateLabel={dateLabel}
                operationsLogDate=""
                onOperationsLogDateChange={() => {}}
                operationsLogDateLabel=""
                canBrowseOperationsHistory={false}
              />
            </>
          ) : (
            <>
              {apiData.inventoryMode === 'reception_shift' ? (
                <div
                  className="card"
                  style={{
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    borderRight: '4px solid #0369a1',
                    background: 'linear-gradient(90deg, rgba(3,105,161,0.08), var(--surface))',
                  }}
                >
                  <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.55 }}>
                    <strong>عرضك:</strong>{' '}
                    {apiData.secretaryShift === 'morning'
                      ? `وردية الصباح فقط (${apiData.shiftBounds?.morning.start}–${apiData.shiftBounds?.morning.end}، توقيت دمشق).`
                      : `وردية المساء فقط (${apiData.shiftBounds?.evening.start}–${apiData.shiftBounds?.evening.end}، توقيت دمشق).`}
                  </p>
                </div>
              ) : null}

              <ReceptionInventoryDetailBody
                variant="full"
                inv={apiData as InventoryPayload}
                opsRows={operationsLogRows}
                opsLoading={operationsLogLoading}
                opsErr={operationsLogErr}
                showOpsDatePicker={canBrowseOperationsHistory}
                sectionKey=""
                businessDateStr={apiData.businessDate || ''}
                dateLabel={dateLabel}
                operationsLogDate={operationsLogDate}
                onOperationsLogDateChange={setOperationsLogDate}
                operationsLogDateLabel={operationsLogDateLabel}
                canBrowseOperationsHistory={canBrowseOperationsHistory}
              />
            </>
          )}
        </>
      ) : null}
    </div>
  )
}
