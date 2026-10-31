import { useEffect, useState } from 'react'
import { FileSpreadsheet, FileText, Mail } from 'lucide-react'
import { api, isoDate, when } from '../api.js'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui.jsx'

const pad = (n) => String(n).padStart(2, '0')
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date()
const PRESETS = [
  { label: 'This month', from: ymd(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDate(0) },
  { label: 'Last month', from: ymd(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: ymd(new Date(today.getFullYear(), today.getMonth(), 0)) },
  { label: 'Last 7 days', from: isoDate(-6), to: isoDate(0) },
  { label: 'Last 30 days', from: isoDate(-29), to: isoDate(0) },
]
const lastMonth = PRESETS[1].from.slice(0, 7)

export default function Reports() {
  const [types, setTypes] = useState([])
  const [type, setType] = useState('sales')
  const [from, setFrom] = useState(PRESETS[0].from)
  const [to, setTo] = useState(PRESETS[0].to)
  const [month, setMonth] = useState(lastMonth)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [sending, setSending] = useState(false)

  const loadHistory = () => api.monthlyReports().then(setHistory).catch(() => {})
  useEffect(() => {
    api.reportTypes().then(setTypes).catch((e) => setError(e.message))
    loadHistory()
  }, [])

  const isMonthly = type === 'monthly'
  const invalid = !isMonthly && (!from || !to || to < from)
  const url = (fmt) =>
    `/api/reports/download?type=${type}&format=${fmt}&` + (isMonthly ? `month=${month}` : `from=${from}&to=${to}`)

  const sendNow = async () => {
    setSending(true)
    setError('')
    setSuccess('')
    try {
      const r = await api.sendMonthly(month)
      if (r.status === 'sent') setSuccess(`Monthly report emailed to ${r.to_addr} with ${r.attachments}.`)
      else setError(`Report generated and saved to the alerts outbox, but not emailed: ${r.error}`)
      loadHistory()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Download clearly labelled PDF or Excel reports for any period. A monthly report is also emailed to the owner automatically." />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <h2 className="mb-3 font-semibold text-slate-900">1. Choose a report</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {types.map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`rounded-xl border p-3 text-left transition ${type === t.id ? 'border-emerald-600 bg-emerald-50/60 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-slate-300'}`}
              >
                <p className="text-sm font-semibold text-slate-900">{t.title}</p>
                <p className="text-xs text-slate-500">{t.description}</p>
              </button>
            ))}
          </div>

          <h2 className="mb-3 mt-6 font-semibold text-slate-900">2. Choose the period</h2>
          {isMonthly ? (
            <Field label="Month">
              <input type="month" className={`${inputClass} max-w-xs`} value={month} max={isoDate(0).slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </Field>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => { setFrom(p.from); setTo(p.to) }}
                    className={`rounded-full border px-3 py-1 text-xs font-medium ${from === p.from && to === p.to ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="grid max-w-md grid-cols-2 gap-3">
                <Field label="From"><input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
                <Field label="To"><input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              </div>
              {invalid && <p className="mt-2 text-xs text-red-600">End date must be on or after the start date.</p>}
            </>
          )}

          <h2 className="mb-3 mt-6 font-semibold text-slate-900">3. Download</h2>
          <div className="flex flex-wrap gap-3">
            <a href={invalid ? undefined : url('pdf')} aria-disabled={invalid}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white ${invalid ? 'pointer-events-none bg-slate-300' : 'bg-red-600 hover:bg-red-700'}`}>
              <FileText size={16} /> Download PDF
            </a>
            <a href={invalid ? undefined : url('xlsx')} aria-disabled={invalid}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white ${invalid ? 'pointer-events-none bg-slate-300' : 'bg-emerald-700 hover:bg-emerald-800'}`}>
              <FileSpreadsheet size={16} /> Download Excel
            </a>
          </div>
          <p className="mt-2 text-xs text-slate-400">Files are named like <code>DukaBuddy_Sales_Report_2026-10-01_to_2026-10-31.pdf</code></p>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Mail size={18} className="text-emerald-600" /> Monthly email report</h2>
          <p className="mt-1 text-sm text-slate-500">
            On the 1st of each month DukaBuddy emails last month's full performance report (PDF + Excel) to the owner.
          </p>
          <div className="mt-4 flex items-end gap-2">
            <Field label="Month">
              <input type="month" className={inputClass} value={month} max={isoDate(0).slice(0, 7)} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Button onClick={sendNow} disabled={sending || !month}>{sending ? 'Sending…' : 'Email now'}</Button>
          </div>
          <div className="mt-3 space-y-2">
            <Alert>{error}</Alert>
            <Alert type="success">{success}</Alert>
          </div>
          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-900">Sent reports</h3>
          {history.length === 0 && <p className="text-sm text-slate-500">None yet.</p>}
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-start justify-between gap-2 text-sm">
                <span>
                  <span className="text-slate-700">{h.subject.replace('Monthly report - ', '')}</span>
                  <span className="block text-xs text-slate-400">{when(h.created_at)} · {h.to_addr || 'no recipient'}</span>
                </span>
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${h.status === 'sent' ? 'bg-emerald-100 text-emerald-700' : h.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                  {h.status === 'logged' ? 'In outbox' : h.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
