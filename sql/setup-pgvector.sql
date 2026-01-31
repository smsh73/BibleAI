-- ============================================
-- BibleAI - pgvector 설정 및 테이블 생성
-- Supabase SQL Editor에서 실행하세요
-- ============================================

-- 1. pgvector 확장 활성화
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 전문 검색을 위한 한글 설정 (Hybrid RAG)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 3. 성경 구절 테이블 (메타데이터 + 임베딩)
CREATE TABLE IF NOT EXISTS bible_verses (
  id SERIAL PRIMARY KEY,

  -- 메타데이터
  testament VARCHAR(10) NOT NULL,        -- 구약/신약
  book_name VARCHAR(50) NOT NULL,        -- 책 이름 (창세기, 마태복음 등)
  book_number INTEGER NOT NULL,          -- 책 번호 (1-66)
  chapter INTEGER NOT NULL,              -- 장
  verse INTEGER NOT NULL,                -- 절

  -- 본문
  content TEXT NOT NULL,                 -- 구절 내용
  reference VARCHAR(100) NOT NULL,       -- 참조 문자열 (예: "창세기 1:1")

  -- 검색용 인덱스 (tsvector)
  content_tsv TSVECTOR,

  -- 벡터 임베딩 (OpenAI text-embedding-3-small: 1536 차원)
  embedding VECTOR(1536),

  -- 타임스탬프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- 유니크 제약조건
  UNIQUE(book_name, chapter, verse)
);

-- 4. 설교 청크 테이블 (설교 스크립트 저장)
CREATE TABLE IF NOT EXISTS sermon_chunks (
  id SERIAL PRIMARY KEY,

  -- 메타데이터
  video_id VARCHAR(50) NOT NULL,         -- YouTube 비디오 ID
  video_title TEXT,                       -- 비디오 제목
  video_url TEXT,                         -- 비디오 URL

  -- 청크 정보
  chunk_index INTEGER NOT NULL,           -- 청크 순서
  start_time FLOAT,                       -- 시작 시간 (초)
  end_time FLOAT,                         -- 종료 시간 (초)

  -- 본문
  content TEXT NOT NULL,                  -- 청크 내용

  -- 검색용 인덱스
  content_tsv TSVECTOR,

  -- 벡터 임베딩
  embedding VECTOR(1536),

  -- 타임스탬프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- 유니크 제약조건
  UNIQUE(video_id, chunk_index)
);

-- 5. 검색 캐시 테이블 (쿼리 결과 캐싱)
CREATE TABLE IF NOT EXISTS search_cache (
  id SERIAL PRIMARY KEY,
  query_hash VARCHAR(64) NOT NULL UNIQUE,
  query_text TEXT NOT NULL,
  results JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '24 hours'
);

-- ============================================
-- 인덱스 생성
-- ============================================

-- 6. 벡터 검색 인덱스 (IVFFlat - 빠른 근사 검색)
-- 성경 구절용 (31,088개 구절이므로 lists = sqrt(31088) ≈ 176)
CREATE INDEX IF NOT EXISTS bible_verses_embedding_idx
  ON bible_verses
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 200);

-- 설교 청크용
CREATE INDEX IF NOT EXISTS sermon_chunks_embedding_idx
  ON sermon_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 7. 전문 검색 인덱스 (GIN)
CREATE INDEX IF NOT EXISTS bible_verses_content_tsv_idx
  ON bible_verses
  USING gin(content_tsv);

CREATE INDEX IF NOT EXISTS sermon_chunks_content_tsv_idx
  ON sermon_chunks
  USING gin(content_tsv);

-- 8. 메타데이터 인덱스
CREATE INDEX IF NOT EXISTS bible_verses_testament_idx ON bible_verses(testament);
CREATE INDEX IF NOT EXISTS bible_verses_book_idx ON bible_verses(book_name);
CREATE INDEX IF NOT EXISTS bible_verses_reference_idx ON bible_verses(reference);
CREATE INDEX IF NOT EXISTS sermon_chunks_video_idx ON sermon_chunks(video_id);

-- 9. 트라이그램 인덱스 (한글 LIKE 검색용)
CREATE INDEX IF NOT EXISTS bible_verses_content_trgm_idx
  ON bible_verses
  USING gin(content gin_trgm_ops);

-- ============================================
-- 트리거 함수
-- ============================================

-- 10. content_tsv 자동 업데이트 함수
CREATE OR REPLACE FUNCTION update_bible_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsv := to_tsvector('simple', NEW.content);
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_sermon_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.content_tsv := to_tsvector('simple', NEW.content);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 11. 트리거 생성
DROP TRIGGER IF EXISTS bible_verses_tsv_trigger ON bible_verses;
CREATE TRIGGER bible_verses_tsv_trigger
  BEFORE INSERT OR UPDATE ON bible_verses
  FOR EACH ROW EXECUTE FUNCTION update_bible_tsv();

DROP TRIGGER IF EXISTS sermon_chunks_tsv_trigger ON sermon_chunks;
CREATE TRIGGER sermon_chunks_tsv_trigger
  BEFORE INSERT OR UPDATE ON sermon_chunks
  FOR EACH ROW EXECUTE FUNCTION update_sermon_tsv();

-- ============================================
-- Hybrid RAG 검색 함수
-- ============================================

