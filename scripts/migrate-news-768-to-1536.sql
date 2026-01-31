-- =============================================
-- News Embeddings Migration: 768 -> 1536 dimensions
-- Execute in Supabase SQL Editor
--
-- 실행 전 주의사항:
-- 1. 반드시 데이터 백업 후 실행
-- 2. 마이그레이션 후 재임베딩 스크립트 실행 필요
-- =============================================

-- Step 1: 백업 생성 (선택사항 - 데이터가 많으면 시간이 오래 걸림)
-- CREATE TABLE IF NOT EXISTS news_chunks_backup_768 AS
-- SELECT * FROM news_chunks;

-- Step 2: 기존 함수 삭제 (vector(768) 타입에 의존)
DROP FUNCTION IF EXISTS hybrid_search_news(vector(768), text, float, int, int, text);

-- Step 3: 기존 벡터 인덱스 삭제
DROP INDEX IF EXISTS idx_news_chunks_embedding;

-- Step 4: 기존 임베딩 데이터 초기화 (768 차원 -> NULL)
-- 중요: 컬럼 타입 변경 전에 먼저 데이터를 NULL로 설정해야 함
UPDATE news_chunks SET embedding = NULL WHERE embedding IS NOT NULL;

-- Step 5: 컬럼 타입 변경 (768 -> 1536)
ALTER TABLE news_chunks
ALTER COLUMN embedding TYPE vector(1536);

-- Step 6: IVFFlat 인덱스 재생성 (1536 차원)
DROP INDEX IF EXISTS idx_news_chunks_embedding;
CREATE INDEX idx_news_chunks_embedding ON news_chunks
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Step 7: 하이브리드 검색 함수 재생성 (1536 차원)
CREATE OR REPLACE FUNCTION hybrid_search_news(
  query_embedding vector(1536),
  query_text text,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  year_filter int DEFAULT NULL,
  article_type_filter text DEFAULT NULL
)
RETURNS TABLE (
  id int,
  article_id int,
  chunk_text text,
  issue_number int,
  issue_date varchar,
  page_number int,
  article_title text,
  article_type varchar,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    nc.id,
    nc.article_id,
    nc.chunk_text,
    nc.issue_number,
    nc.issue_date,
    nc.page_number,
    nc.article_title,
    nc.article_type,
    1 - (nc.embedding <=> query_embedding) as similarity
  FROM news_chunks nc
  JOIN news_issues ni ON nc.issue_id = ni.id
  WHERE
    1 - (nc.embedding <=> query_embedding) > match_threshold
    AND (year_filter IS NULL OR ni.year = year_filter)
    AND (article_type_filter IS NULL OR nc.article_type = article_type_filter)
  ORDER BY nc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Step 8: 마이그레이션 확인 (임베딩은 Step 4에서 이미 NULL로 설정됨)
SELECT
  'news_chunks' as table_name,
  COUNT(*) as total_rows,
  COUNT(embedding) as with_embedding,
  COUNT(*) - COUNT(embedding) as needs_reembedding
FROM news_chunks;

-- =============================================
-- 롤백 스크립트 (문제 발생 시)
-- =============================================
--
-- DROP FUNCTION IF EXISTS hybrid_search_news(vector(1536), text, float, int, int, text);
-- DROP INDEX IF EXISTS idx_news_chunks_embedding;
--
-- ALTER TABLE news_chunks
-- ALTER COLUMN embedding TYPE vector(768);
--
-- -- 백업에서 복원
-- UPDATE news_chunks nc
-- SET embedding = backup.embedding
-- FROM news_chunks_backup_768 backup
-- WHERE nc.id = backup.id;
--
-- CREATE INDEX idx_news_chunks_embedding ON news_chunks
-- USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
--
-- -- 원래 함수 복원 (768 차원)
-- CREATE OR REPLACE FUNCTION hybrid_search_news(
--   query_embedding vector(768), ...
-- ) ...
