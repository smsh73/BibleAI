-- ============================================
-- RAG 검색 품질 개선: hybrid_search_bible 함수 업데이트
--
-- 변경사항:
-- 1. ILIKE 서브스트링 매칭 제거 (노이즈 원인)
-- 2. 기본 가중치 0.85/0.15로 변경 (벡터 검색 우선)
-- 3. ts_rank 최소 임계값 추가 (0.01)
-- 4. 벡터 검색 후보를 match_count * 3으로 확대
--
-- 실행 방법: Supabase SQL Editor에서 실행
-- ============================================

-- 기존 함수 드롭 (모든 시그니처)
DROP FUNCTION IF EXISTS hybrid_search_bible(VECTOR(1536), TEXT, INTEGER, FLOAT, FLOAT, VARCHAR);

CREATE OR REPLACE FUNCTION hybrid_search_bible(
  query_embedding VECTOR(1536),
  query_text TEXT,
  match_count INTEGER DEFAULT 10,
  vector_weight FLOAT DEFAULT 0.85,
  keyword_weight FLOAT DEFAULT 0.15,
  filter_version VARCHAR DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  testament VARCHAR,
  book_name VARCHAR,
  chapter INTEGER,
  verse INTEGER,
  content TEXT,
  reference VARCHAR,
  version_id VARCHAR,
  similarity FLOAT,
  keyword_rank FLOAT,
  combined_score FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    -- 벡터 검색: 의미론적 유사도 기반 (주력 검색)
    SELECT
      bv.id,
      1 - (bv.embedding <=> query_embedding) AS vector_similarity
    FROM bible_verses bv
    WHERE bv.embedding IS NOT NULL
      AND (filter_version IS NULL OR bv.version_id = filter_version)
    ORDER BY bv.embedding <=> query_embedding
    LIMIT match_count * 3  -- 더 많은 후보 확보
  ),
  keyword_results AS (
    -- 키워드 검색: tsvector만 사용 (ILIKE 제거로 노이즈 방지)
    SELECT
      bv.id,
      ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text)) AS keyword_score
    FROM bible_verses bv
    WHERE bv.content_tsv @@ plainto_tsquery('simple', query_text)
      AND (filter_version IS NULL OR bv.version_id = filter_version)
      AND ts_rank(bv.content_tsv, plainto_tsquery('simple', query_text)) > 0.01  -- 최소 임계값
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
