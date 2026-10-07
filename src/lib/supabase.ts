import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://iqnuisneqsgtdusiiyvx.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxbnVpc25lcXNndGR1c2lpeXZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzOTMyODAsImV4cCI6MjEwMzk2OTI4MH0.zWJsrzkWDLmq1wpSUSRzgIPCIyBte2rsBcXtDA4vG8I';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type AccountProfile = {
  id: string;
  profile_code: string;
  name: string;
  partner_id: string;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  master_password?: string | null;
  controlled_email_id?: string | null;
  controlled_emails?: { email: string } | null;
  status: 'active' | 'suspended' | 'banned';
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type Account = {
  id: string;
  account_code: string;
  platform: 'tiktok' | 'youtube' | 'facebook' | 'instagram';
  username: string;
  partner_id?: string;
  profile_id?: string | null;
  controlled_email_id?: string | null;
  controlled_emails?: { email: string; password_encrypted?: string | null } | null;
  password_encrypted?: string | null;
  google_email?: string | null;
  google_password_encrypted?: string | null;
  birth_date?: string | null;
  status: 'active' | 'pending' | 'suspended' | 'banned';
  profile_url: string | null;
  created_at: string;
};

export type AccountMetrics = {
  id: string;
  account_id: string;
  followers: number;
  following: number;
  likes: number;
  views: number;
  videos_count: number;
  subscribers: number;
  profile_name: string | null;
  profile_image: string | null;
};

export type Video = {
  id: string;
  video_code: string;
  filename: string;
  storage_url: string;
  file_size: number | null;
  duration: number | null;
  thumbnail_url: string | null;
};

export type Job = {
  id: string;
  job_code: string;
  video_id: string;
  account_id: string;
  partner_id: string;
  profile_id?: string | null;
  title?: string | null;
  caption: string | null;
  hashtags: string[];
  status: 'pending' | 'downloaded' | 'published' | 'failed' | 'trigger_publish' | 'publishing';
  scheduled_for: string | null;
  downloaded_at: string | null;
  published_at: string | null;
  fail_reason: string | null;
  videos: Video;
  accounts: Account;
};

export type PaymentMethod = {
  id: string;
  partner_id: string;
  method_type: 'pix' | 'crypto' | 'redotpay' | 'paypal';
  pix_key_type: string | null;
  pix_key: string | null;
  pix_holder_name: string | null;
  crypto_network: string | null;
  crypto_coin: string | null;
  crypto_address: string | null;
  redotpay_id: string | null;
  redotpay_email: string | null;
  paypal_email: string | null;
  is_active: boolean;
};

export type PartnerPermission = {
  id: string;
  partner_id: string;
  platform: 'tiktok' | 'youtube' | 'facebook' | 'instagram';
  permission_key: string;
  is_allowed: boolean;
};

export type CodeRequest = {
  id: string;
  request_code: string;
  partner_id: string;
  account_id: string;
  request_type: 'totp' | 'email_verification';
  status: 'pending' | 'responded' | 'denied' | 'expired';
  code_value: string | null;
  created_at: string;
};

export type ControlledEmail = {
  id: string;
  email: string;
  password?: string | null;
  password_encrypted: string;
  account_name?: string | null;
  status: 'available' | 'assigned' | 'blocked';
  assigned_to: string | null;
  assigned_at: string | null;
  notes: string | null;
  created_at: string;
};
