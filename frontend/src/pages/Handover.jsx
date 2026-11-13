import { useEffect, useState } from 'react'
import { RefreshCw, Send, Trash2 } from 'lucide-react'
import { api, ksh } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui.jsx'

// A simple log: staff record each time they send money to the boss, so everyone can keep track of it.
export default function Handover() {
  const { isOwner } = useAuth()
  const [data, setData] = useState(null)
  const [person, setPerson] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.moneySent(isOwner ? person : '').then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [person]) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = async (m) => {
    if (!confirm(`Delete the record of ${ksh(m.amount)} sent on ${day(m.sent_on)}?`)) return
    setError('')
    setSuccess('')
    try {
      await api.deleteMoneySent(m.id)
      setSuccess('Record deleted.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const t = data?.totals
  return (
    <>
      <PageHeader
        title={isOwner ? 'Money sent to you' : 'Money I sent to the boss'}
        subtitle={isOwner ? 'What your staff have recorded sending you' : 'Record every time you send money to the boss, so we keep track of it'}
        action={<Button variant="ghost" onClick={load}><RefreshCw size={16} /> Refresh</Button>}
      />
      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>
      {!data && !error && <p className="text-slate-500">Loading…</p>}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[['Today', t.today, `${t.today_count} record(s)`], ['This week', t.week, 'from Monday'],
              ['This month', t.month, ''], ['All time', t.all_time, '']].map(([label, value, sub]) => (
              <Card key={label} className="p-4">
                <p className="text-xs font-medium text-slate-500">Sent {label.toLowerCase()}</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">{ksh(value)}</p>
                {sub && <p className="text-xs text-slate-400">{sub}</p>}
              </Card>
            ))}
          </div>

          {!isOwner && (
            <RecordForm methods={data.send_methods} today={data.today}
              onSaved={(m) => { setError(''); setSuccess(`Recorded ${ksh(m.amount)} sent by ${m.send_method}.`); load() }}
              onError={(msg) => { setSuccess(''); setError(msg) }} />
          )}

          {isOwner && data.people.length > 0 && (
            <Card>
              <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">By staff member</h2>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Name</th>
                    <th className="px-5 py-3">Last sent</th>
                    <th className="px-5 py-3 text-right">This month</th>
                    <th className="px-5 py-3 text-right">All time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.people.map((p) => (
                    <tr key={p.id} onClick={() => setPerson(String(p.id) === person ? '' : String(p.id))}
                      className={`cursor-pointer hover:bg-slate-50 ${String(p.id) === person ? 'bg-emerald-50' : ''}`}>
                      <td className="px-5 py-3 font-medium text-slate-800">{p.name}</td>
                      <td className="px-5 py-3 text-slate-500">{day(p.last_sent)}</td>
                      <td className="px-5 py-3 text-right font-semibold">{ksh(p.month)}</td>
                      <td className="px-5 py-3 text-right text-slate-600">{ksh(p.all_time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-4">
              <h2 className="mr-auto font-semibold text-slate-900">Records</h2>
              {isOwner && (
                <select className={`${inputClass} w-auto`} value={person} onChange={(e) => setPerson(e.target.value)}>
                  <option value="">Everyone</option>
                  {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3">Date</th>
                    {isOwner && <th className="px-5 py-3">From</th>}
                    <th className="px-5 py-3">How</th>
                    <th className="px-5 py-3">Note</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.entries.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap px-5 py-3 text-slate-600">{day(m.sent_on)}</td>
                      {isOwner && <td className="px-5 py-3 font-medium text-slate-800">{m.user_name}</td>}
                      <td className="px-5 py-3 text-slate-600">
                        {m.send_method === 'Cash' ? 'Cash (handed over)' : m.send_method}
                        {m.reference && <span className="block text-xs text-slate-400">{m.reference}</span>}
                      </td>
                      <td className="px-5 py-3 text-slate-500">{m.note}</td>
                      <td className="px-5 py-3 text-right font-semibold">{ksh(m.amount)}</td>
                      <td className="px-5 py-3 text-right">
                        {m.can_delete && (
                          <button onClick={() => remove(m)} title="Delete" className="text-slate-400 hover:text-red-600">
                            <Trash2 size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.entries.length === 0 && (
                    <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-500">No money has been recorded as sent yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  )
}

function RecordForm({ methods, today, onSaved, onError }) {
  const blank = { amount: '', send_method: 'M-Pesa', reference: '', sent_on: today, note: '' }
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    if (!confirm(`Record that you sent ${ksh(form.amount)} to the boss by ${form.send_method}?`)) return
    setSaving(true)
    try {
      const m = await api.recordMoneySent(form)
      setForm({ ...blank, send_method: form.send_method })
      onSaved(m)
    } catch (err) {
      onError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-4 font-semibold text-slate-900">Record money sent</h2>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Field label="Amount sent (KSh)">
          <input type="number" min="1" step="any" className={inputClass} value={form.amount} onChange={set('amount')} required />
        </Field>
        <Field label="How">
          <select className={inputClass} value={form.send_method} onChange={set('send_method')}>
            {methods.map((m) => <option key={m} value={m}>{m === 'Cash' ? 'Cash (handed over)' : m}</option>)}
          </select>
        </Field>
        <Field label={form.send_method === 'M-Pesa' ? 'M-Pesa code' : 'Reference (optional)'}>
          <input className={inputClass} value={form.reference} onChange={set('reference')}
            placeholder={form.send_method === 'M-Pesa' ? 'e.g. QJK4X1ABCD' : form.send_method === 'Bank' ? 'e.g. deposit slip no.' : ''} />
        </Field>
        <Field label="Date sent">
          <input type="date" max={today} className={inputClass} value={form.sent_on} onChange={set('sent_on')} required />
        </Field>
        <Field label="Note (optional)">
          <input className={inputClass} value={form.note} onChange={set('note')} placeholder="e.g. Monday's sales" />
        </Field>
        <div className="sm:col-span-2 xl:col-span-5">
          <Button type="submit" disabled={saving}><Send size={16} /> {saving ? 'Saving…' : 'Record'}</Button>
        </div>
      </form>
    </Card>
  )
}

function day(d) {
  if (!d) return '—'
  return new Date(`${d}T00:00`).toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
