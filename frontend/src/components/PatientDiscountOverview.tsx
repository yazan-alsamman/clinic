import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, ApiError } from '../api/client'

export type DiscountLine = {
  id: string
  sequence: number
  status: 'active' | 'reversed'
  basis: 'list' | 'remaining'
  entryMode: 'percent' | 'amount'
  percent: number
  amountSyp: number
  priceBeforeSyp: number
  priceAfterSyp: number
  appliedAt: string | null
  appliedByName: string | null
  source: string
  sourceLabel: string
  historical: boolean
  reversedAt: string | null
  reversedByName: string | null
  reversalReason: string | null
  isCorrection: boolean
  note: string | null
}

export type DiscountOverviewService = {
  key: string
  kind: 'service' | 'package' | 'package_session'
  department: string
  label: string
  businessDate: string
  createdAt: string | null
  status: 'paid' | 'pending_payment' | 'package' | 'legacy'
  currency: 'SYP' | 'USD'
  originalPriceSyp: number
  finalPriceSyp: number
  originalPriceUsd?: number
  finalPriceUsd?: number
  paidSyp: number | null
  remainingSyp: number | null
  totalDiscountSyp: number
  totalDiscountPercent: number
  hasDiscount: boolean
  historical: boolean
  discounts: DiscountLine[]
  notes: string[]
}

export type DiscountOverviewResponse = {
  summary: {
    servicesCount: number
    discountedCount: number
    discountsCount: number
    totalOriginalSyp: number
    totalDiscountSyp: number
    totalFinalSyp: number
    totalPaidSyp: number
  }
  services: DiscountOverviewService[]
}

const DEPT_LABEL: Record<string, string> = {
  laser: 'ليزر',
  dermatology: 'جلدية',
  dental: 'أسنان',
  solarium: 'سولاريوم',
  skin: 'بشرة',
}

const STATUS_LABEL: Record<DiscountOverviewService['status'], string> = {
  paid: 'مدفوع',
  pending_payment: 'بانتظار التحصيل',
  package: 'باكج',
  legacy: 'سجل قديم',
}

const CLINIC_TZ = 'Asia/Damascus'

function money(n: number | null | undefined) {
  return Math.round(Number(n) || 0).toLocaleString('ar-SY')
}

function pct(n: number) {
  return `${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString('ar-SY', { maximumFractionDigits: 2 })}%`
}

