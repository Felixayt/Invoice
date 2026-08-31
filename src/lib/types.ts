export type UserRole = 'owner' | 'admin'
export type InvoiceStatus = 'unpaid' | 'paid'
export type ReminderType = 'pre_due' | 'overdue'

export interface Profile {
  id: string
  business_name: string | null
  logo_url: string | null
  role: UserRole
}

export interface Client {
  id: string
  owner_id: string
  name: string
  email: string
  phone: string | null
  created_at: string
}

export interface Invoice {
  id: string
  owner_id: string
  client_id: string
  description: string
  amount: number
  due_date: string
  status: InvoiceStatus
  created_at: string
  paid_at: string | null
}

export interface ReminderLog {
  id: string
  invoice_id: string
  sent_at: string
  type: ReminderType
  success: boolean
}

export interface InvoiceWithClient extends Invoice {
  client: Pick<Client, 'id' | 'name' | 'email'>
}
