-- ============================================
-- 성경 구절 관계 GraphRAG 스키마
-- ============================================

-- 1. 성경 구절 관계 테이블 (그래프 엣지)
CREATE TABLE IF NOT EXISTS verse_relations (
  id SERIAL PRIMARY KEY,
  source_reference VARCHAR(50) NOT NULL,      -- 예: "창세기 1:1"
  target_reference VARCHAR(50) NOT NULL,      -- 예: "요한복음 1:1"
  relation_type VARCHAR(50) NOT NULL,         -- 관계 유형
  strength FLOAT DEFAULT 0.5,                 -- 관계 강도 (0-1)
  description TEXT,                           -- 관계 설명
  created_at TIMESTAMP DEFAULT NOW(),

  -- 인덱스용 복합키
  CONSTRAINT unique_relation UNIQUE (source_reference, target_reference, relation_type)
);

-- 관계 유형 (relation_type):
-- 'prophecy_fulfillment' - 예언과 성취
-- 'parallel' - 평행 본문
-- 'quotation' - 인용
-- 'thematic' - 주제적 연결
-- 'narrative' - 서사적 연결
-- 'theological' - 신학적 연결
-- 'semantic' - 의미적 유사성 (벡터 기반 자동 생성)

-- 2. 성경 구절 주제 태그 테이블
CREATE TABLE IF NOT EXISTS verse_themes (
  id SERIAL PRIMARY KEY,
  reference VARCHAR(50) NOT NULL,
  theme VARCHAR(100) NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_verse_theme UNIQUE (reference, theme)
);

-- 주요 주제 예시:
-- '사랑', '믿음', '소망', '구원', '은혜', '용서', '치유', '평안',
-- '지혜', '인내', '감사', '축복', '기도', '회개', '순종', '섬김'

-- 3. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_verse_relations_source ON verse_relations(source_reference);
CREATE INDEX IF NOT EXISTS idx_verse_relations_target ON verse_relations(target_reference);
CREATE INDEX IF NOT EXISTS idx_verse_relations_type ON verse_relations(relation_type);
CREATE INDEX IF NOT EXISTS idx_verse_themes_reference ON verse_themes(reference);
CREATE INDEX IF NOT EXISTS idx_verse_themes_theme ON verse_themes(theme);

-- 4. 초기 데이터: 유명한 성경 구절 관계 (예언-성취)
INSERT INTO verse_relations (source_reference, target_reference, relation_type, strength, description)
VALUES
  -- 메시아 예언과 성취
  ('이사야 7:14', '마태복음 1:23', 'prophecy_fulfillment', 1.0, '동정녀 탄생 예언과 성취'),
  ('미가 5:2', '마태복음 2:6', 'prophecy_fulfillment', 1.0, '베들레헴 출생 예언과 성취'),
  ('이사야 53:5', '마태복음 8:17', 'prophecy_fulfillment', 1.0, '고난받는 종의 예언'),
  ('시편 22:1', '마태복음 27:46', 'prophecy_fulfillment', 1.0, '십자가 고통의 예언'),
  ('시편 16:10', '사도행전 2:31', 'prophecy_fulfillment', 1.0, '부활 예언'),

  -- 주제적 연결: 창조
  ('창세기 1:1', '요한복음 1:1', 'thematic', 0.9, '태초의 말씀과 창조'),
  ('창세기 1:1', '골로새서 1:16', 'thematic', 0.9, '만물의 창조주'),
  ('창세기 1:3', '요한복음 1:4', 'thematic', 0.85, '빛의 창조와 생명의 빛'),

  -- 주제적 연결: 사랑
  ('요한복음 3:16', '로마서 5:8', 'thematic', 0.95, '하나님의 사랑'),
  ('요한복음 3:16', '요한일서 4:9', 'thematic', 0.95, '독생자를 보내신 사랑'),
  ('요한복음 15:13', '로마서 5:8', 'thematic', 0.9, '희생적 사랑'),

  -- 주제적 연결: 믿음
  ('히브리서 11:1', '로마서 10:17', 'thematic', 0.9, '믿음의 정의'),
  ('로마서 1:17', '갈라디아서 3:11', 'parallel', 0.95, '의인은 믿음으로 산다'),

  -- 평행 본문
  ('마태복음 5:3-12', '누가복음 6:20-23', 'parallel', 1.0, '팔복/평지설교'),
  ('마태복음 6:9-13', '누가복음 11:2-4', 'parallel', 1.0, '주기도문'),

  -- 인용 관계
  ('신명기 6:5', '마태복음 22:37', 'quotation', 1.0, '가장 큰 계명'),
  ('레위기 19:18', '마태복음 22:39', 'quotation', 1.0, '둘째 계명')
ON CONFLICT (source_reference, target_reference, relation_type) DO NOTHING;

