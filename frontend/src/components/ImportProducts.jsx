import { useRef, useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { api, ksh } from '../api.js'
import { Alert, Button, Card } from './ui.jsx'

const FIELD_LABELS = {
  category: 'Category', buying_price: 'Buying', selling_price: 'Selling', quantity: 'Stock', reorder_level: 'Reorder at',
}
const fmt = (field, v) => (field.endsWith('price') ? ksh(v) : v)

// Upload an Excel/CSV product list: preview first, then confirm to save.
export default function ImportProducts({ onDone }) {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const choose = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFile(f)
    setPreview(null)
    setError('')
    setBusy(true)
    try {
      setPreview(await api.importProducts(f, false))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await api.importProducts(file, true)
      onDone(`Imported ${file.name}: ${r.created.length} new, ${r.updated.length} updated` +
        (r.errors.length ? `, ${r.errors.length} row(s) skipped.` : '.'))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const nothingToSave = preview && preview.created.length + preview.updated.length === 0

  return (
    <Card className="mb-6 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-800"><FileSpreadsheet size={18} /> Import products from Excel</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            First row = headings: <b>Product name, Category, Buying price, Selling price, Quantity, Reorder level</b> (buying price,
            category and reorder level are optional; a Brand column is added to the name). Products that already exist (same name)
            get their prices, category, reorder level and stock quantity updated from the file. Without a buying price, existing
            products keep their current one and new products start at KSh 0 until you edit them.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/products/import/template" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <Download size={16} /> Template
          </a>
          <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={choose} />
          <Button onClick={() => inputRef.current.click()} disabled={busy}><Upload size={16} /> Choose file</Button>
        </div>
      </div>

      <div className="mt-3"><Alert>{error}</Alert></div>
      {busy && !preview && <p className="mt-3 text-sm text-slate-500">Reading {file?.name}…</p>}

      {preview && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-600">
            <b>{file.name}</b>: <span className="text-emerald-700">{preview.created.length} new</span>,{' '}
            <span className="text-sky-700">{preview.updated.length} to update</span>, {preview.unchanged} unchanged
            {preview.errors.length > 0 && <>, <span className="text-red-600">{preview.errors.length} with problems (will be skipped)</span></>}.
            <span className="block text-xs text-slate-400">
              Columns used: {Object.entries(preview.columns).map(([k, v]) => `${k} ← "${v}"`).join(' · ')}
            </span>
          </p>

          {preview.errors.length > 0 && (
            <Section title="Rows with problems" tone="text-red-600">
              {preview.errors.map((e) => (
                <tr key={e.row}><Td>Row {e.row}</Td><Td>{e.name || '—'}</Td><Td className="text-red-600">{e.error}</Td></tr>
              ))}
            </Section>
          )}
          {preview.created.length > 0 && (
            <Section title="New products" tone="text-emerald-700">
              {preview.created.map((p) => (
                <tr key={p.row}>
                  <Td>{p.name}</Td><Td>{p.category}</Td><Td>
                    {p.cost_missing
                      ? <>Sells at {ksh(p.selling_price)} <span className="text-amber-600">(buying price not set)</span></>
                      : <>{ksh(p.buying_price)} → {ksh(p.selling_price)}</>}
                  </Td>
                  <Td>{p.quantity} in stock, reorder at {p.reorder_level}</Td>
                </tr>
              ))}
            </Section>
          )}
          {preview.updated.length > 0 && (
            <Section title="Existing products to update" tone="text-sky-700">
              {preview.updated.map((p) => (
                <tr key={p.row}>
                  <Td>{p.name}</Td>
                  <Td>
                    {Object.entries(p.changes).map(([f, c]) => (
                      <span key={f} className="mr-3 whitespace-nowrap">{FIELD_LABELS[f]}: {fmt(f, c.from)} → <b>{fmt(f, c.to)}</b></span>
                    ))}
                  </Td>
                </tr>
              ))}
            </Section>
          )}

          <div className="flex gap-2">
            <Button onClick={confirm} disabled={busy || nothingToSave}>
              {busy ? 'Importing…' : nothingToSave ? 'Nothing to import' : `Import ${preview.created.length + preview.updated.length} products`}
            </Button>
            <Button variant="ghost" onClick={() => { setPreview(null); setFile(null) }} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function Section({ title, tone, children }) {
  return (
    <div>
      <h3 className={`mb-1 text-sm font-semibold ${tone}`}>{title}</h3>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-100">
        <table className="w-full text-left text-sm"><tbody className="divide-y divide-slate-100">{children}</tbody></table>
      </div>
    </div>
  )
}

const Td = ({ className = '', children }) => <td className={`px-3 py-2 text-slate-700 ${className}`}>{children}</td>
