import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { InvoiceWithClient, ReminderLog } from '../lib/types'

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [invoice, setInvoice] = useState<InvoiceWithClient | null>(null)
  const [reminders, setReminders] = useState<ReminderLog[]>([])
  const [error, setError] = useState(false)
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setError(false)
    setInvoice(null)

    const [invoiceResult, remindersResult] = await Promise.all([
      supabase
        .from('invoices')
        .select('*, client:clients(id, name, email)')
        .eq('id', id)
        .single<InvoiceWithClient>(),
      supabase
        .from('reminder_log')
        .select('*')
        .eq('invoice_id', id)
        .order('sent_at', { ascending: false })
        .returns<ReminderLog[]>(),
    ])

    if (invoiceResult.error || !invoiceResult.data) {
      setError(true)
      return
    }

    setInvoice(invoiceResult.data)
    setReminders(remindersResult.data ?? [])
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function markPaid() {
    if (!invoice) return
    setMarking(true)

    const { error: updateError } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', invoice.id)

    setMarking(false)

    if (!updateError) {
      setInvoice({ ...invoice, status: 'paid', paid_at: new Date().toISOString() })
    }
  }

  if (error) {
    return (
      <div>
        <p className="error-message">Could not load this invoice.</p>
        <button type="button" className="btn-secondary" onClick={load}>
          Retry
        </button>
      </div>
    )
  }

  if (!invoice) return <p className="page-status">Loading…</p>

  const isOverdue =
    invoice.status === 'unpaid' &&
    new Date(invoice.due_date + 'T00:00:00') < new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')

  return (
    <div className="card">
      <button type="button" className="btn-secondary" onClick={() => navigate('/')}>
        ← Back to dashboard
      </button>

      <div className="page-header" style={{ marginTop: '1rem' }}>
        <h1>{invoice.client.name}</h1>
        <span className={`status-badge ${invoice.status}`}>
          {invoice.status === 'paid' ? 'Paid' : isOverdue ? 'Overdue' : 'Unpaid'}
        </span>
      </div>

      <p>{invoice.description}</p>
      <p>
        <strong>${invoice.amount.toFixed(2)}</strong> due {invoice.due_date}
      </p>

      {invoice.status === 'unpaid' && (
        <button type="button" className="btn-primary" disabled={marking} onClick={markPaid}>
          {marking ? 'Saving…' : 'Mark as paid'}
        </button>
      )}

      <h2 style={{ marginTop: '2rem', fontSize: '1.05rem' }}>Reminder log</h2>
      {reminders.length === 0 ? (
        <p className="page-status">No reminders sent yet.</p>
      ) : (
        <ul className="reminder-log-list">
          {reminders.map((r) => (
            <li key={r.id}>
              <span>{r.type === 'pre_due' ? 'Pre-due reminder' : 'Overdue reminder'}</span>
              <span>{new Date(r.sent_at).toLocaleString()}</span>
              <span>{r.success ? 'Sent' : 'Failed'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