-- 5. 초기 데이터: 구절별 주제 태그
INSERT INTO verse_themes (reference, theme, confidence)
VALUES
  -- 요한복음 3:16 태그
  ('요한복음 3:16', '사랑', 1.0),
  ('요한복음 3:16', '구원', 1.0),
  ('요한복음 3:16', '믿음', 0.9),
  ('요한복음 3:16', '영생', 0.9),

  -- 시편 23편 태그
  ('시편 23:1', '평안', 1.0),
  ('시편 23:1', '신뢰', 0.9),
  ('시편 23:1', '인도하심', 0.85),
  ('시편 23:4', '두려움', 0.9),
  ('시편 23:4', '위로', 1.0),

  -- 빌립보서 4장 태그
  ('빌립보서 4:6', '염려', 0.9),
  ('빌립보서 4:6', '기도', 1.0),
  ('빌립보서 4:6', '평안', 0.9),
  ('빌립보서 4:13', '능력', 1.0),
  ('빌립보서 4:13', '믿음', 0.85),

  -- 로마서 태그
  ('로마서 8:28', '섭리', 1.0),
  ('로마서 8:28', '소망', 0.9),
  ('로마서 8:28', '사랑', 0.8),

  -- 이사야 태그
  ('이사야 40:31', '능력', 1.0),
  ('이사야 40:31', '인내', 0.9),
  ('이사야 40:31', '소망', 0.85),

  -- 잠언 태그
  ('잠언 3:5', '신뢰', 1.0),
  ('잠언 3:5', '지혜', 0.9),
  ('잠언 3:6', '인도하심', 1.0)
ON CONFLICT (reference, theme) DO NOTHING;

-- 6. 그래프 탐색 함수: 연결된 구절 찾기 (BFS)
-- depth 우선 정렬: 가까운 연결(depth 1)이 먼저 반환됨
CREATE OR REPLACE FUNCTION get_connected_verses(
  start_reference VARCHAR(50),
  max_depth INT DEFAULT 2,
  max_results INT DEFAULT 20
)
RETURNS TABLE (
  reference VARCHAR(50),
  depth INT,
  relation_type VARCHAR(50),
  relation_description TEXT,
  path TEXT[]
) AS $$
WITH RECURSIVE verse_graph AS (
  -- 시작점
  SELECT
    start_reference as reference,
    0 as depth,
    NULL::VARCHAR(50) as relation_type,
    NULL::TEXT as relation_description,
    ARRAY[start_reference] as path

  UNION ALL

  -- 재귀: 연결된 구절 탐색
  SELECT
    CASE
      WHEN vr.source_reference = vg.reference THEN vr.target_reference
      ELSE vr.source_reference
    END as reference,
    vg.depth + 1,
    vr.relation_type,
    vr.description,
    vg.path || CASE
      WHEN vr.source_reference = vg.reference THEN vr.target_reference
      ELSE vr.source_reference
    END
  FROM verse_graph vg
  JOIN verse_relations vr ON (
    vr.source_reference = vg.reference OR vr.target_reference = vg.reference
  )
  WHERE
    vg.depth < max_depth
    AND NOT (
      CASE
        WHEN vr.source_reference = vg.reference THEN vr.target_reference
        ELSE vr.source_reference
      END = ANY(vg.path)
    )
),
-- 서브쿼리: 각 참조에 대해 가장 짧은 depth만 유지
deduplicated AS (
  SELECT DISTINCT ON (reference)
    reference,
    depth,
    relation_type,
    relation_description,
    path
  FROM verse_graph
  WHERE reference != start_reference
  ORDER BY reference, depth
)
-- 최종 결과: depth 우선 정렬 후 LIMIT 적용
SELECT * FROM deduplicated
ORDER BY depth, reference
LIMIT max_results;
$$ LANGUAGE SQL;

-- 7. 같은 주제를 가진 구절 찾기 함수
CREATE OR REPLACE FUNCTION get_verses_by_theme(
  target_theme VARCHAR(100),
  min_confidence FLOAT DEFAULT 0.7,
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  reference VARCHAR(50),
  theme VARCHAR(100),
  confidence FLOAT
) AS $$
SELECT
  vt.reference,
  vt.theme,
  vt.confidence
FROM verse_themes vt
WHERE vt.theme = target_theme
  AND vt.confidence >= min_confidence
ORDER BY vt.confidence DESC
LIMIT max_results;
$$ LANGUAGE SQL;

-- 8. 구절의 모든 관계 가져오기
CREATE OR REPLACE FUNCTION get_verse_relations(
  verse_ref VARCHAR(50)
)
RETURNS TABLE (
  related_reference VARCHAR(50),
  relation_type VARCHAR(50),
  strength FLOAT,
  description TEXT,
  direction VARCHAR(10)
) AS $$
SELECT
  target_reference as related_reference,
  relation_type,
  strength,
  description,
  'outgoing' as direction
FROM verse_relations
WHERE source_reference = verse_ref

UNION ALL

SELECT
  source_reference as related_reference,
  relation_type,
  strength,
  description,
  'incoming' as direction
FROM verse_relations
WHERE target_reference = verse_ref
ORDER BY strength DESC;
$$ LANGUAGE SQL;
