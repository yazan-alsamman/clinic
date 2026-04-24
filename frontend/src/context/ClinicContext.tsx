import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api } from '../api/client'
import { useAuth } from './AuthContext'

interface SystemStatus {
  businessDate: string
  dayActive: boolean
  dayClosed: boolean
  /** ليرة سورية لكل 1 USD — يُحدَّد عند بدء يوم العمل */
  usdSypRate: number | null
  room1MeterStart: number | null
  room2MeterStart: number | null
  room1MeterEnd: number | null
  room2MeterEnd: number | null
}

interface ClinicContextValue {
  dayActive: boolean
  businessDate: string | null
  dayClosed: boolean
  /** سعر الصرف لليوم النشط (ل.س لكل 1 USD) أو null */
  usdSypRate: number | null
  systemLoading: boolean
  refreshSystem: () => Promise<void>
  startDay: (input: {
    room1MeterStart: number
    room2MeterStart: number
    usdSypRate: number
  }) => Promise<void>
  endDay: (input: {
    room1MeterEnd: number
    room2MeterEnd: number
    confirm: string
  }) => Promise<void>
}

const ClinicContext = createContext<ClinicContextValue | null>(null)

export function ClinicProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [status, setStatus] = useState<SystemStatus | null>(null)
  const [systemLoading, setSystemLoading] = useState(true)

  const refreshSystem = useCallback(async () => {
    try {
      const data = await api<SystemStatus>('/api/system/status')
      setStatus(data)
    } catch {
      setStatus(null)
    } finally {
      setSystemLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshSystem()
  }, [refreshSystem])

  useEffect(() => {
    if (user) void refreshSystem()
  }, [user, refreshSystem])

  useEffect(() => {
    if (!user) return
    const id = window.setInterval(() => {
      void refreshSystem()
    }, 15000)
    return () => window.clearInterval(id)
  }, [user, refreshSystem])

  const startDay = useCallback(
    async (input: { room1MeterStart: number; room2MeterStart: number; usdSypRate: number }) => {
      await api('/api/system/start-day', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      await refreshSystem()
    },
    [refreshSystem],
  )

  const endDay = useCallback(
    async (input: {
      room1MeterEnd: number
      room2MeterEnd: number
      confirm: string
    }) => {
      await api('/api/system/close-day', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      await refreshSystem()
    },
    [refreshSystem],
  )

  const value = useMemo(
    () => ({
      dayActive: Boolean(status?.dayActive),
      businessDate: status?.businessDate ?? null,
      dayClosed: Boolean(status?.dayClosed),
      usdSypRate:
        status?.usdSypRate != null && Number.isFinite(Number(status.usdSypRate)) && Number(status.usdSypRate) > 0
          ? Number(status.usdSypRate)
          : null,
      systemLoading,
      refreshSystem,
      startDay,
      endDay,
    }),
    [
      status?.dayActive,
      status?.businessDate,
      status?.dayClosed,
      status?.usdSypRate,
      systemLoading,
      refreshSystem,
      startDay,
      endDay,
    ],
  )

  return (
    <ClinicContext.Provider value={value}>{children}</ClinicContext.Provider>
  )
}

export function useClinic() {
  const ctx = useContext(ClinicContext)
  if (!ctx) throw new Error('useClinic outside ClinicProvider')
  return ctx
}
