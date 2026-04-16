import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ProtectedLayout } from './components/ProtectedLayout'
import { AppShell } from './components/AppShell'
import { Login } from './pages/Login'
import { Dashboard } from './pages/Dashboard'
import { PatientSearch } from './pages/PatientSearch'
import { PatientFastIntakePage } from './pages/PatientFastIntakePage'
import { PatientRecord } from './pages/PatientRecord'
import { BookedAppointmentsPage } from './pages/BookedAppointmentsPage'
import { ReceptionAppointmentPage } from './pages/ReceptionAppointmentPage'
import { DermatologyToday } from './pages/DermatologyToday'
import { DentalPage } from './pages/DentalPage'
import { InventoryPage } from './pages/InventoryPage'
import { DailyReport } from './pages/DailyReport'
import { InsightsPage } from './pages/InsightsPage'
import { AdminUsers } from './pages/AdminUsers'
import { AdminAudit } from './pages/AdminAudit'
import { AdminRooms } from './pages/AdminRooms'
import { AdminAccounting } from './pages/AdminAccounting'
import { BillingPage } from './pages/BillingPage'
import { AccountPassword } from './pages/AccountPassword'
import { PatientPortalGuard } from './components/PatientPortalGuard'
import { PatientPortalShell } from './components/PatientPortalShell'
import { PatientPortalDashboard } from './pages/patient-portal/PatientPortalDashboard'
import { PatientPortalProfile } from './pages/patient-portal/PatientPortalProfile'
import { PatientPortalRecords } from './pages/patient-portal/PatientPortalRecords'
import { PatientPortalAppointments } from './pages/patient-portal/PatientPortalAppointments'
import { PatientPortalSecurity } from './pages/patient-portal/PatientPortalSecurity'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/patient/login" element={<Navigate to="/login" replace />} />
          <Route element={<PatientPortalGuard />}>
            <Route path="/patient" element={<PatientPortalShell />}>
              <Route index element={<PatientPortalDashboard />} />
              <Route path="profile" element={<PatientPortalProfile />} />
              <Route path="records" element={<PatientPortalRecords />} />
              <Route path="appointments" element={<PatientPortalAppointments />} />
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
              <Route path="/reception/appointment" element={<ReceptionAppointmentPage />} />
              <Route path="/dermatology" element={<DermatologyToday />} />
              <Route path="/dental" element={<DentalPage />} />
              <Route path="/billing" element={<BillingPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/reports/daily" element={<DailyReport />} />
              <Route path="/reports/insights" element={<InsightsPage />} />
              <Route path="/admin/users" element={<AdminUsers />} />
              <Route path="/admin/audit" element={<AdminAudit />} />
              <Route path="/admin/rooms" element={<AdminRooms />} />
              <Route path="/admin/accounting" element={<AdminAccounting />} />
              <Route path="/account/password" element={<AccountPassword />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
