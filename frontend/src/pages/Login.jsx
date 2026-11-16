import { useState } from 'react'
import { Smartphone } from 'lucide-react'
import { api } from '../api.js'
import { Alert, Button, Field, inputClass, PasswordInput } from '../components/ui.jsx'

// Login screen. With setup=true (no accounts exist yet) it creates the owner account instead.
// "Forgot password?" sends a code by SMS to the phone saved on the account, then lets you set a new password.
export default function Login({ setup, shopName, onLogin }) {
  const [form, setForm] = useState({ name: '', username: '', password: '', confirm: '', code: '' })
  const [mode, setMode] = useState('login') // login | forgot (ask for code) | reset (enter code + new password)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const go = (m) => {
    setMode(m)
    setError('')
    setInfo('')
    setForm({ ...form, password: '', confirm: '', code: '' })
  }

  const run = async (fn) => {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const submit = (e) => {
    e.preventDefault()
    if ((setup || mode === 'reset') && form.password !== form.confirm) return setError('The two passwords do not match.')
    run(async () => {
      if (mode === 'forgot') {
        const r = await api.forgotPassword(form.username)
        setMode('reset')
        setInfo(r.message)
      } else if (mode === 'reset') {
        const r = await api.resetPassword(form.username, form.code, form.password)
        onLogin(r.user)
      } else {
        const r = setup
          ? await api.setup({ name: form.name, username: form.username, password: form.password })
          : await api.login(form.username, form.password)
        onLogin(r.user)
      }
    })
  }

  const resend = () => run(async () => setInfo((await api.forgotPassword(form.username)).message))

  const title = setup ? (
    <p className="text-sm text-slate-600">
      <b>First-time setup.</b> Create the <b>owner</b> account. The owner sees everything and adds staff accounts later.
    </p>
  ) : mode === 'forgot' ? (
    <p className="text-sm text-slate-600">
      <b>Reset your password.</b> Enter your username and we will send a 6-digit code by SMS to the phone number saved on your account.
    </p>
  ) : mode === 'reset' ? (
    <p className="text-sm text-slate-600"><b>Enter the code</b> from the SMS and choose a new password.</p>
  ) : (
    <p className="text-sm text-slate-600">Log in to continue.</p>
  )

  const newPassword = setup || mode === 'reset'

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white"><Smartphone size={22} /></div>
          <p className="text-lg font-bold text-slate-900">{shopName}</p>
        </div>
        {title}
        <Alert>{error}</Alert>
        <Alert type="success">{info}</Alert>
        {setup && (
          <Field label="Your name">
            <input className={inputClass} value={form.name} onChange={set('name')} placeholder="e.g. Nyambura" required autoFocus />
          </Field>
        )}
        <Field label="Username">
          <input className={inputClass} value={form.username} onChange={set('username')} autoCapitalize="none" autoComplete="username"
            required autoFocus={!setup && mode !== 'reset'} readOnly={mode === 'reset'} />
        </Field>
        {mode === 'reset' && (
          <Field label="Code from SMS">
            <input className={inputClass} value={form.code} onChange={set('code')} inputMode="numeric" autoComplete="one-time-code"
              placeholder="6 digits" maxLength={7} required autoFocus />
          </Field>
        )}
        {mode !== 'forgot' && (
          <Field label={mode === 'reset' ? 'New password (at least 6 characters)' : 'Password'}>
            <PasswordInput value={form.password} onChange={set('password')}
              autoComplete={newPassword ? 'new-password' : 'current-password'} required minLength={newPassword ? 6 : undefined} />
          </Field>
        )}
        {newPassword && (
          <Field label="Repeat password">
            <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
          </Field>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Please wait…'
            : setup ? 'Create owner account'
            : mode === 'forgot' ? 'Send code'
            : mode === 'reset' ? 'Set new password'
            : 'Log in'}
        </Button>
        {!setup && (
          <div className="flex justify-between text-sm">
            {mode === 'login' ? (
              <button type="button" onClick={() => go('forgot')} className="font-medium text-emerald-600 hover:underline">Forgot password?</button>
            ) : (
              <button type="button" onClick={() => go('login')} className="font-medium text-emerald-600 hover:underline">← Back to log in</button>
            )}
            {mode === 'reset' && (
              <button type="button" onClick={resend} disabled={busy} className="font-medium text-slate-500 hover:underline">Send a new code</button>
            )}
          </div>
        )}
      </form>
    </div>
  )
}
