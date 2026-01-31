-- 주보 데이터 테이블 스키마
-- Supabase에서 실행

-- 주보 목록 테이블 (각 주보별 메타정보)
CREATE TABLE IF NOT EXISTS bulletin_issues (
  id SERIAL PRIMARY KEY,
  bulletin_date DATE NOT NULL,                -- 주보 날짜 (예배일)
  title VARCHAR(100) NOT NULL,                -- 제목 (예: "2026년 02월 01일 주보")
  board_id INTEGER NOT NULL,                  -- 게시판 ID
  page_count INTEGER DEFAULT 8,               -- 페이지 수
  year INTEGER NOT NULL,                      -- 연도
  month INTEGER NOT NULL,                     -- 월
  day INTEGER NOT NULL,                       -- 일
  status VARCHAR(20) DEFAULT 'pending',       -- pending, processing, completed, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(bulletin_date)
);

-- 주보 페이지 이미지 테이블
CREATE TABLE IF NOT EXISTS bulletin_pages (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES bulletin_issues(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,               -- 페이지 번호 (1-8)
  image_url TEXT,                             -- 원본 이미지 URL
  ocr_text TEXT,                              -- OCR 추출 텍스트
  status VARCHAR(20) DEFAULT 'pending',       -- pending, processing, completed, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(issue_id, page_number)
);

-- 주보 청크 테이블 (벡터 임베딩용)
CREATE TABLE IF NOT EXISTS bulletin_chunks (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES bulletin_issues(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,               -- 페이지 번호
  chunk_index INTEGER NOT NULL,               -- 청크 순서

  -- 콘텐츠
  section_type VARCHAR(50),                   -- 섹션 유형 (예배순서, 교회소식, 광고, 기도제목 등)
  title TEXT,                                 -- 항목 제목
  content TEXT NOT NULL,                      -- 청크 텍스트

  -- 메타데이터
  bulletin_date DATE,                         -- 주보 날짜
  bulletin_title VARCHAR(100),                -- 주보 제목
  year INTEGER,                               -- 연도
  month INTEGER,                              -- 월

  -- 벡터 임베딩
  embedding vector(1536),                     -- 1536차원 임베딩

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_bulletin_issues_date ON bulletin_issues(bulletin_date);
CREATE INDEX IF NOT EXISTS idx_bulletin_issues_year_month ON bulletin_issues(year, month);
CREATE INDEX IF NOT EXISTS idx_bulletin_issues_status ON bulletin_issues(status);
CREATE INDEX IF NOT EXISTS idx_bulletin_pages_issue_id ON bulletin_pages(issue_id);
CREATE INDEX IF NOT EXISTS idx_bulletin_chunks_issue_id ON bulletin_chunks(issue_id);
CREATE INDEX IF NOT EXISTS idx_bulletin_chunks_section ON bulletin_chunks(section_type);

-- 벡터 검색을 위한 IVFFlat 인덱스
CREATE INDEX IF NOT EXISTS idx_bulletin_chunks_embedding ON bulletin_chunks
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 주보 하이브리드 검색 함수
CREATE OR REPLACE FUNCTION hybrid_search_bulletin(
  query_embedding vector(1536),
  query_text text,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10,
  year_filter int DEFAULT NULL,
  section_type_filter text DEFAULT NULL
)
RETURNS TABLE (
  id int,
  chunk_index int,
  content text,
  section_type varchar,
  title text,
  bulletin_date date,
  bulletin_title varchar,
  year int,
  month int,
  page_number int,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bc.id,
    bc.chunk_index,
    bc.content,
    bc.section_type,
    bc.title,
    bc.bulletin_date,
    bc.bulletin_title,
    bc.year,
    bc.month,
    bc.page_number,
    1 - (bc.embedding <=> query_embedding) as similarity
  FROM bulletin_chunks bc
  WHERE
    bc.embedding IS NOT NULL
    AND 1 - (bc.embedding <=> query_embedding) > match_threshold
    AND (year_filter IS NULL OR bc.year = year_filter)
    AND (section_type_filter IS NULL OR bc.section_type = section_type_filter)
  ORDER BY bc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 주보 벡터 검색 함수 (단순)
CREATE OR REPLACE FUNCTION vector_search_bulletin(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id int,
  content text,
  section_type varchar,
  title text,
  bulletin_date date,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bc.id,
    bc.content,
    bc.section_type,
    bc.title,
    bc.bulletin_date,
    1 - (bc.embedding <=> query_embedding) as similarity
  FROM bulletin_chunks bc
  WHERE
    bc.embedding IS NOT NULL
    AND 1 - (bc.embedding <=> query_embedding) > match_threshold
  ORDER BY bc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