-- 12. 하이브리드 검색 함수 (벡터 + 키워드)
CREATE OR REPLACE FUNCTION hybrid_search_bible(
  query_embedding VECTOR(1536),
  query_text TEXT,
  match_count INTEGER DEFAULT 10,
  vector_weight FLOAT DEFAULT 0.7,
  keyword_weight FLOAT DEFAULT 0.3
)
RETURNS TABLE (
  id INTEGER,
  testament VARCHAR,
  book_name VARCHAR,
  chapter INTEGER,
  verse INTEGER,
  content TEXT,
  reference VARCHAR,
  similarity FLOAT,
  keyword_rank FLOAT,
  combined_score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      bv.id,
      1 - (bv.embedding <=> query_embedding) AS vector_similarity
    FROM bible_verses bv
    WHERE bv.embedding IS NOT NULL
    ORDER BY bv.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  keyword_results AS (
    SELECT
      bv.id,
      ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text)) AS keyword_score
    FROM bible_verses bv
    WHERE bv.content_tsv @@ plainto_tsquery('simple', query_text)
       OR bv.content ILIKE '%' || query_text || '%'
    LIMIT match_count * 2
  ),
  combined AS (
    SELECT
      COALESCE(v.id, k.id) AS id,
      COALESCE(v.vector_similarity, 0) AS sim,
      COALESCE(k.keyword_score, 0) AS kw
    FROM vector_results v
    FULL OUTER JOIN keyword_results k ON v.id = k.id
  )
  SELECT
    bv.id,
    bv.testament,
    bv.book_name,
    bv.chapter,
    bv.verse,
    bv.content,
    bv.reference,
    c.sim::FLOAT AS similarity,
    c.kw::FLOAT AS keyword_rank,
    (c.sim * vector_weight + c.kw * keyword_weight)::FLOAT AS combined_score
  FROM combined c
  JOIN bible_verses bv ON c.id = bv.id
  ORDER BY (c.sim * vector_weight + c.kw * keyword_weight) DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- 13. 순수 벡터 검색 함수 (빠른 검색)
CREATE OR REPLACE FUNCTION vector_search_bible(
  query_embedding VECTOR(1536),
  match_count INTEGER DEFAULT 10,
  filter_testament VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  testament VARCHAR,
  book_name VARCHAR,
  chapter INTEGER,
  verse INTEGER,
  content TEXT,
  reference VARCHAR,
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bv.id,
    bv.testament,
    bv.book_name,
    bv.chapter,
    bv.verse,
    bv.content,
    bv.reference,
    (1 - (bv.embedding <=> query_embedding))::FLOAT AS similarity
  FROM bible_verses bv
  WHERE bv.embedding IS NOT NULL
    AND (filter_testament IS NULL OR bv.testament = filter_testament)
  ORDER BY bv.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- 14. 키워드 검색 함수
CREATE OR REPLACE FUNCTION keyword_search_bible(
  query_text TEXT,
  match_count INTEGER DEFAULT 10
)
RETURNS TABLE (
  id INTEGER,
  testament VARCHAR,
  book_name VARCHAR,
  chapter INTEGER,
  verse INTEGER,
  content TEXT,
  reference VARCHAR,
  rank FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    bv.id,
    bv.testament,
    bv.book_name,
    bv.chapter,
    bv.verse,
    bv.content,
    bv.reference,
    ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text))::FLOAT AS rank
  FROM bible_verses bv
  WHERE bv.content_tsv @@ plainto_tsquery('simple', query_text)
     OR bv.content ILIKE '%' || query_text || '%'
  ORDER BY ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text)) DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 통계 및 유틸리티
-- ============================================

-- 15. 임베딩 상태 확인 뷰
CREATE OR REPLACE VIEW embedding_status AS
SELECT
  'bible_verses' AS table_name,
  COUNT(*) AS total_rows,
  COUNT(embedding) AS embedded_rows,
  COUNT(*) - COUNT(embedding) AS pending_rows,
  ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 2) AS completion_percent
FROM bible_verses
UNION ALL
SELECT
  'sermon_chunks',
  COUNT(*),
  COUNT(embedding),
  COUNT(*) - COUNT(embedding),
  ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 2)
FROM sermon_chunks;

-- 16. 책별 구절 수 확인 뷰
CREATE OR REPLACE VIEW bible_book_stats AS
SELECT
  testament,
  book_name,
  book_number,
  COUNT(*) AS verse_count,
  COUNT(embedding) AS embedded_count
FROM bible_verses
GROUP BY testament, book_name, book_number
ORDER BY book_number;

-- ============================================
-- RLS (Row Level Security) 정책 - 선택사항
-- ============================================

-- 공개 읽기 허용
ALTER TABLE bible_verses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sermon_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bible_verses_public_read" ON bible_verses
  FOR SELECT USING (true);

CREATE POLICY "sermon_chunks_public_read" ON sermon_chunks
  FOR SELECT USING (true);

-- service_role만 쓰기 허용
CREATE POLICY "bible_verses_service_write" ON bible_verses
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "sermon_chunks_service_write" ON sermon_chunks
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 완료!
-- ============================================
-- 이 SQL을 Supabase SQL Editor에서 실행하세요.
-- 그 후 bible-chatbot/scripts/embed-bible.ts를 실행하여
-- 성경 구절을 임베딩하세요.
