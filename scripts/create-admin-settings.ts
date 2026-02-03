/**
 * admin_settings 테이블 생성
 */
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function createAdminSettingsTable() {
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `
      -- 관리자 설정 테이블
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- 인덱스
      CREATE INDEX IF NOT EXISTS idx_admin_settings_updated_at ON admin_settings(updated_at);
    `
  })

  if (error) {
    console.error('Error creating table:', error)
    // Try direct SQL if RPC fails
    console.log('Trying direct table creation...')
    
    const { error: createError } = await supabase
      .from('admin_settings')
      .select('*')
      .limit(1)
    
    if (createError) {
      console.log('Table does not exist. Please run the SQL migration manually:')
      console.log(`
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_settings_updated_at ON admin_settings(updated_at);
      `)
    } else {
      console.log('Table already exists!')
    }
  } else {
    console.log('Table created successfully!')
  }
}

createAdminSettingsTable()
