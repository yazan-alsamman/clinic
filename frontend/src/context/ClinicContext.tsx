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
  usdSypRate: number | null
  dayClosed: boolean
}

interface ClinicContextValue {
  dayActive: boolean
  businessDate: string | null
  usdSypRate: number | null
  dayClosed: boolean
  systemLoading: boolean
  refreshSystem: () => Promise<void>
  startDay: (rate: number) => Promise<void>
  endDay: () => Promise<void>
  updateExchangeRate: (rate: number) => Promise<void>
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
    async (rate: number) => {
      await api('/api/system/start-day', {
        method: 'POST',
        body: JSON.stringify({ rate }),
      })
      await refreshSystem()
    },
    [refreshSystem],
  )

  const endDay = useCallback(async () => {
    await api('/api/system/close-day', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'CLOSE' }),
    })
    await refreshSystem()
  }, [refreshSystem])

  const updateExchangeRate = useCallback(
    async (rate: number) => {
      await api('/api/system/exchange-rate', {
        method: 'PATCH',
        body: JSON.stringify({ rate }),
      })
      await refreshSystem()
    },
    [refreshSystem],
  )

  const value = useMemo(
    () => ({
      dayActive: Boolean(status?.dayActive),
      businessDate: status?.businessDate ?? null,
      usdSypRate: status?.usdSypRate ?? null,
      dayClosed: Boolean(status?.dayClosed),
      systemLoading,
      refreshSystem,
      startDay,
      endDay,
      updateExchangeRate,
    }),
    [
      status?.dayActive,
      status?.businessDate,
      status?.usdSypRate,
      status?.dayClosed,
      systemLoading,
      refreshSystem,
      startDay,
      endDay,
      updateExchangeRate,
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
