'use client'

import { useState, useCallback } from 'react'
import {
  detectWorkdayColumns,
  detectAssembledColumns,
  parseWorkdayCSV,
  parseAssembledCSV,
  getCSVHeaders,
} from '@/lib/parser'
import { analyzeTimecards, fmtTime, getDayLabel } from '@/lib/compare'
import type {
  WorkdayColumnMap,
  AssembledColumnMap,
  AnalysisResult,
  DayBreakdown,
} from '@/lib/types'

// ─── File Uploader ────────────────────────────────────────────────────────────

function FileDropZone({
  label,
  sublabel,
  file,
  onFile,
}: {
  label: string
  sublabel: string
  file: File | null
  onFile: (f: File) => void
}) {
  const [dragging, setDragging] = useState(false)

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const f = e.dataTransfer.files[0]
      if (f) onFile(f)
    },
    [onFile]
  )

  return (
    <label
      className={`flex flex-col items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors
        ${dragging ? 'border-blue-500 bg-blue-50' : file ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-gray-50 hover:bg-gray-100'}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <input
        type="file"
        accept=".csv"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
      <div className="text-3xl">{file ? '✅' : '📂'}</div>
      <div className="font-semibold text-gray-800 text-sm">{label}</div>
      <div className="text-xs text-gray-500">{file ? file.name : sublabel}</div>
    </label>
  )
}

// ─── Column Mapper ────────────────────────────────────────────────────────────

function ColumnSelect({
  label,
  value,
  headers,
  onChange,
  required,
}: {
  label: string
  value: string | null
  headers: string[]
  onChange: (v: string | null) => void
  required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-600">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        className="rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">{required ? 'Select column…' : '— not mapped —'}</option>
        {headers.map((h) => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Results ──────────────────────────────────────────────────────────────────

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: string
  label: string
  value: string | number
  color: 'red' | 'yellow' | 'green' | 'blue'
}) {
  const colors = {
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  }
  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-1 ${colors[color]}`}>
      <div className="text-2xl">{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium">{label}</div>
    </div>
  )
}

