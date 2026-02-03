-- 관리자 설정 테이블
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_admin_settings_updated_at ON admin_settings(updated_at);

-- 기본 voice 설정 (옵션)
-- INSERT INTO admin_settings (key, value)
-- VALUES ('voice_settings', '{"voice_id": "", "provider": "elevenlabs", "updated_at": "2026-02-04T00:00:00Z"}')
-- ON CONFLICT (key) DO NOTHING;
