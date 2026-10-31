import { useEffect, useState } from 'react'
import { Mail, Save, Send, X } from 'lucide-react'
import { api, when } from '../api.js'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui.jsx'

const KIND_LABELS = {
  low_stock: 'Restock orders',
  dead_stock: 'Dead stock',
  monthly_report: 'Monthly report',
  test: 'Test',
}
const STATUS_STYLES = {
  sent: 'bg-emerald-100 text-emerald-700',
  logged: 'bg-slate-100 text-slate-600',
  failed: 'bg-red-100 text-red-700',
}

export default function Alerts() {
  const [settings, setSettings] = useState(null)
  const [smtp, setSmtp] = useState(null)
  const [interval, setIntervalMin] = useState(60)
  const [alerts, setAlerts] = useState([])
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)

  const loadAlerts = () => api.alerts().then(setAlerts).catch((e) => setError(e.message))
  useEffect(() => {
    api.settings().then((d) => { setSettings(d.settings); setSmtp(d.smtp); setIntervalMin(d.interval_minutes) }).catch((e) => setError(e.message))
    loadAlerts()
  }, [])

  const set = (k, v) => setSettings({ ...settings, [k]: v })

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const d = await api.saveSettings(settings)
      setSettings(d.settings)
      setSuccess('Settings saved.')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const test = async () => {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const r = await api.testEmail()
      if (r.status === 'sent') setSuccess(`Test email sent to ${r.to_addr}.`)
      else setError(`Test email saved to outbox but not sent: ${r.error}`)
      loadAlerts()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const open = async (a) => setPreview(await api.alert(a.id))

  if (!settings) return <p className="text-slate-500">{error || 'Loading…'}</p>

  const toggles = [
    ['auto_restock', 'Auto-order established products', 'Create purchase orders automatically when stock is low. Off = every order needs your review.'],
    ['alert_low_stock', 'Email restock alerts', 'Email when restock orders are created.'],
    ['alert_dead_stock', 'Email dead-stock alerts', 'Weekly email listing products that are not selling.'],
    ['monthly_report', 'Email monthly report', 'Full performance report (PDF + Excel) on the 1st of each month.'],
  ]
  const numbers = [
    ['new_product_days', 'New product period (days)', 'Products younger than this need your verification.'],
    ['dead_stock_days', 'Dead stock after (days unsold)', 'In stock but no sale for this long.'],
    ['slow_cover_days', 'Slow mover above (days of stock)', 'More stock than this many days of sales.'],
    ['analysis_days', 'Performance window (days)', 'Period used for ranking and alerts.'],
  ]

  return (
    <>
      <PageHeader title="Alerts & Settings" subtitle={`Automation runs every ${interval} minutes. All alerts are emailed to the owner.`} />
      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <form onSubmit={save} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Owner email (alerts & reports go here)">
                <input type="email" className={inputClass} value={settings.owner_email} onChange={(e) => set('owner_email', e.target.value)} placeholder="owner@example.com" />
              </Field>
              <Field label="Shop name (shown on reports)">
                <input className={inputClass} value={settings.shop_name} onChange={(e) => set('shop_name', e.target.value)} />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {toggles.map(([k, label, help]) => (
                <label key={k} className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50">
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-emerald-600" checked={settings[k]} onChange={(e) => set(k, e.target.checked)} />
                  <span>
                    <span className="block text-sm font-medium text-slate-800">{label}</span>
                    <span className="text-xs text-slate-500">{help}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {numbers.map(([k, label, help]) => (
                <Field key={k} label={label}>
                  <input type="number" min="1" className={inputClass} value={settings[k]} onChange={(e) => set(k, e.target.value)} />
                  <span className="mt-1 block text-xs text-slate-400">{help}</span>
                </Field>
              ))}
            </div>
            <Button type="submit" disabled={busy}><Save size={16} /> Save settings</Button>
          </form>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Mail size={18} className="text-emerald-600" /> Email delivery</h2>
          {smtp?.configured ? (
            <p className="mt-2 text-sm text-emerald-700">✓ SMTP configured ({smtp.host}:{smtp.port}{smtp.from ? `, from ${smtp.from}` : ''}).</p>
          ) : (
            <div className="mt-2 space-y-2 text-sm text-slate-600">
              <p className="font-medium text-amber-700">SMTP is not configured yet - alerts are saved to the outbox below.</p>
              <p>To send real emails, add these to <code>backend/.env</code> and restart the backend:</p>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{`SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=you@gmail.com`}</pre>
              <p className="text-xs text-slate-400">For Gmail, create an App Password (Google Account → Security → App passwords).</p>
            </div>
          )}
          <Button variant="ghost" className="mt-4 w-full" onClick={test} disabled={busy}><Send size={16} /> Send test email</Button>
        </Card>
      </div>

      <Card className="mt-6">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Alert outbox</h2>
          <p className="text-xs text-slate-400">Every alert and report DukaBuddy has sent or tried to send. Click to preview.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Subject</th>
                <th className="px-5 py-3">To</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alerts.map((a) => (
                <tr key={a.id} onClick={() => open(a)} className="cursor-pointer hover:bg-slate-50">
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(a.created_at)}</td>
                  <td className="px-5 py-3 text-slate-600">{KIND_LABELS[a.kind] || a.kind}</td>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800">{a.subject}</p>
                    {a.attachments && <p className="text-xs text-slate-400">📎 {a.attachments}</p>}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{a.to_addr || '—'}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[a.status]}`}>{a.status === 'logged' ? 'In outbox' : a.status}</span>
                    {a.error && <p className="mt-1 max-w-56 text-xs text-slate-400">{a.error}</p>}
                  </td>
                </tr>
              ))}
              {alerts.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-500">No alerts yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPreview(null)}>
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <p className="font-semibold text-slate-900">{preview.subject}</p>
                <p className="text-xs text-slate-400">To: {preview.to_addr || '—'} · {preview.created_at}{preview.attachments ? ` · 📎 ${preview.attachments}` : ''}</p>
              </div>
              <button onClick={() => setPreview(null)} className="rounded-lg p-1 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
            </div>
            {/* sandboxed: email HTML can't run scripts */}
            <iframe title="Email preview" sandbox="" srcDoc={preview.body_html} className="h-[70vh] w-full" />
          </div>
        </div>
      )}
    </>
  )
}
