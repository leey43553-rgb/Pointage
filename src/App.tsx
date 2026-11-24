import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from './api';
import { AdminDashboard } from './components/AdminDashboard';
import { AdminLoginScreen } from './components/AdminLoginScreen';
import { EmployeePinScreen } from './components/EmployeePinScreen';
import { EmployeePortal } from './components/EmployeePortal';
import { OfflineIndicator } from './pwa/OfflineIndicator';
import type { AdminUser, AttendanceRecord, EmployeeProfile, PublicConfig } from './types';

type AppSession =
  | { kind: 'pin' }
  | {
      kind: 'employee';
      token: string;
      employee: EmployeeProfile;
      todayAttendance: AttendanceRecord | null;
    }
  | { kind: 'admin_login' }
  | {
      kind: 'admin';
      token: string;
      admin: AdminUser;
    };

export default function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [session, setSession] = useState<AppSession>({ kind: 'pin' });

  const loadConfig = useCallback(async () => {
    try {
      const data = await apiRequest<PublicConfig>('/api/public/config');
      setConfig(data);
    } catch {
      // keep existing or fallback
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  return (
    <>
      <OfflineIndicator />

      {session.kind === 'pin' && (
        <EmployeePinScreen
          config={config}
          onLoginSuccess={(data) =>
            setSession({
              kind: 'employee',
              token: data.token,
              employee: data.employee,
              todayAttendance: data.today_attendance,
            })
          }
          onOpenAdminLogin={() => setSession({ kind: 'admin_login' })}
        />
      )}

      {session.kind === 'employee' && (
        <EmployeePortal
          token={session.token}
          employee={session.employee}
          initialAttendance={session.todayAttendance}
          config={config}
          onLogout={() => {
            void loadConfig();
            setSession({ kind: 'pin' });
          }}
        />
      )}

      {session.kind === 'admin_login' && (
        <AdminLoginScreen
          config={config}
          onLoginSuccess={(data) =>
            setSession({
              kind: 'admin',
              token: data.token,
              admin: data.admin,
            })
          }
          onBack={() => setSession({ kind: 'pin' })}
        />
      )}

      {session.kind === 'admin' && (
        <AdminDashboard
          token={session.token}
          admin={session.admin}
          config={config}
          onRefreshConfig={() => void loadConfig()}
          onLogout={() => {
            void loadConfig();
            setSession({ kind: 'pin' });
          }}
        />
      )}
    </>
  );
}
