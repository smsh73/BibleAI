-- Migration: Add speaker and upload_date to hybrid_search_sermons RPC
-- Date: 2026-02-01
-- Description: Update the hybrid_search_sermons function to include sermon metadata (speaker, upload_date)
--              by JOINing with the sermons table

-- Drop and recreate the function with additional fields
CREATE OR REPLACE FUNCTION hybrid_search_sermons(
  query_embedding vector(1536),
  query_text text,
  match_count int DEFAULT 5,
  vector_weight float DEFAULT 0.7,
  keyword_weight float DEFAULT 0.3
)
RETURNS TABLE (
  id bigint,
  video_id text,
  video_title text,
  video_url text,
  chunk_index int,
  content text,
  start_time numeric,
  end_time numeric,
  speaker text,
  upload_date date,
  similarity float,
  keyword_rank float,
  combined_score float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH vector_results AS (
    SELECT
      sc.id,
      sc.video_id,
      sc.video_title,
      sc.video_url,
      sc.chunk_index,
      sc.content,
      sc.start_time,
      sc.end_time,
      1 - (sc.embedding <=> query_embedding) AS similarity
    FROM sermon_chunks sc
    WHERE sc.embedding IS NOT NULL
    ORDER BY sc.embedding <=> query_embedding
    LIMIT match_count * 3
  ),
  keyword_results AS (
    SELECT
      sc.id,
      ts_rank(sc.content_tsv, plainto_tsquery('simple', query_text)) AS keyword_rank
    FROM sermon_chunks sc
    WHERE sc.content_tsv @@ plainto_tsquery('simple', query_text)
  )
  SELECT
    vr.id,
    vr.video_id,
    vr.video_title,
    vr.video_url,
    vr.chunk_index,
    vr.content,
    vr.start_time,
    vr.end_time,
    s.speaker,
    s.upload_date,
    vr.similarity::float,
    COALESCE(kr.keyword_rank, 0)::float AS keyword_rank,
    (vr.similarity * vector_weight + COALESCE(kr.keyword_rank, 0) * keyword_weight)::float AS combined_score
  FROM vector_results vr
  LEFT JOIN keyword_results kr ON vr.id = kr.id
  LEFT JOIN sermons s ON vr.video_id = s.video_id
  ORDER BY combined_score DESC
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION hybrid_search_sermons IS 'Hybrid search for sermons combining vector similarity and keyword matching. Returns sermon chunks with metadata (speaker, upload_date) from the sermons table.';
