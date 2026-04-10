export interface WorkdayDay {
  date: string // YYYY-MM-DD
  clockIn: Date
  mealOut: Date | null
  mealReturn: Date | null
  clockOut: Date
}

export interface AssembledRecord {
  agentName: string
  date: string // YYYY-MM-DD
  state: string
  start: Date
  end: Date
}

export type DiscrepancyType =
  | 'offline_during_paid'
  | 'clock_in_gap'
  | 'clock_out_gap'
  | 'meal_return_gap'
  | 'no_assembled_data'
  | 'excessive_rampdown'
  | 'excessive_open_cases'

export interface Discrepancy {
  type: DiscrepancyType
  severity: 'critical' | 'warning'
  date: string
  dayLabel: string
  description: string
  workdayTime: string
  assembledTime: string
  gapMinutes: number
}

export interface DayBreakdown {
  date: string
  dayLabel: string
  workday: WorkdayDay
  assembledStates: AssembledRecord[]
  discrepancies: Discrepancy[]
}

export interface AnalysisResult {
  totalDaysAnalyzed: number
  daysWithIssues: number
  discrepancies: Discrepancy[]
  totalOfflinePaidMinutes: number
  totalGapMinutes: number
  dayBreakdowns: DayBreakdown[]
}

export interface WorkdayColumnMap {
  date: string
  clockIn: string
  clockOut: string
  mealOut: string | null
  mealReturn: string | null
}

export interface AssembledColumnMap {
  date: string
  state: string
  start: string
  end: string
  agentName: string | null
}
