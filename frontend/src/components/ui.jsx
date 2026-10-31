export function Card({ className = '', children }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
}

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Button({ variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-300',
    ghost: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
  }
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${styles[variant]} ${className}`}
      {...props}
    />
  )
}

export function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'

export function Alert({ type = 'error', children }) {
  if (!children) return null
  const cls = type === 'error' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>
}

const TIER_STYLES = {
  Gold: 'bg-yellow-100 text-yellow-800',
  Silver: 'bg-slate-200 text-slate-700',
  Bronze: 'bg-orange-100 text-orange-800',
}
export function TierBadge({ tier }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIER_STYLES[tier]}`}>{tier}</span>
}

const STATUS_STYLES = {
  Loyal: 'bg-emerald-100 text-emerald-700',
  Regular: 'bg-blue-100 text-blue-700',
  Occasional: 'bg-slate-100 text-slate-600',
  'At risk': 'bg-red-100 text-red-700',
  New: 'bg-violet-100 text-violet-700',
}
export function StatusBadge({ status }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>{status}</span>
}

export function StockBadge({ product }) {
  if (product.quantity === 0)
    return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">Out of stock</span>
  if (product.low_stock)
    return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">Low stock</span>
  return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">In stock</span>
}
