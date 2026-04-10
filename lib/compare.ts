import type {
  WorkdayDay,
  AssembledRecord,
  Discrepancy,
  AnalysisResult,
  DayBreakdown,
} from './types'

// ─── State Classification ────────────────────────────────────────────────────

const INACTIVE_KEYWORDS = ['offline', 'break', 'lunch', 'away', 'unavailable', 'disconnected']

function isActive(state: string): boolean {
  const s = state.toLowerCase()
  return !INACTIVE_KEYWORDS.some((k) => s.includes(k))
}

function isOffline(state: string): boolean {
  return state.toLowerCase().includes('offline')
}

function isRampDown(state: string): boolean {
  const s = state.toLowerCase()
  return s.includes('ramp') || s.includes('ramping')
}

function isOpenCases(state: string): boolean {
  const s = state.toLowerCase()
  return s.includes('open case') || s.includes('open_case') || s.includes('opencas')
}

function sumMinutesByState(records: AssembledRecord[], matcher: (state: string) => boolean): number {
  return records
    .filter((r) => matcher(r.state))
    .reduce((sum, r) => sum + diffMin(r.start, r.end), 0)
}

// ─── Formatting ───────────────────────────────────────────────────────────────

export function fmtTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function diffMin(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60000)
}

export function getDayLabel(dateStr: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const d = new Date(dateStr + 'T12:00:00')
  const [, m, day] = dateStr.split('-')
  return `${days[d.getDay()]} ${parseInt(m)}/${parseInt(day)}`
}

// ─── Core Analysis ────────────────────────────────────────────────────────────

export function analyzeTimecards(
  workdayDays: WorkdayDay[],
  assembledRecords: AssembledRecord[],
  thresholdMinutes = 5
): AnalysisResult {
  // Group assembled records by date, sorted by start time
  const byDate: Record<string, AssembledRecord[]> = {}
  for (const r of assembledRecords) {
    if (!byDate[r.date]) byDate[r.date] = []
    byDate[r.date].push(r)
  }
  for (const d of Object.keys(byDate)) {
    byDate[d].sort((a, b) => a.start.getTime() - b.start.getTime())
  }

  const allDiscrepancies: Discrepancy[] = []
  const dayBreakdowns: DayBreakdown[] = []

  for (const day of workdayDays) {
    const records = byDate[day.date] ?? []
    const dayLabel = getDayLabel(day.date)
    const dayDiscrepancies: Discrepancy[] = []

    const activeRecords = records.filter((r) => isActive(r.state))

    if (activeRecords.length === 0) {
      dayDiscrepancies.push({
        type: 'no_assembled_data',
        severity: 'warning',
        date: day.date,
        dayLabel,
        description: 'No Assembled activity found for this day',
        workdayTime: `${fmtTime(day.clockIn)} – ${fmtTime(day.clockOut)}`,
        assembledTime: '—',
        gapMinutes: 0,
      })
    } else {
      const firstActive = activeRecords[0]

      // 1. Clock-in gap: Workday earlier than first Assembled active state
      const clockInGap = diffMin(day.clockIn, firstActive.start)
      if (clockInGap > thresholdMinutes) {
        dayDiscrepancies.push({
          type: 'clock_in_gap',
          severity: 'warning',
          date: day.date,
          dayLabel,
          description: `Workday clock-in is ${clockInGap} min before first Assembled active state`,
          workdayTime: fmtTime(day.clockIn),
          assembledTime: fmtTime(firstActive.start),
          gapMinutes: clockInGap,
        })
      }

      // 2. Offline during paid time (not during meal break)
      const offlineRecords = records.filter((r) => isOffline(r.state))
      for (const offline of offlineRecords) {
        const withinShift =
          offline.start >= day.clockIn && offline.end <= day.clockOut

        if (!withinShift) continue

        // Skip if the offline period overlaps with the meal break window
        if (day.mealOut && day.mealReturn) {
          const overlapsMeal = offline.start < day.mealReturn && offline.end > day.mealOut
          if (overlapsMeal) continue
        }

        const duration = diffMin(offline.start, offline.end)
        if (duration >= thresholdMinutes) {
          dayDiscrepancies.push({
            type: 'offline_during_paid',
            severity: 'critical',
            date: day.date,
            dayLabel,
            description: `Offline ${duration} min during paid hours`,
            workdayTime: `${fmtTime(day.clockIn)} – ${fmtTime(day.clockOut)}`,
            assembledTime: `${fmtTime(offline.start)} – ${fmtTime(offline.end)}`,
            gapMinutes: duration,
          })
        }
      }

      // 3. Meal return gap
      if (day.mealReturn) {
        const postMeal = activeRecords.find((r) => r.start >= day.mealReturn!)
        if (postMeal) {
          const gap = diffMin(day.mealReturn, postMeal.start)
          if (gap > thresholdMinutes) {
            dayDiscrepancies.push({
              type: 'meal_return_gap',
              severity: 'warning',
              date: day.date,
              dayLabel,
              description: `Workday meal return is ${gap} min before Assembled active state`,
              workdayTime: fmtTime(day.mealReturn),
              assembledTime: fmtTime(postMeal.start),
              gapMinutes: gap,
            })
          }
        }
      }

      // 4. Excessive Ramp Down (> 50 min)
      const rampDownMinutes = sumMinutesByState(records, isRampDown)
      if (rampDownMinutes > 50) {
        dayDiscrepancies.push({
          type: 'excessive_rampdown',
          severity: 'warning',
          date: day.date,
          dayLabel,
          description: `Ramp Down totals ${rampDownMinutes} min (limit: 50 min)`,
          workdayTime: `${fmtTime(day.clockIn)} – ${fmtTime(day.clockOut)}`,
          assembledTime: `${rampDownMinutes} min in Ramp Down`,
          gapMinutes: rampDownMinutes,
        })
      }

      // 5. Excessive Open Cases (> 30 min)
      const openCasesMinutes = sumMinutesByState(records, isOpenCases)
      if (openCasesMinutes > 30) {
        dayDiscrepancies.push({
          type: 'excessive_open_cases',
          severity: 'warning',
          date: day.date,
          dayLabel,
          description: `Open Cases totals ${openCasesMinutes} min (limit: 30 min)`,
          workdayTime: `${fmtTime(day.clockIn)} – ${fmtTime(day.clockOut)}`,
          assembledTime: `${openCasesMinutes} min in Open Cases`,
          gapMinutes: openCasesMinutes,
        })
      }
    }

    allDiscrepancies.push(...dayDiscrepancies)
    dayBreakdowns.push({
      date: day.date,
      dayLabel,
      workday: day,
      assembledStates: records,
      discrepancies: dayDiscrepancies,
    })
  }

  const offlineDiscrepancies = allDiscrepancies.filter((d) => d.type === 'offline_during_paid')
  const gapDiscrepancies = allDiscrepancies.filter(
    (d) => d.type === 'clock_in_gap' || d.type === 'meal_return_gap'
  )

  return {
    totalDaysAnalyzed: workdayDays.length,
    daysWithIssues: new Set(allDiscrepancies.map((d) => d.date)).size,
    discrepancies: allDiscrepancies,
    totalOfflinePaidMinutes: offlineDiscrepancies.reduce((s, d) => s + d.gapMinutes, 0),
    totalGapMinutes: gapDiscrepancies.reduce((s, d) => s + d.gapMinutes, 0),
    dayBreakdowns,
  }
}
