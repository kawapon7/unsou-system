export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
          action_type: string
          amount_after: number | null
          amount_before: number | null
          created_at: string
          id: string
          memo: string | null
          operator_id: string
          target_id: string
          target_type: string
        }
        Insert: {
          action_type: string
          amount_after?: number | null
          amount_before?: number | null
          created_at?: string
          id?: string
          memo?: string | null
          operator_id: string
          target_id: string
          target_type: string
        }
        Update: {
          action_type?: string
          amount_after?: number | null
          amount_before?: number | null
          created_at?: string
          id?: string
          memo?: string | null
          operator_id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      billing_records: {
        Row: {
          active_contractor_count: number
          base_fee: number
          billing_month: string
          created_at: string
          id: string
          per_contractor_fee: number
          status: string
          total_fee: number
          updated_at: string
        }
        Insert: {
          active_contractor_count?: number
          base_fee?: number
          billing_month: string
          created_at?: string
          id?: string
          per_contractor_fee?: number
          status?: string
          total_fee?: number
          updated_at?: string
        }
        Update: {
          active_contractor_count?: number
          base_fee?: number
          billing_month?: string
          created_at?: string
          id?: string
          per_contractor_fee?: number
          status?: string
          total_fee?: number
          updated_at?: string
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
          closing_day: string
          company_name: string
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          invoice_registered: boolean
          payment_site: number
          phone: string | null
          tax_type: string
          updated_at: string
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          closing_day?: string
          company_name: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invoice_registered?: boolean
          payment_site?: number
          phone?: string | null
          tax_type?: string
          updated_at?: string
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          closing_day?: string
          company_name?: string
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          invoice_registered?: boolean
          payment_site?: number
          phone?: string | null
          tax_type?: string
          updated_at?: string
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
          contractor_type: string
          created_at: string
          detailed_input_switch: boolean
          email: string | null
          id: string
          invoice_registration_number: string | null
          invoice_registration_type: string
          login_email: string | null
          name: string
          payment_method: string
          payment_site: number
          phone: string | null
          same_person_id: string | null
          tax_type: string
          updated_at: string
          withholding_tax_flag: boolean
        }
        Insert: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          contractor_type?: string
          created_at?: string
          detailed_input_switch?: boolean
          email?: string | null
          id?: string
          invoice_registration_number?: string | null
          invoice_registration_type?: string
          login_email?: string | null
          name: string
          payment_method?: string
          payment_site?: number
          phone?: string | null
          same_person_id?: string | null
          tax_type?: string
          updated_at?: string
          withholding_tax_flag?: boolean
        }
        Update: {
          account_holder?: string | null
          account_number?: string | null
          account_type?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          contractor_type?: string
          created_at?: string
          detailed_input_switch?: boolean
          email?: string | null
          id?: string
          invoice_registration_number?: string | null
          invoice_registration_type?: string
          login_email?: string | null
          name?: string
          payment_method?: string
          payment_site?: number
          phone?: string | null
          same_person_id?: string | null
          tax_type?: string
          updated_at?: string
          withholding_tax_flag?: boolean
        }
        Relationships: []
      }
      expense_records: {
        Row: {
          amount_actual: number
          amount_tax_excluded: number
          approval_status: string
          contractor_id: string
          created_at: string
          expense_date: string
          expense_type: string
          id: string
          receipt_url: string | null
          remarks: string | null
          tax_category: string
          updated_at: string
        }
        Insert: {
          amount_actual?: number
          amount_tax_excluded?: number
          approval_status?: string
          contractor_id: string
          created_at?: string
          expense_date: string
          expense_type: string
          id?: string
          receipt_url?: string | null
          remarks?: string | null
          tax_category?: string
          updated_at?: string
        }
        Update: {
          amount_actual?: number
          amount_tax_excluded?: number
          approval_status?: string
          contractor_id?: string
          created_at?: string
          expense_date?: string
          expense_type?: string
          id?: string
          receipt_url?: string | null
          remarks?: string | null
          tax_category?: string
          updated_at?: string
        }
        Relationships: [
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
          due_date: string | null
          id: string
          invoice_month: string
          issued_at: string | null
          status: string
          total_amount: number
          total_tax_excluded: number
          updated_at: string
        }
        Insert: {
          client_id: string
          consumption_tax?: number
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_month: string
          issued_at?: string | null
          status?: string
          total_amount?: number
          total_tax_excluded?: number
          updated_at?: string
        }
        Update: {
          client_id?: string
          consumption_tax?: number
          created_at?: string
          due_date?: string | null
          id?: string
          invoice_month?: string
          issued_at?: string | null
          status?: string
          total_amount?: number
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
        ]
      }
      payment_notices: {
        Row: {
          approval_status: string
          contractor_id: string
          created_at: string
          deduction: number
          deduction_rate: number
          expense_tax: number
          expense_tax_excluded: number
          id: string
          labor_tax: number
          labor_tax_excluded: number
          locked: boolean
          locked_at: string | null
          notice_month: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          approval_status?: string
          contractor_id: string
          created_at?: string
          deduction?: number
          deduction_rate?: number
          expense_tax?: number
          expense_tax_excluded?: number
          id?: string
          labor_tax?: number
          labor_tax_excluded?: number
          locked?: boolean
          locked_at?: string | null
          notice_month: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          approval_status?: string
          contractor_id?: string
          created_at?: string
          deduction?: number
          deduction_rate?: number
          expense_tax?: number
          expense_tax_excluded?: number
          id?: string
          labor_tax?: number
          labor_tax_excluded?: number
          locked?: boolean
          locked_at?: string | null
          notice_month?: string
          total_amount?: number
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
          id: string
          payment_date: string | null
          payment_month: string
          payment_notice_id: string | null
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          contractor_id: string
          created_at?: string
          id?: string
          payment_date?: string | null
          payment_month: string
          payment_notice_id?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          contractor_id?: string
          created_at?: string
          id?: string
          payment_date?: string | null
          payment_month?: string
          payment_notice_id?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_payment_notice_id_fkey"
            columns: ["payment_notice_id"]
            isOneToOne: false
            referencedRelation: "payment_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      price_rules: {
        Row: {
          buy_unit_price: number
          calc_type: string
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          project_id: string
          sale_unit_price: number
        }
        Insert: {
          buy_unit_price?: number
          calc_type?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          project_id: string
          sale_unit_price?: number
        }
        Update: {
          buy_unit_price?: number
          calc_type?: string
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          project_id?: string
          sale_unit_price?: number
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
          created_at: string
          id: string
          payee_contractor_id: string
          project_id: string
          updated_at: string
          via_contractor_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          payee_contractor_id: string
          project_id: string
          updated_at?: string
          via_contractor_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          payee_contractor_id?: string
          project_id?: string
          updated_at?: string
          via_contractor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_payees_payee_contractor_id_fkey"
            columns: ["payee_contractor_id"]
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
          {
            foreignKeyName: "project_payees_via_contractor_id_fkey"
            columns: ["via_contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          client_id: string
          created_at: string
          id: string
          project_code: string
          project_name: string
          unit_type: string
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          project_code: string
          project_name: string
          unit_type?: string
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          project_code?: string
          project_name?: string
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
        ]
      }
      users: {
        Row: {
          contractor_id: string | null
          created_at: string
          email: string
          id: string
          role: string
          updated_at: string
        }
        Insert: {
          contractor_id?: string | null
          created_at?: string
          email: string
          id?: string
          role?: string
          updated_at?: string
        }
        Update: {
          contractor_id?: string | null
          created_at?: string
          email?: string
          id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "users_contractor_id_fkey"
            columns: ["contractor_id"]
            isOneToOne: false
            referencedRelation: "contractors"
            referencedColumns: ["id"]
          },
        ]
      }
      work_records: {
        Row: {
          approval_status: string
          contractor_id: string
          created_at: string
          id: string
          memo: string | null
          project_id: string | null
          quantity: number
          spot_generic_id: string | null
          tax_excluded_payment: number
          tax_excluded_sales: number
          updated_at: string
          work_date: string
        }
        Insert: {
          approval_status?: string
          contractor_id: string
          created_at?: string
          id?: string
          memo?: string | null
          project_id?: string | null
          quantity?: number
          spot_generic_id?: string | null
          tax_excluded_payment?: number
          tax_excluded_sales?: number
          updated_at?: string
          work_date: string
        }
        Update: {
          approval_status?: string
          contractor_id?: string
          created_at?: string
          id?: string
          memo?: string | null
          project_id?: string | null
          quantity?: number
          spot_generic_id?: string | null
          tax_excluded_payment?: number
          tax_excluded_sales?: number
          updated_at?: string
          work_date?: string
        }
        Relationships: [
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

