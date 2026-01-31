-- API Keys 테이블 생성
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider VARCHAR(50) UNIQUE NOT NULL,
  key TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider);
CREATE INDEX IF NOT EXISTS idx_api_keys_priority ON api_keys(priority);

-- RLS 정책 (서비스 역할만 접근 가능)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- 서비스 역할은 모든 작업 허용
CREATE POLICY "Service role can do everything" ON api_keys
  FOR ALL
  USING (auth.role() = 'service_role');

-- 주석
COMMENT ON TABLE api_keys IS 'AI Provider API 키 저장 (암호화됨)';
COMMENT ON COLUMN api_keys.provider IS 'openai, anthropic, google, perplexity, youtube';
COMMENT ON COLUMN api_keys.key IS 'Base64 암호화된 API 키';
COMMENT ON COLUMN api_keys.is_active IS '활성화 여부';
COMMENT ON COLUMN api_keys.priority IS '우선순위 (낮을수록 먼저)';
