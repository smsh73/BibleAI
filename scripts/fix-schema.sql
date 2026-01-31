-- 누락된 컬럼 추가 마이그레이션
-- Supabase SQL Editor에서 실행하세요

-- 1. news_issues 테이블에 source_type 컬럼 추가
ALTER TABLE news_issues
ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'url';

-- 2. news_issues 테이블에 updated_at 컬럼 추가 (없을 경우)
ALTER TABLE news_issues
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. 확인
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'news_issues'
ORDER BY ordinal_position;
