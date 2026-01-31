-- 누락된 모든 컬럼 추가 마이그레이션
-- Supabase SQL Editor에서 실행하세요

-- =============================================
-- 1. news_issues 테이블 컬럼 추가
-- =============================================
ALTER TABLE news_issues ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) DEFAULT 'url';
ALTER TABLE news_issues ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- =============================================
-- 2. news_pages 테이블 컬럼 추가
-- =============================================
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS file_hash VARCHAR(64);
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS local_path TEXT;
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS ocr_text TEXT;
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS ocr_provider VARCHAR(20);
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE news_pages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- =============================================
-- 3. news_articles 테이블 컬럼 추가
-- =============================================
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS article_type VARCHAR(50);
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS speaker VARCHAR(100);
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS event_name VARCHAR(200);
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS event_date VARCHAR(100);
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS bible_references TEXT[];
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS keywords TEXT[];
ALTER TABLE news_articles ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- =============================================
-- 4. news_chunks 테이블 컬럼 추가
-- =============================================
ALTER TABLE news_chunks ADD COLUMN IF NOT EXISTS issue_number INTEGER;
ALTER TABLE news_chunks ADD COLUMN IF NOT EXISTS issue_date VARCHAR(20);
ALTER TABLE news_chunks ADD COLUMN IF NOT EXISTS page_number INTEGER;
ALTER TABLE news_chunks ADD COLUMN IF NOT EXISTS article_title TEXT;
ALTER TABLE news_chunks ADD COLUMN IF NOT EXISTS article_type VARCHAR(50);
ALTER TABLE news_chunks ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- =============================================
-- 5. 인덱스 생성
-- =============================================
CREATE INDEX IF NOT EXISTS idx_news_issues_year_month ON news_issues(year, month);
CREATE INDEX IF NOT EXISTS idx_news_issues_status ON news_issues(status);
CREATE INDEX IF NOT EXISTS idx_news_pages_issue_id ON news_pages(issue_id);
CREATE INDEX IF NOT EXISTS idx_news_pages_status ON news_pages(status);
CREATE INDEX IF NOT EXISTS idx_news_articles_issue_id ON news_articles(issue_id);
CREATE INDEX IF NOT EXISTS idx_news_chunks_article_id ON news_chunks(article_id);
CREATE INDEX IF NOT EXISTS idx_news_chunks_issue_id ON news_chunks(issue_id);

-- =============================================
-- 6. 확인
-- =============================================
SELECT 'news_issues 컬럼:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'news_issues' ORDER BY ordinal_position;

SELECT 'news_pages 컬럼:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'news_pages' ORDER BY ordinal_position;

SELECT 'news_articles 컬럼:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'news_articles' ORDER BY ordinal_position;

SELECT 'news_chunks 컬럼:' as info;
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'news_chunks' ORDER BY ordinal_position;
