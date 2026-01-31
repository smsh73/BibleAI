-- ============================================
-- 설교 데이터 스키마 v2
-- sermon_chunks 리셋 + sermons 메타데이터 테이블
-- ============================================

-- 1. 기존 sermon_chunks 데이터 삭제
TRUNCATE TABLE sermon_chunks RESTART IDENTITY CASCADE;

-- 2. sermons 메타데이터 테이블 생성 (없으면)
CREATE TABLE IF NOT EXISTS sermons (
  id SERIAL PRIMARY KEY,
  video_id VARCHAR(50) UNIQUE NOT NULL,
  video_url TEXT NOT NULL,
  video_title TEXT NOT NULL,

  -- 설교 구간 정보
  sermon_start_time NUMERIC,
  sermon_end_time NUMERIC,
  sermon_duration NUMERIC,

  -- 전체 스크립트
  full_transcript TEXT,

  -- 메타데이터
  speaker TEXT,
  upload_date DATE,
  channel_name TEXT,
  description TEXT,
  tags TEXT[],
  bible_references TEXT[],

  -- 처리 정보
  chunk_count INTEGER DEFAULT 0,
  processing_status VARCHAR(20) DEFAULT 'pending',  -- pending, processing, completed, failed
  error_message TEXT,

  -- 타임스탬프
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. sermon_chunks에 video_url 컬럼 추가 (없으면)
ALTER TABLE sermon_chunks
ADD COLUMN IF NOT EXISTS video_url TEXT;

-- 4. sermons 테이블 인덱스
CREATE INDEX IF NOT EXISTS idx_sermons_video_id ON sermons(video_id);
CREATE INDEX IF NOT EXISTS idx_sermons_speaker ON sermons(speaker);
CREATE INDEX IF NOT EXISTS idx_sermons_upload_date ON sermons(upload_date);
CREATE INDEX IF NOT EXISTS idx_sermons_status ON sermons(processing_status);

-- 5. Full-text search를 위한 tsvector 컬럼 (sermons)
ALTER TABLE sermons
ADD COLUMN IF NOT EXISTS transcript_tsv TSVECTOR;

-- transcript_tsv 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_sermon_transcript_tsv()
RETURNS TRIGGER AS $$
BEGIN
  NEW.transcript_tsv := to_tsvector('simple', COALESCE(NEW.full_transcript, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sermon_transcript_tsv_trigger ON sermons;
CREATE TRIGGER sermon_transcript_tsv_trigger
  BEFORE INSERT OR UPDATE OF full_transcript ON sermons
  FOR EACH ROW EXECUTE FUNCTION update_sermon_transcript_tsv();

-- 6. updated_at 자동 업데이트 트리거
CREATE OR REPLACE FUNCTION update_sermon_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sermon_updated_at_trigger ON sermons;
CREATE TRIGGER sermon_updated_at_trigger
  BEFORE UPDATE ON sermons
  FOR EACH ROW EXECUTE FUNCTION update_sermon_updated_at();

-- 7. Hybrid Search RPC 함수 개선 (설교용)
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
    vr.similarity::float,
    COALESCE(kr.keyword_rank, 0)::float AS keyword_rank,
    (vr.similarity * vector_weight + COALESCE(kr.keyword_rank, 0) * keyword_weight)::float AS combined_score
  FROM vector_results vr
  LEFT JOIN keyword_results kr ON vr.id = kr.id
  ORDER BY combined_score DESC
  LIMIT match_count;
END;
$$;

-- 8. 중복 체크 함수 (sermons 테이블 기준으로 변경)
CREATE OR REPLACE FUNCTION is_sermon_processed(vid text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM sermons
    WHERE video_id = vid
    AND processing_status = 'completed'
  );
END;
$$;

-- 9. 처리된 설교 목록 조회
CREATE OR REPLACE FUNCTION get_processed_sermons()
RETURNS TABLE (
  video_id text,
  video_title text,
  video_url text,
  speaker text,
  upload_date date,
  chunk_count int,
  sermon_duration numeric,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.video_id,
    s.video_title,
    s.video_url,
    s.speaker,
    s.upload_date,
    s.chunk_count,
    s.sermon_duration,
    s.created_at
  FROM sermons s
  WHERE s.processing_status = 'completed'
  ORDER BY s.created_at DESC;
END;
$$;

COMMENT ON TABLE sermons IS '설교 동영상 메타데이터 테이블';
COMMENT ON COLUMN sermons.video_id IS 'YouTube 비디오 ID';
COMMENT ON COLUMN sermons.full_transcript IS '전체 설교 스크립트 (설교 구간만)';
COMMENT ON COLUMN sermons.processing_status IS '처리 상태: pending, processing, completed, failed';
