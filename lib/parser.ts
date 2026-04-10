import Papa from 'papaparse'
import type {
  WorkdayDay,
  AssembledRecord,
  WorkdayColumnMap,
  AssembledColumnMap,
} from './types'

// ─── Time & Date Helpers ─────────────────────────────────────────────────────

function parseTime(timeStr: string, baseDate: Date): Date | null {
  if (!timeStr?.trim()) return null
  const s = timeStr.trim()

  // Full datetime: "2026-03-29 09:00:00" or "2026-03-29T09:00:00"
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) {
    const d = new Date(s.replace(' ', 'T'))
    return isNaN(d.getTime()) ? null : d
  }

  // "9:00 AM" / "9:00:00 AM"
  const ampm = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i)
  if (ampm) {
    let h = parseInt(ampm[1])
    const m = parseInt(ampm[2])
    const sec = ampm[3] ? parseInt(ampm[3]) : 0
    const pm = ampm[4].toUpperCase() === 'PM'
    if (pm && h !== 12) h += 12
    if (!pm && h === 12) h = 0
    const d = new Date(baseDate)
    d.setHours(h, m, sec, 0)
    return d
  }

  // "09:00" / "09:00:00" 24-hour
  const mil = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (mil) {
    const d = new Date(baseDate)
    d.setHours(parseInt(mil[1]), parseInt(mil[2]), mil[3] ? parseInt(mil[3]) : 0, 0)
    return d
  }

  return null
}

