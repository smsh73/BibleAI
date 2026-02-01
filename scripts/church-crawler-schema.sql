-- 교회 홈페이지 크롤링 및 구조 분석 스키마
-- 교회 dictionary, taxonomy, metadata 저장

-- 교회 정보 테이블
CREATE TABLE IF NOT EXISTS churches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,                  -- 교회명
  code VARCHAR(50) UNIQUE NOT NULL,            -- 교회 코드 (anyangjeil, sarang, onnuri 등)
  homepage_url TEXT NOT NULL,                  -- 홈페이지 URL
  logo_url TEXT,                               -- 로고 URL
  description TEXT,                            -- 설명
  denomination VARCHAR(100),                   -- 교단 (대한예수교장로회 등)
  address TEXT,                                -- 주소
  phone VARCHAR(50),                           -- 전화번호
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 홈페이지 구조 테이블 (사이트맵)
CREATE TABLE IF NOT EXISTS church_site_structure (
  id SERIAL PRIMARY KEY,
  church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES church_site_structure(id) ON DELETE CASCADE,

  -- 페이지 정보
  page_type VARCHAR(50) NOT NULL,              -- main, menu, submenu, content, board, popup
  title VARCHAR(200) NOT NULL,                 -- 페이지/메뉴 제목
  url TEXT,                                    -- 페이지 URL
  url_pattern TEXT,                            -- URL 패턴 (동적 페이지용)

  -- 계층 정보
  depth INTEGER DEFAULT 0,                     -- 깊이 (0=메인, 1=1차메뉴, 2=2차메뉴...)
  sort_order INTEGER DEFAULT 0,                -- 정렬 순서

  -- 메타 정보
  css_selector TEXT,                           -- CSS 선택자 (크롤링용)
  content_type VARCHAR(50),                    -- 콘텐츠 유형 (static, board, gallery, video 등)
  has_children BOOLEAN DEFAULT false,
  is_external BOOLEAN DEFAULT false,           -- 외부 링크 여부

  -- 추출된 데이터
  extracted_data JSONB,                        -- AI가 추출한 구조화된 데이터

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 교회 사전 (Dictionary) 테이블
CREATE TABLE IF NOT EXISTS church_dictionary (
  id SERIAL PRIMARY KEY,
  church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,

  -- 항목 정보
  term VARCHAR(200) NOT NULL,                  -- 용어/명칭
  category VARCHAR(100) NOT NULL,              -- 카테고리 (인물, 장소, 부서, 행사, 용어 등)
  subcategory VARCHAR(100),                    -- 하위 카테고리

  -- 상세 정보
  definition TEXT,                             -- 정의/설명
  aliases TEXT[],                              -- 별칭 목록
  related_terms TEXT[],                        -- 관련 용어

  -- 메타데이터
  metadata JSONB,                              -- 추가 메타데이터
  source_url TEXT,                             -- 출처 URL
  confidence FLOAT DEFAULT 1.0,                -- 신뢰도

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(church_id, term, category)
);

-- 교회 분류 체계 (Taxonomy) 테이블
CREATE TABLE IF NOT EXISTS church_taxonomy (
  id SERIAL PRIMARY KEY,
  church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES church_taxonomy(id) ON DELETE CASCADE,

  -- 분류 정보
  name VARCHAR(200) NOT NULL,                  -- 분류명
  taxonomy_type VARCHAR(50) NOT NULL,          -- 분류 유형 (organization, ministry, location, event 등)

  -- 계층 정보
  depth INTEGER DEFAULT 0,
  path TEXT,                                   -- 전체 경로 (예: /교구/1교구/1구역)

  -- 상세 정보
  description TEXT,
  metadata JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(church_id, taxonomy_type, path)
);

-- 크롤링 작업 로그 테이블
CREATE TABLE IF NOT EXISTS church_crawl_logs (
  id SERIAL PRIMARY KEY,
  church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,

  -- 작업 정보
  crawl_type VARCHAR(50) NOT NULL,             -- full, incremental, structure, content
  status VARCHAR(20) DEFAULT 'pending',        -- pending, running, completed, failed

  -- 결과
  pages_crawled INTEGER DEFAULT 0,
  items_extracted INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,

  -- 상세
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  result_summary JSONB,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 크롤링 템플릿 테이블 (교회별 사이트 구조 템플릿)
CREATE TABLE IF NOT EXISTS church_crawl_templates (
  id SERIAL PRIMARY KEY,
  church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,

  -- 템플릿 정보
  template_name VARCHAR(100) NOT NULL,
  template_type VARCHAR(50) NOT NULL,          -- navigation, content, board, member_list 등

  -- 선택자 및 패턴
  selectors JSONB NOT NULL,                    -- CSS/XPath 선택자들
  url_patterns JSONB,                          -- URL 패턴들
  extraction_rules JSONB,                      -- 데이터 추출 규칙

  -- AI 분석 결과
  ai_detected BOOLEAN DEFAULT false,           -- AI가 자동 감지했는지
  ai_confidence FLOAT,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_church_structure_church_id ON church_site_structure(church_id);
CREATE INDEX IF NOT EXISTS idx_church_structure_parent_id ON church_site_structure(parent_id);
CREATE INDEX IF NOT EXISTS idx_church_structure_page_type ON church_site_structure(page_type);
CREATE INDEX IF NOT EXISTS idx_church_dictionary_church_id ON church_dictionary(church_id);
CREATE INDEX IF NOT EXISTS idx_church_dictionary_category ON church_dictionary(category);
CREATE INDEX IF NOT EXISTS idx_church_dictionary_term ON church_dictionary(term);
CREATE INDEX IF NOT EXISTS idx_church_taxonomy_church_id ON church_taxonomy(church_id);
CREATE INDEX IF NOT EXISTS idx_church_taxonomy_type ON church_taxonomy(taxonomy_type);
CREATE INDEX IF NOT EXISTS idx_church_crawl_logs_church_id ON church_crawl_logs(church_id);

-- 기본 교회 데이터 삽입
INSERT INTO churches (name, code, homepage_url, denomination) VALUES
  ('안양제일교회', 'anyangjeil', 'https://www.anyangjeil.org/', '대한예수교장로회(통합)'),
  ('사랑의교회', 'sarang', 'https://www.sarang.org/', '대한예수교장로회(합동)'),
  ('온누리교회', 'onnuri', 'https://www.onnuri.org/', '대한예수교장로회(합동)'),
  ('여의도순복음교회', 'fgtv', 'https://www.fgtv.com/', '기독교대한하나님의성회'),
  ('명성교회', 'msch', 'http://www.msch.or.kr/', '대한예수교장로회(통합)'),
  ('광림교회', 'klmc', 'https://www.klmc.church/', '기독교대한감리회')
ON CONFLICT (code) DO UPDATE SET
  homepage_url = EXCLUDED.homepage_url,
  updated_at = NOW();

-- 구조 검색 함수
CREATE OR REPLACE FUNCTION get_church_structure_tree(p_church_id INTEGER)
RETURNS TABLE (
  id INTEGER,
  parent_id INTEGER,
  page_type VARCHAR,
  title VARCHAR,
  url TEXT,
  depth INTEGER,
  sort_order INTEGER,
  content_type VARCHAR,
  has_children BOOLEAN
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE structure_tree AS (
    -- 루트 노드
    SELECT s.id, s.parent_id, s.page_type, s.title, s.url, s.depth, s.sort_order, s.content_type, s.has_children
    FROM church_site_structure s
    WHERE s.church_id = p_church_id AND s.parent_id IS NULL

    UNION ALL

    -- 자식 노드
    SELECT s.id, s.parent_id, s.page_type, s.title, s.url, s.depth, s.sort_order, s.content_type, s.has_children
    FROM church_site_structure s
    INNER JOIN structure_tree st ON s.parent_id = st.id
  )
  SELECT * FROM structure_tree
  ORDER BY depth, sort_order;
END;
$$;

-- 사전 검색 함수
CREATE OR REPLACE FUNCTION search_church_dictionary(
  p_church_id INTEGER,
  p_search_term TEXT,
  p_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  term VARCHAR,
  category VARCHAR,
  subcategory VARCHAR,
  definition TEXT,
  aliases TEXT[],
  confidence FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT d.id, d.term, d.category, d.subcategory, d.definition, d.aliases, d.confidence
  FROM church_dictionary d
  WHERE d.church_id = p_church_id
    AND (
      d.term ILIKE '%' || p_search_term || '%'
      OR d.definition ILIKE '%' || p_search_term || '%'
      OR p_search_term = ANY(d.aliases)
    )
    AND (p_category IS NULL OR d.category = p_category)
  ORDER BY
    CASE WHEN d.term ILIKE p_search_term THEN 0
         WHEN d.term ILIKE p_search_term || '%' THEN 1
         ELSE 2
    END,
    d.confidence DESC
  LIMIT 50;
END;
$$;
