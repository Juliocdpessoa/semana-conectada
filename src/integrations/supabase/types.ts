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
          d1_date: string | null
          description: string
          id: string
          is_immediate: boolean
          justification: string | null
          note_number: string | null
          observation: string | null
          order_number: string | null
          pbs: string | null
          planning_data: Json
          pt_color: string | null
          pt_number: string | null
          release_type: string | null
          reported_at: string | null
          reported_by_email: string | null
          reported_by_name: string | null
          reported_by_user_id: string | null
          sap_status_snapshot: string | null
          sap_status_snapshot_at: string | null
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
          worksite_id: string
        }
        Insert: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          d1_date?: string | null
          description?: string
          id?: string
          is_immediate?: boolean
          justification?: string | null
          note_number?: string | null
          observation?: string | null
          order_number?: string | null
          pbs?: string | null
          planning_data?: Json
          pt_color?: string | null
          pt_number?: string | null
          release_type?: string | null
          reported_at?: string | null
          reported_by_email?: string | null
          reported_by_name?: string | null
          reported_by_user_id?: string | null
          sap_status_snapshot?: string | null
          sap_status_snapshot_at?: string | null
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
          worksite_id?: string
        }
        Update: {
          area?: string | null
          created_at?: string
          created_by?: string | null
          d1_date?: string | null
          description?: string
          id?: string
          is_immediate?: boolean
          justification?: string | null
          note_number?: string | null
          observation?: string | null
          order_number?: string | null
          pbs?: string | null
          planning_data?: Json
          pt_color?: string | null
          pt_number?: string | null
          release_type?: string | null
          reported_at?: string | null
          reported_by_email?: string | null
          reported_by_name?: string | null
          reported_by_user_id?: string | null
          sap_status_snapshot?: string | null
          sap_status_snapshot_at?: string | null
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
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_edit_settings: {
        Row: {
          date_edit_cutoff: string
          id: boolean
          updated_at: string
          updated_by: string | null
          worksite_id: string
        }
        Insert: {
          date_edit_cutoff?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          worksite_id?: string
        }
        Update: {
          date_edit_cutoff?: string
          id?: boolean
          updated_at?: string
          updated_by?: string | null
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_edit_settings_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
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
          worksite_id: string
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
          worksite_id?: string
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
          worksite_id?: string
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
          {
            foreignKeyName: "activity_history_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
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
      activity_page_configs: {
        Row: {
          fields: Json
          mode: string
          statuses: Json
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
          version: number
          worksite_id: string
        }
        Insert: {
          fields: Json
          mode: string
          statuses: Json
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          version?: number
          worksite_id: string
        }
        Update: {
          fields?: Json
          mode?: string
          statuses?: Json
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          version?: number
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_page_configs_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: true
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      continuous_activities: {
        Row: {
          created_at: string
          data: Json
          id: string
          record_key: string
          source_data: Json | null
          source_file_name: string | null
          source_row_number: number | null
          test_dataset: string | null
          updated_at: string
          updated_by: string | null
          updated_by_name: string | null
          version: number
          worksite_id: string
        }
        Insert: {
          created_at?: string
          data: Json
          id?: string
          record_key: string
          source_data?: Json | null
          source_file_name?: string | null
          source_row_number?: number | null
          test_dataset?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          version?: number
          worksite_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          record_key?: string
          source_data?: Json | null
          source_file_name?: string | null
          source_row_number?: number | null
          test_dataset?: string | null
          updated_at?: string
          updated_by?: string | null
          updated_by_name?: string | null
          version?: number
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "continuous_activities_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "activity_page_configs"
            referencedColumns: ["worksite_id"]
          },
        ]
      }
      continuous_activity_history: {
        Row: {
          actor: string | null
          actor_name: string | null
          changed_at: string
          id: string
          kind: string
          new_data: Json | null
          previous_data: Json | null
          record_id: string | null
          worksite_id: string
        }
        Insert: {
          actor?: string | null
          actor_name?: string | null
          changed_at?: string
          id?: string
          kind: string
          new_data?: Json | null
          previous_data?: Json | null
          record_id?: string | null
          worksite_id: string
        }
        Update: {
          actor?: string | null
          actor_name?: string | null
          changed_at?: string
          id?: string
          kind?: string
          new_data?: Json | null
          previous_data?: Json | null
          record_id?: string | null
          worksite_id?: string
        }
        Relationships: []
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
          worksite_id: string | null
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
          worksite_id?: string | null
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
          worksite_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_days_off_employee_master_id_fkey"
            columns: ["employee_master_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_days_off_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
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
          deleted_at: string | null
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
          worksite_id: string | null
        }
        Insert: {
          address?: string | null
          admission_date: string
          badge: string
          city?: string | null
          created_at?: string
          deleted_at?: string | null
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
          worksite_id?: string | null
        }
        Update: {
          address?: string | null
          admission_date?: string
          badge?: string
          city?: string | null
          created_at?: string
          deleted_at?: string | null
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
          worksite_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      nexo_backup_capture_queue: {
        Row: {
          attempts: number
          basis_version: number
          completed_at: string | null
          last_error: string | null
          next_attempt_at: string
          requested_at: string
          week_id: string
        }
        Insert: {
          attempts?: number
          basis_version: number
          completed_at?: string | null
          last_error?: string | null
          next_attempt_at?: string
          requested_at?: string
          week_id: string
        }
        Update: {
          attempts?: number
          basis_version?: number
          completed_at?: string | null
          last_error?: string | null
          next_attempt_at?: string
          requested_at?: string
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nexo_backup_capture_queue_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      nexo_backup_chunks: {
        Row: {
          payload: string
          sha256: string
          worksite_id: string
        }
        Insert: {
          payload: string
          sha256: string
          worksite_id: string
        }
        Update: {
          payload?: string
          sha256?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nexo_backup_chunks_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      nexo_backup_devices: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          worksite_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name: string
          revoked_at?: string | null
          token_hash: string
          worksite_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string | null
          name?: string
          revoked_at?: string | null
          token_hash?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nexo_backup_devices_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      nexo_backup_job_chunks: {
        Row: {
          job_id: string
          sha256: string
          worksite_id: string
        }
        Insert: {
          job_id: string
          sha256: string
          worksite_id: string
        }
        Update: {
          job_id?: string
          sha256?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nexo_backup_job_chunks_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "nexo_backup_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nexo_backup_job_chunks_worksite_id_sha256_fkey"
            columns: ["worksite_id", "sha256"]
            isOneToOne: false
            referencedRelation: "nexo_backup_chunks"
            referencedColumns: ["worksite_id", "sha256"]
          },
        ]
      }
      nexo_backup_jobs: {
        Row: {
          basis_version: number
          captured_at: string
          delivered_at: string | null
          delivered_device: string | null
          id: string
          manifest: string
          manifest_sha256: string
          week_id: string | null
          worksite_id: string
        }
        Insert: {
          basis_version: number
          captured_at?: string
          delivered_at?: string | null
          delivered_device?: string | null
          id?: string
          manifest: string
          manifest_sha256: string
          week_id?: string | null
          worksite_id: string
        }
        Update: {
          basis_version?: number
          captured_at?: string
          delivered_at?: string | null
          delivered_device?: string | null
          id?: string
          manifest?: string
          manifest_sha256?: string
          week_id?: string | null
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nexo_backup_jobs_delivered_device_fkey"
            columns: ["delivered_device"]
            isOneToOne: false
            referencedRelation: "nexo_backup_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nexo_backup_jobs_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nexo_backup_jobs_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_archive_rows: {
        Row: {
          archive_id: string
          archived_at: string
          id: number
          payload: Json
          record_date: string
          source_id: string
          source_type: string
          worksite_id: string
        }
        Insert: {
          archive_id: string
          archived_at?: string
          id?: number
          payload: Json
          record_date: string
          source_id: string
          source_type: string
          worksite_id: string
        }
        Update: {
          archive_id?: string
          archived_at?: string
          id?: number
          payload?: Json
          record_date?: string
          source_id?: string
          source_type?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_archive_rows_archive_id_fkey"
            columns: ["archive_id"]
            isOneToOne: false
            referencedRelation: "operational_archives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_archive_rows_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_archives: {
        Row: {
          cutoff_date: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          overtime_count: number
          prepared_at: string
          prepared_by: string | null
          scale_change_count: number
          status: string
          worksite_id: string
        }
        Insert: {
          cutoff_date: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          overtime_count?: number
          prepared_at?: string
          prepared_by?: string | null
          scale_change_count?: number
          status?: string
          worksite_id: string
        }
        Update: {
          cutoff_date?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          overtime_count?: number
          prepared_at?: string
          prepared_by?: string | null
          scale_change_count?: number
          status?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operational_archives_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      overtime_pt_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_by_name: string | null
          id: string
          new_pt: string | null
          previous_pt: string | null
          request_id: string
          worksite_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          new_pt?: string | null
          previous_pt?: string | null
          request_id: string
          worksite_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_by_name?: string | null
          id?: string
          new_pt?: string | null
          previous_pt?: string | null
          request_id?: string
          worksite_id?: string
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
          pt_number: string | null
          pt_updated_at: string | null
          pt_updated_by: string | null
          pt_updated_by_name: string | null
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
          worksite_id: string
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
          pt_number?: string | null
          pt_updated_at?: string | null
          pt_updated_by?: string | null
          pt_updated_by_name?: string | null
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
          worksite_id?: string
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
          pt_number?: string | null
          pt_updated_at?: string | null
          pt_updated_by?: string | null
          pt_updated_by_name?: string | null
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
          worksite_id?: string
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
          {
            foreignKeyName: "overtime_requests_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_audit: {
        Row: {
          actor_id: string
          actor_name: string | null
          event: string
          happened_at: string
          id: string
          reset_id: string
          user_id: string
        }
        Insert: {
          actor_id: string
          actor_name?: string | null
          event: string
          happened_at?: string
          id?: string
          reset_id: string
          user_id: string
        }
        Update: {
          actor_id?: string
          actor_name?: string | null
          event?: string
          happened_at?: string
          id?: string
          reset_id?: string
          user_id?: string
        }
        Relationships: []
      }
      password_reset_write_proofs: {
        Row: {
          reset_id: string
          transaction_id: number
          user_id: string
        }
        Insert: {
          reset_id: string
          transaction_id: number
          user_id: string
        }
        Update: {
          reset_id?: string
          transaction_id?: number
          user_id?: string
        }
        Relationships: []
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
          worksite_id: string
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
          worksite_id?: string
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
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_confirmation_imports: {
        Row: {
          id: string
          imported_at: string
          imported_by: string | null
          imported_by_email: string | null
          imported_by_name: string | null
          row_count: number
          source_file_name: string
          source_label: string | null
          week_id: string
          worksite_id: string
        }
        Insert: {
          id?: string
          imported_at?: string
          imported_by?: string | null
          imported_by_email?: string | null
          imported_by_name?: string | null
          row_count?: number
          source_file_name: string
          source_label?: string | null
          week_id: string
          worksite_id: string
        }
        Update: {
          id?: string
          imported_at?: string
          imported_by?: string | null
          imported_by_email?: string | null
          imported_by_name?: string | null
          row_count?: number
          source_file_name?: string
          source_label?: string | null
          week_id?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sap_confirmation_imports_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sap_confirmation_imports_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_confirmation_rows: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          actual_work: number | null
          confirmation: string
          created_at: string
          description: string | null
          has_confirmation: boolean | null
          id: string
          import_id: string
          normal_duration: number | null
          operation: string | null
          operational_area: string | null
          order_number: string
          planned_work: number | null
          planning_code: string | null
          source_row_number: number
          suboperation: string | null
          system_status: string | null
          user_status: string | null
          week_id: string
          work_center: string | null
          worksite_id: string
        }
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          actual_work?: number | null
          confirmation: string
          created_at?: string
          description?: string | null
          has_confirmation?: boolean | null
          id?: string
          import_id: string
          normal_duration?: number | null
          operation?: string | null
          operational_area?: string | null
          order_number: string
          planned_work?: number | null
          planning_code?: string | null
          source_row_number: number
          suboperation?: string | null
          system_status?: string | null
          user_status?: string | null
          week_id: string
          work_center?: string | null
          worksite_id: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          actual_work?: number | null
          confirmation?: string
          created_at?: string
          description?: string | null
          has_confirmation?: boolean | null
          id?: string
          import_id?: string
          normal_duration?: number | null
          operation?: string | null
          operational_area?: string | null
          order_number?: string
          planned_work?: number | null
          planning_code?: string | null
          source_row_number?: number
          suboperation?: string | null
          system_status?: string | null
          user_status?: string | null
          week_id?: string
          work_center?: string | null
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sap_confirmation_rows_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "sap_confirmation_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sap_confirmation_rows_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sap_confirmation_rows_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      sap_week_closure_history: {
        Row: {
          action: string
          changed_at: string
          changed_by: string
          changed_by_email: string | null
          changed_by_name: string | null
          id: string
          new_deadline: string | null
          previous_deadline: string | null
          reason: string
          week_id: string
          worksite_id: string
        }
        Insert: {
          action: string
          changed_at?: string
          changed_by: string
          changed_by_email?: string | null
          changed_by_name?: string | null
          id?: string
          new_deadline?: string | null
          previous_deadline?: string | null
          reason: string
          week_id: string
          worksite_id: string
        }
        Update: {
          action?: string
          changed_at?: string
          changed_by?: string
          changed_by_email?: string | null
          changed_by_name?: string | null
          id?: string
          new_deadline?: string | null
          previous_deadline?: string | null
          reason?: string
          week_id?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sap_week_closure_history_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sap_week_closure_history_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
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
          worksite_id: string
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
          worksite_id?: string
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
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_transport_batches_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
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
          worksite_id: string
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
          worksite_id?: string
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
          worksite_id?: string
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
          {
            foreignKeyName: "scheduled_transport_requests_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
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
          worksite_id: string
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
          worksite_id?: string
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
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sharepoint_config_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
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
          worksite_id: string | null
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
          worksite_id?: string | null
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
          worksite_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_jobs_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
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
      weekly_capacity_journey: {
        Row: {
          days: Json
          updated_at: string
          updated_by: string
          version: number
          week_id: string
        }
        Insert: {
          days: Json
          updated_at?: string
          updated_by?: string
          version?: number
          week_id: string
        }
        Update: {
          days?: Json
          updated_at?: string
          updated_by?: string
          version?: number
          week_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_capacity_journey_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: true
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_capacity_journey_history: {
        Row: {
          days: Json
          id: string
          updated_at: string
          updated_by: string
          updated_by_name: string | null
          version: number
          week_id: string
        }
        Insert: {
          days: Json
          id?: string
          updated_at: string
          updated_by: string
          updated_by_name?: string | null
          version: number
          week_id: string
        }
        Update: {
          days?: Json
          id?: string
          updated_at?: string
          updated_by?: string
          updated_by_name?: string | null
          version?: number
          week_id?: string
        }
        Relationships: []
      }
      weekly_rs_availability: {
        Row: {
          rows: Json
          source_file_name: string | null
          updated_at: string
          updated_by: string
          version: number
          week_id: string
          worksite_id: string
        }
        Insert: {
          rows: Json
          source_file_name?: string | null
          updated_at?: string
          updated_by: string
          version?: number
          week_id: string
          worksite_id: string
        }
        Update: {
          rows?: Json
          source_file_name?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
          week_id?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rs_availability_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: true
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_rs_availability_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_rs_availability_history: {
        Row: {
          rows: Json
          source_file_name: string | null
          updated_at: string
          updated_by: string
          version: number
          week_id: string
          worksite_id: string
        }
        Insert: {
          rows: Json
          source_file_name?: string | null
          updated_at?: string
          updated_by: string
          version: number
          week_id: string
          worksite_id: string
        }
        Update: {
          rows?: Json
          source_file_name?: string | null
          updated_at?: string
          updated_by?: string
          version?: number
          week_id?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rs_availability_history_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_rs_availability_history_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_rs_closure_items: {
        Row: {
          closure_id: string
          evidence: Json | null
          id: number
          kind: string
          local: string | null
          payload: Json
          record_date: string | null
          source_id: string
        }
        Insert: {
          closure_id: string
          evidence?: Json | null
          id?: never
          kind: string
          local?: string | null
          payload: Json
          record_date?: string | null
          source_id: string
        }
        Update: {
          closure_id?: string
          evidence?: Json | null
          id?: never
          kind?: string
          local?: string | null
          payload?: Json
          record_date?: string | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rs_closure_items_closure_id_fkey"
            columns: ["closure_id"]
            isOneToOne: false
            referencedRelation: "weekly_rs_closures"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_rs_closure_scopes: {
        Row: {
          closure_id: string
          data: Json
          scope: string
        }
        Insert: {
          closure_id: string
          data: Json
          scope: string
        }
        Update: {
          closure_id?: string
          data?: Json
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rs_closure_scopes_closure_id_fkey"
            columns: ["closure_id"]
            isOneToOne: false
            referencedRelation: "weekly_rs_closures"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_rs_closures: {
        Row: {
          closed_at: string
          closed_by: string
          closed_by_name: string
          id: string
          reason: string
          rule_version: string
          rules: Json
          summary: Json
          version: number
          week_id: string
          week_info: Json
          worksite_id: string
        }
        Insert: {
          closed_at?: string
          closed_by: string
          closed_by_name: string
          id?: string
          reason: string
          rule_version: string
          rules: Json
          summary: Json
          version: number
          week_id: string
          week_info: Json
          worksite_id: string
        }
        Update: {
          closed_at?: string
          closed_by?: string
          closed_by_name?: string
          id?: string
          reason?: string
          rule_version?: string
          rules?: Json
          summary?: Json
          version?: number
          week_id?: string
          week_info?: Json
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rs_closures_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_rs_closures_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_rs_program_base_history: {
        Row: {
          row_count: number
          rows: Json
          sheet_name: string
          source_file_name: string
          total_work: number
          updated_at: string
          updated_by: string
          updated_by_name: string
          version: number
          week_id: string
          worksite_id: string
        }
        Insert: {
          row_count: number
          rows: Json
          sheet_name: string
          source_file_name: string
          total_work: number
          updated_at?: string
          updated_by: string
          updated_by_name: string
          version: number
          week_id: string
          worksite_id: string
        }
        Update: {
          row_count?: number
          rows?: Json
          sheet_name?: string
          source_file_name?: string
          total_work?: number
          updated_at?: string
          updated_by?: string
          updated_by_name?: string
          version?: number
          week_id?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rs_program_base_history_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: false
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_rs_program_bases: {
        Row: {
          row_count: number
          rows: Json
          sheet_name: string
          source_file_name: string
          total_work: number
          updated_at: string
          updated_by: string
          updated_by_name: string
          version: number
          week_id: string
          worksite_id: string
        }
        Insert: {
          row_count: number
          rows: Json
          sheet_name: string
          source_file_name: string
          total_work: number
          updated_at?: string
          updated_by: string
          updated_by_name: string
          version: number
          week_id: string
          worksite_id: string
        }
        Update: {
          row_count?: number
          rows?: Json
          sheet_name?: string
          source_file_name?: string
          total_work?: number
          updated_at?: string
          updated_by?: string
          updated_by_name?: string
          version?: number
          week_id?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_rs_program_bases_week_id_fkey"
            columns: ["week_id"]
            isOneToOne: true
            referencedRelation: "weeks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_rs_program_bases_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      weeks: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          closed_at: string | null
          code: string
          created_at: string
          end_date: string
          id: string
          imported_at: string | null
          imported_by: string | null
          is_active: boolean
          label: string
          lifecycle_status: string
          sap_closed_at: string | null
          sap_closed_by: string | null
          sap_closure_deadline: string | null
          sap_closure_status: string
          sharepoint_item_id: string | null
          sheet_name: string | null
          source_file_name: string | null
          start_date: string
          worksite_id: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          closed_at?: string | null
          code: string
          created_at?: string
          end_date: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          is_active?: boolean
          label: string
          lifecycle_status?: string
          sap_closed_at?: string | null
          sap_closed_by?: string | null
          sap_closure_deadline?: string | null
          sap_closure_status?: string
          sharepoint_item_id?: string | null
          sheet_name?: string | null
          source_file_name?: string | null
          start_date: string
          worksite_id?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          closed_at?: string | null
          code?: string
          created_at?: string
          end_date?: string
          id?: string
          imported_at?: string | null
          imported_by?: string | null
          is_active?: boolean
          label?: string
          lifecycle_status?: string
          sap_closed_at?: string | null
          sap_closed_by?: string | null
          sap_closure_deadline?: string | null
          sap_closure_status?: string
          sharepoint_item_id?: string | null
          sheet_name?: string | null
          source_file_name?: string | null
          start_date?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "weeks_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      worksite_holidays: {
        Row: {
          created_at: string
          holiday_date: string
          name: string
          worksite_id: string
        }
        Insert: {
          created_at?: string
          holiday_date: string
          name: string
          worksite_id: string
        }
        Update: {
          created_at?: string
          holiday_date?: string
          name?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worksite_holidays_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      worksite_memberships: {
        Row: {
          created_at: string
          granted_by: string | null
          is_worksite_admin: boolean
          updated_at: string
          user_id: string
          worksite_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          is_worksite_admin?: boolean
          updated_at?: string
          user_id: string
          worksite_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          is_worksite_admin?: boolean
          updated_at?: string
          user_id?: string
          worksite_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worksite_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worksite_memberships_worksite_id_fkey"
            columns: ["worksite_id"]
            isOneToOne: false
            referencedRelation: "worksites"
            referencedColumns: ["id"]
          },
        ]
      }
      worksites: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      password_reset_latest: {
        Row: {
          actor_name: string | null
          event: string | null
          happened_at: string | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_operational_week: {
        Args: { p_week_id: string }
        Returns: undefined
      }
      activity_sap_earned: {
        Args: { p_week_id: string }
        Returns: {
          activity_id: string
          earned: number
          has_source: boolean
          planned: number
          progress_date: string
        }[]
      }
      assert_sap_closure_admin: {
        Args: { p_week_id: string }
        Returns: {
          activated_at: string | null
          activated_by: string | null
          closed_at: string | null
          code: string
          created_at: string
          end_date: string
          id: string
          imported_at: string | null
          imported_by: string | null
          is_active: boolean
          label: string
          lifecycle_status: string
          sap_closed_at: string | null
          sap_closed_by: string | null
          sap_closure_deadline: string | null
          sap_closure_status: string
          sharepoint_item_id: string | null
          sheet_name: string | null
          source_file_name: string | null
          start_date: string
          worksite_id: string
        }
        SetofOptions: {
          from: "*"
          to: "weeks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      brazil_easter_date: { Args: { p_year: number }; Returns: string }
      bulk_update_activity_planning_fields: {
        Args: { p_rows: Json }
        Returns: number
      }
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
      bulk_update_activity_reports_v2: {
        Args: {
          p_justification: string
          p_linked_ids?: string[]
          p_observation: string
          p_rows: Json
          p_status: string
        }
        Returns: number
      }
      can_access_sap: { Args: { _user_id: string }; Returns: boolean }
      can_access_worksite: {
        Args: { _user_id: string; _worksite_id: string }
        Returns: boolean
      }
      can_admin_worksite: {
        Args: { _user_id: string; _worksite_id: string }
        Returns: boolean
      }
      can_manage_scheduled_transport: {
        Args: { _user_id: string }
        Returns: boolean
      }
      can_view_activity_sap: { Args: { _user_id: string }; Returns: boolean }
      capture_nexo_backup: {
        Args: { p_version: number; p_week: string }
        Returns: string
      }
      capture_weekly_rs_closure: {
        Args: { p_reason: string; p_week_id: string }
        Returns: string
      }
      close_sap_week: {
        Args: { p_reason: string; p_week_id: string }
        Returns: undefined
      }
      complete_overtime_pt: {
        Args: {
          p_apply_batch?: boolean
          p_expected_version: number
          p_id: string
          p_pt: string
        }
        Returns: Json
      }
      continuous_activity_facets: {
        Args: {
          p_filters?: Json
          p_from?: string
          p_search?: string
          p_to?: string
          p_worksite: string
        }
        Returns: Json
      }
      continuous_activity_options: {
        Args: { p_worksite: string }
        Returns: Json
      }
      continuous_activity_status_counts: {
        Args: {
          p_filters?: Json
          p_from?: string
          p_search?: string
          p_to?: string
          p_worksite: string
        }
        Returns: Json
      }
      continuous_filter_matches: {
        Args: { p_data: Json; p_exclude?: string; p_filters: Json }
        Returns: boolean
      }
      current_role_label: { Args: { _user_id: string }; Returns: string }
      current_worksite_id: { Args: { _user_id: string }; Returns: string }
      decide_overtime_batch: {
        Args: {
          p_comment?: string
          p_decision: string
          p_expected_version: number
          p_request_id: string
          p_snapshot: Json
        }
        Returns: Json
      }
      extend_sap_week_deadline: {
        Args: { p_deadline: string; p_reason: string; p_week_id: string }
        Returns: undefined
      }
      finalize_operational_archive: {
        Args: { _archive_id: string }
        Returns: {
          overtime_deleted: number
          scale_change_deleted: number
        }[]
      }
      get_activities_page: {
        Args: {
          p_filters?: Json
          p_page?: number
          p_page_size?: number
          p_week_id: string
        }
        Returns: Json
      }
      get_activity_daily_capacity: {
        Args: { p_week_id: string }
        Returns: Json
      }
      get_activity_sap_progress: { Args: { p_week_id: string }; Returns: Json }
      get_monthly_rs_weeks: {
        Args: { p_local?: string; p_week_ids: string[]; p_worksite_id: string }
        Returns: Json
      }
      get_nexo_backup_status: { Args: { p_worksite: string }; Returns: Json }
      get_overtime_export_metadata: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_departure_time?: string
          p_employee_search?: string
          p_entry_time?: string
          p_transport?: string
          p_worksite_id: string
        }
        Returns: Json
      }
      get_overtime_export_metadata_pt: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_departure_time?: string
          p_employee_search?: string
          p_entry_time?: string
          p_pt_search?: string
          p_transport?: string
          p_worksite_id: string
        }
        Returns: Json
      }
      get_overtime_export_pt_options: {
        Args: {
          p_date_from?: string
          p_date_to?: string
          p_departure_time?: string
          p_employee_search?: string
          p_entry_time?: string
          p_pt_number?: string
          p_pt_search?: string
          p_transport?: string
          p_worksite_id: string
        }
        Returns: Json
      }
      get_rs_center_immediate_tasks: {
        Args: {
          p_center: string
          p_limit?: number
          p_local?: string
          p_offset?: number
          p_sources: Json
        }
        Returns: Json
      }
      get_rs_center_pending_tasks: {
        Args: {
          p_center: string
          p_limit?: number
          p_local?: string
          p_offset?: number
          p_sources: Json
        }
        Returns: Json
      }
      get_sap_confirmation_overview: {
        Args: { p_week_id: string }
        Returns: Json
      }
      get_sap_outside_schedule: { Args: { p_week_id: string }; Returns: Json }
      get_scheduled_transport_metadata: {
        Args: {
          p_date_from: string
          p_date_to?: string
          p_departure_time?: string
          p_entry_time?: string
          p_job_title?: string
          p_search?: string
          p_status?: string
          p_transport?: string
          p_worksite_id: string
        }
        Returns: Json
      }
      get_weekly_realization: { Args: { p_week_id: string }; Returns: Json }
      get_weekly_rs_analysis: {
        Args: { p_local?: string; p_week_id: string }
        Returns: Json
      }
      get_weekly_rs_availability_changes: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_version: number
          p_week_id: string
        }
        Returns: Json
      }
      get_weekly_rs_closure_items: {
        Args: {
          p_closure_id: string
          p_kind: string
          p_limit?: number
          p_offset?: number
        }
        Returns: Json
      }
      get_weekly_rs_closure_pending: {
        Args: {
          p_closure_id: string
          p_include_monitoring?: boolean
          p_justification?: string
          p_limit?: number
          p_local?: string
          p_offset?: number
          p_only_missing_justification?: boolean
          p_query?: string
        }
        Returns: Json
      }
      get_weekly_rs_official_analysis: {
        Args: { p_local?: string; p_week_id: string }
        Returns: Json
      }
      get_weekly_rs_pending: {
        Args: {
          p_include_monitoring?: boolean
          p_justification?: string
          p_limit?: number
          p_local?: string
          p_offset?: number
          p_only_missing_justification?: boolean
          p_query?: string
          p_week_id: string
        }
        Returns: Json
      }
      get_weekly_rs_report: {
        Args: { p_local?: string; p_version?: number; p_week_id: string }
        Returns: Json
      }
      get_weekly_sap_load_rows: {
        Args: { p_import_id: string; p_limit?: number; p_offset?: number }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_worksite_membership: {
        Args: { _user_id: string; _worksite_id: string }
        Returns: boolean
      }
      import_continuous_activities: {
        Args: { p_rows: Json; p_worksite: string }
        Returns: Json
      }
      import_sap_confirmations: {
        Args: { p_rows: Json; p_source_file_name: string; p_week_id: string }
        Returns: Json
      }
      is_approved: { Args: { _user_id: string }; Returns: boolean }
      is_global_admin: { Args: { _user_id: string }; Returns: boolean }
      is_scale_non_working_day: {
        Args: { p_date: string; p_worksite_id: string }
        Returns: boolean
      }
      list_weekly_rs_availability_history: {
        Args: { p_before_version?: number; p_limit?: number; p_week_id: string }
        Returns: Json
      }
      list_weekly_rs_closures: { Args: { p_week_id: string }; Returns: Json }
      list_weekly_sap_loads: {
        Args: { p_limit?: number; p_offset?: number; p_week_id: string }
        Returns: Json
      }
      nexo_backup_ack: {
        Args: { p_job: string; p_manifest_sha256: string; p_token: string }
        Returns: boolean
      }
      nexo_backup_chunk: {
        Args: { p_job: string; p_sha256: string; p_token: string }
        Returns: Json
      }
      nexo_backup_device: {
        Args: { p_token: string }
        Returns: {
          created_at: string
          id: string
          last_seen_at: string | null
          name: string
          revoked_at: string | null
          token_hash: string
          worksite_id: string
        }
        SetofOptions: {
          from: "*"
          to: "nexo_backup_devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      nexo_backup_poll: { Args: { p_token: string }; Returns: Json }
      normalize_sap_identifier: { Args: { value: string }; Returns: string }
      operational_history_cutoff: {
        Args: { _reference_date?: string }
        Returns: string
      }
      password_access_allowed: { Args: never; Returns: boolean }
      password_reset_state: { Args: never; Returns: Json }
      patch_activity_planning_fields: { Args: { p_rows: Json }; Returns: Json }
      prepare_operational_archive: {
        Args: { _cutoff_date?: string; _worksite_id: string }
        Returns: {
          archive_id: string
          overtime_count: number
          scale_change_count: number
        }[]
      }
      process_nexo_backup_queue: { Args: never; Returns: undefined }
      reopen_sap_week: {
        Args: { p_reason: string; p_week_id: string }
        Returns: undefined
      }
      rs_archive_calculation: {
        Args: { d: Json; selected_local?: string }
        Returns: Json
      }
      rs_archive_key: { Args: { value: string }; Returns: string }
      rs_center_local: {
        Args: { p_center: string; p_fallback: string }
        Returns: string
      }
      rs_external_sap_counts: {
        Args: { p_code: string; p_local: string; p_worksite: string }
        Returns: boolean
      }
      rs_program_center: { Args: { p_center: string }; Returns: string }
      save_activity_page_config: {
        Args: {
          p_fields: Json
          p_statuses: Json
          p_version: number
          p_worksite: string
        }
        Returns: undefined
      }
      save_continuous_activity: {
        Args: {
          p_data: Json
          p_id?: string
          p_key: string
          p_version?: number
          p_worksite: string
        }
        Returns: Json
      }
      save_weekly_rs_availability: {
        Args: {
          p_expected_version?: number
          p_rows: Json
          p_source_file_name?: string
          p_week_id: string
        }
        Returns: undefined
      }
      save_weekly_rs_program_base: {
        Args: {
          p_expected_version?: number
          p_rows: Json
          p_sheet_name?: string
          p_source_file_name: string
          p_week_id: string
        }
        Returns: Json
      }
      sync_overtime_from_scale_row: {
        Args: {
          p_scale: Database["public"]["Tables"]["scheduled_transport_requests"]["Row"]
        }
        Returns: undefined
      }
      weekly_rs_activity_evidence: {
        Args: { p_week_id: string }
        Returns: {
          center: string
          confirmation: string
          description: string
          id: string
          included_in_rs: boolean
          justification: string
          local: string
          observation: string
          operation: string
          order_number: string
          planned_hh: number
          sap_state: string
          scheduled_date: string
          specialty: string
          status: string
          suboperation: string
        }[]
      }
      weekly_rs_included: {
        Args: { p_center: string; p_specialty: string }
        Returns: boolean
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
        | "operation"
      approval_status: "pending" | "approved" | "blocked"
      change_source:
        | "individual"
        | "bulk"
        | "import"
        | "sync"
        | "planning"
        | "operation"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
        "operation",
      ],
      approval_status: ["pending", "approved", "blocked"],
      change_source: [
        "individual",
        "bulk",
        "import",
        "sync",
        "planning",
        "operation",
      ],
      sync_status: ["synced", "pending", "error"],
    },
  },
} as const
