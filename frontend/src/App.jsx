import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';

// Pages
import LoginPage        from './pages/LoginPage.jsx';
import RegisterPage     from './pages/RegisterPage.jsx';
import HomePage         from './pages/HomePage.jsx';
import TeamPickerPage   from './pages/TeamPickerPage.jsx';
import LiveScorePage    from './pages/LiveScorePage.jsx';
import MatchResultPage  from './pages/MatchResultPage.jsx';
import LeaderboardPage  from './pages/LeaderboardPage.jsx';
import SettingsPage     from './pages/SettingsPage.jsx';
import AdminDashboard   from './pages/admin/AdminDashboard.jsx';
import AdminMatchPage   from './pages/admin/AdminMatchPage.jsx';
import AdminUsersPage   from './pages/admin/AdminUsersPage.jsx';

// Layout
import BottomNav        from './components/common/BottomNav.jsx';
import Spinner          from './components/common/Spinner.jsx';

function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading, isAdmin } = useAuth();
  if (loading) return <div className="loading-center"><Spinner /></div>;
  if (!user)   return <Navigate to="/login" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return children;
}

function PublicOnlyRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-center"><Spinner /></div>;
  if (user)    return <Navigate to="/" replace />;
  return children;
}

function AppLayout({ children }) {
  return (
    <>
      <main>{children}</main>
      <BottomNav />
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public */}
          <Route path="/login"    element={<PublicOnlyRoute><LoginPage /></PublicOnlyRoute>} />
          <Route path="/register" element={<PublicOnlyRoute><RegisterPage /></PublicOnlyRoute>} />

          {/* Protected user routes */}
          <Route path="/" element={
            <ProtectedRoute>
              <AppLayout><HomePage /></AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/match/:matchId/pick" element={
            <ProtectedRoute>
              <AppLayout><TeamPickerPage /></AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/match/:matchId/live" element={
            <ProtectedRoute>
              <AppLayout><LiveScorePage /></AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/match/:matchId/result" element={
            <ProtectedRoute>
              <AppLayout><MatchResultPage /></AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/leaderboard" element={
            <ProtectedRoute>
              <AppLayout><LeaderboardPage /></AppLayout>
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <AppLayout><SettingsPage /></AppLayout>
            </ProtectedRoute>
          } />

          {/* Admin routes */}
          <Route path="/admin" element={
            <ProtectedRoute adminOnly>
              <AdminDashboard />
            </ProtectedRoute>
          } />
          <Route path="/admin/match/:matchId" element={
            <ProtectedRoute adminOnly>
              <AdminMatchPage />
            </ProtectedRoute>
          } />
          <Route path="/admin/users" element={
            <ProtectedRoute adminOnly>
              <AdminUsersPage />
            </ProtectedRoute>
          } />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