function dateOnly(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('ar-SY', { timeZone: CLINIC_TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
}

function timeOnly(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleTimeString('ar-SY', { timeZone: CLINIC_TZ, hour: '2-digit', minute: '2-digit', hour12: false })
}

const notRecorded = <span style={{ color: 'var(--text-muted)' }}>غير مسجّل</span>

function DiscountLinesTable({ svc }: { svc: DiscountOverviewService }) {
  return (
    <div className="table-wrap" style={{ margin: '0.25rem 0 0.35rem' }}>
      <table className="data-table" style={{ fontSize: '0.82rem' }}>
        <thead>
          <tr>
            <th>الخصم</th>
            <th>النسبة</th>
            <th>المبلغ</th>
            <th>محسوب على</th>
            <th>التاريخ</th>
            <th>الوقت</th>
            <th>طبّقه</th>
            <th>المصدر</th>
          </tr>
        </thead>
        <tbody>
          {svc.discounts.map((d) => {
            const reversed = d.status === 'reversed'
            const cellStyle = reversed ? { textDecoration: 'line-through', color: 'var(--text-muted)' } : undefined
            return (
              <Fragment key={d.id}>
                <tr>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    خصم {d.sequence.toLocaleString('ar-SY')}
                    {reversed ? (
                      <span style={{ color: 'var(--danger)', marginRight: '0.3rem' }}>(ملغى)</span>
                    ) : d.isCorrection ? (
                      <span style={{ color: 'var(--warning)', marginRight: '0.3rem' }}>(تصحيح)</span>
                    ) : null}
                  </td>
                  <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums' }}>
                    {pct(d.percent)}
                    {d.entryMode === 'amount' ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> (محسوبة)</span>
                    ) : null}
                  </td>
                  <td style={{ ...cellStyle, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    −{money(d.amountSyp)}
                    {d.entryMode === 'percent' && !d.historical ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}> (محسوب)</span>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {d.basis === 'remaining' ? 'المتبقي' : 'السعر الأصلي'} ({money(d.priceBeforeSyp)})
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{dateOnly(d.appliedAt) ?? notRecorded}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{timeOnly(d.appliedAt) ?? notRecorded}</td>
                  <td>{d.appliedByName ?? notRecorded}</td>
                  <td style={{ color: 'var(--text-muted)' }}>
                    {d.sourceLabel}
                    {d.historical ? ' — سجل قديم' : ''}
                  </td>
                </tr>
                {reversed || d.note ? (
                  <tr>
                    <td colSpan={8} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingTop: 0 }}>
                      {reversed
                        ? `أُلغي ${dateOnly(d.reversedAt) ?? ''} ${timeOnly(d.reversedAt) ?? ''} بواسطة ${
                            d.reversedByName || 'غير مسجّل'
                          }${d.reversalReason ? ` — السبب: ${d.reversalReason}` : ''}`
                        : d.note}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * الأسعار والخصومات في نظرة المريض العامة — عرض فقط، لا يُنشئ أي حركة مالية.
 * السعر النهائي من السجل المالي المعتمد؛ كل خصم سطر مستقل بنسبته ومبلغه ووقته ومن طبّقه.
 */
export function PatientDiscountOverview({ patientId, refreshKey }: { patientId: string; refreshKey?: unknown }) {
  const requestKey = `${patientId}|${String(refreshKey ?? '')}`
  const [result, setResult] = useState<{ key: string; data: DiscountOverviewResponse | null; err: string } | null>(
    null,
  )
  const [onlyDiscounted, setOnlyDiscounted] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    api<DiscountOverviewResponse>(`/api/patients/${encodeURIComponent(patientId)}/discount-overview`)
      .then((d) => {
        if (!cancelled) setResult({ key: requestKey, data: d, err: '' })
      })
      .catch((e) => {
        if (!cancelled) {
          setResult({
            key: requestKey,
            data: null,
            err: e instanceof ApiError ? e.message : 'تعذر تحميل الأسعار والخصومات',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [patientId, requestKey])

  const loading = result?.key !== requestKey
  const data = result?.data ?? null
  const err = loading ? '' : (result?.err ?? '')

  const rows = useMemo(() => {
    const all = data?.services ?? []
    return onlyDiscounted ? all.filter((s) => s.hasDiscount) : all
  }, [data, onlyDiscounted])
  const visible = showAll ? rows : rows.slice(0, 15)

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <h3 className="card-title" style={{ fontSize: '0.95rem' }}>
        الأسعار والخصومات
      </h3>
      <p className="page-desc" style={{ margin: '0 0 0.6rem', fontSize: '0.85rem' }}>
        السعر الأصلي لكل خدمة أو باكج، وكل خصم طُبّق عليه بشكل مستقل، والسعر النهائي المعتمد في السجل المالي.
      </p>
      {loading && !data ? (
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>جاري التحميل…</p>
      ) : err ? (
        <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
      ) : !data || data.services.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.88rem' }}>لا توجد خدمات مسعّرة لهذا المريض.</p>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.5rem 1.25rem',
              fontSize: '0.86rem',
              margin: '0 0 0.6rem',
            }}
          >
            <span>
              الخدمات: <strong>{data.summary.servicesCount.toLocaleString('ar-SY')}</strong>
            </span>
            <span>
              عليها خصم: <strong>{data.summary.discountedCount.toLocaleString('ar-SY')}</strong>
            </span>
            <span>
              إجمالي الخصومات: <strong style={{ color: 'var(--danger)' }}>−{money(data.summary.totalDiscountSyp)} ل.س</strong>
            </span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyDiscounted} onChange={(e) => setOnlyDiscounted(e.target.checked)} />
              عرض الخدمات المخفّضة فقط
            </label>
          </div>
          {rows.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.88rem' }}>لا خصومات على خدمات هذا المريض.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>الخدمة / العلاج</th>
                    <th>التاريخ</th>
                    <th>السعر الأصلي</th>
                    <th>الخصم</th>
                    <th>السعر النهائي</th>
                    <th>المدفوع</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <Fragment key={s.key}>
                      <tr style={s.hasDiscount ? { background: 'var(--surface-2, rgba(0,0,0,0.025))' } : undefined}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{s.label}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {DEPT_LABEL[s.department] ?? s.department}
                            {s.kind === 'package' ? ' — باكج' : s.kind === 'package_session' ? ' — جلسة باكج' : ''}
                          </div>
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {s.businessDate || dateOnly(s.createdAt) || '—'}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {money(s.originalPriceSyp)}
                          {s.currency === 'USD' && s.originalPriceUsd ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} dir="ltr">
                              {s.originalPriceUsd} USD
                            </div>
                          ) : null}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {s.totalDiscountSyp > 0 ? (
                            <>
                              <strong>{pct(s.totalDiscountPercent)}</strong>
                              <div style={{ color: 'var(--danger)' }}>−{money(s.totalDiscountSyp)}</div>
                            </>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 700 }}>
                          {money(s.finalPriceSyp)}
                          {s.currency === 'USD' && s.finalPriceUsd ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }} dir="ltr">
                              {s.finalPriceUsd} USD
                            </div>
                          ) : null}
                        </td>
                        <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                          {s.paidSyp == null ? '—' : money(s.paidSyp)}
                          {s.remainingSyp ? (
                            <div style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>متبقٍ {money(s.remainingSyp)}</div>
                          ) : null}
                        </td>
                        <td style={{ fontSize: '0.82rem' }}>{STATUS_LABEL[s.status] ?? s.status}</td>
                      </tr>
                      {s.discounts.length > 0 || s.notes.length > 0 ? (
                        <tr>
                          <td colSpan={7} style={{ paddingTop: 0 }}>
                            {s.discounts.length > 0 ? <DiscountLinesTable svc={s} /> : null}
                            {s.notes.map((n, i) => (
                              <p key={i} style={{ margin: '0.2rem 0', fontSize: '0.8rem', color: 'var(--warning)' }}>
                                {n}
                              </p>
                            ))}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > visible.length ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}
              onClick={() => setShowAll(true)}
            >
              عرض الكل ({rows.length.toLocaleString('ar-SY')})
            </button>
          ) : null}
        </>
      )}
    </div>
  )
}
