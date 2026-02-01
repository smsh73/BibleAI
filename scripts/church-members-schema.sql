-- 교회 인명/고유명사 데이터베이스 스키마
-- OCR 텍스트 검증 및 교정용

-- 교회 구성원 테이블 (목사, 전도사, 장로, 직원 등)
CREATE TABLE IF NOT EXISTS church_members (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL,                    -- 이름
  position VARCHAR(50) NOT NULL,                -- 직분 (위임목사, 담임목사, 목사, 전도사, 장로, 권사, 안수집사, 집사 등)
  department VARCHAR(100),                       -- 소속 부서 (교구, 청년부, 교육부, 장애인사역부, 국제사역부 등)
  role VARCHAR(100),                            -- 역할 상세 (1교구 담당, 청년부 담당 등)
  is_active BOOLEAN DEFAULT true,               -- 현재 활동 여부
  source_url TEXT,                              -- 출처 URL
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(name, position, department)
);

-- 교구/구역 테이블
CREATE TABLE IF NOT EXISTS church_districts (
  id SERIAL PRIMARY KEY,
  district_type VARCHAR(20) NOT NULL,           -- 교구, 구역, 속회
  name VARCHAR(50) NOT NULL,                    -- 이름 (1교구, 새가족1구역 등)
  parent_id INTEGER REFERENCES church_districts(id), -- 상위 조직 (교구 -> 구역)
  leader_name VARCHAR(50),                      -- 담당자 이름
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(district_type, name)
);

-- 장소 테이블
CREATE TABLE IF NOT EXISTS church_places (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,                   -- 장소명 (만나홀, 비전홀, 대예배실 등)
  floor VARCHAR(20),                            -- 층수
  building VARCHAR(50),                         -- 건물 (본관, 교육관 등)
  capacity INTEGER,                             -- 수용 인원
  aliases TEXT[],                               -- 별칭 목록
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(name)
);

-- 행사/프로그램 명칭 테이블
CREATE TABLE IF NOT EXISTS church_events (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,                   -- 행사명
  event_type VARCHAR(50),                       -- 유형 (예배, 행사, 교육, 봉사 등)
  recurring BOOLEAN DEFAULT false,              -- 정기 행사 여부
  frequency VARCHAR(50),                        -- 주기 (매주, 매월, 연 1회 등)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(name)
);

-- 고유명사 별칭/오탐 패턴 테이블
-- OCR에서 자주 오인식되는 패턴을 저장
CREATE TABLE IF NOT EXISTS ocr_corrections (
  id SERIAL PRIMARY KEY,
  wrong_text VARCHAR(100) NOT NULL,             -- 잘못된 텍스트
  correct_text VARCHAR(100) NOT NULL,           -- 올바른 텍스트
  category VARCHAR(50),                         -- 카테고리 (이름, 장소, 직분 등)
  confidence FLOAT DEFAULT 1.0,                 -- 신뢰도 (1.0 = 항상 교정)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(wrong_text, correct_text)
);

-- 검증용 키워드 테이블 (숫자, 날짜 패턴 등)
CREATE TABLE IF NOT EXISTS verification_patterns (
  id SERIAL PRIMARY KEY,
  pattern_type VARCHAR(50) NOT NULL,            -- 패턴 유형 (전화번호, 날짜, 시간, 금액 등)
  regex_pattern TEXT NOT NULL,                  -- 정규식 패턴
  description TEXT,                             -- 설명
  example TEXT,                                 -- 예시
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_church_members_name ON church_members(name);
CREATE INDEX IF NOT EXISTS idx_church_members_position ON church_members(position);
CREATE INDEX IF NOT EXISTS idx_church_members_department ON church_members(department);
CREATE INDEX IF NOT EXISTS idx_church_districts_name ON church_districts(name);
CREATE INDEX IF NOT EXISTS idx_church_places_name ON church_places(name);
CREATE INDEX IF NOT EXISTS idx_ocr_corrections_wrong ON ocr_corrections(wrong_text);

-- 기본 OCR 오류 패턴 삽입
INSERT INTO ocr_corrections (wrong_text, correct_text, category) VALUES
  ('한나홀', '만나홀', '장소'),
  ('위원목사', '위임목사', '직분'),
  ('최재호', '최원준', '이름'),
  ('요즘형', '요르단', '팀명'),
  ('8가족', '새가족', '일반')
ON CONFLICT DO NOTHING;

-- 기본 장소 삽입
INSERT INTO church_places (name, floor, building, aliases) VALUES
  ('만나홀', 'B1', '본관', ARRAY['만나실', '만남홀']),
  ('비전홀', '4F', '본관', ARRAY['비전실']),
  ('대예배실', '2F', '본관', ARRAY['본당', '대예배당']),
  ('소예배실', '3F', '본관', ARRAY['소예배당']),
  ('카페테리아', '1F', '본관', ARRAY['카페', '식당'])
ON CONFLICT DO NOTHING;

-- 검증 패턴 삽입
INSERT INTO verification_patterns (pattern_type, regex_pattern, description, example) VALUES
  ('전화번호', '\\d{2,4}-\\d{3,4}-\\d{4}', '전화번호 형식', '031-123-4567'),
  ('날짜_년월일', '\\d{4}년\\s*\\d{1,2}월\\s*\\d{1,2}일', '년월일 형식', '2026년 2월 1일'),
  ('시간', '(오전|오후)?\\s*\\d{1,2}(시|:)\\d{0,2}', '시간 형식', '오전 11시 30분'),
  ('금액', '[\\d,]+원', '금액 형식', '100,000원'),
  ('인원수', '\\d+여?\\s*(명|분|가정|가족)', '인원수 형식', '145여 명')
ON CONFLICT DO NOTHING;

-- 고유명사 검색 함수
CREATE OR REPLACE FUNCTION search_church_members(search_name text)
RETURNS TABLE (
  id int,
  name varchar,
  position varchar,
  department varchar,
  role varchar,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cm.id,
    cm.name,
    cm.position,
    cm.department,
    cm.role,
    similarity(cm.name, search_name) as similarity
  FROM church_members cm
  WHERE
    cm.is_active = true
    AND (
      cm.name = search_name
      OR similarity(cm.name, search_name) > 0.5
    )
  ORDER BY similarity(cm.name, search_name) DESC
  LIMIT 5;
END;
$$;

-- OCR 교정 검색 함수
CREATE OR REPLACE FUNCTION get_ocr_correction(input_text text)
RETURNS TABLE (
  correct_text varchar,
  category varchar,
  confidence float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    oc.correct_text,
    oc.category,
    oc.confidence
  FROM ocr_corrections oc
  WHERE oc.wrong_text = input_text
  ORDER BY oc.confidence DESC
  LIMIT 1;
END;
$$;
