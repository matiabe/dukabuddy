import { useEffect, useState } from 'react'
import { ArrowLeft, CheckCircle2, Clock, RefreshCw, Send, TriangleAlert } from 'lucide-react'
import { api, ksh, when } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Alert, Button, Card, Field, PageHeader, inputClass } from '../components/ui.jsx'

// Money a staff member collects is sent to the boss; the boss confirms it arrived.
export default function Handover() {
  const { isOwner } = useAuth()
  return isOwner ? <BossView /> : <StaffView />
}

const STATUS = {
  sent: { label: 'Waiting for boss', cls: 'bg-amber-100 text-amber-800' },
  received: { label: 'Received', cls: 'bg-emerald-100 text-emerald-700' },
  problem: { label: 'Problem', cls: 'bg-red-100 text-red-700' },
}
function StatusPill({ status }) {
  const s = STATUS[status]
  return s ? <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.cls}`}>{s.label}</span> : null
}

function Breakdown({ s }) {
  const rows = [['Cash', s.cash_total], ['M-Pesa', s.mpesa_total], ['Card', s.card_total], ['Credit (not paid yet)', s.credit_total]]
  return (
    <dl className="space-y-1 text-sm">
      {rows.filter(([, v]) => v > 0).map(([k, v]) => (
        <div key={k} className="flex justify-between"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-700">{ksh(v)}</dd></div>
      ))}
      <div className="flex justify-between border-t border-slate-100 pt-1">
        <dt className="font-semibold text-slate-700">Money collected</dt><dd className="font-bold text-slate-900">{ksh(s.expected)}</dd>
      </div>
    </dl>
  )
}

// ---------------------------------------------------------------- staff
function StaffView() {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ amount_sent: '', send_method: 'M-Pesa', reference: '', note: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.handoverCurrent().then((d) => {
    setData(d)
    if (d.session) setForm((f) => ({ ...f, amount_sent: f.amount_sent === '' ? String(d.session.expected) : f.amount_sent }))
  }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const s = data?.session
  const differs = s && form.amount_sent !== '' && Math.abs(Number(form.amount_sent) - s.expected) > 0.5

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!confirm(`Send ${ksh(form.amount_sent)} to the boss by ${form.send_method}?`)) return
    try {
      const sent = await api.handoverSend(form)
      setSuccess(`Sent ${ksh(sent.amount_sent)} to the boss. They have been notified and will confirm when it arrives.`)
      setForm({ amount_sent: '', send_method: form.send_method, reference: '', note: '' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <PageHeader title="Send money to boss" subtitle="Your sales since your last handover. Send the money and the boss confirms when it arrives."
        action={<Button variant="ghost" onClick={load}><RefreshCw size={16} /> Refresh</Button>} />
      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>
      {!data && !error && <p className="text-slate-500">Loading…</p>}

      {data && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="p-5">
            <h2 className="mb-1 font-semibold text-slate-900">Current session</h2>
            {s && s.sales_count > 0 ? (
              <>
                <p className="mb-4 text-xs text-slate-400">{s.sales_count} sale(s) · first {when(s.first_sale)} · last {when(s.last_sale)}</p>
                <Breakdown s={s} />
              </>
            ) : (
              <p className="text-sm text-slate-500">No sales since your last handover. A new session starts with your next sale.</p>
            )}
          </Card>

          {s && s.sales_count > 0 && (
            <Card className="p-5 xl:col-span-2">
              <h2 className="mb-4 font-semibold text-slate-900">Send to boss</h2>
              <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
                <Field label="Amount you are sending (KSh)">
                  <input type="number" min="0" step="any" className={inputClass} value={form.amount_sent} onChange={set('amount_sent')} required />
                </Field>
                <Field label="How">
                  <select className={inputClass} value={form.send_method} onChange={set('send_method')}>
                    {data.send_methods.map((m) => <option key={m} value={m}>{m === 'Cash' ? 'Cash (handed over)' : m}</option>)}
                  </select>
                </Field>
                <Field label={form.send_method === 'M-Pesa' ? 'M-Pesa code' : 'Reference (optional)'}>
                  <input className={inputClass} value={form.reference} onChange={set('reference')}
                    placeholder={form.send_method === 'M-Pesa' ? 'e.g. QJK4X1ABCD' : form.send_method === 'Bank' ? 'e.g. deposit slip no.' : ''} />
                </Field>
                <Field label={differs ? 'Why is the amount different? (required)' : 'Note (optional)'}>
                  <input className={inputClass} value={form.note} onChange={set('note')} required={differs}
                    placeholder={differs ? 'e.g. KSh 500 paid for transport' : ''} />
                </Field>
                {differs && (
                  <div className="sm:col-span-2">
                    <Alert>You collected {ksh(s.expected)} but are sending {ksh(form.amount_sent)}.</Alert>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <Button type="submit"><Send size={16} /> Send to boss</Button>
                </div>
              </form>
            </Card>
          )}

          <Card className="xl:col-span-3">
            <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">My handovers</h2>
            <HandoverTable rows={data.recent} empty="You have not sent any money yet." />
          </Card>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- boss
function BossView() {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  const load = () => api.handovers(filter).then(setData).catch((e) => setError(e.message))
  useEffect(() => { load() }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  if (selected) return <HandoverDetail id={selected} onBack={() => { setSelected(null); load() }} />

  return (
    <>
      <PageHeader title="Money Handover" subtitle="Money your staff have sent you, and money still with them"
        action={<Button variant="ghost" onClick={load}><RefreshCw size={16} /> Refresh</Button>} />
      <Alert>{error}</Alert>
      {!data && !error && <p className="text-slate-500">Loading…</p>}

      {data && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2">
            <Card className="p-4">
              <p className="text-xs font-medium text-slate-500">Sent to you, waiting for your confirmation</p>
              <p className="mt-1 text-2xl font-bold text-amber-700">{ksh(data.pending.amount)}</p>
              <p className="text-xs text-slate-400">{data.pending.count} handover(s)</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-medium text-slate-500">Still with staff (not sent yet)</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{ksh(data.with_staff)}</p>
              <p className="text-xs text-slate-400">{data.open_sessions.length} staff member(s) with unsent sales</p>
            </Card>
          </div>

          {data.open_sessions.length > 0 && (
            <Card className="mb-6">
              <h2 className="border-b border-slate-100 px-5 py-4 font-semibold text-slate-900">Not sent yet</h2>
              <ul className="divide-y divide-slate-100">
                {data.open_sessions.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <span>
                      <span className="font-medium text-slate-800">{s.user_name}</span>
                      <span className="block text-xs text-slate-400">{s.sales_count} sale(s) since {when(s.first_sale)}</span>
                    </span>
                    <span className="font-semibold">{ksh(s.expected)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-4">
              <h2 className="mr-auto font-semibold text-slate-900">Handovers</h2>
              {[['', 'All'], ['sent', 'Waiting'], ['received', 'Received'], ['problem', 'Problem']].map(([k, label]) => (
                <button key={k} onClick={() => setFilter(k)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === k ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {label}
                </button>
              ))}
            </div>
            <HandoverTable rows={data.handovers} showWho onSelect={setSelected} empty="No money has been sent yet." />
          </Card>
        </>
      )}
    </>
  )
}

function HandoverTable({ rows, showWho, onSelect, empty }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showWho && <th className="px-5 py-3">From</th>}
            <th className="px-5 py-3">Sent</th>
            <th className="px-5 py-3">How</th>
            <th className="px-5 py-3 text-right">Collected</th>
            <th className="px-5 py-3 text-right">Sent</th>
            <th className="px-5 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((h) => (
            <tr key={h.id} onClick={onSelect && (() => onSelect(h.id))} className={onSelect ? 'cursor-pointer hover:bg-slate-50' : ''}>
              {showWho && <td className="px-5 py-3 font-medium text-slate-800">{h.user_name}</td>}
              <td className="whitespace-nowrap px-5 py-3 text-slate-500">{when(h.sent_at)}</td>
              <td className="px-5 py-3 text-slate-600">{h.send_method}{h.reference && <span className="block text-xs text-slate-400">{h.reference}</span>}</td>
              <td className="px-5 py-3 text-right text-slate-600">{ksh(h.expected)}</td>
              <td className="px-5 py-3 text-right font-semibold">
                {ksh(h.amount_sent)}
                {h.shortage > 0.5 && <span className="block text-xs font-medium text-red-600">short {ksh(h.shortage)}</span>}
              </td>
              <td className="px-5 py-3"><StatusPill status={h.status} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-center text-slate-500">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function HandoverDetail({ id, onBack }) {
  const [data, setData] = useState(null)
  const [form, setForm] = useState({ amount_received: '', note: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const load = () => api.handover(id).then((d) => {
    setData(d)
    setForm({ amount_received: String(d.handover.amount_received ?? d.handover.amount_sent), note: d.handover.owner_note || '' })
  }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <p className="text-slate-500">{error || 'Loading…'}</p>
  const h = data.handover

  const mark = async (status) => {
    setError('')
    setSuccess('')
    try {
      await api.confirmHandover(id, { status, ...form })
      setSuccess(status === 'received' ? 'Marked as received.' : 'Problem recorded.')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={16} /> All handovers
      </button>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Money sent by</p>
          <h1 className="text-2xl font-bold text-slate-900">{h.user_name}</h1>
          <p className="text-sm text-slate-500">
            {when(h.sent_at)} · by {h.send_method}{h.reference && ` · ${h.reference}`} · session started {when(h.opened_at)}
          </p>
          {h.note && <p className="mt-1 text-sm text-slate-700">Their note: {h.note}</p>}
        </div>
        <Card className="p-4 text-right">
          <p className="text-xs font-medium text-slate-500">Amount sent</p>
          <p className="text-2xl font-bold text-slate-900">{ksh(h.amount_sent)}</p>
          {h.shortage > 0.5 && <p className="text-xs font-semibold text-red-600">{ksh(h.shortage)} less than collected</p>}
          {h.shortage < -0.5 && <p className="text-xs text-slate-400">{ksh(-h.shortage)} more than collected</p>}
          <div className="mt-1"><StatusPill status={h.status} /></div>
        </Card>
      </div>

      <div className="mb-4 space-y-2">
        <Alert>{error}</Alert>
        <Alert type="success">{success}</Alert>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">{h.status === 'sent' ? 'Did the money arrive?' : 'Your confirmation'}</h2>
          {h.checked_by && (
            <p className="mb-3 text-xs text-slate-500">
              {STATUS[h.status].label} · {h.checked_by} · {when(h.checked_at)}
              {h.amount_received != null && ` · received ${ksh(h.amount_received)}`}
            </p>
          )}
          <div className="space-y-3">
            <Field label="Amount you received (KSh)">
              <input type="number" min="0" step="any" className={inputClass} value={form.amount_received}
                onChange={(e) => setForm({ ...form, amount_received: e.target.value })} />
            </Field>
            <Field label="Note (needed for a problem or a different amount)">
              <input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="e.g. M-Pesa not received yet" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => mark('received')}><CheckCircle2 size={16} /> Received</Button>
              <Button variant="danger" onClick={() => mark('problem')}><TriangleAlert size={16} /> Problem</Button>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-slate-900">What was collected</h2>
          <Breakdown s={h} />
          <p className="mt-3 text-xs text-slate-400">Total sales {ksh(h.sales_total)} · {h.sales_count} sale(s). Credit sales are not counted as collected.</p>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><Clock size={16} /> Sales in this session</h2>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto pr-1 text-sm">
            {data.sales.map((t) => (
              <li key={t.id} className="flex justify-between gap-3 py-2">
                <span>
                  <span className="font-medium text-slate-700">{t.receipt_no}</span>
                  <span className="block text-xs text-slate-400">{when(t.created_at)} · {t.payment_method}{t.customer_name && ` · ${t.customer_name}`}</span>
                </span>
                <span className="font-semibold">{ksh(t.total)}</span>
              </li>
            ))}
            {data.sales.length === 0 && <li className="py-2 text-slate-500">The sales in this session were removed.</li>}
          </ul>
        </Card>
      </div>
    </>
  )
}
