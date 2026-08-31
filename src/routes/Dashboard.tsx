import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabaseClient'
import type { InvoiceWithClient } from '../lib/types'

function daysOverdue(dueDate: string): number {
  const due = new Date(dueDate + 'T00:00:00')
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00')
  return Math.round((today.getTime() - due.getTime()) / 86_400_000)
}

interface ConfirmationState {
  reminderConfirmation: true
  dueDate: string
  immediate: boolean
}

export function Dashboard() {
  const { session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState<InvoiceWithClient[] | null>(null)
  const [error, setError] = useState(false)
  const confirmation = location.state as ConfirmationState | null

  const loadInvoices = useCallback(async () => {
    if (!session) return
    setError(false)
    setInvoices(null)

    const { data, error: fetchError } = await supabase
      .from('invoices')
      .select('*, client:clients(id, name, email)')
      .eq('status', 'unpaid')
      .order('due_date', { ascending: true })
      .returns<InvoiceWithClient[]>()

    if (fetchError) {
      setError(true)
      return
    }

    setInvoices(data)
  }, [session])

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

  useEffect(() => {
    if (confirmation) {
      // Clear the confirmation from history state after showing it once.
      navigate(location.pathname, { replace: true })
    }
    // Runs once on mount only — intentionally ignores confirmation/location changes.
  }, [confirmation, location.pathname, navigate])

  async function markPaid(invoiceId: string) {
    const { error: updateError } = await supabase
      .from('invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', invoiceId)

    if (!updateError) {
      setInvoices((prev) => prev?.filter((inv) => inv.id !== invoiceId) ?? null)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Outstanding invoices</h1>
      </div>

      {confirmation && (
        <p className="success-message">
          {confirmation.immediate
            ? 'Invoice saved. This invoice is due today, so the reminder email was sent immediately.'
            : `Invoice saved. A reminder email will be sent 24 hours before the ${confirmation.dueDate} due date, then daily until it's paid.`}
        </p>
      )}

      {error && (
        <div>
          <p className="error-message">Could not load invoices.</p>
          <button type="button" className="btn-secondary" onClick={loadInvoices}>
            Retry
          </button>
        </div>
      )}

      {!error && invoices === null && (
        <>
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </>
      )}

      {!error && invoices !== null && invoices.length === 0 && (
        <div className="empty-state">
          <p>No outstanding invoices.</p>
          <Link to="/invoices/new" className="btn-primary">
            Create your first invoice
          </Link>
        </div>
      )}

      {!error && invoices !== null && invoices.length > 0 && (
        <ul className="invoice-list">
          {invoices.map((invoice) => {
            const overdue = daysOverdue(invoice.due_date)
            return (
              <li key={invoice.id} className="invoice-row">
                <Link to={`/invoices/${invoice.id}`}>
                  <span className="invoice-meta">
                    <span className="client-name">{invoice.client.name}</span>
                    <span className={`due-info${overdue > 0 ? ' overdue' : ''}`}>
                      {overdue > 0
                        ? `${overdue} day${overdue === 1 ? '' : 's'} overdue`
                        : overdue === 0
                          ? 'Due today'
                          : `Due in ${-overdue} day${-overdue === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span className="invoice-amount">
                    ${invoice.amount.toFixed(2)}
                  </span>
                </Link>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => markPaid(invoice.id)}
                >
                  Mark as paid
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
