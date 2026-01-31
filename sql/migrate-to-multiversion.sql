-- =============================================
-- BibleAI Multi-Version Bible Support Migration
-- Supabase SQL Editor에서 실행
--
-- 이 스크립트는 기존 bible_verses 테이블에
-- 멀티버전 지원을 추가합니다.
-- =============================================

-- ============================================
-- Phase 1: bible_versions 마스터 테이블 생성
-- ============================================

CREATE TABLE IF NOT EXISTS bible_versions (
  id VARCHAR(10) PRIMARY KEY,                 -- GAE, KRV, NIV, ESV 등
  name_korean VARCHAR(100) NOT NULL,          -- 개역개정, 개역한글 등
  name_english VARCHAR(100),                  -- Korean Revised Version 등
  language VARCHAR(10) NOT NULL,              -- ko, en
  is_default BOOLEAN DEFAULT FALSE,           -- 기본 버전 여부
  is_active BOOLEAN DEFAULT TRUE,             -- 활성화 여부
  source_url TEXT,                            -- 크롤링 소스 URL
  description TEXT,                           -- 버전 설명
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 지원 버전 추가
INSERT INTO bible_versions (id, name_korean, name_english, language, is_default, source_url, description)
VALUES
  ('GAE', '개역개정', 'Korean Revised Version (New)', 'ko', TRUE, 'http://www.holybible.or.kr/B_GAE/', '대한성서공회 개역개정판'),
  ('KRV', '개역한글', 'Korean Revised Version', 'ko', FALSE, 'http://www.holybible.or.kr/B_KRV/', '대한성서공회 개역한글판'),
  ('NIV', 'NIV', 'New International Version', 'en', FALSE, 'http://www.holybible.or.kr/B_NIV/', 'New International Version (English)'),
  ('ESV', 'ESV', 'English Standard Version', 'en', FALSE, NULL, 'English Standard Version')
ON CONFLICT (id) DO UPDATE SET
  name_korean = EXCLUDED.name_korean,
  name_english = EXCLUDED.name_english,
  language = EXCLUDED.language,
  source_url = EXCLUDED.source_url,
  description = EXCLUDED.description;

-- ============================================
-- Phase 2: bible_verses 테이블에 version_id 추가
-- ============================================

-- version_id 컬럼 추가 (기존 데이터는 GAE로 설정)
ALTER TABLE bible_verses
ADD COLUMN IF NOT EXISTS version_id VARCHAR(10) DEFAULT 'GAE';

-- 기존 데이터 업데이트 (NULL인 경우 GAE로 설정)
UPDATE bible_verses SET version_id = 'GAE' WHERE version_id IS NULL;

-- NOT NULL 제약조건 추가
ALTER TABLE bible_verses
ALTER COLUMN version_id SET NOT NULL;

-- 외래 키 제약조건 추가 (선택사항)
-- ALTER TABLE bible_verses
-- ADD CONSTRAINT fk_bible_version
-- FOREIGN KEY (version_id) REFERENCES bible_versions(id);

-- ============================================
-- Phase 3: Unique 제약조건 변경
-- ============================================

-- 기존 unique 제약조건 삭제
ALTER TABLE bible_verses
DROP CONSTRAINT IF EXISTS bible_verses_book_name_chapter_verse_key;

-- 새로운 unique 제약조건 (version_id 포함)
ALTER TABLE bible_verses
ADD CONSTRAINT bible_verses_version_book_chapter_verse_key
UNIQUE (version_id, book_name, chapter, verse);

-- ============================================
-- Phase 4: 버전 필터링 인덱스 추가
-- ============================================

CREATE INDEX IF NOT EXISTS idx_bible_verses_version
ON bible_verses(version_id);

CREATE INDEX IF NOT EXISTS idx_bible_verses_version_testament
ON bible_verses(version_id, testament);

-- ============================================
-- Phase 5: 검색 함수 업데이트 (버전 필터링 지원)
-- ============================================

-- 하이브리드 검색 함수 (버전 필터링 추가)
DROP FUNCTION IF EXISTS hybrid_search_bible(VECTOR(1536), TEXT, INTEGER, FLOAT, FLOAT);

CREATE OR REPLACE FUNCTION hybrid_search_bible(
  query_embedding VECTOR(1536),
  query_text TEXT,
  match_count INTEGER DEFAULT 10,
  vector_weight FLOAT DEFAULT 0.7,
  keyword_weight FLOAT DEFAULT 0.3,
  filter_version VARCHAR DEFAULT NULL    -- 새로운 파라미터
)
RETURNS TABLE (
  id INTEGER,
  testament VARCHAR,
  book_name VARCHAR,
  chapter INTEGER,
  verse INTEGER,
  content TEXT,
  reference VARCHAR,
  version_id VARCHAR,                    -- 새로운 컬럼
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
      AND (filter_version IS NULL OR bv.version_id = filter_version)
    ORDER BY bv.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  keyword_results AS (
    SELECT
      bv.id,
      ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text)) AS keyword_score
    FROM bible_verses bv
    WHERE (bv.content_tsv @@ plainto_tsquery('simple', query_text)
       OR bv.content ILIKE '%' || query_text || '%')
      AND (filter_version IS NULL OR bv.version_id = filter_version)
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
    bv.version_id,
    c.sim::FLOAT AS similarity,
    c.kw::FLOAT AS keyword_rank,
    (c.sim * vector_weight + c.kw * keyword_weight)::FLOAT AS combined_score
  FROM combined c
  JOIN bible_verses bv ON c.id = bv.id
  ORDER BY (c.sim * vector_weight + c.kw * keyword_weight) DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- 벡터 검색 함수 (버전 필터링 추가)
DROP FUNCTION IF EXISTS vector_search_bible(VECTOR(1536), INTEGER, VARCHAR);

CREATE OR REPLACE FUNCTION vector_search_bible(
  query_embedding VECTOR(1536),
  match_count INTEGER DEFAULT 10,
  filter_testament VARCHAR DEFAULT NULL,
  filter_version VARCHAR DEFAULT NULL    -- 새로운 파라미터
)
RETURNS TABLE (
  id INTEGER,
  testament VARCHAR,
  book_name VARCHAR,
  chapter INTEGER,
  verse INTEGER,
  content TEXT,
  reference VARCHAR,
  version_id VARCHAR,                    -- 새로운 컬럼
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
    bv.version_id,
    (1 - (bv.embedding <=> query_embedding))::FLOAT AS similarity
  FROM bible_verses bv
  WHERE bv.embedding IS NOT NULL
    AND (filter_testament IS NULL OR bv.testament = filter_testament)
    AND (filter_version IS NULL OR bv.version_id = filter_version)
  ORDER BY bv.embedding <=> query_embedding
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- 키워드 검색 함수 (버전 필터링 추가)
DROP FUNCTION IF EXISTS keyword_search_bible(TEXT, INTEGER);

CREATE OR REPLACE FUNCTION keyword_search_bible(
  query_text TEXT,
  match_count INTEGER DEFAULT 10,
  filter_version VARCHAR DEFAULT NULL    -- 새로운 파라미터
)
RETURNS TABLE (
  id INTEGER,
  testament VARCHAR,
  book_name VARCHAR,
  chapter INTEGER,
  verse INTEGER,
  content TEXT,
  reference VARCHAR,
  version_id VARCHAR,                    -- 새로운 컬럼
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
    bv.version_id,
    ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text))::FLOAT AS rank
  FROM bible_verses bv
  WHERE (bv.content_tsv @@ plainto_tsquery('simple', query_text)
     OR bv.content ILIKE '%' || query_text || '%')
    AND (filter_version IS NULL OR bv.version_id = filter_version)
  ORDER BY ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text)) DESC
  LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- Phase 6: 통계 뷰 업데이트
