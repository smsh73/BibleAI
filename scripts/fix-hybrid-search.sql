-- hybrid_search_news 함수에 article_id 추가
-- Supabase SQL Editor에서 실행하세요

-- 기존 함수 삭제 (반환 타입 변경을 위해 필요)
DROP FUNCTION IF EXISTS hybrid_search_news(vector(768), text, float, int, int, text);

CREATE OR REPLACE FUNCTION hybrid_search_news(
  query_embedding vector(768),
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
