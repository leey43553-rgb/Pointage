export interface PublicConfig {
  company_name: string;
  logo_data_url: string | null;
  official_start_time: string;
  grace_minutes: number;
  server_time: string;
  server_date: string;
  client_ip: string;
}

export interface EmployeeProfile {
  id: number;
  first_name: string;
  last_name: string;
  job_title: string;
}

export interface EmployeeFull extends EmployeeProfile {
  code: string;
  is_active: number;
  created_at: string;
}

export interface EmployeeListOption extends EmployeeProfile {
  is_active: number;
}

export interface AttendanceRecord {
  id: number;
  employee_id: number;
  work_date: string;
  checkin_time: string | null;
  checkout_time: string | null;
  checkin_ip: string | null;
  checkout_ip: string | null;
  is_late: number;
  late_minutes: number;
  worked_minutes: number;
  created_at: string;
}

export interface AdminUser {
  id: number;
  username: string;
  role: 'super_admin' | 'admin';
  must_change_password: boolean;
  created_at?: string;
}

export interface TodayEmployeeRow {
  employee_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  status: 'present' | 'late' | 'absent';
  checkin_time: string | null;
  checkout_time: string | null;
  late_minutes: number;
  worked_minutes: number;
  checkin_ip: string | null;
  checkout_ip: string | null;
}

export interface TodayDashboardResponse {
  date: string;
  summary: {
    total_active: number;
    present_total: number;
    on_time: number;
    late: number;
    absent: number;
  };
  employees: TodayEmployeeRow[];
}

export interface MonthlyEmployeeRow {
  employee_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  is_active: boolean;
  days_present: number;
  days_late: number;
  total_late_minutes: number;
  total_worked_minutes: number;
}

export interface AdminAttendanceRow {
  id: number;
  employee_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  work_date: string;
  checkin_time: string | null;
  checkout_time: string | null;
  checkin_ip: string | null;
  checkout_ip: string | null;
  is_late: number;
  late_minutes: number;
  worked_minutes: number;
}

export interface AttendanceLogRow {
  id: number;
  employee_id: number;
  employee_name: string;
  action: 'checkin' | 'checkout';
  log_date: string;
  log_time: string;
  ip_address: string;
  created_at: string;
}

export interface AppSettings {
  id: number;
  company_name: string;
  logo_data_url: string | null;
  official_start_time: string;
  grace_minutes: number;
  allowed_network_prefix: string;
  updated_at: string;
}
