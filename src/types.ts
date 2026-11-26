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
  shift_start?: string | null;
  shift_end?: string | null;
  grace_minutes?: number | null;
}

export interface EmployeeFull extends EmployeeProfile {
  code: string;
  is_active: number;
  shift_start: string | null;
  shift_end: string | null;
  grace_minutes: number | null;
  created_at: string;
}

export interface EmployeeListOption extends EmployeeProfile {
  is_active: number;
  shift_start?: string | null;
  shift_end?: string | null;
  grace_minutes?: number | null;
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
  checkout_missing?: number;
  auto_closed_at?: string | null;
  is_corrected?: number;
  last_correction_reason?: string | null;
  created_at: string;
}

export interface MissingYesterdayInfo {
  work_date: string;
  punch_type: 'checkin' | 'checkout';
  checkin_time: string | null;
  request_status: 'pending' | 'approved' | 'rejected' | null;
}

export type CorrectionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface CorrectionRequestItem {
  id: number;
  employee_id: number;
  work_date: string;
  punch_type: 'checkin' | 'checkout';
  requested_time: string;
  reason: string;
  status: CorrectionRequestStatus;
  reviewed_by_admin_id: number | null;
  reviewed_by_username: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  first_name?: string;
  last_name?: string;
  job_title?: string;
  attendance_id?: number | null;
  current_checkin_time?: string | null;
  current_checkout_time?: string | null;
  current_checkout_missing?: number | null;
}

export type CorrectionLogActionType =
  | 'manual_add'
  | 'manual_edit'
  | 'request_approved'
  | 'request_rejected'
  | 'auto_close';

export interface CorrectionLogItem {
  id: number;
  attendance_id: number | null;
  employee_id: number;
  employee_name: string;
  work_date: string;
  action_type: CorrectionLogActionType;
  actor_admin_id: number | null;
  actor_username: string;
  old_value: string;
  new_value: string;
  reason: string;
  created_at: string;
}

export interface AdminAlertsSummary {
  today_unreported: number;
  missing_checkouts_count: number;
  pending_requests: number;
  total_alerts: number;
}

export interface AdminUser {
  id: number;
  username: string;
  role: 'super_admin' | 'admin';
  must_change_password: boolean;
  created_at?: string;
}

export type TodayEmployeeStatus =
  | 'present'
  | 'late'
  | 'unreported'
  | 'missing_checkout'
  | 'absent';

export interface TodayEmployeeRow {
  attendance_id: number | null;
  employee_id: number;
  first_name: string;
  last_name: string;
  job_title: string;
  status: TodayEmployeeStatus;
  checkin_time: string | null;
  checkout_time: string | null;
  late_minutes: number;
  worked_minutes: number;
  checkout_missing?: boolean;
  is_corrected?: boolean;
  last_correction_reason?: string | null;
  shift_start?: string;
  shift_end?: string | null;
  grace_minutes?: number;
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
    unreported: number;
    missing_checkout: number;
    absent: number;
    pending_requests: number;
  };
  alerts?: AdminAlertsSummary;
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
  missing_checkouts: number;
  missing_punches: number;
  corrected_punches: number;
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
  checkout_missing?: number;
  auto_closed_at?: string | null;
  is_corrected?: number;
  last_correction_reason?: string | null;
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
  auto_close_time: string;
  updated_at: string;
}

export interface NetworkInfoResponse {
  company_name: string;
  allowed_network_prefix: string;
  port: number;
  lan_ips: string[];
  primary_ip: string;
  local_url: string;
  phone_urls: string[];
  primary_phone_url: string;
  client_ip: string;
  data_dir: string;
  is_electron: boolean;
}

export interface DesktopSettingsResponse {
  is_electron: boolean;
  data_dir: string;
  db_path: string;
  photos_dir: string;
  config_path: string;
  open_at_login: boolean;
  start_minimized: boolean;
}

export interface ElectronPrintResult {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
}

export interface ElectronBridgeAPI {
  isElectron: boolean;
  printToPDF: (html: string, fileName?: string) => Promise<ElectronPrintResult>;
  getDataPath: () => Promise<string>;
  openDataFolder: () => Promise<boolean>;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridgeAPI;
  }
}

