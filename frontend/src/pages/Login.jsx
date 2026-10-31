import { useState } from 'react'
import { Smartphone } from 'lucide-react'
import { api } from '../api.js'
import { Alert, Button, Field, inputClass } from '../components/ui.jsx'

// Login screen. With setup=true (no accounts exist yet) it creates the owner account instead.
export default function Login({ setup, shopName, onLogin }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (setup && form.password !== form.confirm) return setError('The two passwords do not match.')
    setBusy(true)
    try {
      const r = setup
        ? await api.setup({ name: form.name, username: form.username, password: form.password })
        : await api.login(form.username, form.password)
      onLogin(r.user)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white"><Smartphone size={22} /></div>
          <p className="text-lg font-bold text-slate-900">{shopName}</p>
        </div>
        {setup ? (
          <p className="text-sm text-slate-600">
            <b>First-time setup.</b> Create the <b>owner</b> account. The owner sees everything and adds staff accounts later.
          </p>
        ) : (
          <p className="text-sm text-slate-600">Log in to continue.</p>
        )}
        <Alert>{error}</Alert>
        {setup && (
          <Field label="Your name">
            <input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. Nyambura" required autoFocus />
          </Field>
        )}
        <Field label="Username">
          <input className={inputClass} value={form.username} onChange={set('username')} autoCapitalize="none" autoComplete="username" required autoFocus={!setup} />
        </Field>
        <Field label="Password">
          <input type="password" className={inputClass} value={form.password} onChange={set('password')}
            autoComplete={setup ? 'new-password' : 'current-password'} required minLength={setup ? 6 : undefined} />
        </Field>
        {setup && (
          <Field label="Repeat password">
            <input type="password" className={inputClass} value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
          </Field>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Please wait…' : setup ? 'Create owner account' : 'Log in'}
        </Button>
      </form>
    </div>
  )
}
