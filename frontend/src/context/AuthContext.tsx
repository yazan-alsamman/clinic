import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { api, getToken, setToken, setPatientToken } from '../api/client'
import type { Role } from '../types'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: Role
  active: boolean
}

function normalizeRole(raw: unknown): Role {
  const role = String(raw || '').trim().toLowerCase()
  if (role === 'super_admin') return 'super_admin'
  if (role === 'reception') return 'reception'
  if (role === 'laser') return 'laser'
  if (role === 'dermatology') return 'dermatology'
  if (role === 'dental_branch') return 'dental_branch'
  if (role === 'solarium') return 'solarium'
  if (
    role === 'dermatology_manager' ||
    role === 'dermatology head' ||
    role === 'dermatology_head' ||
    role === 'dermatology-manager'
  ) {
    return 'dermatology_manager'
  }
  if (
    role === 'dermatology_assistant_manager' ||
    role === 'dermatology assistant manager' ||
    role === 'dermatology_assistant_head' ||
    role === 'dermatology-assistant-manager'
  ) {
    return 'dermatology_assistant_manager'
  }
  return 'reception'
}

function normalizeAuthUser(raw: AuthUser): AuthUser {
  return {
    ...raw,
    role: normalizeRole(raw?.role),
  }
}

export type LoginResult =
  | { accountType: 'staff' }
  | { accountType: 'patient'; mustChangePassword: boolean }

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  sessionMinutesLeft: number | null
  login: (identifier: string, password: string) => Promise<LoginResult>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionMinutesLeft, setSessionMinutesLeft] = useState<number | null>(null)

  const refreshUser = useCallback(async () => {
    const t = getToken()
    if (!t) {
      setUser(null)
      setSessionMinutesLeft(null)
      setLoading(false)
      return
    }
    try {
      const data = await api<{ user: AuthUser; sessionMinutesLeft: number | null }>(
        '/api/auth/me',
      )
      setUser(normalizeAuthUser(data.user))
      setSessionMinutesLeft(data.sessionMinutesLeft ?? null)
    } catch {
      setToken(null)
      setUser(null)
      setSessionMinutesLeft(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshUser()
  }, [refreshUser])

  const login = useCallback(async (identifier: string, password: string) => {
    const data = await api<{
      accountType: 'staff' | 'patient'
      token: string
      user?: AuthUser
      mustChangePassword?: boolean
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login: identifier.trim(), password }),
    })
    if (data.accountType === 'patient') {
      setPatientToken(data.token)
      setToken(null)
      setUser(null)
      setSessionMinutesLeft(null)
      return {
        accountType: 'patient' as const,
        mustChangePassword: data.mustChangePassword === true,
      }
    }
    setPatientToken(null)
    setToken(data.token)
    const me = await api<{ user: AuthUser; sessionMinutesLeft: number | null }>(
      '/api/auth/me',
    )
    setUser(normalizeAuthUser(me.user))
    setSessionMinutesLeft(me.sessionMinutesLeft ?? null)
    return { accountType: 'staff' as const }
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setPatientToken(null)
    setUser(null)
    setSessionMinutesLeft(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      sessionMinutesLeft,
      login,
      logout,
      refreshUser,
    }),
    [user, loading, sessionMinutesLeft, login, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
