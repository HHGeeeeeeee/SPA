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
      audit_log: {
        Row: {
          action: string
          after: Json | null
          before: Json | null
          changed_at: string
          changed_by: string | null
          id: number
          row_id: string | null
          table_name: string
        }
        Insert: {
          action: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: number
          row_id?: string | null
          table_name: string
        }
        Update: {
          action?: string
          after?: Json | null
          before?: Json | null
          changed_at?: string
          changed_by?: string | null
          id?: number
          row_id?: string | null
          table_name?: string
        }
        Relationships: []
      }
      billing_destinations: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          credit_terms_days: number
          default_payment_method_id: string | null
          id: string
          intercompany_account: string | null
          intercompany_sub: string | null
          name: string
          settlement_type: string
          transaction_code_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          credit_terms_days?: number
          default_payment_method_id?: string | null
          id?: string
          intercompany_account?: string | null
          intercompany_sub?: string | null
          name: string
          settlement_type: string
          transaction_code_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          credit_terms_days?: number
          default_payment_method_id?: string | null
          id?: string
          intercompany_account?: string | null
          intercompany_sub?: string | null
          name?: string
          settlement_type?: string
          transaction_code_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_destinations_transaction_code_id_fkey"
            columns: ["transaction_code_id"]
            isOneToOne: false
            referencedRelation: "transaction_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_destinations_default_payment_method_id_fkey"
            columns: ["default_payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_business_units: {
        Row: {
          branch_id: string
          business_unit_id: string
        }
        Insert: {
          branch_id: string
          business_unit_id: string
        }
        Update: {
          branch_id?: string
          business_unit_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "branch_business_units_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_business_units_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
        ]
      }
      branch_commission_rates: {
        Row: {
          branch_id: string
          commission_class_id: string
          commission_rate: number
        }
        Insert: {
          branch_id: string
          commission_class_id: string
          commission_rate: number
        }
        Update: {
          branch_id?: string
          commission_class_id?: string
          commission_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "branch_commission_rates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "branch_commission_rates_commission_class_id_fkey"
            columns: ["commission_class_id"]
            isOneToOne: false
            referencedRelation: "commission_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          active: boolean
          close_time: string
          code: string
          commission_policy_id: string | null
          created_at: string
          created_by: string | null
          id: string
          name: string
          open_time: string
          therapist_share_group: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          close_time?: string
          code: string
          commission_policy_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          open_time?: string
          therapist_share_group?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          close_time?: string
          code?: string
          commission_policy_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          open_time?: string
          therapist_share_group?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branches_commission_policy_id_fkey"
            columns: ["commission_policy_id"]
            isOneToOne: false
            referencedRelation: "commission_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      business_day_close: {
        Row: {
          balances_ok_at: string | null
          branch_id: string
          business_date: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          note: string | null
          opened_at: string
          opened_by: string | null
          order_reviewed_at: string | null
          revenue_confirmed_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          balances_ok_at?: string | null
          branch_id: string
          business_date: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          order_reviewed_at?: string | null
          revenue_confirmed_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          balances_ok_at?: string | null
          branch_id?: string
          business_date?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          order_reviewed_at?: string | null
          revenue_confirmed_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_day_close_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_day_close_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_day_close_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      business_units: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      cash_reconciliations: {
        Row: {
          actual_received_cents: number | null
          approved_by_staff_id: string | null
          branch_id: string
          cashier_user_id: string
          closed_at: string | null
          closing_count_cents: number | null
          counted_by_staff_id: string | null
          created_at: string
          id: string
          note: string | null
          opening_float_cents: number
          previous_shift_handover_cents: number
          reconciliation_date: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by_staff_id: string | null
          shift_end_at: string | null
          shift_label: string
          shift_start_at: string | null
          status: string
          system_cash_in_cents: number
          system_cash_out_cents: number
          system_expected_cents: number
          updated_at: string
          variance_cents: number | null
          variance_reason: string | null
        }
        Insert: {
          actual_received_cents?: number | null
          approved_by_staff_id?: string | null
          branch_id: string
          cashier_user_id: string
          closed_at?: string | null
          closing_count_cents?: number | null
          counted_by_staff_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          opening_float_cents?: number
          previous_shift_handover_cents?: number
          reconciliation_date: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by_staff_id?: string | null
          shift_end_at?: string | null
          shift_label: string
          shift_start_at?: string | null
          status?: string
          system_cash_in_cents?: number
          system_cash_out_cents?: number
          system_expected_cents: number
          updated_at?: string
          variance_cents?: number | null
          variance_reason?: string | null
        }
        Update: {
          actual_received_cents?: number | null
          approved_by_staff_id?: string | null
          branch_id?: string
          cashier_user_id?: string
          closed_at?: string | null
          closing_count_cents?: number | null
          counted_by_staff_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          opening_float_cents?: number
          previous_shift_handover_cents?: number
          reconciliation_date?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by_staff_id?: string | null
          shift_end_at?: string | null
          shift_label?: string
          shift_start_at?: string | null
          status?: string
          system_cash_in_cents?: number
          system_cash_out_cents?: number
          system_expected_cents?: number
          updated_at?: string
          variance_cents?: number | null
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_reconciliations_approved_by_staff_id_fkey"
            columns: ["approved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_cashier_user_id_fkey"
            columns: ["cashier_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_counted_by_staff_id_fkey"
            columns: ["counted_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_reconciliations_reopened_by_staff_id_fkey"
            columns: ["reopened_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_classes: {
        Row: {
          active: boolean
          class_code: string
          commission_rate: number
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          class_code: string
          commission_rate: number
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          class_code?: string
          commission_rate?: number
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      commission_entries: {
        Row: {
          adjustment_at: string | null
          adjustment_by_staff_id: string | null
          adjustment_cents: number
          adjustment_reason: string | null
          branch_id: string
          computed_commission_cents: number
          created_at: string
          final_amount_cents: number
          id: string
          period_id: string
          therapist_id: string
          total_gross_sales_cents: number
          total_sessions: number
          updated_at: string
        }
        Insert: {
          adjustment_at?: string | null
          adjustment_by_staff_id?: string | null
          adjustment_cents?: number
          adjustment_reason?: string | null
          branch_id: string
          computed_commission_cents: number
          created_at?: string
          final_amount_cents: number
          id?: string
          period_id: string
          therapist_id: string
          total_gross_sales_cents: number
          total_sessions: number
          updated_at?: string
        }
        Update: {
          adjustment_at?: string | null
          adjustment_by_staff_id?: string | null
          adjustment_cents?: number
          adjustment_reason?: string | null
          branch_id?: string
          computed_commission_cents?: number
          created_at?: string
          final_amount_cents?: number
          id?: string
          period_id?: string
          therapist_id?: string
          total_gross_sales_cents?: number
          total_sessions?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_entries_adjustment_by_staff_id_fkey"
            columns: ["adjustment_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "commission_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_entries_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_periods: {
        Row: {
          branch_id: string | null
          confirmed_at: string | null
          confirmed_by_staff_id: string | null
          created_at: string
          export_file_path: string | null
          export_format: string | null
          id: string
          note: string | null
          period_from: string
          period_no: string
          period_to: string
          status: string
          total_commission_cents: number | null
          total_gross_sales_cents: number | null
          total_sessions: number | null
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          confirmed_at?: string | null
          confirmed_by_staff_id?: string | null
          created_at?: string
          export_file_path?: string | null
          export_format?: string | null
          id?: string
          note?: string | null
          period_from: string
          period_no: string
          period_to: string
          status?: string
          total_commission_cents?: number | null
          total_gross_sales_cents?: number | null
          total_sessions?: number | null
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          confirmed_at?: string | null
          confirmed_by_staff_id?: string | null
          created_at?: string
          export_file_path?: string | null
          export_format?: string | null
          id?: string
          note?: string | null
          period_from?: string
          period_no?: string
          period_to?: string
          status?: string
          total_commission_cents?: number | null
          total_gross_sales_cents?: number | null
          total_sessions?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_periods_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_periods_confirmed_by_staff_id_fkey"
            columns: ["confirmed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_policies: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
          warmup_enabled: boolean
          warmup_occurrence: number
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          warmup_enabled?: boolean
          warmup_occurrence?: number
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          warmup_enabled?: boolean
          warmup_occurrence?: number
        }
        Relationships: []
      }
      commission_policy_bands: {
        Row: {
          commission_rate: number
          id: string
          min_minutes: number | null
          policy_id: string
          sort_order: number
          up_to_minutes: number | null
        }
        Insert: {
          commission_rate: number
          id?: string
          min_minutes?: number | null
          policy_id: string
          sort_order?: number
          up_to_minutes?: number | null
        }
        Update: {
          commission_rate?: number
          id?: string
          min_minutes?: number | null
          policy_id?: string
          sort_order?: number
          up_to_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "commission_policy_bands_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "commission_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_sources: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          default_billing_to_id: string | null
          default_discount_class_id: string | null
          discount_locked: boolean
          id: string
          name: string
          phone_required: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          default_billing_to_id?: string | null
          default_discount_class_id?: string | null
          discount_locked?: boolean
          id?: string
          name: string
          phone_required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          default_billing_to_id?: string | null
          default_discount_class_id?: string | null
          discount_locked?: boolean
          id?: string
          name?: string
          phone_required?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_cs_default_billing"
            columns: ["default_billing_to_id"]
            isOneToOne: false
            referencedRelation: "billing_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_cs_default_discount"
            columns: ["default_discount_class_id"]
            isOneToOne: false
            referencedRelation: "discount_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          created_by: string | null
          customer_type: string | null
          data_anonymized_at: string | null
          data_consent_at: string | null
          data_deletion_requested_at: string | null
          deleted_at: string | null
          dob: string | null
          email: string | null
          gender: string | null
          home_branch_id: string | null
          id: string
          membership_id: string | null
          name: string
          phone: string
          preferences: Json | null
          primary_business_unit_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_type?: string | null
          data_anonymized_at?: string | null
          data_consent_at?: string | null
          data_deletion_requested_at?: string | null
          deleted_at?: string | null
          dob?: string | null
          email?: string | null
          gender?: string | null
          home_branch_id?: string | null
          id?: string
          membership_id?: string | null
          name: string
          phone: string
          preferences?: Json | null
          primary_business_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_type?: string | null
          data_anonymized_at?: string | null
          data_consent_at?: string | null
          data_deletion_requested_at?: string | null
          deleted_at?: string | null
          dob?: string | null
          email?: string | null
          gender?: string | null
          home_branch_id?: string | null
          id?: string
          membership_id?: string | null
          name?: string
          phone?: string
          preferences?: Json | null
          primary_business_unit_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_home_branch_id_fkey"
            columns: ["home_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_primary_business_unit_id_fkey"
            columns: ["primary_business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
        ]
      }
      discount_classes: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          description: string
          discount_amount_cents: number
          discount_percent: number
          force_apply: boolean
          id: string
          requires_approval: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          description: string
          discount_amount_cents?: number
          discount_percent?: number
          force_apply?: boolean
          id?: string
          requires_approval?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string
          discount_amount_cents?: number
          discount_percent?: number
          force_apply?: boolean
          id?: string
          requires_approval?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      employee_attendance: {
        Row: {
          approved_by_staff_id: string | null
          branch_id: string
          clock_in_at: string
          clock_in_device_id: string | null
          clock_in_method: string | null
          clock_in_source: string | null
          clock_out_at: string | null
          created_at: string
          early_leave_minutes: number
          employee_id: string
          id: string
          late_minutes: number
          note: string | null
          overtime_minutes: number
          shift_id: string | null
          status: string | null
          updated_at: string
        }
        Insert: {
          approved_by_staff_id?: string | null
          branch_id: string
          clock_in_at: string
          clock_in_device_id?: string | null
          clock_in_method?: string | null
          clock_in_source?: string | null
          clock_out_at?: string | null
          created_at?: string
          early_leave_minutes?: number
          employee_id: string
          id?: string
          late_minutes?: number
          note?: string | null
          overtime_minutes?: number
          shift_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Update: {
          approved_by_staff_id?: string | null
          branch_id?: string
          clock_in_at?: string
          clock_in_device_id?: string | null
          clock_in_method?: string | null
          clock_in_source?: string | null
          clock_out_at?: string | null
          created_at?: string
          early_leave_minutes?: number
          employee_id?: string
          id?: string
          late_minutes?: number
          note?: string | null
          overtime_minutes?: number
          shift_id?: string | null
          status?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_attendance_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_attendance_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "employee_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ea_approved_by"
            columns: ["approved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_service_categories: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          service_category_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          service_category_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          service_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_service_categories_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_service_categories_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_service_groups: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          service_group: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          service_group: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          service_group?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_service_groups_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_shift_templates: {
        Row: {
          active: boolean
          branch_id: string
          created_at: string
          day_of_week: number
          employee_id: string
          id: string
          max_weekly_hours: number
          shift_end: string | null
          shift_start: string | null
          shift_type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          branch_id: string
          created_at?: string
          day_of_week: number
          employee_id: string
          id?: string
          max_weekly_hours?: number
          shift_end?: string | null
          shift_start?: string | null
          shift_type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          branch_id?: string
          created_at?: string
          day_of_week?: number
          employee_id?: string
          id?: string
          max_weekly_hours?: number
          shift_end?: string | null
          shift_start?: string | null
          shift_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_shift_templates_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shift_templates_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_shifts: {
        Row: {
          branch_id: string
          created_at: string
          created_by: string | null
          employee_id: string
          generated_from_template: boolean
          id: string
          leave_type: string | null
          note: string | null
          override_commission_class_id: string | null
          resource_id: string | null
          shift_date: string
          shift_end: string | null
          shift_start: string | null
          shift_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
          generated_from_template?: boolean
          id?: string
          leave_type?: string | null
          note?: string | null
          override_commission_class_id?: string | null
          resource_id?: string | null
          shift_date: string
          shift_end?: string | null
          shift_start?: string | null
          shift_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
          generated_from_template?: boolean
          id?: string
          leave_type?: string | null
          note?: string | null
          override_commission_class_id?: string | null
          resource_id?: string | null
          shift_date?: string
          shift_end?: string | null
          shift_start?: string | null
          shift_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shifts_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shifts_override_commission_class_id_fkey"
            columns: ["override_commission_class_id"]
            isOneToOne: false
            referencedRelation: "commission_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_shifts_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          acumatica_user_id: string | null
          business_unit_id: string | null
          commission_class_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          employee_code: string
          gender: string | null
          home_branch_id: string | null
          id: string
          name: string
          phone: string | null
          position_id: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          acumatica_user_id?: string | null
          business_unit_id?: string | null
          commission_class_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          employee_code: string
          gender?: string | null
          home_branch_id?: string | null
          id?: string
          name: string
          phone?: string | null
          position_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          acumatica_user_id?: string | null
          business_unit_id?: string | null
          commission_class_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          employee_code?: string
          gender?: string | null
          home_branch_id?: string | null
          id?: string
          name?: string
          phone?: string | null
          position_id?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_commission_class_id_fkey"
            columns: ["commission_class_id"]
            isOneToOne: false
            referencedRelation: "commission_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_home_branch_id_fkey"
            columns: ["home_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      eod_report_config: {
        Row: {
          branch_id: string
          created_at: string
          enabled: boolean
          id: string
          include_sections: string[] | null
          recipients: string[] | null
          send_time: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          include_sections?: string[] | null
          recipients?: string[] | null
          send_time?: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          include_sections?: string[] | null
          recipients?: string[] | null
          send_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "eod_report_config_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: true
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      eod_report_log: {
        Row: {
          branch_id: string
          error_message: string | null
          id: string
          pdf_attachment_path: string | null
          recipients: string[] | null
          sent_at: string
          sent_for_date: string
          status: string
        }
        Insert: {
          branch_id: string
          error_message?: string | null
          id?: string
          pdf_attachment_path?: string | null
          recipients?: string[] | null
          sent_at?: string
          sent_for_date: string
          status: string
        }
        Update: {
          branch_id?: string
          error_message?: string | null
          id?: string
          pdf_attachment_path?: string | null
          recipients?: string[] | null
          sent_at?: string
          sent_for_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "eod_report_log_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_posting_log: {
        Row: {
          acu_session_user_id: string | null
          batch_nbr: string | null
          created_at: string
          entity_id: string
          entity_type: string
          erp_response: Json | null
          error_message: string | null
          id: string
          payload: Json
          posted_at_attempt: string
          posted_by_staff_id: string | null
          retried_count: number
          status: string
        }
        Insert: {
          acu_session_user_id?: string | null
          batch_nbr?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          erp_response?: Json | null
          error_message?: string | null
          id?: string
          payload: Json
          posted_at_attempt?: string
          posted_by_staff_id?: string | null
          retried_count?: number
          status?: string
        }
        Update: {
          acu_session_user_id?: string | null
          batch_nbr?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          erp_response?: Json | null
          error_message?: string | null
          id?: string
          payload?: Json
          posted_at_attempt?: string
          posted_by_staff_id?: string | null
          retried_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_posting_log_posted_by_staff_id_fkey"
            columns: ["posted_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          age: number | null
          comment: string | null
          created_at: string
          email: string | null
          filled_at: string | null
          filled_via: string | null
          id: string
          language: string | null
          order_id: string
          order_item_id: string
          score: number | null
          skipped_reason: string | null
          status: string
          therapist_id: string | null
          updated_at: string
        }
        Insert: {
          age?: number | null
          comment?: string | null
          created_at?: string
          email?: string | null
          filled_at?: string | null
          filled_via?: string | null
          id?: string
          language?: string | null
          order_id: string
          order_item_id: string
          score?: number | null
          skipped_reason?: string | null
          status: string
          therapist_id?: string | null
          updated_at?: string
        }
        Update: {
          age?: number | null
          comment?: string | null
          created_at?: string
          email?: string | null
          filled_at?: string | null
          filled_via?: string | null
          id?: string
          language?: string | null
          order_id?: string
          order_item_id?: string
          score?: number | null
          skipped_reason?: string | null
          status?: string
          therapist_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      folio_lines: {
        Row: {
          amount_cents: number
          auth_code: string | null
          billing_destination_id: string | null
          branch_id: string | null
          card_last4: string | null
          created_at: string
          id: string
          kind: string
          note: string | null
          order_customer_id: string | null
          order_id: string | null
          order_item_id: string | null
          payment_method_id: string | null
          payment_ref: string | null
          posted_at: string
          posted_by: string | null
          proof_file_path: string | null
          settled_by_folio_line_id: string | null
          shift_id: string
          soa_session_id: string | null
          stored_value_card_id: string | null
          tip_cents: number | null
          transaction_code_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          auth_code?: string | null
          billing_destination_id?: string | null
          branch_id?: string | null
          card_last4?: string | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          order_customer_id?: string | null
          order_id?: string | null
          order_item_id?: string | null
          payment_method_id?: string | null
          payment_ref?: string | null
          posted_at?: string
          posted_by?: string | null
          proof_file_path?: string | null
          settled_by_folio_line_id?: string | null
          shift_id: string
          soa_session_id?: string | null
          stored_value_card_id?: string | null
          tip_cents?: number | null
          transaction_code_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          auth_code?: string | null
          billing_destination_id?: string | null
          branch_id?: string | null
          card_last4?: string | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          order_customer_id?: string | null
          order_id?: string | null
          order_item_id?: string | null
          payment_method_id?: string | null
          payment_ref?: string | null
          posted_at?: string
          posted_by?: string | null
          proof_file_path?: string | null
          settled_by_folio_line_id?: string | null
          shift_id?: string
          soa_session_id?: string | null
          stored_value_card_id?: string | null
          tip_cents?: number | null
          transaction_code_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "folio_lines_billing_destination_id_fkey"
            columns: ["billing_destination_id"]
            isOneToOne: false
            referencedRelation: "billing_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_transaction_code_id_fkey"
            columns: ["transaction_code_id"]
            isOneToOne: false
            referencedRelation: "transaction_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_soa_session_id_fkey"
            columns: ["soa_session_id"]
            isOneToOne: false
            referencedRelation: "revenue_soa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_settled_by_folio_line_id_fkey"
            columns: ["settled_by_folio_line_id"]
            isOneToOne: false
            referencedRelation: "folio_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_order_customer_id_fkey"
            columns: ["order_customer_id"]
            isOneToOne: false
            referencedRelation: "order_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_stored_value_card_id_fkey"
            columns: ["stored_value_card_id"]
            isOneToOne: false
            referencedRelation: "stored_value_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folio_lines_posted_by_fkey"
            columns: ["posted_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      help_article_versions: {
        Row: {
          article_id: string
          change_summary: string | null
          content_markdown_snapshot: string
          edited_at: string
          edited_by_staff_id: string | null
          id: string
          version_no: number
        }
        Insert: {
          article_id: string
          change_summary?: string | null
          content_markdown_snapshot: string
          edited_at?: string
          edited_by_staff_id?: string | null
          id?: string
          version_no: number
        }
        Update: {
          article_id?: string
          change_summary?: string | null
          content_markdown_snapshot?: string
          edited_at?: string
          edited_by_staff_id?: string | null
          id?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "help_article_versions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "help_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_article_versions_edited_by_staff_id_fkey"
            columns: ["edited_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      help_articles: {
        Row: {
          applies_to_roles: string[] | null
          category: string
          content_markdown: string
          contextual_pages: string[] | null
          created_at: string
          id: string
          is_published: boolean
          order_index: number
          slug: string
          title: string
          updated_at: string
          updated_by_staff_id: string | null
        }
        Insert: {
          applies_to_roles?: string[] | null
          category: string
          content_markdown: string
          contextual_pages?: string[] | null
          created_at?: string
          id?: string
          is_published?: boolean
          order_index?: number
          slug: string
          title: string
          updated_at?: string
          updated_by_staff_id?: string | null
        }
        Update: {
          applies_to_roles?: string[] | null
          category?: string
          content_markdown?: string
          contextual_pages?: string[] | null
          created_at?: string
          id?: string
          is_published?: boolean
          order_index?: number
          slug?: string
          title?: string
          updated_at?: string
          updated_by_staff_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "help_articles_updated_by_staff_id_fkey"
            columns: ["updated_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_log: {
        Row: {
          created_at: string
          customer_name: string
          customer_phone: string | null
          description: string
          follow_up_required: boolean
          id: string
          incident_type: string
          related_discount_id: string | null
          related_employee_id: string | null
          related_order_id: string | null
          related_order_item_id: string | null
          reported_at: string
          reported_by_staff_id: string | null
          resolution_action: string | null
          resolved: boolean
          resolved_at: string | null
          resolved_by_staff_id: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          customer_name: string
          customer_phone?: string | null
          description: string
          follow_up_required?: boolean
          id?: string
          incident_type: string
          related_discount_id?: string | null
          related_employee_id?: string | null
          related_order_id?: string | null
          related_order_item_id?: string | null
          reported_at?: string
          reported_by_staff_id?: string | null
          resolution_action?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by_staff_id?: string | null
          severity: string
        }
        Update: {
          created_at?: string
          customer_name?: string
          customer_phone?: string | null
          description?: string
          follow_up_required?: boolean
          id?: string
          incident_type?: string
          related_discount_id?: string | null
          related_employee_id?: string | null
          related_order_id?: string | null
          related_order_item_id?: string | null
          reported_at?: string
          reported_by_staff_id?: string | null
          resolution_action?: string | null
          resolved?: boolean
          resolved_at?: string | null
          resolved_by_staff_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_log_related_discount_id_fkey"
            columns: ["related_discount_id"]
            isOneToOne: false
            referencedRelation: "discount_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_log_related_employee_id_fkey"
            columns: ["related_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_log_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_log_related_order_item_id_fkey"
            columns: ["related_order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_log_reported_by_staff_id_fkey"
            columns: ["reported_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_log_resolved_by_staff_id_fkey"
            columns: ["resolved_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      order_adjustments: {
        Row: {
          adjustment_month: string | null
          adjustment_type: string
          amount_cents: number | null
          approved_by_user_id: string | null
          created_at: string
          id: string
          new_order_id: string | null
          original_month: string | null
          original_order_id: string
          reason: string
          reversal_batch_nbr: string | null
        }
        Insert: {
          adjustment_month?: string | null
          adjustment_type: string
          amount_cents?: number | null
          approved_by_user_id?: string | null
          created_at?: string
          id?: string
          new_order_id?: string | null
          original_month?: string | null
          original_order_id: string
          reason: string
          reversal_batch_nbr?: string | null
        }
        Update: {
          adjustment_month?: string | null
          adjustment_type?: string
          amount_cents?: number | null
          approved_by_user_id?: string | null
          created_at?: string
          id?: string
          new_order_id?: string | null
          original_month?: string | null
          original_order_id?: string
          reason?: string
          reversal_batch_nbr?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_adjustments_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_adjustments_new_order_id_fkey"
            columns: ["new_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_adjustments_original_order_id_fkey"
            columns: ["original_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_customers: {
        Row: {
          created_at: string
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          discount_id_no: string | null
          discount_id_type: string | null
          discount_id_verified: boolean
          email: string | null
          gender: string | null
          id: string
          order_id: string
          seq_no: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          discount_id_no?: string | null
          discount_id_type?: string | null
          discount_id_verified?: boolean
          email?: string | null
          gender?: string | null
          id?: string
          order_id: string
          seq_no: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          discount_id_no?: string | null
          discount_id_type?: string | null
          discount_id_verified?: boolean
          email?: string | null
          gender?: string | null
          id?: string
          order_id?: string
          seq_no?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_customers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_customers_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_edit_log: {
        Row: {
          after_snapshot: Json
          before_snapshot: Json
          edit_reason: string
          edited_at: string
          edited_by_staff_id: string | null
          from_status: string | null
          id: string
          order_id: string
          to_status: string | null
        }
        Insert: {
          after_snapshot: Json
          before_snapshot: Json
          edit_reason: string
          edited_at?: string
          edited_by_staff_id?: string | null
          from_status?: string | null
          id?: string
          order_id: string
          to_status?: string | null
        }
        Update: {
          after_snapshot?: Json
          before_snapshot?: Json
          edit_reason?: string
          edited_at?: string
          edited_by_staff_id?: string | null
          from_status?: string | null
          id?: string
          order_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_edit_log_edited_by_staff_id_fkey"
            columns: ["edited_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_edit_log_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          actual_duration_minutes: number | null
          actual_end: string | null
          actual_start: string | null
          bed_released_at: string | null
          commission_amount_cents: number | null
          commission_branch_id: string | null
          commission_rate: number | null
          commission_settlement_id: string | null
          created_at: string
          discount_amount_cents: number
          discount_class_id: string
          duration_minutes: number
          external_room_no: string | null
          final_amount_cents: number | null
          id: string
          interruption_approved_by_user_id: string | null
          interruption_at: string | null
          interruption_handling: string | null
          interruption_notes: string | null
          interruption_reason: string | null
          interruption_reason_code: string | null
          item_seq: number | null
          list_price_cents: number | null
          order_customer_id: string
          order_id: string
          reschedule_fulfilled_at: string | null
          resource_id: string | null
          scheduled_start: string | null
          service_category_id: string
          service_end: string | null
          service_item_id: string | null
          service_start: string | null
          slot_end: string | null
          slot_start: string | null
          status: string
          therapist_home_branch_id: string | null
          therapist_id: string | null
          updated_at: string
        }
        Insert: {
          actual_duration_minutes?: number | null
          actual_end?: string | null
          actual_start?: string | null
          bed_released_at?: string | null
          commission_amount_cents?: number | null
          commission_branch_id?: string | null
          commission_rate?: number | null
          commission_settlement_id?: string | null
          created_at?: string
          discount_amount_cents?: number
          discount_class_id: string
          duration_minutes?: number
          external_room_no?: string | null
          final_amount_cents?: number | null
          id?: string
          interruption_approved_by_user_id?: string | null
          interruption_at?: string | null
          interruption_handling?: string | null
          interruption_notes?: string | null
          interruption_reason?: string | null
          interruption_reason_code?: string | null
          item_seq?: number | null
          list_price_cents?: number | null
          order_customer_id: string
          order_id: string
          reschedule_fulfilled_at?: string | null
          resource_id?: string | null
          scheduled_start?: string | null
          service_category_id: string
          service_end?: string | null
          service_item_id?: string | null
          service_start?: string | null
          slot_end?: string | null
          slot_start?: string | null
          status?: string
          therapist_home_branch_id?: string | null
          therapist_id?: string | null
          updated_at?: string
        }
        Update: {
          actual_duration_minutes?: number | null
          actual_end?: string | null
          actual_start?: string | null
          bed_released_at?: string | null
          commission_amount_cents?: number | null
          commission_branch_id?: string | null
          commission_rate?: number | null
          commission_settlement_id?: string | null
          created_at?: string
          discount_amount_cents?: number
          discount_class_id?: string
          duration_minutes?: number
          external_room_no?: string | null
          final_amount_cents?: number | null
          id?: string
          interruption_approved_by_user_id?: string | null
          interruption_at?: string | null
          interruption_handling?: string | null
          interruption_notes?: string | null
          interruption_reason?: string | null
          interruption_reason_code?: string | null
          item_seq?: number | null
          list_price_cents?: number | null
          order_customer_id?: string
          order_id?: string
          reschedule_fulfilled_at?: string | null
          resource_id?: string | null
          scheduled_start?: string | null
          service_category_id?: string
          service_end?: string | null
          service_item_id?: string | null
          service_start?: string | null
          slot_end?: string | null
          slot_start?: string | null
          status?: string
          therapist_home_branch_id?: string | null
          therapist_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_order_items_commission_period"
            columns: ["commission_settlement_id"]
            isOneToOne: false
            referencedRelation: "commission_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_commission_branch_id_fkey"
            columns: ["commission_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_discount_class_id_fkey"
            columns: ["discount_class_id"]
            isOneToOne: false
            referencedRelation: "discount_classes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_interruption_approved_by_user_id_fkey"
            columns: ["interruption_approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_customer_id_fkey"
            columns: ["order_customer_id"]
            isOneToOne: false
            referencedRelation: "order_customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: false
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_therapist_home_branch_id_fkey"
            columns: ["therapist_home_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      order_status_log: {
        Row: {
          changed_at: string
          changed_by_staff_id: string | null
          entity_id: string
          entity_type: string
          from_status: string | null
          id: string
          reason: string | null
          to_status: string | null
        }
        Insert: {
          changed_at?: string
          changed_by_staff_id?: string | null
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          changed_at?: string
          changed_by_staff_id?: string | null
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: string
          reason?: string | null
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_status_log_changed_by_staff_id_fkey"
            columns: ["changed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          billing_to_id: string | null
          branch_id: string
          business_unit_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          discount_cents: number
          external_hotel_id: string | null
          gl_batch_nbr: string | null
          id: string
          note: string | null
          order_no: string
          order_type: string
          paid_cents: number
          payment_method_id: string | null
          posting_error: string | null
          posting_status: string | null
          service_date: string
          service_location_type: string | null
          source_id: string | null
          status: string
          stored_value_card_id: string | null
          subtotal_cents: number
          total_cents: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billing_to_id?: string | null
          branch_id: string
          business_unit_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_cents?: number
          external_hotel_id?: string | null
          gl_batch_nbr?: string | null
          id?: string
          note?: string | null
          order_no: string
          order_type?: string
          paid_cents?: number
          payment_method_id?: string | null
          posting_error?: string | null
          posting_status?: string | null
          service_date: string
          service_location_type?: string | null
          source_id?: string | null
          status?: string
          stored_value_card_id?: string | null
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billing_to_id?: string | null
          branch_id?: string
          business_unit_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          discount_cents?: number
          external_hotel_id?: string | null
          gl_batch_nbr?: string | null
          id?: string
          note?: string | null
          order_no?: string
          order_type?: string
          paid_cents?: number
          payment_method_id?: string | null
          posting_error?: string | null
          posting_status?: string | null
          service_date?: string
          service_location_type?: string | null
          source_id?: string | null
          status?: string
          stored_value_card_id?: string | null
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_orders_svc"
            columns: ["stored_value_card_id"]
            isOneToOne: false
            referencedRelation: "stored_value_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_billing_to_id_fkey"
            columns: ["billing_to_id"]
            isOneToOne: false
            referencedRelation: "billing_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_external_hotel_id_fkey"
            columns: ["external_hotel_id"]
            isOneToOne: false
            referencedRelation: "billing_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "customer_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          currency: string
          display_name: string
          id: string
          manual_reconciliation: boolean
          method_type: string
          requires_reference: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          currency?: string
          display_name: string
          id?: string
          manual_reconciliation?: boolean
          method_type?: string
          requires_reference?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          display_name?: string
          id?: string
          manual_reconciliation?: boolean
          method_type?: string
          requires_reference?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      position_business_units: {
        Row: {
          business_unit_id: string
          position_id: string
        }
        Insert: {
          business_unit_id: string
          position_id: string
        }
        Update: {
          business_unit_id?: string
          position_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_business_units_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_business_units_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "positions"
            referencedColumns: ["id"]
          },
        ]
      }
      positions: {
        Row: {
          active: boolean
          code: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      resource_status_log: {
        Row: {
          auto_cleared: boolean
          changed_at: string
          changed_by_staff_id: string | null
          from_status: string | null
          id: string
          reason: string | null
          resource_id: string
          to_status: string | null
          until_at: string | null
        }
        Insert: {
          auto_cleared?: boolean
          changed_at?: string
          changed_by_staff_id?: string | null
          from_status?: string | null
          id?: string
          reason?: string | null
          resource_id: string
          to_status?: string | null
          until_at?: string | null
        }
        Update: {
          auto_cleared?: boolean
          changed_at?: string
          changed_by_staff_id?: string | null
          from_status?: string | null
          id?: string
          reason?: string | null
          resource_id?: string
          to_status?: string | null
          until_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resource_status_log_changed_by_staff_id_fkey"
            columns: ["changed_by_staff_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resource_status_log_resource_id_fkey"
            columns: ["resource_id"]
            isOneToOne: false
            referencedRelation: "resources"
            referencedColumns: ["id"]
          },
        ]
      }
      resources: {
        Row: {
          branch_id: string
          business_unit_id: string | null
          capacity: number
          created_at: string
          created_by: string | null
          id: string
          location_zone: string | null
          resource_name: string
          resource_type: string
          status: string
          status_changed_at: string | null
          status_changed_by_user_id: string | null
          status_reason: string | null
          status_until: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id: string
          business_unit_id?: string | null
          capacity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_zone?: string | null
          resource_name: string
          resource_type: string
          status?: string
          status_changed_at?: string | null
          status_changed_by_user_id?: string | null
          status_reason?: string | null
          status_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string
          business_unit_id?: string | null
          capacity?: number
          created_at?: string
          created_by?: string | null
          id?: string
          location_zone?: string | null
          resource_name?: string
          resource_type?: string
          status?: string
          status_changed_at?: string | null
          status_changed_by_user_id?: string | null
          status_reason?: string | null
          status_until?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "resources_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "resources_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_soa: {
        Row: {
          billing_to_id: string
          branch_id: string | null
          created_at: string
          created_by: string | null
          due_date: string | null
          gl_batch_nbr: string | null
          id: string
          issued_date: string | null
          note: string | null
          outstanding_cents: number | null
          paid_cents: number
          pdf_file_path: string | null
          period_from: string
          period_to: string
          posting_error: string | null
          posting_status: string | null
          settlement_type: string | null
          soa_no: string
          status: string
          subtotal_cents: number
          total_cents: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          billing_to_id: string
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          gl_batch_nbr?: string | null
          id?: string
          issued_date?: string | null
          note?: string | null
          outstanding_cents?: number | null
          paid_cents?: number
          pdf_file_path?: string | null
          period_from: string
          period_to: string
          posting_error?: string | null
          posting_status?: string | null
          settlement_type?: string | null
          soa_no: string
          status?: string
          subtotal_cents: number
          total_cents: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          billing_to_id?: string
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          due_date?: string | null
          gl_batch_nbr?: string | null
          id?: string
          issued_date?: string | null
          note?: string | null
          outstanding_cents?: number | null
          paid_cents?: number
          pdf_file_path?: string | null
          period_from?: string
          period_to?: string
          posting_error?: string | null
          posting_status?: string | null
          settlement_type?: string | null
          soa_no?: string
          status?: string
          subtotal_cents?: number
          total_cents?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_soa_billing_to_id_fkey"
            columns: ["billing_to_id"]
            isOneToOne: false
            referencedRelation: "billing_destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_soa_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_soa_orders: {
        Row: {
          added_at: string
          amount_cents: number
          id: string
          order_id: string
          soa_id: string
        }
        Insert: {
          added_at?: string
          amount_cents: number
          id?: string
          order_id: string
          soa_id: string
        }
        Update: {
          added_at?: string
          amount_cents?: number
          id?: string
          order_id?: string
          soa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_soa_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_soa_orders_soa_id_fkey"
            columns: ["soa_id"]
            isOneToOne: false
            referencedRelation: "revenue_soa"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_soa_payments: {
        Row: {
          amount_cents: number
          created_at: string
          gl_batch_nbr: string | null
          id: string
          note: string | null
          paid_at: string
          payment_method: string | null
          posting_error: string | null
          posting_status: string | null
          proof_file_path: string | null
          recorded_by: string | null
          reference_no: string | null
          soa_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          gl_batch_nbr?: string | null
          id?: string
          note?: string | null
          paid_at: string
          payment_method?: string | null
          posting_error?: string | null
          posting_status?: string | null
          proof_file_path?: string | null
          recorded_by?: string | null
          reference_no?: string | null
          soa_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          gl_batch_nbr?: string | null
          id?: string
          note?: string | null
          paid_at?: string
          payment_method?: string | null
          posting_error?: string | null
          posting_status?: string | null
          proof_file_path?: string | null
          recorded_by?: string | null
          reference_no?: string | null
          soa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_soa_payments_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_soa_payments_soa_id_fkey"
            columns: ["soa_id"]
            isOneToOne: false
            referencedRelation: "revenue_soa"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          permission_name: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          permission_name: string
          role: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          permission_name?: string
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      service_categories: {
        Row: {
          active: boolean
          code: string
          commission_applicable: boolean
          created_at: string
          created_by: string | null
          id: string
          name: string
          required_resource_type: string | null
          required_resource_types: string[]
          revenue_account: string | null
          revenue_transaction_code_id: string | null
          tip_applicable: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          commission_applicable?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          required_resource_type?: string | null
          required_resource_types?: string[]
          revenue_account?: string | null
          revenue_transaction_code_id?: string | null
          tip_applicable?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          commission_applicable?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          required_resource_type?: string | null
          required_resource_types?: string[]
          revenue_account?: string | null
          revenue_transaction_code_id?: string | null
          tip_applicable?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_categories_revenue_transaction_code_id_fkey"
            columns: ["revenue_transaction_code_id"]
            isOneToOne: false
            referencedRelation: "transaction_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      service_category_branches: {
        Row: {
          branch_id: string
          created_at: string
          enabled: boolean
          id: string
          service_category_id: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          enabled?: boolean
          id?: string
          service_category_id: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          enabled?: boolean
          id?: string
          service_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_category_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_category_branches_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      service_category_business_units: {
        Row: {
          business_unit_id: string
          service_category_id: string
        }
        Insert: {
          business_unit_id: string
          service_category_id: string
        }
        Update: {
          business_unit_id?: string
          service_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_category_business_units_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_category_business_units_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      service_item_prices: {
        Row: {
          branch_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          effective_from: string
          effective_to: string
          id: string
          price_cents: number
          price_class: string
          service_item_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from: string
          effective_to: string
          id?: string
          price_cents: number
          price_class?: string
          service_item_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_from?: string
          effective_to?: string
          id?: string
          price_cents?: number
          price_class?: string
          service_item_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_item_prices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_item_prices_service_item_id_fkey"
            columns: ["service_item_id"]
            isOneToOne: false
            referencedRelation: "service_items"
            referencedColumns: ["id"]
          },
        ]
      }
      service_items: {
        Row: {
          active: boolean
          business_unit_id: string | null
          cleanup_after_minutes: number
          code: string
          commission_applicable: boolean
          created_at: string
          created_by: string | null
          duration_minutes: number
          id: string
          name: string
          prep_before_minutes: number
          pricing_model: string
          allowed_resource_types: string[]
          service_category_id: string
          service_group: string | null
          tip_applicable: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          business_unit_id?: string | null
          cleanup_after_minutes?: number
          code: string
          commission_applicable?: boolean
          created_at?: string
          created_by?: string | null
          duration_minutes: number
          id?: string
          name: string
          prep_before_minutes?: number
          pricing_model?: string
          allowed_resource_types?: string[]
          service_category_id: string
          service_group?: string | null
          tip_applicable?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          business_unit_id?: string | null
          cleanup_after_minutes?: number
          code?: string
          commission_applicable?: boolean
          created_at?: string
          created_by?: string | null
          duration_minutes?: number
          id?: string
          name?: string
          prep_before_minutes?: number
          pricing_model?: string
          allowed_resource_types?: string[]
          service_category_id?: string
          service_group?: string | null
          tip_applicable?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_items_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_items_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          branch_id: string | null
          created_at: string
          description: string | null
          id: string
          key: string
          scope: string
          updated_at: string
          updated_by: string | null
          value: string
          value_type: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key: string
          scope?: string
          updated_at?: string
          updated_by?: string | null
          value: string
          value_type: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          scope?: string
          updated_at?: string
          updated_by?: string | null
          value?: string
          value_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "settings_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      soa_adjustments: {
        Row: {
          adjustment_month: string
          amount_cents: number
          approval_user_id: string | null
          created_at: string
          id: string
          new_soa_id: string | null
          original_month: string
          original_soa_id: string
          reason: string
        }
        Insert: {
          adjustment_month: string
          amount_cents: number
          approval_user_id?: string | null
          created_at?: string
          id?: string
          new_soa_id?: string | null
          original_month: string
          original_soa_id: string
          reason: string
        }
        Update: {
          adjustment_month?: string
          amount_cents?: number
          approval_user_id?: string | null
          created_at?: string
          id?: string
          new_soa_id?: string | null
          original_month?: string
          original_soa_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "soa_adjustments_approval_user_id_fkey"
            columns: ["approval_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soa_adjustments_new_soa_id_fkey"
            columns: ["new_soa_id"]
            isOneToOne: false
            referencedRelation: "revenue_soa"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "soa_adjustments_original_soa_id_fkey"
            columns: ["original_soa_id"]
            isOneToOne: false
            referencedRelation: "revenue_soa"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_user_branches: {
        Row: {
          branch_id: string
          staff_user_id: string
        }
        Insert: {
          branch_id: string
          staff_user_id: string
        }
        Update: {
          branch_id?: string
          staff_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_user_branches_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_user_branches_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_user_business_units: {
        Row: {
          business_unit_id: string
          staff_user_id: string
        }
        Insert: {
          business_unit_id: string
          staff_user_id: string
        }
        Update: {
          business_unit_id?: string
          staff_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_user_business_units_business_unit_id_fkey"
            columns: ["business_unit_id"]
            isOneToOne: false
            referencedRelation: "business_units"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_user_business_units_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          branch_id: string
          business_date: string
          closed_at: string | null
          closed_by: string | null
          closing_count_cents: number | null
          created_at: string
          gl_batch_nbr: string | null
          id: string
          label: string
          note: string | null
          opened_at: string
          opened_by: string | null
          opening_float_cents: number
          posting_error: string | null
          posting_status: string | null
          status: string
          updated_at: string
          variance_cents: number | null
          variance_reason: string | null
        }
        Insert: {
          branch_id: string
          business_date: string
          closed_at?: string | null
          closed_by?: string | null
          closing_count_cents?: number | null
          created_at?: string
          gl_batch_nbr?: string | null
          id?: string
          label: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float_cents?: number
          posting_error?: string | null
          posting_status?: string | null
          status?: string
          updated_at?: string
          variance_cents?: number | null
          variance_reason?: string | null
        }
        Update: {
          branch_id?: string
          business_date?: string
          closed_at?: string | null
          closed_by?: string | null
          closing_count_cents?: number | null
          created_at?: string
          gl_batch_nbr?: string | null
          id?: string
          label?: string
          note?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_float_cents?: number
          posting_error?: string | null
          posting_status?: string | null
          status?: string
          updated_at?: string
          variance_cents?: number | null
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_users: {
        Row: {
          active: boolean
          acumatica_user_id: string
          auth_user_id: string | null
          created_at: string
          display_name: string | null
          email: string
          home_branch_id: string | null
          id: string
          last_login_at: string | null
          manager_pin_failed_attempts: number
          manager_pin_hash: string | null
          manager_pin_last_used_at: string | null
          manager_pin_locked_until: string | null
          manager_pin_set_at: string | null
          password_hash: string | null
          role: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          acumatica_user_id: string
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email: string
          home_branch_id?: string | null
          id?: string
          last_login_at?: string | null
          manager_pin_failed_attempts?: number
          manager_pin_hash?: string | null
          manager_pin_last_used_at?: string | null
          manager_pin_locked_until?: string | null
          manager_pin_set_at?: string | null
          password_hash?: string | null
          role?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          acumatica_user_id?: string
          auth_user_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string
          home_branch_id?: string | null
          id?: string
          last_login_at?: string | null
          manager_pin_failed_attempts?: number
          manager_pin_hash?: string | null
          manager_pin_last_used_at?: string | null
          manager_pin_locked_until?: string | null
          manager_pin_set_at?: string | null
          password_hash?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_users_home_branch_id_fkey"
            columns: ["home_branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      staffing_requirements: {
        Row: {
          branch_id: string
          created_at: string
          day_of_week: number
          id: string
          min_senior_therapists: number
          min_therapists: number
          note: string | null
          service_category_id: string | null
          time_block_end: string
          time_block_start: string
          updated_at: string
        }
        Insert: {
          branch_id: string
          created_at?: string
          day_of_week: number
          id?: string
          min_senior_therapists?: number
          min_therapists: number
          note?: string | null
          service_category_id?: string | null
          time_block_end: string
          time_block_start: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          created_at?: string
          day_of_week?: number
          id?: string
          min_senior_therapists?: number
          min_therapists?: number
          note?: string | null
          service_category_id?: string | null
          time_block_end?: string
          time_block_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "staffing_requirements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staffing_requirements_service_category_id_fkey"
            columns: ["service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      stored_value_cards: {
        Row: {
          bonus_amount_cents: number
          branch_id: string
          card_no: string
          created_at: string
          created_by: string | null
          current_balance_cents: number
          customer_id: string
          discount_class_id: string | null
          expires_at: string
          id: string
          initial_amount_cents: number
          issued_at: string
          status: string
          transferable: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bonus_amount_cents?: number
          branch_id: string
          card_no: string
          created_at?: string
          created_by?: string | null
          current_balance_cents: number
          customer_id: string
          discount_class_id?: string | null
          expires_at: string
          id?: string
          initial_amount_cents: number
          issued_at: string
          status?: string
          transferable?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bonus_amount_cents?: number
          branch_id?: string
          card_no?: string
          created_at?: string
          created_by?: string | null
          current_balance_cents?: number
          customer_id?: string
          discount_class_id?: string | null
          expires_at?: string
          id?: string
          initial_amount_cents?: number
          issued_at?: string
          status?: string
          transferable?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stored_value_cards_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_cards_discount_class_id_fkey"
            columns: ["discount_class_id"]
            isOneToOne: false
            referencedRelation: "discount_classes"
            referencedColumns: ["id"]
          },
        ]
      }
      stored_value_transactions: {
        Row: {
          amount_cents: number
          approved_by_user_id: string | null
          balance_after_cents: number
          branch_id: string
          card_id: string
          created_at: string
          id: string
          note: string | null
          related_order_id: string | null
          related_folio_line_id: string | null
          type: string
        }
        Insert: {
          amount_cents: number
          approved_by_user_id?: string | null
          balance_after_cents: number
          branch_id: string
          card_id: string
          created_at?: string
          id?: string
          note?: string | null
          related_order_id?: string | null
          related_folio_line_id?: string | null
          type: string
        }
        Update: {
          amount_cents?: number
          approved_by_user_id?: string | null
          balance_after_cents?: number
          branch_id?: string
          card_id?: string
          created_at?: string
          id?: string
          note?: string | null
          related_order_id?: string | null
          related_folio_line_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "stored_value_transactions_approved_by_user_id_fkey"
            columns: ["approved_by_user_id"]
            isOneToOne: false
            referencedRelation: "staff_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_transactions_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_transactions_card_id_fkey"
            columns: ["card_id"]
            isOneToOne: false
            referencedRelation: "stored_value_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_transactions_related_order_id_fkey"
            columns: ["related_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stored_value_transactions_related_folio_line_id_fkey"
            columns: ["related_folio_line_id"]
            isOneToOne: false
            referencedRelation: "folio_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      tip_settlements: {
        Row: {
          branch_id: string | null
          created_at: string
          gl_batch_nbr: string | null
          id: string
          note: string | null
          pdf_file_path: string | null
          period_from: string
          period_to: string
          posted_at: string | null
          posting_error: string | null
          posting_status: string | null
          settlement_no: string
          status: string
          subtotal_cents: number
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          created_at?: string
          gl_batch_nbr?: string | null
          id?: string
          note?: string | null
          pdf_file_path?: string | null
          period_from: string
          period_to: string
          posted_at?: string | null
          posting_error?: string | null
          posting_status?: string | null
          settlement_no: string
          status?: string
          subtotal_cents: number
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          created_at?: string
          gl_batch_nbr?: string | null
          id?: string
          note?: string | null
          pdf_file_path?: string | null
          period_from?: string
          period_to?: string
          posted_at?: string | null
          posting_error?: string | null
          posting_status?: string | null
          settlement_no?: string
          status?: string
          subtotal_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tip_settlements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
        ]
      }
      tips: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          order_id: string
          order_item_id: string
          folio_line_id: string
          settlement_id: string | null
          status: string
          therapist_id: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          order_id: string
          order_item_id: string
          folio_line_id: string
          settlement_id?: string | null
          status?: string
          therapist_id: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          order_id?: string
          order_item_id?: string
          folio_line_id?: string
          settlement_id?: string | null
          status?: string
          therapist_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_tips_settlement"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "tip_settlements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_folio_line_id_fkey"
            columns: ["folio_line_id"]
            isOneToOne: false
            referencedRelation: "folio_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tips_therapist_id_fkey"
            columns: ["therapist_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_codes: {
        Row: {
          active: boolean
          branch_id: string | null
          code: string
          created_at: string
          created_by: string | null
          credit_account: string | null
          credit_branch_id: string | null
          credit_subaccount: string | null
          debit_account: string | null
          debit_branch_id: string | null
          debit_subaccount: string | null
          id: string
          payment_method_id: string | null
          transaction_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          branch_id?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          credit_account?: string | null
          credit_branch_id?: string | null
          credit_subaccount?: string | null
          debit_account?: string | null
          debit_branch_id?: string | null
          debit_subaccount?: string | null
          id?: string
          payment_method_id?: string | null
          transaction_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          branch_id?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          credit_account?: string | null
          credit_branch_id?: string | null
          credit_subaccount?: string | null
          debit_account?: string | null
          debit_branch_id?: string | null
          debit_subaccount?: string | null
          id?: string
          payment_method_id?: string | null
          transaction_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_codes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_codes_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist: {
        Row: {
          arrived_at: string
          branch_id: string
          converted_to_order_id: string | null
          created_at: string
          customer_name: string
          customer_phone: string | null
          estimated_wait_minutes: number | null
          id: string
          note: string | null
          notified_at: string | null
          pax: number
          position: number | null
          preferred_gender: string | null
          preferred_service_category_id: string | null
          preferred_therapist_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          arrived_at?: string
          branch_id: string
          converted_to_order_id?: string | null
          created_at?: string
          customer_name: string
          customer_phone?: string | null
          estimated_wait_minutes?: number | null
          id?: string
          note?: string | null
          notified_at?: string | null
          pax: number
          position?: number | null
          preferred_gender?: string | null
          preferred_service_category_id?: string | null
          preferred_therapist_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          arrived_at?: string
          branch_id?: string
          converted_to_order_id?: string | null
          created_at?: string
          customer_name?: string
          customer_phone?: string | null
          estimated_wait_minutes?: number | null
          id?: string
          note?: string | null
          notified_at?: string | null
          pax?: number
          position?: number | null
          preferred_gender?: string | null
          preferred_service_category_id?: string | null
          preferred_therapist_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_converted_to_order_id_fkey"
            columns: ["converted_to_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_preferred_service_category_id_fkey"
            columns: ["preferred_service_category_id"]
            isOneToOne: false
            referencedRelation: "service_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_preferred_therapist_id_fkey"
            columns: ["preferred_therapist_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_audit_user: {
        Row: {
          display_name: string | null
          id: string | null
          role: string | null
          username: string | null
        }
        Insert: {
          display_name?: string | null
          id?: string | null
          role?: string | null
          username?: string | null
        }
        Update: {
          display_name?: string | null
          id?: string | null
          role?: string | null
          username?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      [_ in never]: never
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
