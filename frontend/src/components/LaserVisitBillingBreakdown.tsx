export type LaserVisitBreakdown = {
  laserSessionId: string
  packageCovered: {
    key: string
    label: string
    packageId: string
    packageTitle: string
    deductionStatus: 'deducted' | 'pending' | 'no_balance'
    sessionsTotal: number
    remainingAfter: number
    additionalChargeSyp: number
  }[]
  noBalanceLabels: string[]
  addonServices: { label: string; originalPriceSyp: number }[]
  addonBills: { billingItemId: string; status: string; amountDueSyp: number }[]
  addonSubtotalSyp: number
  addonAmountDueSyp: number
  addonPendingSyp: number
  addonPaidSyp: number
  packageChargeSyp: number
}

function money(n: number) {
  return `${Math.round(Number(n) || 0).toLocaleString('ar-SY')} ل.س`
}

const cell = { padding: '0.25rem 0.35rem', textAlign: 'start' as const }

/**
 * ملخص زيارة ليزر قبل الدفع: ما غطّاه الباكج (بلا رسوم) منفصلاً عن الخدمات الإضافية ومجموعها.
 */
export function LaserVisitBillingBreakdown({ breakdown }: { breakdown: LaserVisitBreakdown | undefined }) {
  if (!breakdown) return null
  const { packageCovered, addonServices } = breakdown
  if (!packageCovered.length && !addonServices.length && !breakdown.noBalanceLabels.length) return null
  return (
    <div
      style={{
        marginTop: '0.5rem',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.5rem 0.6rem',
        fontSize: '0.84rem',
        display: 'grid',
        gap: '0.5rem',
      }}
    >
      <div>
        <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>علاجات مغطاة بالباكج</div>
        {packageCovered.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th style={cell}>المنطقة</th>
                  <th style={cell}>الباكج</th>
                  <th style={cell}>إنقاص الجلسات</th>
                  <th style={cell}>رسوم إضافية</th>
                </tr>
              </thead>
              <tbody>
                {packageCovered.map((r) => (
                  <tr key={`${r.packageId}|${r.key}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ ...cell, fontWeight: 600 }}>{r.label}</td>
                    <td style={cell}>{r.packageTitle}</td>
                    <td style={cell}>
                      {r.deductionStatus === 'deducted'
                        ? `أُنقصت جلسة — يبقى ${r.remainingAfter} من ${r.sessionsTotal}`
                        : r.deductionStatus === 'pending'
                          ? `جلسة واحدة — يبقى ${r.remainingAfter} من ${r.sessionsTotal}`
                          : 'لا رصيد متبقٍ'}
                    </td>
                    <td style={cell}>{money(r.additionalChargeSyp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>لا توجد منطقة باكج في هذه الزيارة.</div>
        )}
        {breakdown.noBalanceLabels.length ? (
          <div style={{ color: 'var(--danger)', marginTop: '0.2rem' }}>
            مسجّلة كمنطقة باكج بلا رصيد: {breakdown.noBalanceLabels.join('، ')}
          </div>
        ) : null}
      </div>

      <div>
        <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>خدمات إضافية خارج الباكجات</div>
        {addonServices.length ? (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)' }}>
                    <th style={cell}>الخدمة</th>
                    <th style={cell}>السعر الأصلي</th>
                  </tr>
                </thead>
                <tbody>
                  {addonServices.map((s, i) => (
                    <tr key={`${s.label}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...cell, fontWeight: 600 }}>{s.label}</td>
                      <td style={cell}>{money(s.originalPriceSyp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: '0.3rem', display: 'grid', gap: '0.1rem' }}>
              <div>
                المجموع الفرعي للخدمات الإضافية: <strong>{money(breakdown.addonSubtotalSyp)}</strong>
              </div>
              {breakdown.addonAmountDueSyp !== breakdown.addonSubtotalSyp ? (
                <div>
                  المطلوب دفعه بعد الخصم/الكفر: <strong>{money(breakdown.addonAmountDueSyp)}</strong>
                </div>
              ) : null}
              {breakdown.addonPaidSyp > 0 ? (
                <div style={{ color: 'var(--success)' }}>مدفوع: {money(breakdown.addonPaidSyp)}</div>
              ) : null}
              {breakdown.addonPendingSyp > 0 ? (
                <div style={{ color: 'var(--warning)' }}>بانتظار التحصيل: {money(breakdown.addonPendingSyp)}</div>
              ) : null}
            </div>
          </>
        ) : (
          <div style={{ color: 'var(--text-muted)' }}>لا توجد خدمات إضافية — المطلوب لهذه الزيارة {money(0)}.</div>
        )}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
        المناطق المغطاة لا تضيف أي مبلغ (الباكج مدفوع مسبقاً)، والخدمات الإضافية لا تُنقص أي جلسة ولا تغيّر سعر الباكج.
      </div>
    </div>
  )
}
