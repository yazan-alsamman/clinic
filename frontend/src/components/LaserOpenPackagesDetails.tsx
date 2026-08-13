export type LaserBookingOpenPackage = {
  id: string
  title: string
  notes: string
  sessionsCount: number
  sessionsCompleted: number
  sessionsAvailable: number
  sessionsLinkedOpen: number
  sessionsRemaining: number
  areaCount: number
  areaLabels: string[]
  remainingAreas?: string[]
  procedureOptionIds?: string[]
  packageTotalSyp: number
  paidAmountSyp: number
  isPartial: boolean
  isFreshTarget: boolean
}

export type LaserBookingContext = {
  hasOpenPackage: boolean
  hasFreshPackageSession: boolean
  partialVisit: {
    packageId: string
    packageSessionId: string
    packageTitle: string
    packageSessionLabel: string
    doneAreas: string[]
    remainingAreas: string[]
    remainingProcedureOptionIds: string[]
    linkedLaserSessionId: string
  } | null
  openPackages?: LaserBookingOpenPackage[]
}

function formatSypShort(n: number) {
  return `${Math.round(Number(n) || 0).toLocaleString('ar-SY')} ل.س`
}

export function LaserOpenPackagesDetails({
  packages,
  compact = false,
}: {
  packages: LaserBookingOpenPackage[]
  compact?: boolean
}) {
  if (!packages.length) return null
  return (
    <div
      style={{
        display: 'grid',
        gap: compact ? '0.45rem' : '0.65rem',
        marginBottom: compact ? '0.55rem' : '0.75rem',
      }}
    >
      {packages.map((pkg) => (
        <div
          key={pkg.id}
          style={{
            padding: '0.55rem 0.65rem',
            borderRadius: 8,
            border: pkg.isPartial ? '1px solid var(--amber)' : '1px solid var(--border)',
            background: pkg.isPartial ? 'var(--warning-dim)' : 'var(--surface-2, var(--surface))',
            fontSize: '0.86rem',
            lineHeight: 1.55,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: '0.2rem' }}>
            {pkg.title}
            {pkg.isPartial ? (
              <span style={{ color: 'var(--amber)', fontWeight: 600, marginRight: '0.35rem' }}>
                — جلسة ناقصة المناطق
              </span>
            ) : null}
          </div>
          <div>
            الجلسات: اكتمل {pkg.sessionsCompleted} من {pkg.sessionsCount}
            {pkg.sessionsAvailable > 0 ? ` — متاح للحجز الآن: ${pkg.sessionsAvailable}` : ''}
            {pkg.sessionsLinkedOpen > 0 ? ` — جارية/مربوطة: ${pkg.sessionsLinkedOpen}` : ''}
          </div>
          <div>
            نوع الباكج / المناطق ({pkg.areaCount}):{' '}
            <strong>{pkg.areaLabels.length ? pkg.areaLabels.join('، ') : '—'}</strong>
          </div>
          {(pkg.remainingAreas || []).length > 0 ? (
            <div style={{ color: 'var(--amber)', fontWeight: 600 }}>
              مناطق متبقية من الباكج: {(pkg.remainingAreas || []).join('، ')}
            </div>
          ) : null}
          {!compact ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              إجمالي الباكج: {formatSypShort(pkg.packageTotalSyp)} — المدفوع: {formatSypShort(pkg.paidAmountSyp)}
            </div>
          ) : null}
          {pkg.notes ? (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>ملاحظة: {pkg.notes}</div>
          ) : null}
        </div>
      ))}
    </div>
  )
}
