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
      current_role_label: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "planning" | "leader" | "viewer"
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
      app_role: ["admin", "planning", "leader", "viewer"],
      approval_status: ["pending", "approved", "blocked"],
      change_source: ["individual", "bulk", "import", "sync"],
      sync_status: ["synced", "pending", "error"],
    },
  },
} as const
