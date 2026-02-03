#!/bin/bash

# Supabase admin_settings 테이블 생성 스크립트

cat << 'EOF'

===========================================
Supabase SQL Editor에서 다음 SQL을 실행하세요:
===========================================

-- 관리자 설정 테이블
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_admin_settings_updated_at ON admin_settings(updated_at);

-- Voice 설정 초기화 (선택사항)
INSERT INTO admin_settings (key, value, updated_at)
VALUES (
  'voice_settings',
  '{"voice_id": "9VYyUj7Y2oHpf8c7oJtZ", "provider": "elevenlabs", "updated_at": "2026-02-04T00:00:00Z"}'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;

===========================================

EOF
