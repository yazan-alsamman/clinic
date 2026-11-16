import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'

export type LaserAreaHistoryEntry = {
  id: string
  source: 'laser_visit' | 'manual' | 'legacy_session' | string
  legacyUnverified: boolean
  laserSessionId: string | null
  date: string | null
  visitDate?: string
  byName?: string
  note?: string
  reversed: boolean
  reverseReason?: string
}

export type LaserAreaBalance = {
  key: string
  label: string
  sessionsTotal: number
  usedSessions: number
  remainingSessions: number
  legacyUsedSessions: number
  legacyUnverifiedSessions: number
  history: LaserAreaHistoryEntry[]
}

export type LaserPackageVisit = {
  key: string
  source: string
  laserSessionId: string | null
  treatmentNumber?: number | null
  date: string | null
  visitDate: string
  byName: string
  note: string
  areas: {
    key: string
    label: string
    deductionId: string | null
    reversed: boolean
    reverseReason: string
    legacyUnverified: boolean
  }[]
}

export type LaserPackageLedger = {
  packageId: string
  title: string
  suspended: boolean
  sessionsCount: number
  legacyCompletedSessions: number
  areas: LaserAreaBalance[]
  visits: LaserPackageVisit[]
}

export type LaserAddonService = {
  id: string
  laserSessionId: string
  businessDate: string
  label: string
  priceSyp: number
  status: string
  paidAt: string | null
}

export type LaserPackageLedgerResponse = { packages: LaserPackageLedger[]; addonServices: LaserAddonService[] }

export function useLaserPackageLedger(patientId: string | undefined, refreshKey: unknown) {
  const [data, setData] = useState<LaserPackageLedgerResponse | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    if (!patientId) return
    let alive = true
    api<LaserPackageLedgerResponse>(`/api/patients/${encodeURIComponent(patientId)}/laser-package-ledger`)
      .then((d) => {
        if (!alive) return
        setData(d)
        setErr('')
      })
      .catch((e) => {
        if (alive) setErr(e instanceof ApiError ? e.message : 'تعذر تحميل أرصدة مناطق الباكج')
      })
    return () => {
      alive = false
    }
  }, [patientId, refreshKey])
  return { data, err, setData }
}
