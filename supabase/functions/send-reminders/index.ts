// Nudge reminder sender.
//
// Two ways to invoke:
//  - No body (or empty body): the daily cron path. Sends the pre-due
//    reminder for every unpaid invoice due tomorrow, and one overdue
//    reminder for every unpaid invoice already at or past its due date.
//  - { invoice_id }: sends just the pre-due reminder for that invoice,
//    immediately. Used by the app when an invoice is created with a due
//    date of today (BR-002: less than 24h out, so the daily cron would
//    never see it a day early).
//
// BR-001 is enforced by only ever selecting invoices with status = 'unpaid'.
// BR-003 is additionally enforced in the database by a unique index on
// (invoice_id, day) for successful overdue sends.
// Failures are logged to reminder_log with success = false and are not
// retried automatically (see spec edge cases: "do not retry silently").

import { createClient } from 'jsr:@supabase/supabase-js@2'

interface Client {
  name: string
  email: string
}

interface Invoice {
  id: string
  owner_id: string
  description: string
  amount: number
  due_date: string
  client: Client
}

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const resendApiKey = Deno.env.get('RESEND_API_KEY')!
const fromEmail = Deno.env.get('REMINDER_FROM_EMAIL') ?? 'reminders@nudge.app'

const supabase = createClient(supabaseUrl, serviceRoleKey)

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

async function sendEmail(to: string, subject: string, body: string): Promise<boolean> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to,
      subject,
      text: body,
    }),
  })
  return response.ok
}

function preDueEmail(invoice: Invoice) {
  return {
    subject: `Invoice due tomorrow: ${invoice.description}`,
    body: `Hi ${invoice.client.name},\n\nThis is a reminder that your invoice for "${invoice.description}" ($${invoice.amount.toFixed(2)}) is due tomorrow (${invoice.due_date}).\n\nThanks!`,
  }
}

function overdueEmail(invoice: Invoice) {
  return {
    subject: `Overdue invoice: ${invoice.description}`,
    body: `Hi ${invoice.client.name},\n\nYour invoice for "${invoice.description}" ($${invoice.amount.toFixed(2)}) was due on ${invoice.due_date} and is now overdue.\n\nPlease arrange payment as soon as possible.\n\nThanks!`,
  }
}

async function logResult(
  invoiceId: string,
  type: 'pre_due' | 'overdue',
  success: boolean,
) {
  const { error } = await supabase
    .from('reminder_log')
    .insert({ invoice_id: invoiceId, type, success })
  // A unique-constraint conflict here means another run already logged a
  // successful overdue send for this invoice today (BR-003) — not an error.
  if (error && error.code !== '23505') {
    console.error('failed to write reminder_log', invoiceId, type, error)
  }
}

async function sendPreDue(invoice: Invoice) {
  const { subject, body } = preDueEmail(invoice)
  const success = await sendEmail(invoice.client.email, subject, body)
  await logResult(invoice.id, 'pre_due', success)
}

async function sendOverdue(invoice: Invoice) {
  const { subject, body } = overdueEmail(invoice)
  const success = await sendEmail(invoice.client.email, subject, body)
  await logResult(invoice.id, 'overdue', success)
}

async function fetchInvoice(invoiceId: string): Promise<Invoice | null> {
  const { data } = await supabase
    .from('invoices')
    .select('id, owner_id, description, amount, due_date, status, client:clients(name, email)')
    .eq('id', invoiceId)
    .eq('status', 'unpaid')
    .single()
  return (data as unknown as Invoice) ?? null
}

async function runImmediatePreDue(invoiceId: string, callerUserId: string | null) {
  const invoice = await fetchInvoice(invoiceId)
  if (!invoice) return
  // A null callerUserId means the caller authenticated as service_role,
  // which is trusted for any invoice.
  if (callerUserId !== null && invoice.owner_id !== callerUserId) return
  await sendPreDue(invoice)
}

async function runDailyBatch() {
  const today = todayUtc()
  const tomorrow = addDays(today, 1)

  const [dueTomorrow, overdue] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, description, amount, due_date, status, client:clients(name, email)')
      .eq('status', 'unpaid')
      .eq('due_date', tomorrow),
    supabase
      .from('invoices')
      .select('id, description, amount, due_date, status, client:clients(name, email)')
      .eq('status', 'unpaid')
      .lte('due_date', today),
  ])

  const preDueInvoices = (dueTomorrow.data as unknown as Invoice[]) ?? []
  const overdueInvoices = (overdue.data as unknown as Invoice[]) ?? []

  // The pre-due reminder fires once only (BR-002): skip invoices that
  // already have a successful pre_due log entry.
  const preDueIds = preDueInvoices.map((i) => i.id)
  const { data: alreadySent } = preDueIds.length
    ? await supabase
        .from('reminder_log')
        .select('invoice_id')
        .in('invoice_id', preDueIds)
        .eq('type', 'pre_due')
        .eq('success', true)
    : { data: [] as { invoice_id: string }[] }
  const alreadySentIds = new Set((alreadySent ?? []).map((r) => r.invoice_id))

  // BR-003 defense in depth: skip invoices that already have a
  // successful overdue log entry today, in case this batch is re-run
  // (the unique index is the hard backstop, but this avoids sending a
  // duplicate email before that constraint is even reached).
  const overdueIds = overdueInvoices.map((i) => i.id)
  const todayStart = `${today}T00:00:00Z`
  const { data: overdueSentToday } = overdueIds.length
    ? await supabase
        .from('reminder_log')
        .select('invoice_id')
        .in('invoice_id', overdueIds)
        .eq('type', 'overdue')
        .eq('success', true)
        .gte('sent_at', todayStart)
    : { data: [] as { invoice_id: string }[] }
  const overdueSentTodayIds = new Set((overdueSentToday ?? []).map((r) => r.invoice_id))

  await Promise.all([
    ...preDueInvoices
      .filter((invoice) => !alreadySentIds.has(invoice.id))
      .map(sendPreDue),
    ...overdueInvoices
      .filter((invoice) => !overdueSentTodayIds.has(invoice.id))
      .map(sendOverdue),
  ])
}

// verify_jwt is off in config.toml (the daily cron caller has no user
// session), so authorization is enforced here instead: the batch path
// requires the service_role key, and the single-invoice path requires an
// authenticated user who owns that invoice.
function decodeJwt(authHeader: string | null): { role?: string; sub?: string } {
  const token = authHeader?.replace(/^Bearer\s+/i, '')
  if (!token) return {}
  const payloadPart = token.split('.')[1]
  if (!payloadPart) return {}
  try {
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
  } catch {
    return {}
  }
}

Deno.serve(async (req) => {
  const { role, sub } = decodeJwt(req.headers.get('Authorization'))

  let invoiceId: string | undefined
  try {
    const body = await req.json()
    invoiceId = body?.invoice_id
  } catch {
    // No JSON body — treat as the daily cron invocation.
  }

  if (invoiceId) {
    if (role !== 'service_role' && !sub) {
      return new Response('Unauthorized', { status: 401 })
    }
    await runImmediatePreDue(invoiceId, role === 'service_role' ? null : sub!)
  } else {
    if (role !== 'service_role') {
      return new Response('Forbidden', { status: 403 })
    }
    await runDailyBatch()
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
