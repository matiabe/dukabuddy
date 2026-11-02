import { Check, Printer, X } from 'lucide-react'
import { ksh } from '../api.js'
import { useAuth } from '../auth.jsx'
import { Alert, Button } from './ui.jsx'

// draft: a preview of a sale that is not saved yet; onRecord(print) records it, optionally printing the receipt.
export default function ReceiptModal({ tx, onClose, children, draft = false, onRecord, busy = false, error = '' }) {
  const { shopName } = useAuth()
  if (!tx) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={busy ? undefined : onClose}>
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {draft && (
          <p className="no-print rounded-t-2xl bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800">
            Not recorded yet - the sale is saved when you tap Record sale. Printing is optional.
          </p>
        )}
        <div className="print-area p-6 font-mono text-sm text-slate-800">
          <div className="text-center">
            <p className="text-lg font-bold">{shopName}</p>
            <p className="mt-2 text-xs">Receipt {tx.receipt_no}</p>
            <p className="text-xs text-slate-500">{tx.created_at}</p>
          </div>
          <div className="my-3 border-t border-dashed border-slate-300" />
          {tx.items.map((it) => (
            <div key={it.product_id} className="mb-1.5">
              <p>{it.product_name}</p>
              <div className="flex justify-between text-xs text-slate-600">
                <span>{it.quantity} × {ksh(it.unit_price)}</span>
                <span>{ksh(it.quantity * it.unit_price)}</span>
              </div>
            </div>
          ))}
          <div className="my-3 border-t border-dashed border-slate-300" />
          <Row label="Subtotal" value={ksh(tx.subtotal)} />
          {tx.discount > 0 && <Row label={`Points used (${tx.points_redeemed})`} value={`-${ksh(tx.discount)}`} />}
          {tx.price_cut > 0 && <Row label="Agreed price reduction" value={`-${ksh(tx.price_cut)}`} />}
          <Row label="TOTAL" value={ksh(tx.total)} bold />
          <Row label={`Paid (${tx.payment_method})`} value={ksh(tx.amount_paid)} />
          {tx.change_given > 0 && <Row label="Change" value={ksh(tx.change_given)} />}
          <p className="mt-2 text-xs text-slate-500">{tx.items_count} item(s)</p>
          {tx.served_by && <p className="text-xs text-slate-500">Served by: {tx.served_by}</p>}
          {tx.customer_name && (
            <>
              <div className="my-3 border-t border-dashed border-slate-300" />
              <p className="text-xs">Customer: {tx.customer_name}</p>
              <p className="text-xs">Points earned: +{tx.points_earned}</p>
            </>
          )}
          <p className="mt-4 text-center text-xs text-slate-500">Asante kwa kununua! Karibu tena.</p>
        </div>
        {error && <div className="no-print px-4"><Alert>{error}</Alert></div>}
        <div className="no-print flex gap-2 border-t border-slate-100 p-4">
          {draft ? (
            <>
              <Button className="flex-1" disabled={busy} onClick={() => onRecord(false)}>
                <Check size={16} /> {busy ? 'Recording…' : 'Record sale'}
              </Button>
              <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => onRecord(true)}>
                <Printer size={16} /> Record & print
              </Button>
            </>
          ) : (
            <Button variant="ghost" className="flex-1" onClick={() => window.print()}>
              <Printer size={16} /> Print
            </Button>
          )}
          {children}
          <Button variant="ghost" onClick={onClose} disabled={busy} aria-label="Close"><X size={16} /></Button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, bold }) {
  return (
    <div className={`flex justify-between ${bold ? 'mt-1 text-base font-bold' : 'text-xs'}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
}
