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
  public: {
    Tables: {
      activities: {
        Row: {
          area: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          is_immediate: boolean
          justification: string | null
          note_number: string | null
          observation: string | null
          order_number: string | null
          planning_data: Json
          reported_at: string | null
          reported_by_email: string | null
          reported_by_name: string | null
          reported_by_user_id: string | null
          scheduled_date: string | null
          source_key: string
          source_row_number: number | null
          specialty: string | null
          status: string
          sync_error: string | null
          sync_status: Database["public"]["Enums"]["sync_status"]
          updated_at: string
          version: number
          week_id: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_immediate?: boolean
          justification?: string | null
          note_number?: string | null
          observation?: string | null
          order_number?: string | null
          planning_data?: Json
          reported_at?: string | null
          reported_by_email?: string | null
          reported_by_name?: string | null
          reported_by_user_id?: string | null
          scheduled_date?: string | null
          source_key: string
          source_row_number?: number | null
          specialty?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
          version?: number
          week_id: string
        }
        Update: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          is_immediate?: boolean
          justification?: string | null
          note_number?: string | null
          observation?: string | null
          order_number?: string | null
          planning_data?: Json
          reported_at?: string | null
          reported_by_email?: string | null
          reported_by_name?: string | null
          reported_by_user_id?: string | null
          scheduled_date?: string | null
          source_key?: string
          source_row_number?: number | null
          specialty?: string | null
          status?: string
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
          version?: number
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_history: {
        Row: {
          activity_id: string
          change_source: Database["public"]["Enums"]["change_source"]
          changed_at: string
          changed_by_email: string | null
          changed_by_name: string | null
          changed_by_user_id: string | null
          id: string
          new_values: Json
          previous_values: Json
          sync_error: string | null
          sync_status: Database["public"]["Enums"]["sync_status"] | null
          week_id: string
        }
        Insert: {
          activity_id: string
          change_source?: Database["public"]["Enums"]["change_source"]
          changed_at?: string
          changed_by_email?: string | null
          changed_by_name?: string | null
          changed_by_user_id?: string | null
          id?: string
          new_values?: Json
          previous_values?: Json
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"] | null
          week_id: string
        }
        Update: {
          activity_id?: string
          change_source?: Database["public"]["Enums"]["change_source"]
          changed_at?: string
          changed_by_email?: string | null
          changed_by_name?: string | null
          changed_by_user_id?: string | null
          id?: string
          new_values?: Json
          previous_values?: Json
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"] | null
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_history_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_history_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_immediate_links: {
        Row: {
          id: string
          immediate_activity_id: string
          linked_at: string
          linked_by_user_id: string | null
          planned_activity_id: string
          week_id: string
        }
        Insert: {
          id?: string
          immediate_activity_id: string
          linked_at?: string
          linked_by_user_id?: string | null
          planned_activity_id: string
          week_id: string
        }
        Update: {
          id?: string
          immediate_activity_id?: string
          linked_at?: string
          linked_by_user_id?: string | null
          planned_activity_id?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_immediate_links_immediate_activity_id_fkey"
            columns: ["immediate_activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_immediate_links_planned_activity_id_fkey"
            columns: ["planned_activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_immediate_links_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_days_off: {
        Row: {
          created_at: string
          created_by_email: string
          created_by_name: string
          created_by_user_id: string
          day_off_date: string
          employee_master_id: string
          employee_name: string
          employee_registration: string | null
          employee_role: string | null
          id: string
          observation: string | null
          updated_at: string
          updated_by_name: string | null
          updated_by_user_id: string | null
          version: number
        }
        Insert: {
          created_at?: string
          created_by_email?: string
          created_by_name?: string
          created_by_user_id: string
          day_off_date: string
          employee_master_id: string
          employee_name: string
          employee_registration?: string | null
          employee_role?: string | null
          id?: string
          observation?: string | null
          updated_at?: string
          updated_by_name?: string | null
          updated_by_user_id?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          created_by_email?: string
          created_by_name?: string
          created_by_user_id?: string
          day_off_date?: string
          employee_master_id?: string
          employee_name?: string
          employee_registration?: string | null
          employee_role?: string | null
          id?: string
          observation?: string | null
          updated_at?: string
          updated_by_name?: string | null
          updated_by_user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_days_off_employee_master_id_fkey"
            columns: ["employee_master_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          admission_date: string
          badge: string
          city: string | null
          created_at: string
          employee_id: string
          full_name: string
          id: string
          is_active: boolean
          job_title: string
          message_contact: string | null
          neighborhood: string | null
          phone: string | null
          transport_line: string | null
          updated_at: string
          updated_by_name: string | null
          updated_by_user_id: string | null
        }
        Insert: {
          address?: string | null
          admission_date: string
          badge: string
          city?: string | null
          created_at?: string
          employee_id: string
          full_name: string
          id?: string
          is_active?: boolean
          job_title: string
          message_contact?: string | null
          neighborhood?: string | null
          phone?: string | null
          transport_line?: string | null
          updated_at?: string
          updated_by_name?: string | null
          updated_by_user_id?: string | null
        }
        Update: {
          address?: string | null
          admission_date?: string
          badge?: string
          city?: string | null
          created_at?: string
          employee_id?: string
          full_name?: string
          id?: string
          is_active?: boolean
          job_title?: string
          message_contact?: string | null
          neighborhood?: string | null
          phone?: string | null
          transport_line?: string | null
          updated_at?: string
          updated_by_name?: string | null
          updated_by_user_id?: string | null
        }
        Relationships: []
      }
      overtime_requests: {
        Row: {
          activity_id: string | null
          batch_id: string | null
          created_at: string
          decided_at: string | null
          decided_by_email: string | null
          decided_by_name: string | null
          decided_by_user_id: string | null
          departure_time: string
          employee_external_id: string | null
          employee_master_id: string | null
          employee_name: string
          employee_registration: string
          employee_role: string
          entry_time: string | null
          id: string
          justification: string
          manager_comment: string | null
          needs_snack: boolean
          needs_transport: boolean
          order_number: string | null
          overtime_date: string
          request_number: number
          requester_email: string
          requester_name: string
          requester_user_id: string
          service_description: string
          source_scheduled_transport_id: string | null
          source_type: string
          status: string
          updated_at: string
          version: number
          week_id: string | null
        }
        Insert: {
          activity_id?: string | null
          batch_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_email?: string | null
          decided_by_name?: string | null
          decided_by_user_id?: string | null
          departure_time: string
          employee_external_id?: string | null
          employee_master_id?: string | null
          employee_name: string
          employee_registration: string
          employee_role: string
          entry_time?: string | null
          id?: string
          justification: string
          manager_comment?: string | null
          needs_snack?: boolean
          needs_transport?: boolean
          order_number?: string | null
          overtime_date: string
          request_number?: number
          requester_email?: string
          requester_name?: string
          requester_user_id: string
          service_description: string
          source_scheduled_transport_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          version?: number
          week_id?: string | null
        }
        Update: {
          activity_id?: string | null
          batch_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by_email?: string | null
          decided_by_name?: string | null
          decided_by_user_id?: string | null
          departure_time?: string
          employee_external_id?: string | null
          employee_master_id?: string | null
          employee_name?: string
          employee_registration?: string
          employee_role?: string
          entry_time?: string | null
          id?: string
          justification?: string
          manager_comment?: string | null
          needs_snack?: boolean
          needs_transport?: boolean
          order_number?: string | null
          overtime_date?: string
          request_number?: number
          requester_email?: string
          requester_name?: string
          requester_user_id?: string
          service_description?: string
          source_scheduled_transport_id?: string | null
          source_type?: string
          status?: string
          updated_at?: string
          version?: number
          week_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "overtime_requests_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_requests_employee_master_id_fkey"
            columns: ["employee_master_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_requests_source_scheduled_transport_id_fkey"
            columns: ["source_scheduled_transport_id"]
            isOneToOne: false
            referencedRelation: "scheduled_transport_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "overtime_requests_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          approval_status: Database["public"]["Enums"]["approval_status"]
          approved_at: string | null
          approved_by: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["approval_status"]
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_transport_batches: {
        Row: {
          created_at: string
          created_by_email: string
          created_by_name: string
          created_by_user_id: string | null
          departure_time: string
          end_date: string
          entry_time: string
          id: string
          needs_snack: boolean
          needs_transport: boolean
          observation: string | null
          order_number: string | null
          service_description: string | null
          start_date: string
          updated_at: string
          weekdays: number[]
        }
        Insert: {
          created_at?: string
          created_by_email?: string
          created_by_name?: string
          created_by_user_id?: string | null
          departure_time: string
          end_date: string
          entry_time: string
          id?: string
          needs_snack?: boolean
          needs_transport?: boolean
          observation?: string | null
          order_number?: string | null
          service_description?: string | null
          start_date: string
          updated_at?: string
          weekdays?: number[]
        }
        Update: {
          created_at?: string
          created_by_email?: string
          created_by_name?: string
          created_by_user_id?: string | null
          departure_time?: string
          end_date?: string
          entry_time?: string
          id?: string
          needs_snack?: boolean
          needs_transport?: boolean
          observation?: string | null
          order_number?: string | null
          service_description?: string | null
          start_date?: string
          updated_at?: string
          weekdays?: number[]
        }
        Relationships: []
      }
      scheduled_transport_requests: {
        Row: {
          batch_id: string | null
          cancelled_at: string | null
          cancelled_by_name: string | null
          cancelled_by_user_id: string | null
          created_at: string
          departure_time: string
          employee_address: string | null
          employee_city: string | null
          employee_external_id: string | null
          employee_master_id: string
          employee_message_contact: string | null
          employee_name: string
          employee_neighborhood: string | null
          employee_phone: string | null
          employee_registration: string | null
          employee_role: string
          employee_transport_line: string | null
          entry_time: string
          id: string
          needs_snack: boolean
          needs_transport: boolean
          observation: string | null
          order_number: string | null
          requester_email: string
          requester_name: string
          requester_user_id: string | null
          service_description: string | null
          status: string
          transport_date: string
          updated_at: string
          updated_by_name: string | null
          updated_by_user_id: string | null
          version: number
        }
        Insert: {
          batch_id?: string | null
          cancelled_at?: string | null
          cancelled_by_name?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          departure_time: string
          employee_address?: string | null
          employee_city?: string | null
          employee_external_id?: string | null
          employee_master_id: string
          employee_message_contact?: string | null
          employee_name: string
          employee_neighborhood?: string | null
          employee_phone?: string | null
          employee_registration?: string | null
          employee_role?: string
          employee_transport_line?: string | null
          entry_time: string
          id?: string
          needs_snack?: boolean
          needs_transport?: boolean
          observation?: string | null
          order_number?: string | null
          requester_email?: string
          requester_name?: string
          requester_user_id?: string | null
          service_description?: string | null
          status?: string
          transport_date: string
          updated_at?: string
          updated_by_name?: string | null
          updated_by_user_id?: string | null
          version?: number
        }
        Update: {
          batch_id?: string | null
          cancelled_at?: string | null
          cancelled_by_name?: string | null
          cancelled_by_user_id?: string | null
          created_at?: string
          departure_time?: string
          employee_address?: string | null
          employee_city?: string | null
          employee_external_id?: string | null
          employee_master_id?: string
          employee_message_contact?: string | null
          employee_name?: string
          employee_neighborhood?: string | null
          employee_phone?: string | null
          employee_registration?: string | null
          employee_role?: string
          employee_transport_line?: string | null
          entry_time?: string
          id?: string
          needs_snack?: boolean
          needs_transport?: boolean
          observation?: string | null
          order_number?: string | null
          requester_email?: string
          requester_name?: string
          requester_user_id?: string | null
          service_description?: string | null
          status?: string
          transport_date?: string
          updated_at?: string
          updated_by_name?: string | null
          updated_by_user_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_transport_requests_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "scheduled_transport_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_transport_requests_employee_master_id_fkey"
            columns: ["employee_master_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      sharepoint_config: {
        Row: {
          column_mapping: Json
          drive_id: string | null
          enabled: boolean
          id: number
          item_id: string | null
          sheet_name: string | null
          site_id: string | null
          table_name: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          column_mapping?: Json
          drive_id?: string | null
          enabled?: boolean
          id?: number
          item_id?: string | null
          sheet_name?: string | null
          site_id?: string | null
          table_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          column_mapping?: Json
          drive_id?: string | null
          enabled?: boolean
          id?: number
          item_id?: string | null
          sheet_name?: string | null
          site_id?: string | null
          table_name?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          activity_id: string | null
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          next_retry_at: string | null
          operation: string
          payload: Json
          status: Database["public"]["Enums"]["sync_status"]
        }
        Insert: {
          activity_id?: string | null
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          operation: string
          payload?: Json
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Update: {
          activity_id?: string | null
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          operation?: string
          payload?: Json
          status?: Database["public"]["Enums"]["sync_status"]
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weeks: {
        Row: {
          code: string
          created_at: string
          end_date: string
          id: string
          imported_at: string | null
          imported_by: string | null
          is_active: boolean
          label: string
          sharepoint_item_id: string | null
          sheet_name: string | null
          source_file_name: string | null
          start_date: string
        }
        Insert: {
          code: string
          created_at?: string
          end_date: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          is_active?: boolean
          label: string
          sharepoint_item_id?: string | null
          sheet_name?: string | null
          source_file_name?: string | null
          start_date: string
        }
        Update: {
          code?: string
          created_at?: string
          end_date?: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          is_active?: boolean
          label?: string
          sharepoint_item_id?: string | null
          sheet_name?: string | null
          source_file_name?: string | null
          start_date?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bulk_update_activity_reports: {
        Args: {
          p_ids: string[]
          p_justification: string
          p_linked_ids?: string[]
          p_observation: string
          p_status: string
        }
        Returns: number
      }
      can_manage_scheduled_transport: {
        Args: { _user_id: string }
        Returns: boolean
      }
      current_role_label: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      sync_overtime_from_scale_row: {
        Args: {
          p_scale: Database["public"]["Tables"]["scheduled_transport_requests"]["Row"]
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "planning"
        | "leader"
        | "viewer"
        | "manager"
        | "measurement_control"
        | "logistics"
      approval_status: "pending" | "approved" | "blocked"
      change_source: "individual" | "bulk" | "import" | "sync"
      sync_status: "synced" | "pending" | "error"
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
  public: {
    Enums: {
      app_role: [
        "admin",
        "planning",
        "leader",
        "viewer",
        "manager",
        "measurement_control",
        "logistics",
      ],
      approval_status: ["pending", "approved", "blocked"],
      change_source: ["individual", "bulk", "import", "sync"],
      sync_status: ["synced", "pending", "error"],
    },
  },
} as const
