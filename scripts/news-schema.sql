-- 열한시 신문 기사 테이블 스키마
-- Supabase에서 실행

-- 신문 호수 테이블 (각 호별 메타정보)
CREATE TABLE IF NOT EXISTS news_issues (
  id SERIAL PRIMARY KEY,
  issue_number INTEGER NOT NULL,           -- 호수 (예: 504)
  issue_date VARCHAR(20) NOT NULL,         -- 발행년월 (예: "2026년 1월호")
  year INTEGER NOT NULL,                   -- 발행연도
  month INTEGER NOT NULL,                  -- 발행월
  board_id INTEGER NOT NULL DEFAULT 0,     -- 게시판 ID (65868 등)
  page_count INTEGER DEFAULT 8,            -- 면수
  source_type VARCHAR(20) DEFAULT 'url',   -- url, pdf, upload
  status VARCHAR(20) DEFAULT 'pending',    -- pending, processing, completed, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(issue_number)
);

-- 신문 페이지 이미지 테이블
CREATE TABLE IF NOT EXISTS news_pages (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES news_issues(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,            -- 면 번호 (1-8)
  image_url TEXT,                          -- 원본 이미지 URL
  file_hash VARCHAR(64),                   -- 파일 해시 (중복 체크용)
  local_path TEXT,                         -- 로컬 저장 경로
  ocr_text TEXT,                           -- OCR 추출 텍스트
  ocr_provider VARCHAR(20),                -- 사용된 OCR 서비스 (OpenAI, Gemini, Claude)
  status VARCHAR(20) DEFAULT 'pending',    -- pending, downloading, ocr_processing, completed, failed
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(issue_id, page_number)
);

-- 신문 기사 테이블 (OCR 텍스트에서 추출된 개별 기사)
CREATE TABLE IF NOT EXISTS news_articles (
  id SERIAL PRIMARY KEY,
  issue_id INTEGER REFERENCES news_issues(id) ON DELETE CASCADE,
  page_id INTEGER REFERENCES news_pages(id) ON DELETE CASCADE,
  title TEXT NOT NULL,                     -- 기사 제목
  content TEXT NOT NULL,                   -- 기사 본문
  article_type VARCHAR(50),                -- 기사 유형 (목회편지, 교회소식, 광고 등)
  speaker VARCHAR(100),                    -- 인물/화자
  event_name VARCHAR(200),                 -- 행사명
  event_date VARCHAR(100),                 -- 행사 일시
  bible_references TEXT[],                 -- 성경 참조 (배열)
  keywords TEXT[],                         -- 키워드 (배열)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 신문 청크 테이블 (벡터 임베딩용)
CREATE TABLE IF NOT EXISTS news_chunks (
  id SERIAL PRIMARY KEY,
  article_id INTEGER REFERENCES news_articles(id) ON DELETE CASCADE,
  issue_id INTEGER REFERENCES news_issues(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,            -- 청크 순서
  chunk_text TEXT NOT NULL,                -- 청크 텍스트 (약 500자)

  -- 메타데이터 (검색 결과에 표시)
  issue_number INTEGER,                    -- 호수
  issue_date VARCHAR(20),                  -- 발행년월
  page_number INTEGER,                     -- 면 번호
  article_title TEXT,                      -- 기사 제목
  article_type VARCHAR(50),                -- 기사 유형

  -- 벡터 임베딩
  embedding vector(1536),                  -- 1536차원 임베딩 (text-embedding-3-small, bible_verses와 동일)

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_news_issues_year_month ON news_issues(year, month);
CREATE INDEX IF NOT EXISTS idx_news_issues_status ON news_issues(status);
CREATE INDEX IF NOT EXISTS idx_news_pages_issue_id ON news_pages(issue_id);
CREATE INDEX IF NOT EXISTS idx_news_pages_status ON news_pages(status);
CREATE INDEX IF NOT EXISTS idx_news_articles_issue_id ON news_articles(issue_id);
CREATE INDEX IF NOT EXISTS idx_news_chunks_article_id ON news_chunks(article_id);
CREATE INDEX IF NOT EXISTS idx_news_chunks_issue_id ON news_chunks(issue_id);

-- 벡터 검색을 위한 IVFFlat 인덱스
CREATE INDEX IF NOT EXISTS idx_news_chunks_embedding ON news_chunks
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- 뉴스 하이브리드 검색 함수
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

-- 전문 검색을 위한 텍스트 검색 설정 (한국어)
-- ALTER TABLE news_chunks ADD COLUMN IF NOT EXISTS tsv tsvector;
-- CREATE INDEX IF NOT EXISTS idx_news_chunks_tsv ON news_chunks USING gin(tsv);
