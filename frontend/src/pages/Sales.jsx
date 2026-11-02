import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Gift, Minus, Plus, Receipt, Search, ShoppingCart, Trash2 } from 'lucide-react'
import { api, ksh } from '../api.js'
import { useAuth } from '../auth.jsx'
import ReceiptModal from '../components/Receipt.jsx'
import { Alert, Button, Card, Field, PageHeader, TierBadge, inputClass } from '../components/ui.jsx'

const METHODS = ['Cash', 'M-Pesa', 'Card', 'Credit']
// Phones/tablets: don't pop the keyboard up over the products on page load
const HAS_MOUSE = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches

export default function Sales({ navigate }) {
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState([]) // [{ product, qty }]
  const [customerId, setCustomerId] = useState('')
  const [redeem, setRedeem] = useState('')
  const [method, setMethod] = useState('Cash')
  const [cash, setCash] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [draft, setDraft] = useState(false) // receipt shown is a preview; nothing is saved until the sale is recorded
  const [printError, setPrintError] = useState('')
  const [warnings, setWarnings] = useState([])
  const { user } = useAuth()
  const cartRef = useRef(null)

  const load = () => {
    api.products().then(setProducts).catch((e) => setError(e.message))
    api.customers().then(setCustomers).catch((e) => setError(e.message))
  }
  useEffect(load, [])

  const filtered = useMemo(
    () => products.filter((p) => `${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase())),
    [products, query],
  )

  const inCart = (id) => cart.find((l) => l.product.id === id)?.qty || 0

  const add = (p) => {
    setError('')
    if (inCart(p.id) >= p.quantity) return setError(`Only ${p.quantity} of ${p.name} in stock.`)
    setCart((c) =>
      c.some((l) => l.product.id === p.id)
        ? c.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l))
        : [...c, { product: p, qty: 1 }],
    )
  }
  const setQty = (id, qty) => {
    setError('')
    setCart((c) =>
      c
        .map((l) => (l.product.id === id ? { ...l, qty: Math.max(0, Math.min(Number(qty) || 0, l.product.quantity)) } : l))
        .filter((l) => l.qty > 0),
    )
  }

  const subtotal = cart.reduce((n, l) => n + l.qty * l.product.selling_price, 0)
  const items = cart.reduce((n, l) => n + l.qty, 0)
  const customer = customers.find((c) => String(c.id) === String(customerId))
  const maxRedeem = customer ? Math.min(customer.points, Math.floor(subtotal)) : 0
  const discount = customer ? Math.min(Number(redeem) || 0, maxRedeem) : 0
  const total = subtotal - discount // at the marked prices
  // Amount received: below the total = price agreed with the customer; above it = change (cash only)
  const received = cash !== ''
  const cashNum = Number(cash) || 0
  const priceCut = received && cashNum > 0 && cashNum < total ? total - cashNum : 0
  const toPay = total - priceCut
  const change = method === 'Cash' && received ? Math.max(0, cashNum - total) : 0
  const badAmount = received && (cashNum <= 0 || (method !== 'Cash' && cashNum > total))
  const pointsToEarn = customer ? Math.floor(Math.floor(toPay / 100) * customer.multiplier) : 0

  const reset = () => {
    setCart([])
    setCustomerId('')
    setRedeem('')
    setCash('')
    setMethod('Cash')
  }

  // Step 1: show the receipt as a preview. Nothing is recorded yet.
  const review = () => {
    setError('')
    setPrintError('')
    setReceipt({
      receipt_no: '(preview)',
      created_at: new Date().toLocaleString('en-KE'),
      items: cart.map((l) => ({
        product_id: l.product.id, product_name: l.product.name, quantity: l.qty, unit_price: l.product.selling_price,
      })),
      subtotal, discount, points_redeemed: discount, total: toPay, price_cut: priceCut,
      payment_method: method,
      amount_paid: received ? cashNum : toPay,
      change_given: change,
      items_count: items,
      served_by: user.name,
      customer_name: customer?.name,
      points_earned: pointsToEarn,
    })
    setDraft(true)
  }

  // Step 2: recording the sale saves it (and deducts stock). Printing the receipt is optional.
  const recordSale = async (print = false) => {
    setPrintError('')
    setSaving(true)
    try {
      const res = await api.checkout({
        items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty })),
        customer_id: customerId || null,
        redeem_points: discount,
        payment_method: method,
        amount_paid: received ? cashNum : null,
      })
      // Render the real receipt (with its receipt number) before the print dialog opens
      flushSync(() => {
        setReceipt(res.transaction)
        setDraft(false)
        setSaving(false)
      })
      setWarnings(res.low_stock)
      reset()
      load()
      if (print) window.print()
    } catch (err) {
      setPrintError(err.message)
      setSaving(false)
    }
  }

  const closeReceipt = () => {
    setReceipt(null)
    setDraft(false)
    setPrintError('')
  }

  return (
    <>
      <PageHeader
        title="New Sale"
        subtitle="Add items to the cart, review, then record the sale. Printing the receipt is optional."
        action={<Button variant="ghost" onClick={() => navigate('history')}><Receipt size={16} /> Sales history</Button>}
      />

      {warnings.length > 0 && (
        <div className="mb-4">
          <Alert>
            Low stock after this sale: {warnings.map((p) => `${p.name} (${p.quantity} left)`).join(', ')}.{' '}
            <button className="font-semibold underline" onClick={() => navigate('lowstock')}>Restock</button>
          </Alert>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-5">
        {/* Product picker */}
        <Card className="xl:col-span-3">
          <div className="border-b border-slate-100 p-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input autoFocus={HAS_MOUSE} className={`${inputClass} pl-9`} placeholder="Search products to add…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="grid max-h-[50vh] gap-2 xl:max-h-[65vh] overflow-y-auto p-4 sm:grid-cols-2">
            {filtered.map((p) => {
              const left = p.quantity - inCart(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => add(p)}
                  disabled={left <= 0}
                  className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-left transition hover:border-emerald-400 hover:bg-emerald-50/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                    <p className={`text-xs ${p.low_stock ? 'text-amber-600' : 'text-slate-400'}`}>
                      {left <= 0 ? 'Out of stock' : `${left} in stock`}
                    </p>
                  </div>
                  <div className="ml-2 flex items-center gap-2">
                    <span className="whitespace-nowrap text-sm font-semibold">{ksh(p.selling_price)}</span>
                    {inCart(p.id) > 0 && (
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">{inCart(p.id)}</span>
                    )}
                  </div>
                </button>
              )
            })}
            {filtered.length === 0 && <p className="p-4 text-sm text-slate-500">No products found.</p>}
          </div>
        </Card>

        {/* Cart & checkout */}
        <div ref={cartRef} className="scroll-mt-20 xl:col-span-2">
        <Card className="flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900"><ShoppingCart size={18} /> Cart ({items})</h2>
            {cart.length > 0 && <button onClick={reset} className="text-xs font-medium text-slate-500 hover:text-red-600">Clear</button>}
          </div>

          <div className="max-h-72 flex-1 divide-y divide-slate-100 overflow-y-auto">
            {cart.length === 0 && <p className="px-5 py-8 text-center text-sm text-slate-400">Tap a product to add it.</p>}
            {cart.map(({ product: p, qty }) => (
              <div key={p.id} className="flex items-center gap-2 px-5 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400">{ksh(p.selling_price)} each</p>
                </div>
                <div className="flex items-center rounded-lg border border-slate-200">
                  <button className="p-1.5 hover:bg-slate-50" onClick={() => setQty(p.id, qty - 1)} aria-label="Decrease"><Minus size={14} /></button>
                  <input className="w-10 text-center text-sm outline-none" value={qty} onChange={(e) => setQty(p.id, e.target.value)} />
                  <button className="p-1.5 hover:bg-slate-50" onClick={() => setQty(p.id, qty + 1)} aria-label="Increase"><Plus size={14} /></button>
                </div>
                <span className="w-20 text-right text-sm font-semibold">{ksh(qty * p.selling_price)}</span>
                <button className="p-1 text-slate-400 hover:text-red-600" onClick={() => setQty(p.id, 0)} aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t border-slate-100 p-5">
            <Field label="Loyalty customer (optional)">
              <select className={inputClass} value={customerId} onChange={(e) => { setCustomerId(e.target.value); setRedeem('') }}>
                <option value="">Walk-in customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} · {c.phone} · {c.points} pts</option>
                ))}
              </select>
            </Field>
            {customer && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{customer.name}</span>
                  <TierBadge tier={customer.tier} />
                </div>
                <p className="mt-1 text-xs text-slate-500">{customer.points} points available (worth {ksh(customer.points)})</p>
                {customer.points > 0 && subtotal > 0 && (
                  <div className="mt-2 flex gap-2">
                    <input type="number" min="0" max={maxRedeem} className={inputClass} placeholder="Points to use" value={redeem} onChange={(e) => setRedeem(e.target.value)} />
                    <Button type="button" variant="ghost" onClick={() => setRedeem(maxRedeem)}>Max</Button>
                  </div>
                )}
              </div>
            )}

            <div>
              <span className="mb-1 block text-sm font-medium text-slate-700">Payment method</span>
              <div className="grid grid-cols-4 gap-1.5">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`rounded-lg border px-2 py-1.5 text-xs font-semibold ${method === m ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Amount received (optional)">
              <input type="number" min="0" inputMode="decimal" className={inputClass} placeholder={total ? String(total) : ''} value={cash} onChange={(e) => setCash(e.target.value)} />
            </Field>
            <p className="-mt-2 text-xs text-slate-400">Agreed a lower price? Type what the customer actually paid and the sale is recorded at that amount.</p>

            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{ksh(subtotal)}</span></div>
              {discount > 0 && <div className="flex justify-between text-slate-500"><span>Points discount</span><span>−{ksh(discount)}</span></div>}
              {priceCut > 0 && (
                <>
                  <div className="flex justify-between text-slate-500"><span>Marked total</span><span>{ksh(total)}</span></div>
                  <div className="flex justify-between font-medium text-amber-700"><span>Agreed price reduction</span><span>−{ksh(priceCut)}</span></div>
                </>
              )}
              <div className="mt-1 flex justify-between text-xl font-bold text-slate-900"><span>Total</span><span>{ksh(toPay)}</span></div>
              {change > 0 && (
                <div className="flex justify-between font-semibold text-emerald-700"><span>Change</span><span>{ksh(change)}</span></div>
              )}
              {badAmount && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  {cashNum <= 0 ? 'Amount received must be more than zero.' : `${method} payments can't be more than the total (no change is given).`}
                </p>
              )}
              {customer && (
                <p className="mt-1 flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <Gift size={12} /> Earns {pointsToEarn} points ({customer.multiplier}× {customer.tier} rate)
                </p>
              )}
            </div>

            <Alert>{error}</Alert>
            <Button className="w-full py-3 text-base" disabled={saving || cart.length === 0 || badAmount} onClick={review}>
              <Receipt size={18} /> {`Checkout · ${ksh(toPay)}`}
            </Button>
          </div>
        </Card>
        </div>
      </div>

      {/* Phones/tablets: the cart sits below the product list, so keep a shortcut to it on screen */}
      {cart.length > 0 && (
        <>
          <div className="h-20 xl:hidden" />
          <button
            onClick={() => cartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="fixed inset-x-3 bottom-3 z-20 flex items-center justify-between rounded-xl bg-emerald-600 px-4 py-3.5 text-white shadow-lg xl:hidden"
          >
            <span className="flex items-center gap-2 font-semibold"><ShoppingCart size={18} /> View cart ({items})</span>
            <span className="font-bold">{ksh(toPay)}</span>
          </button>
        </>
      )}

      <ReceiptModal tx={receipt} onClose={closeReceipt} draft={draft} onRecord={draft ? recordSale : undefined}
        busy={saving} error={printError}>
        {!draft && <Button className="flex-1" onClick={closeReceipt}>New sale</Button>}
      </ReceiptModal>
    </>
  )
}
