export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      approval_history: {
        Row: {
          action_by: string
          action_type: string
          created_at: string
          id: string
          payment_notice_id: string
          unlock_reason: string | null
        }
        Insert: {
          action_by: string
          action_type: string
          created_at?: string
          id?: string
          payment_notice_id: string
          unlock_reason?: string | null
        }
        Update: {
          action_by?: string
          action_type?: string
          created_at?: string
          id?: string
          payment_notice_id?: string
          unlock_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_history_action_by_fkey"
            columns: ["action_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_history_payment_notice_id_fkey"
            columns: ["payment_notice_id"]
            isOneToOne: false
            referencedRelation: "payment_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_records: {
        Row: {
          active_contractors_count: number
          base_fee: number
          contractor_fee_total: number
          created_at: string
          id: string
          target_month: string
          total_billing_amount: number
        }
        Insert: {
          active_contractors_count: number
          base_fee?: number
          contractor_fee_total: number
          created_at?: string
          id?: string
          target_month: string
          total_billing_amount: number
        }
        Update: {
          active_contractors_count?: number
          base_fee?: number
          contractor_fee_total?: number
          created_at?: string
          id?: string
          target_month?: string
          total_billing_amount?: number
        }
        Relationships: []
      }
      clients: {
        Row: {
          account_holder: string | null
          account_number: string | null
          account_type: string | null
          bank_branch: string | null
          bank_name: string | null
          branch_name: string | null
          closing_day: number
          closing_day_int: number | null
          company_name: string
          contact_name: string | null
          created_at: string
          email: string | null
          has_invoice: boolean
          id: string
          invoice_registered: boolean | null
          is_invoice_registered: boolean
          metadata: Json
          name: string | null
          payment_site: number
          phone: string | null
          tax_treatment: string | null
          tax_type: string
          tenant_id: string
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_name?: string | null
          closing_day: number
          closing_day_int?: number | null
          company_name: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          has_invoice?: boolean
          id?: string
          invoice_registered?: boolean | null
          is_invoice_registered?: boolean
          metadata?: Json
          name?: string | null
          payment_site: number
          phone?: string | null
          tax_treatment?: string | null
          tax_type: string
          tenant_id?: string
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_name?: string | null
          closing_day?: number
          closing_day_int?: number | null
          company_name?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          has_invoice?: boolean
          id?: string
          invoice_registered?: boolean | null
          is_invoice_registered?: boolean
          metadata?: Json
          name?: string | null
          payment_site?: number
          phone?: string | null
          tax_treatment?: string | null
          tax_type?: string
          tenant_id?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      contractors: {
        Row: {
          account_holder: string | null
          account_number: string | null
          account_type: string | null
          bank_branch: string | null
          bank_name: string | null
          branch_name: string | null
          contractor_type: string
          created_at: string
          email: string
          has_withholding: boolean
          id: string
          invoice_number: string | null
          invoice_registration_type: string
          invoice_status: string | null
          name: string
          payment_site: number
          payment_type: string
          phone: string | null
          same_person_id: string | null
          show_detail_switch: boolean
          tax_category: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_name?: string | null
          contractor_type?: string
          created_at?: string
          email: string
          has_withholding?: boolean
          id?: string
          invoice_number?: string | null
          invoice_registration_type: string
          invoice_status?: string | null
          name: string
          payment_site: number
          payment_type: string
          phone?: string | null
          same_person_id?: string | null
          show_detail_switch?: boolean
          tax_category: string
          tenant_id?: string
          user_id?: string | null
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_name?: string | null
          contractor_type?: string
          created_at?: string
          email?: string
          has_withholding?: boolean
          id?: string
          invoice_number?: string | null
          invoice_registration_type?: string
          invoice_status?: string | null
          name?: string
          payment_site?: number
          payment_type?: string
          phone?: string | null
          same_person_id?: string | null
          show_detail_switch?: boolean
          tax_category?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contractors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_records: {
        Row: {
          amount: number
          amount_actual: number
          amount_tax_excluded: number
          approval_status: string
          approved_at: string | null
          category: string
          company_id: string | null
          contractor_id: string
          created_at: string
          date: string | null
          expense_date: string
          expense_type: string
          id: string
          is_approved_by_master: boolean
          metadata: Json
          note: string | null
          receipt_url: string | null
          remarks: string | null
          status: string
          tax_category: string
          tenant_id: string
        }
        Insert: {
          amount: number
          amount_actual?: number
          amount_tax_excluded?: number
          approval_status?: string
          approved_at?: string | null
          category: string
          company_id?: string | null
          contractor_id: string
          created_at?: string
          date?: string | null
          expense_date: string
          expense_type?: string
          id?: string
          is_approved_by_master?: boolean
          metadata?: Json
          note?: string | null
          receipt_url?: string | null
          remarks?: string | null
          status?: string
          tax_category?: string
          tenant_id?: string
        }
        Update: {
          amount?: number
          amount_actual?: number
          amount_tax_excluded?: number
          approval_status?: string
          approved_at?: string | null
          category?: string
          company_id?: string | null
          contractor_id?: string
          created_at?: string
          date?: string | null
          expense_date?: string
          expense_type?: string
          id?: string
          is_approved_by_master?: boolean
          metadata?: Json
          note?: string | null
          receipt_url?: string | null
          remarks?: string | null
          status?: string
          tax_category?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_records_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          client_id: string
          consumption_tax: number
          created_at: string
          deduction_unregistered: number
          due_date: string | null
          id: string
          invoice_month: string
          is_issued: boolean
          issued_at: string | null
          project_id: string | null
          status: string
          subtotal_exempt: number
          subtotal_registered: number
          subtotal_unregistered: number
          target_month: string
          tax_registered: number
          tax_unregistered: number
          total_amount: number
          total_amount_ex_tax: number
          total_deduction: number
          total_excluding_tax: number
          total_tax: number
          total_tax_excluded: number
          updated_at: string
        }
        Insert: {
          client_id: string
          consumption_tax?: number
          created_at?: string
          deduction_unregistered?: number
          due_date?: string | null
          id?: string
          invoice_month?: string
          is_issued?: boolean
          issued_at?: string | null
          project_id?: string | null
          status?: string
          subtotal_exempt?: number
          subtotal_registered?: number
          subtotal_unregistered?: number
          target_month: string
          tax_registered?: number
          tax_unregistered?: number
          total_amount?: number
          total_amount_ex_tax: number
          total_deduction?: number
          total_excluding_tax?: number
          total_tax: number
          total_tax_excluded?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          consumption_tax?: number
          created_at?: string
          deduction_unregistered?: number
          due_date?: string | null
          id?: string
          invoice_month?: string
          is_issued?: boolean
          issued_at?: string | null
          project_id?: string | null
          status?: string
          subtotal_exempt?: number
          subtotal_registered?: number
          subtotal_unregistered?: number
          target_month?: string
          tax_registered?: number
          tax_unregistered?: number
          total_amount?: number
          total_amount_ex_tax?: number
          total_deduction?: number
          total_excluding_tax?: number
          total_tax?: number
          total_tax_excluded?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_logs: {
        Row: {
          contractor_id: string
          created_at: string
          destination: string
          id: string
          message_id: string | null
          status: string
          type: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          destination: string
          id?: string
          message_id?: string | null
          status?: string
          type: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          destination?: string
          id?: string
          message_id?: string | null
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_logs_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_notices: {
        Row: {
          approval_status: string
          contractor_id: string
          created_at: string
          deduction: number
          deduction_rate: number
          deduction_unregistered: number
          expense_tax: number
          expense_tax_excluded: number
          id: string
          labor_tax: number
          labor_tax_excluded: number
          locked: boolean
          locked_at: string | null
          notice_month: string
          status: string
          subtotal_exempt: number
          subtotal_registered: number
          subtotal_unregistered: number
          target_month: string
          tax_registered: number
          tax_unregistered: number
          total_amount: number
          total_deduction: number
          total_excluding_tax: number
          total_tax: number
          updated_at: string
        }
        Insert: {
          approval_status?: string
          contractor_id: string
          created_at?: string
          deduction?: number
          deduction_rate?: number
          deduction_unregistered?: number
          expense_tax?: number
          expense_tax_excluded?: number
          id?: string
          labor_tax?: number
          labor_tax_excluded?: number
          locked?: boolean
          locked_at?: string | null
          notice_month?: string
          status: string
          subtotal_exempt?: number
          subtotal_registered?: number
          subtotal_unregistered?: number
          target_month: string
          tax_registered?: number
          tax_unregistered?: number
          total_amount?: number
          total_deduction?: number
          total_excluding_tax?: number
          total_tax?: number
          updated_at?: string
        }
        Update: {
          approval_status?: string
          contractor_id?: string
          created_at?: string
          deduction?: number
          deduction_rate?: number
          deduction_unregistered?: number
          expense_tax?: number
          expense_tax_excluded?: number
          id?: string
          labor_tax?: number
          labor_tax_excluded?: number
          locked?: boolean
          locked_at?: string | null
          notice_month?: string
          status?: string
          subtotal_exempt?: number
          subtotal_registered?: number
          subtotal_unregistered?: number
          target_month?: string
          tax_registered?: number
          tax_unregistered?: number
          total_amount?: number
          total_deduction?: number
          total_excluding_tax?: number
          total_tax?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_notices_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          contractor_id: string
          created_at: string
          expense_amount_total: number
          id: string
          reward_amount_ex_tax: number
          target_month: string
          tax_amount: number
        }
        Insert: {
          contractor_id: string
          created_at?: string
          expense_amount_total: number
          id?: string
          reward_amount_ex_tax: number
          target_month: string
          tax_amount: number
        }
        Update: {
          contractor_id?: string
          created_at?: string
          expense_amount_total?: number
          id?: string
          reward_amount_ex_tax?: number
          target_month?: string
          tax_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      price_rules: {
        Row: {
          buying_price: number
          calculation_type: string
          created_at: string
          id: string
          margin_fixed: number
          margin_rate: number
          project_id: string
          sales_price: number
          selling_price: number
        }
        Insert: {
          buying_price: number
          calculation_type: string
          created_at?: string
          id?: string
          margin_fixed?: number
          margin_rate?: number
          project_id: string
          sales_price?: number
          selling_price: number
        }
        Update: {
          buying_price?: number
          calculation_type?: string
          created_at?: string
          id?: string
          margin_fixed?: number
          margin_rate?: number
          project_id?: string
          sales_price?: number
          selling_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "price_rules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_payees: {
        Row: {
          contractor_id: string
          created_at: string
          id: string
          project_id: string
          share_rate: number | null
        }
        Insert: {
          contractor_id: string
          created_at?: string
          id?: string
          project_id: string
          share_rate?: number | null
        }
        Update: {
          contractor_id?: string
          created_at?: string
          id?: string
          project_id?: string
          share_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_payees_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_payees_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          buy_amount: number | null
          client_id: string
          contractor_id: string | null
          created_at: string
          default_margin_rate: number | null
          destination: string | null
          id: string
          name: string | null
          operation_end: string | null
          operation_start: string | null
          origin: string | null
          project_code: string | null
          project_name: string
          sale_amount: number
          status: string
          tenant_id: string
          unit_type: string
          updated_at: string
        }
        Insert: {
          buy_amount?: number | null
          client_id: string
          contractor_id?: string | null
          created_at?: string
          default_margin_rate?: number | null
          destination?: string | null
          id?: string
          name?: string | null
          operation_end?: string | null
          operation_start?: string | null
          origin?: string | null
          project_code?: string | null
          project_name: string
          sale_amount?: number
          status?: string
          tenant_id?: string
          unit_type?: string
          updated_at?: string
        }
        Update: {
          buy_amount?: number | null
          client_id?: string
          contractor_id?: string | null
          created_at?: string
          default_margin_rate?: number | null
          destination?: string | null
          id?: string
          name?: string | null
          operation_end?: string | null
          operation_start?: string | null
          origin?: string | null
          project_code?: string | null
          project_name?: string
          sale_amount?: number
          status?: string
          tenant_id?: string
          unit_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_jobs: {
        Row: {
          created_at: string
          error_message: string | null
          extracted_data: Json | null
          file_name: string | null
          file_type: string | null
          id: string
          job_id: string
          status: string
          updated_at: string
          user_id: string
          work_record_id: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_type?: string | null
          id?: string
          job_id: string
          status?: string
          updated_at?: string
          user_id: string
          work_record_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          extracted_data?: Json | null
          file_name?: string | null
          file_type?: string | null
          id?: string
          job_id?: string
          status?: string
          updated_at?: string
          user_id?: string
          work_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scan_jobs_work_record_id_fkey"
            columns: ["work_record_id"]
            isOneToOne: false
            referencedRelation: "work_records"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          contractor_id: string
          created_at: string
          date: string
          id: string
          project_id: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          date: string
          id?: string
          project_id: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          date?: string
          id?: string
          project_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedules_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          email: string
          id: string
          role: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          role: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          role?: string
        }
        Relationships: []
      }
      work_records: {
        Row: {
          break_minutes: number | null
          company_id: string | null
          contractor_id: string
          created_at: string
          date: string | null
          end_time: string | null
          id: string
          is_approved_by_master: boolean
          metadata: Json
          note: string | null
          piece_count: number | null
          project_id: string
          raw_spot_text: string | null
          start_time: string | null
          status: string
          tenant_id: string
          work_date: string
        }
        Insert: {
          break_minutes?: number | null
          company_id?: string | null
          contractor_id: string
          created_at?: string
          date?: string | null
          end_time?: string | null
          id?: string
          is_approved_by_master?: boolean
          metadata?: Json
          note?: string | null
          piece_count?: number | null
          project_id: string
          raw_spot_text?: string | null
          start_time?: string | null
          status?: string
          tenant_id?: string
          work_date: string
        }
        Update: {
          break_minutes?: number | null
          company_id?: string | null
          contractor_id?: string
          created_at?: string
          date?: string | null
          end_time?: string | null
          id?: string
          is_approved_by_master?: boolean
          metadata?: Json
          note?: string | null
          piece_count?: number | null
          project_id?: string
          raw_spot_text?: string | null
          start_time?: string | null
          status?: string
          tenant_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_records_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_records_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_owner: { Args: never; Returns: boolean }
      my_contractor_id: { Args: never; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
