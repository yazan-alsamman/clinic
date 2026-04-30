import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedLayout } from './components/ProtectedLayout'
import { AppShell } from './components/AppShell'
import { Login } from './pages/Login'
import { PatientPortalGuard } from './components/PatientPortalGuard'
import { PatientPortalShell } from './components/PatientPortalShell'

// All page components are lazy-loaded: each route becomes its own JS chunk.
// This keeps the initial bundle small and defers xlsx (used only in DailyReport)
// until that page is actually visited.
const lazyPage = <T extends Record<string, React.ComponentType>>(
  loader: () => Promise<T>,
  name: keyof T,
) => lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })))

const Dashboard                 = lazyPage(() => import('./pages/Dashboard'), 'Dashboard')
const PatientSearch             = lazyPage(() => import('./pages/PatientSearch'), 'PatientSearch')
const PatientFastIntakePage     = lazyPage(() => import('./pages/PatientFastIntakePage'), 'PatientFastIntakePage')
const PatientRecord             = lazyPage(() => import('./pages/PatientRecord'), 'PatientRecord')
const BookedAppointmentsPage    = lazyPage(() => import('./pages/BookedAppointmentsPage'), 'BookedAppointmentsPage')
const ReceptionAppointmentPage  = lazyPage(() => import('./pages/ReceptionAppointmentPage'), 'ReceptionAppointmentPage')
const DentalPage                = lazyPage(() => import('./pages/DentalPage'), 'DentalPage')
const InventoryPage             = lazyPage(() => import('./pages/InventoryPage'), 'InventoryPage')
const DailyReport               = lazyPage(() => import('./pages/DailyReport'), 'DailyReport')
const InsightsPage              = lazyPage(() => import('./pages/InsightsPage'), 'InsightsPage')
const AdminUsers                = lazyPage(() => import('./pages/AdminUsers'), 'AdminUsers')
const AdminSendNotificationsPage = lazyPage(() => import('./pages/AdminSendNotificationsPage'), 'AdminSendNotificationsPage')
const AdminAudit                = lazyPage(() => import('./pages/AdminAudit'), 'AdminAudit')
const AdminRooms                = lazyPage(() => import('./pages/AdminRooms'), 'AdminRooms')
const AdminLaserPage            = lazyPage(() => import('./pages/AdminLaserPage'), 'AdminLaserPage')
const AdminAccounting           = lazyPage(() => import('./pages/AdminAccounting'), 'AdminAccounting')
const AdminFinancialBalances    = lazyPage(() => import('./pages/AdminFinancialBalances'), 'AdminFinancialBalances')
const BillingPage               = lazyPage(() => import('./pages/BillingPage'), 'BillingPage')
const ReceptionCashMovementPage = lazyPage(() => import('./pages/ReceptionCashMovementPage'), 'ReceptionCashMovementPage')
const ReceptionDailyInventoryPage = lazyPage(() => import('./pages/ReceptionDailyInventoryPage'), 'ReceptionDailyInventoryPage')
const AccountPassword           = lazyPage(() => import('./pages/AccountPassword'), 'AccountPassword')
const LaserCreateSessionPage    = lazyPage(() => import('./pages/LaserCreateSessionPage'), 'LaserCreateSessionPage')
const SkinCreateSessionPage = lazyPage(() => import('./pages/SkinCreateSessionPage'), 'SkinCreateSessionPage')
const DermatologyCreateSessionPage = lazyPage(
  () => import('./pages/DermatologyCreateSessionPage'),
  'DermatologyCreateSessionPage',
)
const DermatologyFinancePage = lazyPage(() => import('./pages/DermatologyFinancePage'), 'DermatologyFinancePage')
const AdminSkinProceduresPage = lazyPage(() => import('./pages/AdminSkinProceduresPage'), 'AdminSkinProceduresPage')

const PatientPortalDashboard    = lazyPage(() => import('./pages/patient-portal/PatientPortalDashboard'), 'PatientPortalDashboard')
const PatientPortalProfile      = lazyPage(() => import('./pages/patient-portal/PatientPortalProfile'), 'PatientPortalProfile')
const PatientPortalRecords      = lazyPage(() => import('./pages/patient-portal/PatientPortalRecords'), 'PatientPortalRecords')
const PatientPortalAppointments = lazyPage(() => import('./pages/patient-portal/PatientPortalAppointments'), 'PatientPortalAppointments')
const PatientPortalFinancial    = lazyPage(() => import('./pages/patient-portal/PatientPortalFinancial'), 'PatientPortalFinancial')
const PatientPortalSecurity     = lazyPage(() => import('./pages/patient-portal/PatientPortalSecurity'), 'PatientPortalSecurity')

function PageLoader() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--text-muted)',
      }}
    >
      جاري التحميل…
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/patient/login" element={<Navigate to="/login" replace />} />
            <Route element={<PatientPortalGuard />}>
              <Route path="/patient" element={<PatientPortalShell />}>
                <Route index element={<PatientPortalDashboard />} />
                <Route path="profile" element={<PatientPortalProfile />} />
                <Route path="records" element={<PatientPortalRecords />} />
                <Route path="appointments" element={<PatientPortalAppointments />} />
                <Route path="financial" element={<PatientPortalFinancial />} />
                <Route path="security" element={<PatientPortalSecurity />} />
              </Route>
            </Route>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedLayout />}>
              <Route element={<AppShell />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/patients" element={<PatientSearch />} />
                <Route path="/patients/intake-fast" element={<PatientFastIntakePage />} />
                <Route path="/patients/:id" element={<PatientRecord />} />
                <Route path="/appointments" element={<BookedAppointmentsPage />} />
                <Route path="/laser/create-session" element={<LaserCreateSessionPage />} />
                <Route path="/skin/create-session" element={<SkinCreateSessionPage />} />
                <Route path="/dermatology/create-session" element={<DermatologyCreateSessionPage />} />
                <Route path="/dermatology/finance" element={<DermatologyFinancePage />} />
                <Route path="/reception/appointment" element={<ReceptionAppointmentPage />} />
                <Route path="/dental" element={<DentalPage />} />
                <Route path="/billing" element={<BillingPage />} />
                <Route path="/reception/cash-movement" element={<ReceptionCashMovementPage />} />
                <Route path="/reception/daily-inventory" element={<ReceptionDailyInventoryPage />} />
                <Route path="/inventory" element={<InventoryPage />} />
                <Route path="/reports/daily" element={<DailyReport />} />
                <Route path="/reports/insights" element={<InsightsPage />} />
                <Route path="/admin/users" element={<AdminUsers />} />
                <Route path="/admin/skin-procedures" element={<AdminSkinProceduresPage />} />
                <Route path="/admin/send-notifications" element={<AdminSendNotificationsPage />} />
                <Route path="/admin/audit" element={<AdminAudit />} />
                <Route path="/admin/rooms" element={<AdminRooms />} />
                <Route path="/admin/laser" element={<AdminLaserPage />} />
                <Route path="/admin/accounting" element={<AdminAccounting />} />
                <Route path="/admin/financial-balances" element={<AdminFinancialBalances />} />
                <Route path="/account/password" element={<AccountPassword />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  )
}