-- ============================================

-- 임베딩 상태 확인 뷰 (버전별)
DROP VIEW IF EXISTS embedding_status;
CREATE OR REPLACE VIEW embedding_status AS
SELECT
  'bible_verses' AS table_name,
  version_id,
  COUNT(*) AS total_rows,
  COUNT(embedding) AS embedded_rows,
  COUNT(*) - COUNT(embedding) AS pending_rows,
  ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 2) AS completion_percent
FROM bible_verses
GROUP BY version_id
UNION ALL
SELECT
  'sermon_chunks',
  NULL,
  COUNT(*),
  COUNT(embedding),
  COUNT(*) - COUNT(embedding),
  ROUND(100.0 * COUNT(embedding) / NULLIF(COUNT(*), 0), 2)
FROM sermon_chunks;

-- 책별 구절 수 확인 뷰 (버전별)
DROP VIEW IF EXISTS bible_book_stats;
CREATE OR REPLACE VIEW bible_book_stats AS
SELECT
  version_id,
  testament,
  book_name,
  book_number,
  COUNT(*) AS verse_count,
  COUNT(embedding) AS embedded_count
FROM bible_verses
GROUP BY version_id, testament, book_name, book_number
ORDER BY version_id, book_number;

-- ============================================
-- Phase 7: 마이그레이션 확인
-- ============================================

-- 버전 목록 확인
SELECT * FROM bible_versions ORDER BY is_default DESC, id;

-- 버전별 구절 수 확인
SELECT
  version_id,
  COUNT(*) AS verse_count,
  COUNT(embedding) AS embedded_count
FROM bible_verses
GROUP BY version_id;

-- ============================================
-- 완료!
-- ============================================
-- 마이그레이션 후 다음 작업 필요:
-- 1. Python 크롤링 스크립트로 새 버전 데이터 추출
-- 2. TypeScript 임베딩 스크립트로 새 버전 임베딩
-- 3. UI에서 버전 선택 기능 테스트