function parseDate(dateStr: string): string | null {
  if (!dateStr?.trim()) return null
  const s = dateStr.trim()

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

  // M/D/YYYY or MM/DD/YYYY
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) {
    const [, m, d, y] = mdy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // M/D/YY
  const mdyShort = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (mdyShort) {
    const [, m, d, y] = mdyShort
    return `${2000 + parseInt(y)}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // Workday format: "Sun, 3/29" or "Mon, 3/30" — no year, assume current year
  const workdayFmt = s.match(/^[A-Za-z]{2,3},?\s+(\d{1,2})\/(\d{1,2})$/)
  if (workdayFmt) {
    const m = workdayFmt[1].padStart(2, '0')
    const d = workdayFmt[2].padStart(2, '0')
    const year = new Date().getFullYear()
    return `${year}-${m}-${d}`
  }

  // Fallback: native Date parse, extract date portion
  const fallback = new Date(s)
  if (!isNaN(fallback.getTime())) return fallback.toISOString().split('T')[0]

  return null
}

// ─── Column Auto-Detection ───────────────────────────────────────────────────

// Exact match first, then partial
function findColumn(headers: string[], candidates: string[]): string | null {
  const lower = headers.map((h) => h.toLowerCase().trim())
  // Exact match pass
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h === c.toLowerCase())
    if (idx >= 0) return headers[idx]
  }
  // Partial match pass
  for (const c of candidates) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()))
    if (idx >= 0) return headers[idx]
  }
  return null
}

export function detectWorkdayColumns(headers: string[]): WorkdayColumnMap | null {
  // Known Workday export column names first, then fallbacks
  const date = findColumn(headers, ['date'])
  const clockIn = findColumn(headers, ['in', 'clock in', 'time in', 'start time'])
  const clockOut = findColumn(headers, ['out', 'clock out', 'time out', 'end time'])
  const mealOut = findColumn(headers, ['meal out', 'lunch out', 'break out', 'meal start'])
  const mealReturn = findColumn(headers, ['meal return', 'meal in', 'lunch in', 'break in', 'meal end'])

  if (!date || !clockIn || !clockOut) return null
  return { date, clockIn, clockOut, mealOut, mealReturn }
}

export function detectAssembledColumns(headers: string[]): AssembledColumnMap | null {
  // Known Assembled export column names first, then fallbacks
  const state = findColumn(headers, ['state', 'activity', 'status'])
  const start = findColumn(headers, ['start time', 'start', 'begin'])
  const end = findColumn(headers, ['end time', 'end', 'finish'])
  const agentName = findColumn(headers, ['agent', 'name', 'employee', 'user'])

  if (!state || !start || !end) return null

  // Assembled often has no separate Date column — date lives inside Start Time
  const date = findColumn(headers, ['date']) ?? start

  return { date, state, start, end, agentName }
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

export function parseWorkdayCSV(csv: string, cols: WorkdayColumnMap): WorkdayDay[] {
  const rawRows = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: false }).data as string[][]
  const headerIdx = findHeaderRow(rawRows)
  const headers = rawRows[headerIdx]

  // Build objects directly from raw rows — avoids re-serializing cells that contain commas
  const data: Record<string, string>[] = []
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (row.every((c) => !c.trim())) continue
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { obj[h] = row[idx] ?? '' })
    data.push(obj)
  }

  // Group rows by date to handle Workday's two-row-per-day format
  const byDate: Record<string, Array<Record<string, string>>> = {}
  for (const row of data) {
    const dateStr = parseDate(row[cols.date])
    if (!dateStr) continue
    if (!byDate[dateStr]) byDate[dateStr] = []
    byDate[dateStr].push(row)
  }

  const days: WorkdayDay[] = []

  for (const [dateStr, rows] of Object.entries(byDate)) {
    const base = new Date(dateStr + 'T00:00:00')

    // Detect Workday two-row format: Out Reason = "Meal" / "Out"
    const outReasonCol = Object.keys(rows[0]).find((k) =>
      k.toLowerCase().includes('out reason') || k.toLowerCase().includes('outreason')
    )

    if (outReasonCol && rows.length >= 2) {
      const mealRow = rows.find((r) => r[outReasonCol]?.toLowerCase().includes('meal'))
      const outRow = rows.find((r) => r[outReasonCol]?.toLowerCase().includes('out') &&
        !r[outReasonCol]?.toLowerCase().includes('meal'))

      if (mealRow && outRow) {
        const clockIn = parseTime(mealRow[cols.clockIn], base)
        const mealOut = parseTime(mealRow[cols.clockOut], base)
        const mealReturn = parseTime(outRow[cols.clockIn], base)
        const clockOut = parseTime(outRow[cols.clockOut], base)
        if (clockIn && clockOut) {
          days.push({ date: dateStr, clockIn, mealOut, mealReturn, clockOut })
          continue
        }
      }
    }

    // Fallback: single row per day
    for (const row of rows) {
      const clockIn = parseTime(row[cols.clockIn], base)
      const clockOut = parseTime(row[cols.clockOut], base)
      if (!clockIn || !clockOut) continue
      const mealOut = cols.mealOut ? parseTime(row[cols.mealOut] ?? '', base) : null
      const mealReturn = cols.mealReturn ? parseTime(row[cols.mealReturn] ?? '', base) : null
      days.push({ date: dateStr, clockIn, mealOut, mealReturn, clockOut })
      break
    }
  }

  return days
}

export function parseAssembledCSV(csv: string, cols: AssembledColumnMap): AssembledRecord[] {
  const rawRows = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: false }).data as string[][]
  const headerIdx = findHeaderRow(rawRows)
  const headers = rawRows[headerIdx]

  const data: Record<string, string>[] = []
  for (let i = headerIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    if (row.every((c) => !c.trim())) continue
    const obj: Record<string, string> = {}
    headers.forEach((h, idx) => { obj[h] = row[idx] ?? '' })
    data.push(obj)
  }

  const records: AssembledRecord[] = []

  for (const row of data) {
    const dateStr = parseDate(row[cols.date])
    if (!dateStr) continue

    const base = new Date(dateStr + 'T00:00:00')

    const startRaw = row[cols.start]?.trim() ?? ''
    const endRaw = row[cols.end]?.trim() ?? ''

    const start =
      /^\d{4}-\d{2}-\d{2}[T ]/.test(startRaw)
        ? new Date(startRaw.replace(' ', 'T'))
        : parseTime(startRaw, base)

    const end =
      /^\d{4}-\d{2}-\d{2}[T ]/.test(endRaw)
        ? new Date(endRaw.replace(' ', 'T'))
        : parseTime(endRaw, base)

    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) continue

    // If date and start point to the same column, extract date from the parsed start datetime
    const resolvedDate = cols.date === cols.start
      ? start.toISOString().split('T')[0]
      : dateStr

    records.push({
      agentName: cols.agentName ? (row[cols.agentName] ?? '') : '',
      date: resolvedDate,
      state: row[cols.state]?.trim() ?? '',
      start,
      end,
    })
  }

  return records
}

// Find the row index that looks like a real data header
// (contains at least "Date" + one of "In"/"Out"/"Start"/"End"/"State"/"Activity")
function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map((c) => c.toLowerCase().trim())
    // Workday: has "date" + "in" + "out"
    const isWorkday = cells.includes('date') && cells.includes('in') && cells.includes('out')
    // Assembled: has "state" + "start time" + "end time" (no date column)
    const isAssembled = cells.includes('state') && cells.includes('start time') && cells.includes('end time')
    if (isWorkday || isAssembled) return i
  }
  return 0
}

export function getCSVHeaders(csv: string): string[] {
  const { data } = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: false })
  if (!data.length) return []
  const headerRowIdx = findHeaderRow(data as string[][])
  return ((data as string[][])[headerRowIdx] ?? []).filter(Boolean)
}

export function getHeaderRowIndex(csv: string): number {
  const { data } = Papa.parse<string[]>(csv, { header: false, skipEmptyLines: true })
  return findHeaderRow(data as string[][])
}