function DiscrepancyBadge({ type, severity }: { type: string; severity: string }) {
  const labels: Record<string, string> = {
    offline_during_paid: '🔴 Offline During Paid',
    clock_in_gap: '⚠️ Clock-In Gap',
    clock_out_gap: '⚠️ Clock-Out Gap',
    meal_return_gap: '⚠️ Meal Return Gap',
    no_assembled_data: '❓ No Assembled Data',
    excessive_rampdown: '⚠️ Excessive Ramp Down',
    excessive_open_cases: '⚠️ Excessive Open Cases',
  }
  const colors =
    severity === 'critical'
      ? 'bg-red-100 text-red-700 border border-red-200'
      : 'bg-yellow-100 text-yellow-700 border border-yellow-200'

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${colors}`}>
      {labels[type] ?? type}
    </span>
  )
}

function DayCard({ breakdown }: { breakdown: DayBreakdown }) {
  const [open, setOpen] = useState(false)
  const { workday, assembledStates, discrepancies, dayLabel } = breakdown
  const hasIssues = discrepancies.length > 0

  return (
    <div className={`rounded-xl border ${hasIssues ? 'border-red-100' : 'border-gray-200'} overflow-hidden`}>
      <button
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors
          ${hasIssues ? 'bg-red-50 hover:bg-red-100' : 'bg-gray-50 hover:bg-gray-100'}`}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold text-sm text-gray-800">{dayLabel}</span>
          <span className="text-xs text-gray-500">
            {fmtTime(workday.clockIn)} – {fmtTime(workday.clockOut)}
            {workday.mealOut && workday.mealReturn
              ? ` (meal ${fmtTime(workday.mealOut)} – ${fmtTime(workday.mealReturn)})`
              : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {discrepancies.length > 0 ? (
            <span className="text-xs font-medium text-red-600">
              {discrepancies.length} issue{discrepancies.length > 1 ? 's' : ''}
            </span>
          ) : (
            <span className="text-xs font-medium text-green-600">✓ Clean</span>
          )}
          <span className="text-gray-400 text-sm">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="px-4 py-3 space-y-3 bg-white">
          {discrepancies.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Issues</div>
              {discrepancies.map((d, i) => (
                <div key={i} className="rounded-lg bg-gray-50 p-3 text-sm space-y-1">
                  <DiscrepancyBadge type={d.type} severity={d.severity} />
                  <div className="text-gray-700">{d.description}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 mt-1">
                    <div>
                      <span className="font-medium">Workday:</span> {d.workdayTime}
                    </div>
                    <div>
                      <span className="font-medium">Assembled:</span> {d.assembledTime}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Assembled Timeline
            </div>
            {assembledStates.length === 0 ? (
              <div className="text-xs text-gray-400 italic">No records found</div>
            ) : (
              <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 overflow-hidden">
                {assembledStates.map((s, i) => {
                  const isOff = s.state.toLowerCase().includes('offline')
                  const isMeal = s.state.toLowerCase().includes('lunch') || s.state.toLowerCase().includes('break')
                  return (
                    <div
                      key={i}
                      className={`flex justify-between items-center px-3 py-1.5 text-xs
                        ${isOff ? 'bg-red-50 text-red-700' : isMeal ? 'bg-yellow-50 text-yellow-700' : 'text-gray-700'}`}
                    >
                      <span className="font-medium">{s.state}</span>
                      <span className="text-gray-500">
                        {fmtTime(s.start)} – {fmtTime(s.end)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Results({ result }: { result: AnalysisResult }) {
  const critical = result.discrepancies.filter((d) => d.severity === 'critical')
  const warnings = result.discrepancies.filter((d) => d.severity === 'warning')

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          icon="📅"
          label="Days Analyzed"
          value={result.totalDaysAnalyzed}
          color="blue"
        />
        <SummaryCard
          icon="⚠️"
          label="Days with Issues"
          value={result.daysWithIssues}
          color={result.daysWithIssues > 0 ? 'yellow' : 'green'}
        />
        <SummaryCard
          icon="🔴"
          label="Critical Issues"
          value={critical.length}
          color={critical.length > 0 ? 'red' : 'green'}
        />
        <SummaryCard
          icon="🕐"
          label="Total Offline (paid)"
          value={`${result.totalOfflinePaidMinutes} min`}
          color={result.totalOfflinePaidMinutes > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Critical Issues Table */}
      {critical.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-red-700 mb-2 flex items-center gap-2">
            🔴 Critical Issues — Offline During Paid Time
          </h3>
          <div className="rounded-xl border border-red-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-red-50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-red-700">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-red-700">Workday Shift</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-red-700">Offline Period</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-red-700">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100">
                {critical.map((d, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-4 py-2 font-medium text-gray-800">{d.dayLabel}</td>
                    <td className="px-4 py-2 text-gray-600">{d.workdayTime}</td>
                    <td className="px-4 py-2 text-red-600">{d.assembledTime}</td>
                    <td className="px-4 py-2 text-right font-bold text-red-600">{d.gapMinutes} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Warning Issues Table */}
      {warnings.length > 0 && (
        <div>
          <h3 className="text-sm font-bold text-yellow-700 mb-2 flex items-center gap-2">
            ⚠️ Warnings — Time Gaps
          </h3>
          <div className="rounded-xl border border-yellow-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-yellow-50">
                <tr>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-yellow-700">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-yellow-700">Type</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-yellow-700">Workday</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-yellow-700">Assembled Active</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-yellow-700">Gap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-yellow-100">
                {warnings.map((d, i) => (
                  <tr key={i} className="bg-white">
                    <td className="px-4 py-2 font-medium text-gray-800">{d.dayLabel}</td>
                    <td className="px-4 py-2">
                      <DiscrepancyBadge type={d.type} severity={d.severity} />
                    </td>
                    <td className="px-4 py-2 text-gray-600">{d.workdayTime}</td>
                    <td className="px-4 py-2 text-gray-600">{d.assembledTime}</td>
                    <td className="px-4 py-2 text-right font-bold text-yellow-600">
                      {d.gapMinutes > 0 ? `${d.gapMinutes} min` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.discrepancies.length === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <div className="text-3xl mb-2">✅</div>
          <div className="font-semibold text-green-700">All clear! No discrepancies found.</div>
          <div className="text-sm text-green-600 mt-1">
            Workday and Assembled times match within the {5}-minute threshold.
          </div>
        </div>
      )}

      {/* Day-by-Day Breakdown */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-2">📅 Day-by-Day Breakdown</h3>
        <div className="space-y-2">
          {result.dayBreakdowns.map((b) => (
            <DayCard key={b.date} breakdown={b} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TimecardChecker() {
  // Files & CSV content
  const [workdayFile, setWorkdayFile] = useState<File | null>(null)
  const [assembledFile, setAssembledFile] = useState<File | null>(null)
  const [workdayCsv, setWorkdayCsv] = useState('')
  const [assembledCsv, setAssembledCsv] = useState('')

  // Headers (only needed if manual mapping is required)
  const [workdayHeaders, setWorkdayHeaders] = useState<string[]>([])
  const [assembledHeaders, setAssembledHeaders] = useState<string[]>([])

  // Column maps
  const [wdCols, setWdCols] = useState<WorkdayColumnMap>({
    date: '', clockIn: '', clockOut: '', mealOut: null, mealReturn: null,
  })
  const [asmCols, setAsmCols] = useState<AssembledColumnMap>({
    date: '', state: '', start: '', end: '', agentName: null,
  })

  // Whether auto-detection succeeded
  const [wdDetected, setWdDetected] = useState(false)
  const [asmDetected, setAsmDetected] = useState(false)
  const [showManualMapping, setShowManualMapping] = useState(false)

  // Settings
  const [threshold, setThreshold] = useState(10)

  // Results
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const readFile = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target?.result as string)
      reader.onerror = reject
      reader.readAsText(file)
    })

  const tryAutoRun = (wdCsv: string, asmCsv: string, wdMap: WorkdayColumnMap, asmMap: AssembledColumnMap) => {
    setError(null)
    try {
      const workdayDays = parseWorkdayCSV(wdCsv, wdMap)
      const assembledRecords = parseAssembledCSV(asmCsv, asmMap)
      if (workdayDays.length === 0 || assembledRecords.length === 0) return false
      const analysisResult = analyzeTimecards(workdayDays, assembledRecords, threshold)
      setResult(analysisResult)
      return true
    } catch {
      return false
    }
  }

  const handleWorkdayFile = async (f: File) => {
    setWorkdayFile(f)
    setResult(null)
    setError(null)
    const csv = await readFile(f)
    setWorkdayCsv(csv)
    const headers = getCSVHeaders(csv)
    setWorkdayHeaders(headers)
    const detected = detectWorkdayColumns(headers)
    setWdDetected(!!detected)
    const newCols = detected ?? wdCols
    if (detected) setWdCols(detected)
    // Auto-run if assembled is already loaded
    if (assembledCsv && asmDetected) {
      tryAutoRun(csv, assembledCsv, newCols, asmCols)
    }
  }

  const handleAssembledFile = async (f: File) => {
    setAssembledFile(f)
    setResult(null)
    setError(null)
    const csv = await readFile(f)
    setAssembledCsv(csv)
    const headers = getCSVHeaders(csv)
    setAssembledHeaders(headers)
    const detected = detectAssembledColumns(headers)
    setAsmDetected(!!detected)
    const newCols = detected ?? asmCols
    if (detected) setAsmCols(detected)
    // Auto-run if workday is already loaded
    if (workdayCsv && wdDetected) {
      tryAutoRun(workdayCsv, csv, wdCols, newCols)
    }
  }

  const runAnalysis = () => {
    setError(null)
    try {
      const workdayDays = parseWorkdayCSV(workdayCsv, wdCols)
      const assembledRecords = parseAssembledCSV(assembledCsv, asmCols)
      if (workdayDays.length === 0) {
        setError('Could not parse any rows from the Workday CSV. Check column mapping.')
        return
      }
      if (assembledRecords.length === 0) {
        setError('Could not parse any rows from the Assembled CSV. Check column mapping.')
        return
      }
      setResult(analyzeTimecards(workdayDays, assembledRecords, threshold))
    } catch (e) {
      setError(`Analysis failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const bothUploaded = workdayFile && assembledFile
  const detectionFailed = bothUploaded && (!wdDetected || !asmDetected)
  const canAnalyze = wdCols.date && wdCols.clockIn && wdCols.clockOut &&
    asmCols.date && asmCols.state && asmCols.start && asmCols.end

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">⏱️ Timecard Checker</h1>
            <p className="text-xs text-gray-500 mt-0.5">Compare Workday entries against Assembled status records</p>
          </div>
          {(result || error) && (
            <button
              className="text-sm text-blue-600 hover:underline"
              onClick={() => {
                setWorkdayFile(null); setAssembledFile(null)
                setWorkdayCsv(''); setAssembledCsv('')
                setResult(null); setError(null)
                setWdDetected(false); setAsmDetected(false)
                setShowManualMapping(false)
              }}
            >
              ← Start over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Upload */}
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FileDropZone
              label="Workday Export (CSV)"
              sublabel="Drop file here or click to select"
              file={workdayFile}
              onFile={handleWorkdayFile}
            />
            <FileDropZone
              label="Assembled Export (CSV)"
              sublabel="Drop file here or click to select"
              file={assembledFile}
              onFile={handleAssembledFile}
            />
          </div>

          {/* Auto-running indicator */}
          {bothUploaded && !result && !error && !detectionFailed && (
            <div className="mt-3 text-sm text-blue-600 text-center">Analyzing…</div>
          )}

          {/* Detection failed — need manual mapping */}
          {detectionFailed && (
            <div className="mt-3 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800 flex items-center justify-between gap-4">
              <span>⚠️ Couldn't auto-detect column names. Please map them manually.</span>
              <button
                className="text-yellow-700 font-medium underline whitespace-nowrap"
                onClick={() => setShowManualMapping(true)}
              >
                Map columns
              </button>
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between gap-4">
              <span>⚠️ {error}</span>
              <button
                className="text-red-700 font-medium underline whitespace-nowrap"
                onClick={() => setShowManualMapping(true)}
              >
                Map columns
              </button>
            </div>
          )}
        </section>

        {/* Manual Column Mapping (only shown on failure or request) */}
        {showManualMapping && bothUploaded && (
          <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-gray-700">Column Mapping</div>
              <button className="text-xs text-gray-400 hover:text-gray-600" onClick={() => setShowManualMapping(false)}>✕ Close</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Workday</div>
                <ColumnSelect label="Date" value={wdCols.date} headers={workdayHeaders} required
                  onChange={(v) => setWdCols((c) => ({ ...c, date: v ?? '' }))} />
                <ColumnSelect label="Clock In" value={wdCols.clockIn} headers={workdayHeaders} required
                  onChange={(v) => setWdCols((c) => ({ ...c, clockIn: v ?? '' }))} />
                <ColumnSelect label="Clock Out" value={wdCols.clockOut} headers={workdayHeaders} required
                  onChange={(v) => setWdCols((c) => ({ ...c, clockOut: v ?? '' }))} />
                <ColumnSelect label="Meal Out (optional)" value={wdCols.mealOut} headers={workdayHeaders}
                  onChange={(v) => setWdCols((c) => ({ ...c, mealOut: v }))} />
                <ColumnSelect label="Meal Return (optional)" value={wdCols.mealReturn} headers={workdayHeaders}
                  onChange={(v) => setWdCols((c) => ({ ...c, mealReturn: v }))} />
              </div>
              <div className="space-y-3">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Assembled</div>
                <ColumnSelect label="Date" value={asmCols.date} headers={assembledHeaders} required
                  onChange={(v) => setAsmCols((c) => ({ ...c, date: v ?? '' }))} />
                <ColumnSelect label="State / Activity" value={asmCols.state} headers={assembledHeaders} required
                  onChange={(v) => setAsmCols((c) => ({ ...c, state: v ?? '' }))} />
                <ColumnSelect label="Start Time" value={asmCols.start} headers={assembledHeaders} required
                  onChange={(v) => setAsmCols((c) => ({ ...c, start: v ?? '' }))} />
                <ColumnSelect label="End Time" value={asmCols.end} headers={assembledHeaders} required
                  onChange={(v) => setAsmCols((c) => ({ ...c, end: v ?? '' }))} />
                <ColumnSelect label="Agent Name (optional)" value={asmCols.agentName} headers={assembledHeaders}
                  onChange={(v) => setAsmCols((c) => ({ ...c, agentName: v }))} />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                className={`rounded-lg px-5 py-2 text-sm font-medium transition-colors
                  ${canAnalyze ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                disabled={!canAnalyze}
                onClick={() => { runAnalysis(); setShowManualMapping(false) }}
              >
                Run Analysis →
              </button>
            </div>
          </section>
        )}

        {/* Threshold (shown once results are available) */}
        {result && (
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex items-center gap-4">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Gap Threshold</label>
            <input type="range" min={1} max={30} value={threshold}
              onChange={(e) => setThreshold(parseInt(e.target.value))}
              className="flex-1" />
            <span className="text-sm font-bold text-blue-600 w-16 text-right">{threshold} min</span>
            <button className="text-xs text-blue-600 hover:underline whitespace-nowrap" onClick={runAnalysis}>
              Re-run
            </button>
          </div>
        )}

        {/* Results */}
        {result && (
          <section>
            <Results result={result} />
          </section>
        )}
      </main>
    </div>
  )
}
