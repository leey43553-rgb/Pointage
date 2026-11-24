export type PhotoRequirement = 'none' | 'checkin_only' | 'both';

export interface PublicConfig {
  company_name: string;
  logo_data_url: string | null;
  official_start_time: string;
  grace_minutes: number;
  photo_requirement: PhotoRequirement;
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
  checkin_photo?: string | null;
  checkout_photo?: string | null;
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
  attendance_id: number | null;
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
  has_checkin_photo: boolean;
  has_checkout_photo: boolean;
  checkin_photo_id: number | null;
  checkout_photo_id: number | null;
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
  expected_working_days: number;
  days_present: number;
  days_absent: number;
  days_late: number;
  total_late_minutes: number;
  total_worked_minutes: number;
  attendance_rate: number;
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
  has_checkin_photo: number | boolean;
  has_checkout_photo: number | boolean;
  checkin_photo_id: number | null;
  checkout_photo_id: number | null;
  is_late: number;
  late_minutes: number;
  worked_minutes: number;
}

export type CalendarCellStatus =
  | 'present'
  | 'late'
  | 'absent'
  | 'weekend'
  | 'holiday'
  | 'leave'
  | 'future';

export interface PhotoCalendarDay {
  day: number;
  date: string;
  weekdayIndex: number;
  weekdayLetter: string;
  isWeekend: boolean;
  holidayType: 'holiday' | 'leave' | null;
  holidayLabel: string;
  isFuture: boolean;
}

export interface PhotoCalendarCell {
  attendance_id: number | null;
  status: CalendarCellStatus;
  checkin_time: string | null;
  checkout_time: string | null;
  is_late: boolean;
  late_minutes: number;
  worked_minutes: number;
  checkin_ip: string | null;
  checkout_ip: string | null;
  checkin_photo_id: number | null;
  checkout_photo_id: number | null;
  holiday_label: string;
}

export interface PhotoCalendarEmployeeRow {
  employee_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  is_active: boolean;
  cells: Record<string, PhotoCalendarCell>;
}

export interface PhotoCalendarResponse {
  month: string;
  days: PhotoCalendarDay[];
  employees: PhotoCalendarEmployeeRow[];
}

export interface PhotoDayCard {
  employee_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  attendance_id: number | null;
  status: CalendarCellStatus;
  checkin_time: string | null;
  checkout_time: string | null;
  is_late: boolean;
  late_minutes: number;
  worked_minutes: number;
  checkin_ip: string | null;
  checkout_ip: string | null;
  checkin_photo_id: number | null;
  checkout_photo_id: number | null;
  holiday_label: string;
}

export interface PhotoDayResponse {
  date: string;
  cards: PhotoDayCard[];
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

export interface PublicHolidayEntry {
  date: string;
  type: 'holiday' | 'leave';
  label: string;
}

export interface AppSettings {
  id: number;
  company_name: string;
  logo_data_url: string | null;
  official_start_time: string;
  grace_minutes: number;
  allowed_network_prefix: string;
  working_days: number[];
  public_holidays: PublicHolidayEntry[];
  photo_requirement: PhotoRequirement;
  photo_retention_days: number;
  updated_at: string;
}
