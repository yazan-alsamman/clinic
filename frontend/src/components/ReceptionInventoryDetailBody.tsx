import type { InventoryPayload, TxRow } from '../types/receptionDailyInventory'

function formatSyp(n: number) {
  return `${Math.round(n).toLocaleString('ar-SY')} ل.س`
}

function formatUsd(n: number) {
  const v = Math.round(n * 100) / 100
  return `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
}

function formatTime(iso: string | null) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('ar-SY', {
      hour: '2-digit',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    })
  } catch {
    return '—'
  }
}

export type ReceptionInventoryDetailBodyProps = {
  inv: InventoryPayload
  /** جدول السجل فقط (استعلام تاريخ آخر للمدير) */
  variant?: 'full' | 'operationsOnly'
  /** عنوان اختياري فوق الملخص (فصل ورديات المدير) */
  sectionTitle?: string
  opsRows: TxRow[]
  opsLoading: boolean
  opsErr: string
  showOpsDatePicker: boolean
  /** تمييز عناصر النموذج عند وجود أكثر من كتلة في الصفحة */
  sectionKey?: string
  businessDateStr: string
  dateLabel: string
  operationsLogDate: string
  onOperationsLogDateChange: (v: string) => void
  operationsLogDateLabel: string
  canBrowseOperationsHistory: boolean
}

export function ReceptionInventoryDetailBody({
  inv: d,
  variant = 'full',
  sectionTitle,
  opsRows,
  opsLoading,
  opsErr,
  showOpsDatePicker,
  sectionKey = '',
  businessDateStr,
  dateLabel,
  operationsLogDate,
  onOperationsLogDateChange,
  operationsLogDateLabel,
  canBrowseOperationsHistory,
}: ReceptionInventoryDetailBodyProps) {
  const sid = sectionKey ? `-${sectionKey}` : ''

  if (variant === 'full') {
    const s = d.summary
    if (
      !s?.cash ||
      !s?.totals ||
      !Array.isArray(s.banks) ||
      !Array.isArray(d.byDepartment) ||
      !Array.isArray(d.transactions)
    ) {
      return (
        <div className="card" style={{ borderRight: '4px solid var(--danger)', marginBottom: '1rem' }}>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--danger)' }}>تعذر عرض الجرد</p>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            استجابة الخادم غير مكتملة أو تعارض إصدارات (الواجهة أحدث من الخادم). حدّث خدمة الـ API وأعد تشغيلها، ثم أعد
            تحميل الصفحة.
          </p>
        </div>
      )
    }
  }

  if (variant === 'operationsOnly') {
    return (
      <section>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>
          سجل العمليات ({opsRows.length.toLocaleString('ar-SY')})
        </h2>
        <div
          className="card"
          style={{
            marginBottom: '0.65rem',
            padding: '0.65rem 0.85rem',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.65rem',
              justifyContent: 'space-between',
            }}
          >
            <label className="form-label" htmlFor={`inv-ops-log-date${sid}`} style={{ margin: 0 }}>
              تاريخ السجل
            </label>
            <input
              id={`inv-ops-log-date${sid}`}
              type="date"
              className="input"
              dir="ltr"
              style={{ width: 'auto', minWidth: 160 }}
              value={operationsLogDate || businessDateStr || ''}
              onChange={(e) => onOperationsLogDateChange(e.target.value)}
              disabled={!businessDateStr}
            />
          </div>
          <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            المعروض: <strong>{operationsLogDateLabel || '—'}</strong>. الجرد أعلاه لليوم الحالي؛ هذا الجدول لتاريخ اخترته.
          </p>
          {opsErr ? <p style={{ margin: '0.5rem 0 0', color: 'var(--danger)', fontSize: '0.85rem' }}>{opsErr}</p> : null}
        </div>
        <div
          className="card"
          style={{ padding: 0, overflow: 'auto', maxHeight: 'min(70vh, 720px)', border: '1px solid var(--border)' }}
        >
          {opsLoading ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>جاري تحميل السجل…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: 'linear-gradient(180deg, #e0f2fe, #eef2ff)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>الوقت</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المريض</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المقدّم</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>القسم</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>الإجراء</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>القناة</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>عملة التحصيل</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'left' }} dir="ltr">
                    مستلم ل.س
                  </th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'left' }} dir="ltr">
                    مستلم USD
                  </th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>مستحق</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>فرق تسوية</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>ترجيع</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المحصّل</th>
                </tr>
              </thead>
              <tbody>
                {opsRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      لا توجد عمليات تحصيل مؤكدة للتاريخ المحدد ({operationsLogDateLabel || '—'}).
                    </td>
                  </tr>
                ) : (
                  opsRows.map((t, idx) => {
                    const debtRow = t.transactionKind === 'debt_settlement'
                    const cashRow = t.paymentChannel === 'cash'
                    const bg = debtRow
                      ? idx % 2 === 0
                        ? 'rgba(217,119,6,0.08)'
                        : 'rgba(217,119,6,0.12)'
                      : cashRow
                        ? idx % 2 === 0
                          ? 'rgba(22,163,74,0.06)'
                          : 'rgba(22,163,74,0.1)'
                        : idx % 2 === 0
                          ? 'rgba(99,102,241,0.06)'
                          : 'rgba(99,102,241,0.1)'
                    return (
                      <tr key={`hist-${t.paymentId}`} style={{ background: bg }}>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{formatTime(t.paidAt)}</td>
                        <td style={{ padding: '0.5rem', fontWeight: 600 }}>{t.patientName}</td>
                        <td style={{ padding: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t.providerName}</td>
                        <td style={{ padding: '0.5rem' }}>{t.departmentLabel}</td>
                        <td style={{ padding: '0.5rem', maxWidth: 160, color: 'var(--text-muted)' }}>{t.procedureLabel}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.12rem 0.45rem',
                              borderRadius: 999,
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              background: cashRow ? 'var(--success-dim)' : 'var(--violet-dim)',
                              color: cashRow ? 'var(--success)' : 'var(--violet)',
                            }}
                          >
                            {cashRow ? 'كاش' : `بنك: ${t.bankName}`}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem', fontWeight: 700 }}>{t.payCurrency === 'USD' ? 'USD' : 'ل.س'}</td>
                        <td style={{ padding: '0.5rem', direction: 'ltr', textAlign: 'left' }}>
                          {t.receivedAmountSyp.toLocaleString('ar-SY')}
                        </td>
                        <td style={{ padding: '0.5rem', direction: 'ltr', textAlign: 'left' }}>
                          {t.receivedAmountUsd > 0 ? t.receivedAmountUsd.toFixed(2) : '—'}
                        </td>
                        <td style={{ padding: '0.5rem' }}>{t.amountDueSyp.toLocaleString('ar-SY')}</td>
                        <td
                          style={{
                            padding: '0.5rem',
                            fontWeight: 600,
                            color:
                              t.settlementDeltaSyp > 0
                                ? 'var(--success)'
                                : t.settlementDeltaSyp < 0
                                  ? 'var(--danger)'
                                  : 'var(--text-muted)',
                          }}
                        >
                          {t.settlementDeltaSyp > 0 ? '+' : ''}
                          {t.settlementDeltaSyp.toLocaleString('ar-SY')}
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.8rem' }}>
                          {t.patientRefundSyp > 0 || t.patientRefundUsd > 0 ? (
                            <>
                              {t.patientRefundSyp > 0 ? `${t.patientRefundSyp.toLocaleString('ar-SY')} ل.س` : null}
                              {t.patientRefundSyp > 0 && t.patientRefundUsd > 0 ? ' + ' : null}
                              {t.patientRefundUsd > 0 ? `${t.patientRefundUsd.toFixed(2)} USD` : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.receivedByName}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    )
  }

  return (
    <>
      {sectionTitle ? (
        <h2
          style={{
            fontSize: '1.15rem',
            margin: '0 0 0.85rem',
            color: 'var(--text)',
            paddingBottom: '0.35rem',
            borderBottom: '2px solid var(--border)',
          }}
        >
          {sectionTitle}
        </h2>
      ) : null}

      <section style={{ marginBottom: '1.15rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>ملخص ما يجب أن يتوافر لديك</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.75rem',
          }}
        >
          <div
            className="card"
            style={{
              borderTop: '4px solid #16a34a',
              background: 'linear-gradient(180deg, var(--success-bg) 0%, var(--surface) 55%)',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--success)', fontWeight: 700 }}>كاش — ليرة سورية</p>
            <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, color: 'var(--text)' }}>
              {formatSyp(d.summary.cash.totalSyp)}
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              بعد إضافة المصاريف والمقبوضات النقدية
            </p>
          </div>
          <div
            className="card"
            style={{
              borderTop: '4px solid #0284c7',
              background: 'linear-gradient(180deg, var(--cyan-dim) 0%, var(--surface) 55%)',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--cyan)', fontWeight: 700 }}>كاش — دولار</p>
            <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, direction: 'ltr', textAlign: 'right' }}>
              {formatUsd(d.summary.cash.totalUsd)}
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              بعد إضافة المصاريف والمقبوضات النقدية
            </p>
          </div>
          <div
            className="card"
            style={{
              borderTop: '4px solid #7c3aed',
              background: 'linear-gradient(180deg, var(--violet-dim) 0%, var(--surface) 55%)',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--violet)', fontWeight: 700 }}>الإجمالي — ليرة</p>
            <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, color: 'var(--text)' }}>
              {formatSyp(d.summary.totals.totalSyp)}
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>كاش + جميع البنوك (مقابل ليرة)</p>
          </div>
          <div
            className="card"
            style={{
              borderTop: '4px solid #db2777',
              background: 'linear-gradient(180deg, var(--magenta-dim) 0%, var(--surface) 55%)',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--magenta)', fontWeight: 700 }}>الإجمالي — دولار</p>
            <p style={{ margin: '0.45rem 0 0', fontSize: '1.35rem', fontWeight: 800, direction: 'ltr', textAlign: 'right' }}>
              {formatUsd(d.summary.totals.totalUsd)}
            </p>
            <p style={{ margin: '0.35rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>كاش + بنوك (مبالغ بالدولار)</p>
          </div>
        </div>
      </section>

      {d.cashMovements ? (
        <section style={{ marginBottom: '1.15rem' }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>
            جدول حركة الصندوق (مصاريف + مبالغ مستلمة)
          </h2>
          <div className="card" style={{ marginBottom: '0.65rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.8rem' }}>
              <p style={{ margin: 0 }}>
                <strong>كاش أساسي ل.س:</strong> {formatSyp(d.summary.cashBase?.totalSyp ?? d.summary.cash.totalSyp)}
              </p>
              <p style={{ margin: 0 }} dir="ltr">
                <strong>Cash Base USD:</strong> {formatUsd(d.summary.cashBase?.totalUsd ?? d.summary.cash.totalUsd)}
              </p>
              <p style={{ margin: 0, color: 'var(--danger)' }}>
                <strong>مصاريف:</strong> {formatSyp(d.cashMovements.expense.totalSyp)}
              </p>
              <p style={{ margin: 0, color: 'var(--danger)' }} dir="ltr">
                <strong>Expenses USD:</strong> {formatUsd(d.cashMovements.expense.totalUsd)}
              </p>
              <p style={{ margin: 0, color: 'var(--success)' }}>
                <strong>مقبوضات:</strong> {formatSyp(d.cashMovements.receipt.totalSyp)}
              </p>
              <p style={{ margin: 0, color: 'var(--success)' }} dir="ltr">
                <strong>Receipts USD:</strong> {formatUsd(d.cashMovements.receipt.totalUsd)}
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>النوع</th>
                  <th>السبب</th>
                  <th>المبلغ ل.س</th>
                  <th>المبلغ USD</th>
                  <th>الوقت</th>
                </tr>
              </thead>
              <tbody>
                {d.cashMovements.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--text-muted)' }}>
                      لا توجد حركة صندوق مسجلة لهذا اليوم.
                    </td>
                  </tr>
                ) : (
                  d.cashMovements.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.kind === 'expense' ? 'مصروف' : 'مقبوض'}</td>
                      <td>{row.reason}</td>
                      <td>{row.amountSyp > 0 ? formatSyp(row.amountSyp) : '—'}</td>
                      <td dir="ltr">{row.amountUsd > 0 ? formatUsd(row.amountUsd) : '—'}</td>
                      <td>
                        {row.createdAt
                          ? new Date(row.createdAt).toLocaleString('ar-SY', {
                              hour: '2-digit',
                              minute: '2-digit',
                              day: '2-digit',
                              month: '2-digit',
                            })
                          : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section style={{ marginBottom: '1.15rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>البنوك — تفصيل الحوالات</h2>
        {d.summary.banks.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-muted)' }}>
            <p style={{ margin: 0 }}>لا توجد تحصيلات عبر بنك لهذا اليوم حتى الآن.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.65rem' }}>
            {d.summary.banks.map((b) => (
              <div
                key={b.bankName}
                className="card"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  borderRight: '5px solid #6366f1',
                  background: 'linear-gradient(90deg, rgba(99,102,241,0.08), var(--surface))',
                }}
              >
                <div>
                  <p style={{ margin: 0, fontWeight: 800, fontSize: '1.02rem', color: '#4338ca' }}>{b.bankName}</p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>قناة استلام: بنك</p>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', textAlign: 'left' as const }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', color: 'var(--success)', fontWeight: 700 }}>ل.س</span>
                    <p style={{ margin: '0.15rem 0 0', fontWeight: 700 }}>{formatSyp(b.totalSyp)}</p>
                  </div>
                  <div dir="ltr">
                    <span style={{ fontSize: '0.72rem', color: 'var(--cyan)', fontWeight: 700 }}>USD</span>
                    <p style={{ margin: '0.15rem 0 0', fontWeight: 700 }}>{formatUsd(b.totalUsd)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(d.summary.refundsRecorded.totalSyp > 0 || d.summary.refundsRecorded.totalUsd > 0) ? (
        <section style={{ marginBottom: '1.15rem' }}>
          <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>ترجيع مسجّل (دفعات بالدولار)</h2>
          <div
            className="card"
            style={{
              borderRight: '4px solid var(--amber)',
              background: 'var(--warning-bg)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1.25rem',
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 700 }}>إجمالي ترجيع ل.س</p>
              <p style={{ margin: '0.35rem 0 0', fontWeight: 700 }}>{formatSyp(d.summary.refundsRecorded.totalSyp)}</p>
            </div>
            <div dir="ltr">
              <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--amber)', fontWeight: 700 }}>إجمالي ترجيع USD</p>
              <p style={{ margin: '0.35rem 0 0', fontWeight: 700 }}>{formatUsd(d.summary.refundsRecorded.totalUsd)}</p>
            </div>
          </div>
        </section>
      ) : null}

      <section style={{ marginBottom: '1.15rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>حسب القسم</h2>
        {d.byDepartment.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-muted)' }}>
            <p style={{ margin: 0 }}>لا توجد عمليات محصّلة بعد — سيظهر التفصيل حسب الليزر/الجلدية/الأسنان/السولاريوم عند أول تحصيل.</p>
          </div>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
          {d.byDepartment.map((row) => (
            <div
              key={row.key}
              className="card"
              style={{
                minWidth: 200,
                flex: '1 1 220px',
                borderBottom: '3px solid var(--cyan)',
              }}
            >
              <p style={{ margin: 0, fontWeight: 800, color: 'var(--cyan)' }}>{row.label}</p>
              <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                عمليات: {row.transactionCount.toLocaleString('ar-SY')}
              </p>
              <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '0.5rem 0' }} />
              <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--success)' }}>كاش ل.س:</span> {formatSyp(row.cashSyp)}
              </p>
              <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }} dir="ltr">
                <span style={{ color: 'var(--cyan)' }}>كاش USD:</span> {formatUsd(row.cashUsd)}
              </p>
              <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }}>
                <span style={{ color: '#4f46e5' }}>بنك ل.س:</span> {formatSyp(row.bankSyp)}
              </p>
              <p style={{ margin: '0.2rem 0', fontSize: '0.85rem' }} dir="ltr">
                <span style={{ color: '#7c3aed' }}>بنك USD:</span> {formatUsd(row.bankUsd)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 0.65rem', color: 'var(--text)' }}>
          سجل العمليات ({opsRows.length.toLocaleString('ar-SY')})
        </h2>
        <div
          className="card"
          style={{
            marginBottom: '0.65rem',
            padding: '0.65rem 0.85rem',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.65rem',
              justifyContent: 'space-between',
            }}
          >
            <label
              className="form-label"
              htmlFor={showOpsDatePicker ? `inv-ops-log-date${sid}` : `inv-ops-log-date-readonly${sid}`}
              style={{ margin: 0 }}
            >
              تاريخ السجل
            </label>
            {showOpsDatePicker ? (
              <input
                id={`inv-ops-log-date${sid}`}
                type="date"
                className="input"
                dir="ltr"
                style={{ width: 'auto', minWidth: 160 }}
                value={operationsLogDate || businessDateStr || ''}
                onChange={(e) => onOperationsLogDateChange(e.target.value)}
                disabled={!businessDateStr}
              />
            ) : (
              <span
                id={`inv-ops-log-date-readonly${sid}`}
                className="input"
                dir="ltr"
                style={{
                  display: 'inline-block',
                  width: 'auto',
                  minWidth: 160,
                  opacity: 0.95,
                  cursor: 'default',
                  background: 'var(--surface-2, var(--surface))',
                }}
              >
                {businessDateStr || '—'}
              </span>
            )}
          </div>
          <p style={{ margin: '0.45rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.55 }}>
            {canBrowseOperationsHistory ? (
              <>
                يمكن <strong>لمدير النظام</strong> اختيار تاريخ السجل لعرض عمليات التحصيل المؤكدة لذلك اليوم. المعروض الآن:{' '}
                <strong>{operationsLogDateLabel || '—'}</strong>. ملخص الجرد أعلاه يبقى لـ <strong>يوم العمل الحالي ({dateLabel})</strong>.
              </>
            ) : (
              <>
                <strong>قسم الاستقبال</strong> يرى سجل العمليات لـ <strong>اليوم الحالي فقط</strong> (
                {operationsLogDateLabel || dateLabel}). ملخص الجرد أعلاه لنفس الفترة المعروضة.
              </>
            )}
          </p>
          {opsErr ? <p style={{ margin: '0.5rem 0 0', color: 'var(--danger)', fontSize: '0.85rem' }}>{opsErr}</p> : null}
        </div>
        <div
          className="card"
          style={{ padding: 0, overflow: 'auto', maxHeight: 'min(70vh, 720px)', border: '1px solid var(--border)' }}
        >
          {opsLoading ? (
            <div style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>جاري تحميل السجل…</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.86rem' }}>
              <thead>
                <tr style={{ background: 'linear-gradient(180deg, #e0f2fe, #eef2ff)', position: 'sticky', top: 0, zIndex: 1 }}>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>الوقت</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المريض</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المقدّم</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>القسم</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>الإجراء</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>القناة</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>عملة التحصيل</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'left' }} dir="ltr">
                    مستلم ل.س
                  </th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'left' }} dir="ltr">
                    مستلم USD
                  </th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>مستحق</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>فرق تسوية</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>ترجيع</th>
                  <th style={{ padding: '0.65rem 0.5rem', textAlign: 'right' }}>المحصّل</th>
                </tr>
              </thead>
              <tbody>
                {opsRows.length === 0 ? (
                  <tr>
                    <td colSpan={13} style={{ padding: '1.25rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                      لا توجد عمليات تحصيل مؤكدة للتاريخ المحدد ({operationsLogDateLabel || '—'}).
                    </td>
                  </tr>
                ) : (
                  opsRows.map((t, idx) => {
                    const debtRow = t.transactionKind === 'debt_settlement'
                    const cashRow = t.paymentChannel === 'cash'
                    const bg = debtRow
                      ? idx % 2 === 0
                        ? 'rgba(217,119,6,0.08)'
                        : 'rgba(217,119,6,0.12)'
                      : cashRow
                        ? idx % 2 === 0
                          ? 'rgba(22,163,74,0.06)'
                          : 'rgba(22,163,74,0.1)'
                        : idx % 2 === 0
                          ? 'rgba(99,102,241,0.06)'
                          : 'rgba(99,102,241,0.1)'
                    return (
                      <tr key={`${sectionKey}-${t.paymentId}`} style={{ background: bg }}>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{formatTime(t.paidAt)}</td>
                        <td style={{ padding: '0.5rem', fontWeight: 600 }}>{t.patientName}</td>
                        <td style={{ padding: '0.5rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{t.providerName}</td>
                        <td style={{ padding: '0.5rem' }}>{t.departmentLabel}</td>
                        <td style={{ padding: '0.5rem', maxWidth: 160, color: 'var(--text-muted)' }}>{t.procedureLabel}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '0.12rem 0.45rem',
                              borderRadius: 999,
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              background: cashRow ? 'var(--success-dim)' : 'var(--violet-dim)',
                              color: cashRow ? 'var(--success)' : 'var(--violet)',
                            }}
                          >
                            {cashRow ? 'كاش' : `بنك: ${t.bankName}`}
                          </span>
                        </td>
                        <td style={{ padding: '0.5rem', fontWeight: 700 }}>{t.payCurrency === 'USD' ? 'USD' : 'ل.س'}</td>
                        <td style={{ padding: '0.5rem', direction: 'ltr', textAlign: 'left' }}>
                          {t.receivedAmountSyp.toLocaleString('ar-SY')}
                        </td>
                        <td style={{ padding: '0.5rem', direction: 'ltr', textAlign: 'left' }}>
                          {t.receivedAmountUsd > 0 ? t.receivedAmountUsd.toFixed(2) : '—'}
                        </td>
                        <td style={{ padding: '0.5rem' }}>{t.amountDueSyp.toLocaleString('ar-SY')}</td>
                        <td
                          style={{
                            padding: '0.5rem',
                            fontWeight: 600,
                            color:
                              t.settlementDeltaSyp > 0
                                ? 'var(--success)'
                                : t.settlementDeltaSyp < 0
                                  ? 'var(--danger)'
                                  : 'var(--text-muted)',
                          }}
                        >
                          {t.settlementDeltaSyp > 0 ? '+' : ''}
                          {t.settlementDeltaSyp.toLocaleString('ar-SY')}
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.8rem' }}>
                          {t.patientRefundSyp > 0 || t.patientRefundUsd > 0 ? (
                            <>
                              {t.patientRefundSyp > 0 ? `${t.patientRefundSyp.toLocaleString('ar-SY')} ل.س` : null}
                              {t.patientRefundSyp > 0 && t.patientRefundUsd > 0 ? ' + ' : null}
                              {t.patientRefundUsd > 0 ? `${t.patientRefundUsd.toFixed(2)} USD` : null}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t.receivedByName}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  )
}
