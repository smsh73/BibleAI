-- ============================================
-- 성경 메타데이터 확장 스키마
-- 장소, 인물, 사건, 주제 테이블
-- ============================================

-- 1. 성경 장소 테이블 (OpenBible.info Geocoding Data 기반)
CREATE TABLE IF NOT EXISTS bible_places (
  id VARCHAR(20) PRIMARY KEY,
  name_korean VARCHAR(100) NOT NULL,      -- 한글 장소명
  name_english VARCHAR(100),               -- 영어 장소명
  place_type VARCHAR(50),                  -- settlement, mountain, river, valley, region, etc.
  place_class VARCHAR(50),                 -- human, natural, special
  latitude FLOAT,
  longitude FLOAT,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. 장소-구절 연결 테이블
CREATE TABLE IF NOT EXISTS place_verses (
  id SERIAL PRIMARY KEY,
  place_id VARCHAR(20) NOT NULL REFERENCES bible_places(id) ON DELETE CASCADE,
  reference VARCHAR(50) NOT NULL,          -- 구절 참조 (예: "창세기 12:1")
  context TEXT,                            -- 해당 구절에서 장소가 언급되는 맥락
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_place_verse UNIQUE (place_id, reference)
);

-- 3. 성경 인물 테이블
CREATE TABLE IF NOT EXISTS bible_people (
  id VARCHAR(20) PRIMARY KEY,
  name_korean VARCHAR(100) NOT NULL,       -- 한글 인물명
  name_english VARCHAR(100),               -- 영어 인물명
  name_hebrew VARCHAR(100),                -- 히브리어/아람어 원명
  name_greek VARCHAR(100),                 -- 헬라어 원명
  gender VARCHAR(10),                      -- male, female, unknown
  testament VARCHAR(10),                   -- 구약, 신약, 양쪽
  description TEXT,                        -- 인물 설명
  father_id VARCHAR(20) REFERENCES bible_people(id),
  mother_id VARCHAR(20) REFERENCES bible_people(id),
  spouse_ids TEXT[],                       -- 배우자 ID 배열
  created_at TIMESTAMP DEFAULT NOW()
);

-- 4. 인물-구절 연결 테이블
CREATE TABLE IF NOT EXISTS people_verses (
  id SERIAL PRIMARY KEY,
  person_id VARCHAR(20) NOT NULL REFERENCES bible_people(id) ON DELETE CASCADE,
  reference VARCHAR(50) NOT NULL,
  role VARCHAR(50),                        -- 주인공, 언급, 조상, 후손 등
  context TEXT,
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_person_verse UNIQUE (person_id, reference)
);

-- 5. 성경 사건 테이블
CREATE TABLE IF NOT EXISTS bible_events (
  id VARCHAR(20) PRIMARY KEY,
  name_korean VARCHAR(200) NOT NULL,       -- 한글 사건명
  name_english VARCHAR(200),               -- 영어 사건명
  event_type VARCHAR(50),                  -- miracle, battle, prophecy, covenant, journey, etc.
  testament VARCHAR(10),                   -- 구약, 신약
  start_reference VARCHAR(50),             -- 시작 구절
  end_reference VARCHAR(50),               -- 끝 구절
  description TEXT,
  significance TEXT,                       -- 신학적 의의
  created_at TIMESTAMP DEFAULT NOW()
);

-- 6. 사건-인물 연결 테이블
CREATE TABLE IF NOT EXISTS event_people (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(20) NOT NULL REFERENCES bible_events(id) ON DELETE CASCADE,
  person_id VARCHAR(20) NOT NULL REFERENCES bible_people(id) ON DELETE CASCADE,
  role VARCHAR(50),                        -- 주역, 조력자, 적대자, 목격자 등
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_event_person UNIQUE (event_id, person_id)
);

-- 7. 사건-장소 연결 테이블
CREATE TABLE IF NOT EXISTS event_places (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(20) NOT NULL REFERENCES bible_events(id) ON DELETE CASCADE,
  place_id VARCHAR(20) NOT NULL REFERENCES bible_places(id) ON DELETE CASCADE,
  role VARCHAR(50),                        -- 발생지, 경유지, 목적지 등
  created_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unique_event_place UNIQUE (event_id, place_id)
);

-- 8. 성경 주제/테마 마스터 테이블
CREATE TABLE IF NOT EXISTS bible_themes_master (
  id VARCHAR(50) PRIMARY KEY,
  name_korean VARCHAR(100) NOT NULL,
  name_english VARCHAR(100),
  category VARCHAR(50),                    -- 신학적, 윤리적, 실존적, 관계적 등
  parent_id VARCHAR(50) REFERENCES bible_themes_master(id),
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 9. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_bible_places_name ON bible_places(name_korean);
CREATE INDEX IF NOT EXISTS idx_bible_places_type ON bible_places(place_type);
CREATE INDEX IF NOT EXISTS idx_place_verses_place ON place_verses(place_id);
CREATE INDEX IF NOT EXISTS idx_place_verses_ref ON place_verses(reference);
CREATE INDEX IF NOT EXISTS idx_bible_people_name ON bible_people(name_korean);
CREATE INDEX IF NOT EXISTS idx_bible_people_testament ON bible_people(testament);
CREATE INDEX IF NOT EXISTS idx_people_verses_person ON people_verses(person_id);
CREATE INDEX IF NOT EXISTS idx_people_verses_ref ON people_verses(reference);
CREATE INDEX IF NOT EXISTS idx_bible_events_type ON bible_events(event_type);
CREATE INDEX IF NOT EXISTS idx_bible_events_testament ON bible_events(testament);

-- ============================================
-- 초기 데이터: 주요 성경 인물
-- ============================================

INSERT INTO bible_people (id, name_korean, name_english, name_hebrew, gender, testament, description)
VALUES
  -- 구약 주요 인물
  ('adam', '아담', 'Adam', 'אָדָם', 'male', '구약', '최초의 인간, 에덴동산의 첫 거주자'),
  ('eve', '하와', 'Eve', 'חַוָּה', 'female', '구약', '최초의 여성, 아담의 아내'),
  ('noah', '노아', 'Noah', 'נֹחַ', 'male', '구약', '대홍수에서 방주를 지어 인류를 구한 의인'),
  ('abraham', '아브라함', 'Abraham', 'אַבְרָהָם', 'male', '구약', '믿음의 조상, 이스라엘의 시조'),
  ('sarah', '사라', 'Sarah', 'שָׂרָה', 'female', '구약', '아브라함의 아내, 이삭의 어머니'),
  ('isaac', '이삭', 'Isaac', 'יִצְחָק', 'male', '구약', '아브라함의 아들, 야곱의 아버지'),
  ('rebekah', '리브가', 'Rebekah', 'רִבְקָה', 'female', '구약', '이삭의 아내, 야곱과 에서의 어머니'),
  ('jacob', '야곱', 'Jacob', 'יַעֲקֹב', 'male', '구약', '이스라엘이라는 이름을 받은 족장, 12지파의 아버지'),
  ('joseph', '요셉', 'Joseph', 'יוֹסֵף', 'male', '구약', '야곱의 아들, 애굽의 총리'),
  ('moses', '모세', 'Moses', 'מֹשֶׁה', 'male', '구약', '이스라엘의 지도자, 율법을 받은 선지자'),
  ('joshua', '여호수아', 'Joshua', 'יְהוֹשֻׁעַ', 'male', '구약', '모세의 후계자, 가나안 정복의 지도자'),
  ('ruth', '룻', 'Ruth', 'רוּת', 'female', '구약', '모압 여인, 다윗의 증조할머니'),
  ('samuel', '사무엘', 'Samuel', 'שְׁמוּאֵל', 'male', '구약', '마지막 사사이자 선지자, 사울과 다윗에게 기름 부음'),
  ('david', '다윗', 'David', 'דָּוִד', 'male', '구약', '이스라엘의 왕, 예수님의 조상, 시편의 저자'),
  ('solomon', '솔로몬', 'Solomon', 'שְׁלֹמֹה', 'male', '구약', '다윗의 아들, 지혜의 왕, 성전 건축자'),
  ('elijah', '엘리야', 'Elijah', 'אֵלִיָּהוּ', 'male', '구약', '위대한 선지자, 바알 선지자들과 대결'),
  ('elisha', '엘리사', 'Elisha', 'אֱלִישָׁע', 'male', '구약', '엘리야의 제자이자 후계자'),
  ('isaiah', '이사야', 'Isaiah', 'יְשַׁעְיָהוּ', 'male', '구약', '대선지자, 메시아 예언'),
  ('jeremiah', '예레미야', 'Jeremiah', 'יִרְמְיָהוּ', 'male', '구약', '눈물의 선지자, 바벨론 포로를 예언'),
  ('ezekiel', '에스겔', 'Ezekiel', 'יְחֶזְקֵאל', 'male', '구약', '포로기의 선지자, 환상의 선지자'),
  ('daniel', '다니엘', 'Daniel', 'דָּנִיֵּאל', 'male', '구약', '바벨론의 지혜자, 꿈 해석자'),
  ('job', '욥', 'Job', 'אִיּוֹב', 'male', '구약', '고난 중에도 신실함을 지킨 의인'),
  ('esther', '에스더', 'Esther', 'אֶסְתֵּר', 'female', '구약', '페르시아의 왕비, 유대인을 구원'),

  -- 신약 주요 인물
  ('jesus', '예수', 'Jesus', 'יֵשׁוּעַ', 'male', '신약', '하나님의 아들, 메시아, 인류의 구세주'),
  ('mary_mother', '마리아', 'Mary (Mother of Jesus)', 'מִרְיָם', 'female', '신약', '예수님의 어머니, 동정녀'),
  ('joseph_husband', '요셉', 'Joseph (Husband of Mary)', 'יוֹסֵף', 'male', '신약', '마리아의 남편, 예수님의 양아버지'),
  ('john_baptist', '세례 요한', 'John the Baptist', 'יוֹחָנָן', 'male', '신약', '예수님의 길을 예비한 선지자'),
  ('peter', '베드로', 'Peter', 'פֶּטְרוֹס', 'male', '신약', '예수님의 제자, 열두 사도의 대표'),
  ('john_apostle', '사도 요한', 'John (Apostle)', 'יוֹחָנָן', 'male', '신약', '사랑받는 제자, 요한복음 저자'),
  ('james_apostle', '야고보', 'James (Apostle)', 'יַעֲקֹב', 'male', '신약', '세베대의 아들, 요한의 형제'),
  ('paul', '바울', 'Paul', 'פַּאוּלוּס', 'male', '신약', '이방인의 사도, 서신서 저자'),
  ('matthew', '마태', 'Matthew', 'מַתִּתְיָהוּ', 'male', '신약', '세리였던 예수님의 제자, 복음서 저자'),
  ('luke', '누가', 'Luke', 'לוּקָס', 'male', '신약', '의사, 누가복음과 사도행전 저자'),
  ('mark', '마가', 'Mark', 'מַרְקוֹס', 'male', '신약', '마가복음 저자, 바나바의 조카'),
  ('mary_magdalene', '막달라 마리아', 'Mary Magdalene', 'מִרְיָם', 'female', '신약', '예수님의 제자, 부활의 첫 증인'),
  ('martha', '마르다', 'Martha', 'מַרְתָּא', 'female', '신약', '나사로와 마리아의 자매'),
  ('lazarus', '나사로', 'Lazarus', 'אֶלְעָזָר', 'male', '신약', '예수님이 죽음에서 살리신 베다니 사람'),
  ('thomas', '도마', 'Thomas', 'תוֹמָא', 'male', '신약', '의심했던 제자, 후에 신앙 고백'),
  ('judas', '유다', 'Judas Iscariot', 'יְהוּדָה', 'male', '신약', '예수님을 배반한 제자'),
  ('barnabas', '바나바', 'Barnabas', 'בַּרְנַבָּא', 'male', '신약', '바울의 동역자, 위로의 아들'),
  ('timothy', '디모데', 'Timothy', 'טִימוֹתֵאוֹס', 'male', '신약', '바울의 제자, 에베소 교회 감독'),
  ('stephen', '스데반', 'Stephen', 'סְטֶפָנוֹס', 'male', '신약', '첫 순교자, 집사')
ON CONFLICT (id) DO NOTHING;

-- 족보 관계 설정
UPDATE bible_people SET father_id = 'adam' WHERE id = 'eve';
UPDATE bible_people SET father_id = 'abraham', mother_id = 'sarah' WHERE id = 'isaac';
UPDATE bible_people SET father_id = 'isaac', mother_id = 'rebekah' WHERE id = 'jacob';
UPDATE bible_people SET father_id = 'jacob' WHERE id = 'joseph';
UPDATE bible_people SET father_id = 'david' WHERE id = 'solomon';

-- ============================================
-- 초기 데이터: 주요 성경 장소
-- ============================================

INSERT INTO bible_places (id, name_korean, name_english, place_type, place_class, latitude, longitude, description)
VALUES
  ('jerusalem', '예루살렘', 'Jerusalem', 'settlement', 'human', 31.7683, 35.2137, '다윗성, 성전의 도시, 예수님의 십자가와 부활의 장소'),
  ('bethlehem', '베들레헴', 'Bethlehem', 'settlement', 'human', 31.7054, 35.2024, '예수님의 탄생지, 다윗의 고향'),
  ('nazareth', '나사렛', 'Nazareth', 'settlement', 'human', 32.6996, 35.3035, '예수님이 자라신 곳'),
  ('capernaum', '가버나움', 'Capernaum', 'settlement', 'human', 32.8803, 35.5753, '갈릴리 사역의 중심지'),
  ('galilee_sea', '갈릴리 바다', 'Sea of Galilee', 'water', 'natural', 32.8234, 35.5872, '예수님의 많은 기적이 일어난 호수'),
  ('jordan_river', '요단강', 'Jordan River', 'river', 'natural', 32.5, 35.5, '예수님이 세례 받으신 강'),
  ('sinai', '시내산', 'Mount Sinai', 'mountain', 'natural', 28.5392, 33.9749, '모세가 십계명을 받은 산'),
  ('eden', '에덴동산', 'Garden of Eden', 'region', 'special', null, null, '아담과 하와가 처음 살았던 동산'),
  ('babylon', '바벨론', 'Babylon', 'settlement', 'human', 32.5363, 44.4209, '고대 제국의 수도, 포로지'),
  ('egypt', '애굽', 'Egypt', 'region', 'human', 26.8206, 30.8025, '이스라엘이 노예로 있었던 땅'),
  ('canaan', '가나안', 'Canaan', 'region', 'human', 31.5, 34.75, '약속의 땅'),
  ('bethany', '베다니', 'Bethany', 'settlement', 'human', 31.7607, 35.2575, '나사로, 마르다, 마리아의 마을'),
  ('gethsemane', '겟세마네', 'Gethsemane', 'settlement', 'human', 31.7793, 35.2397, '예수님이 기도하신 동산'),
  ('golgotha', '골고다', 'Golgotha', 'settlement', 'human', 31.7784, 35.2296, '예수님이 십자가에 못 박히신 곳'),
  ('antioch', '안디옥', 'Antioch', 'settlement', 'human', 36.2028, 36.1606, '초대교회의 중심지, 그리스도인 명칭의 시작'),
  ('rome', '로마', 'Rome', 'settlement', 'human', 41.9028, 12.4964, '로마 제국의 수도, 바울 서신의 수신지'),
  ('corinth', '고린도', 'Corinth', 'settlement', 'human', 37.9062, 22.8808, '바울이 전도한 그리스 도시'),
  ('ephesus', '에베소', 'Ephesus', 'settlement', 'human', 37.9411, 27.3419, '바울이 오래 머문 소아시아 도시'),
  ('damascus', '다마스쿠스', 'Damascus', 'settlement', 'human', 33.5138, 36.2765, '바울이 회심한 곳')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 초기 데이터: 주요 성경 사건
-- ============================================

INSERT INTO bible_events (id, name_korean, name_english, event_type, testament, start_reference, end_reference, description, significance)
VALUES
  ('creation', '천지 창조', 'Creation', 'miracle', '구약', '창세기 1:1', '창세기 2:25', '하나님이 천지를 창조하심', '하나님의 주권과 창조 사역의 선포'),
  ('flood', '노아의 홍수', 'The Flood', 'judgment', '구약', '창세기 6:1', '창세기 9:17', '온 세상을 덮은 대홍수', '죄에 대한 심판과 은혜의 구원'),
  ('babel', '바벨탑 사건', 'Tower of Babel', 'judgment', '구약', '창세기 11:1', '창세기 11:9', '언어의 혼잡과 민족의 흩어짐', '인간 교만에 대한 심판'),
  ('abraham_call', '아브라함의 소명', 'Call of Abraham', 'covenant', '구약', '창세기 12:1', '창세기 12:9', '하나님이 아브람을 부르심', '믿음의 여정의 시작, 이스라엘 역사의 시작'),
  ('exodus', '출애굽', 'The Exodus', 'deliverance', '구약', '출애굽기 12:1', '출애굽기 15:21', '이스라엘의 애굽 탈출', '하나님의 구원 사역의 원형'),
  ('sinai_covenant', '시내산 언약', 'Sinai Covenant', 'covenant', '구약', '출애굽기 19:1', '출애굽기 24:18', '모세가 율법을 받음', '하나님과 이스라엘의 언약 체결'),
  ('conquest', '가나안 정복', 'Conquest of Canaan', 'battle', '구약', '여호수아 1:1', '여호수아 12:24', '여호수아의 가나안 정복', '약속의 땅 성취'),
  ('david_goliath', '다윗과 골리앗', 'David and Goliath', 'battle', '구약', '사무엘상 17:1', '사무엘상 17:58', '다윗이 골리앗을 물리침', '믿음으로 거인을 이김'),
  ('temple_dedication', '성전 봉헌', 'Temple Dedication', 'worship', '구약', '열왕기상 8:1', '열왕기상 8:66', '솔로몬 성전 봉헌', '하나님의 임재의 장소'),
  ('exile', '바벨론 포로', 'Babylonian Exile', 'judgment', '구약', '열왕기하 25:1', '열왕기하 25:30', '유다 왕국의 멸망과 포로', '죄에 대한 심판과 회복의 약속'),
  ('virgin_birth', '예수님의 탄생', 'Birth of Jesus', 'miracle', '신약', '마태복음 1:18', '마태복음 2:12', '동정녀 마리아에게서 예수님 탄생', '하나님의 성육신'),
  ('baptism', '예수님의 세례', 'Baptism of Jesus', 'milestone', '신약', '마태복음 3:13', '마태복음 3:17', '요단강에서 세례 요한에게 세례', '공생애의 시작'),
  ('sermon_mount', '산상수훈', 'Sermon on the Mount', 'teaching', '신약', '마태복음 5:1', '마태복음 7:29', '예수님의 핵심 가르침', '천국 백성의 삶의 원리'),
  ('transfiguration', '변화산 사건', 'Transfiguration', 'miracle', '신약', '마태복음 17:1', '마태복음 17:13', '예수님의 영광스러운 변화', '예수님의 신성 확인'),
  ('raising_lazarus', '나사로의 부활', 'Raising of Lazarus', 'miracle', '신약', '요한복음 11:1', '요한복음 11:44', '죽은 나사로를 살리심', '부활의 예표'),
  ('last_supper', '최후의 만찬', 'Last Supper', 'covenant', '신약', '마태복음 26:17', '마태복음 26:30', '제자들과의 마지막 식사', '새 언약의 제정, 성찬의 기원'),
  ('crucifixion', '십자가 처형', 'Crucifixion', 'sacrifice', '신약', '마태복음 27:32', '마태복음 27:56', '예수님의 십자가 죽음', '인류 구원의 완성'),
  ('resurrection', '예수님의 부활', 'Resurrection', 'miracle', '신약', '마태복음 28:1', '마태복음 28:10', '사흘 만에 죽음에서 다시 살아나심', '죽음을 이기신 승리, 기독교 신앙의 핵심'),
  ('ascension', '승천', 'Ascension', 'milestone', '신약', '사도행전 1:9', '사도행전 1:11', '예수님의 하늘로 올라가심', '하나님 우편에 앉으심'),
  ('pentecost', '오순절 성령 강림', 'Pentecost', 'miracle', '신약', '사도행전 2:1', '사도행전 2:41', '성령의 강림과 교회의 탄생', '교회 시대의 시작'),
  ('paul_conversion', '바울의 회심', 'Conversion of Paul', 'miracle', '신약', '사도행전 9:1', '사도행전 9:22', '다마스쿠스 도상에서 바울의 회심', '이방 선교의 시작')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 초기 데이터: 주제 마스터
-- ============================================

INSERT INTO bible_themes_master (id, name_korean, name_english, category, description)
VALUES
  -- 신학적 주제
  ('salvation', '구원', 'Salvation', '신학적', '죄에서의 구원과 영생'),
  ('grace', '은혜', 'Grace', '신학적', '받을 자격 없는 자에게 주시는 하나님의 선물'),
  ('faith', '믿음', 'Faith', '신학적', '하나님과 그의 약속에 대한 신뢰'),
  ('redemption', '속량/구속', 'Redemption', '신학적', '대가를 치르고 자유케 함'),
  ('justification', '칭의', 'Justification', '신학적', '믿음으로 의롭다 함을 받음'),
  ('sanctification', '성화', 'Sanctification', '신학적', '거룩하게 되어가는 과정'),
  ('atonement', '대속', 'Atonement', '신학적', '죄를 대신하여 갚음'),
  ('covenant', '언약', 'Covenant', '신학적', '하나님과 인간 사이의 약속'),
  ('kingdom', '하나님 나라', 'Kingdom of God', '신학적', '하나님의 통치'),
  ('resurrection_theme', '부활', 'Resurrection', '신학적', '죽음에서 다시 살아남'),

  -- 윤리적 주제
  ('love', '사랑', 'Love', '윤리적', '하나님 사랑과 이웃 사랑'),
  ('forgiveness', '용서', 'Forgiveness', '윤리적', '죄나 잘못을 용납함'),
  ('obedience', '순종', 'Obedience', '윤리적', '하나님의 뜻에 따름'),
  ('humility', '겸손', 'Humility', '윤리적', '자신을 낮춤'),
  ('justice', '정의', 'Justice', '윤리적', '공의와 바른 판단'),
  ('mercy', '긍휼', 'Mercy', '윤리적', '불쌍히 여기는 마음'),
  ('holiness', '거룩', 'Holiness', '윤리적', '하나님을 위해 구별됨'),
  ('purity', '정결', 'Purity', '윤리적', '깨끗함, 죄로부터 자유'),
  ('generosity', '관용/나눔', 'Generosity', '윤리적', '베풂'),
  ('integrity', '성실/진실', 'Integrity', '윤리적', '정직과 일관성'),

  -- 실존적 주제
  ('hope', '소망', 'Hope', '실존적', '미래에 대한 기대'),
  ('peace', '평안', 'Peace', '실존적', '마음의 안정과 화평'),
  ('joy', '기쁨', 'Joy', '실존적', '하나님 안에서의 기쁨'),
  ('suffering', '고난', 'Suffering', '실존적', '고통과 시련'),
  ('comfort', '위로', 'Comfort', '실존적', '슬픔 중에 위안'),
  ('fear', '두려움', 'Fear', '실존적', '무서움과 불안'),
  ('trust', '신뢰', 'Trust', '실존적', '의지함'),
  ('patience', '인내', 'Patience', '실존적', '참고 기다림'),
  ('wisdom', '지혜', 'Wisdom', '실존적', '분별력과 통찰'),
  ('strength', '능력/힘', 'Strength', '실존적', '하나님이 주시는 힘'),

  -- 관계적 주제
  ('prayer', '기도', 'Prayer', '관계적', '하나님과의 대화'),
  ('worship', '예배', 'Worship', '관계적', '하나님을 높임'),
  ('fellowship', '교제', 'Fellowship', '관계적', '함께 나눔'),
  ('family', '가정', 'Family', '관계적', '가족 관계'),
  ('marriage', '결혼', 'Marriage', '관계적', '부부의 연합'),
  ('service', '섬김', 'Service', '관계적', '다른 사람을 돌봄'),
  ('discipleship', '제자도', 'Discipleship', '관계적', '예수님을 따름'),
  ('church', '교회', 'Church', '관계적', '그리스도의 몸'),
  ('evangelism', '전도', 'Evangelism', '관계적', '복음을 전함'),
  ('leadership', '지도력', 'Leadership', '관계적', '하나님의 백성을 인도함')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 인물-구절 연결 (샘플)
-- ============================================

INSERT INTO people_verses (person_id, reference, role, context)
VALUES
  ('abraham', '창세기 12:1', '주인공', '하나님의 부르심을 받음'),
  ('abraham', '창세기 15:6', '주인공', '믿음으로 의로 여김을 받음'),
  ('abraham', '창세기 22:1', '주인공', '이삭을 바치려 함'),
  ('moses', '출애굽기 3:1', '주인공', '불붙는 떨기나무에서 부름받음'),
  ('moses', '출애굽기 14:21', '주인공', '홍해를 가르심'),
  ('david', '사무엘상 17:45', '주인공', '골리앗에게 담대히 나아감'),
  ('david', '시편 23:1', '저자', '여호와는 나의 목자시니'),
  ('jesus', '요한복음 3:16', '주인공', '하나님이 세상을 이처럼 사랑하사'),
  ('jesus', '마태복음 5:1', '주인공', '산상수훈'),
  ('peter', '마태복음 16:16', '주인공', '주는 그리스도시요 살아계신 하나님의 아들'),
  ('paul', '사도행전 9:3', '주인공', '다메섹 도상에서 예수님을 만남'),
  ('paul', '로마서 8:28', '저자', '모든 것이 합력하여 선을 이루느니라')
ON CONFLICT (person_id, reference) DO NOTHING;

-- ============================================
-- 사건-인물, 사건-장소 연결 (샘플)
-- ============================================

INSERT INTO event_people (event_id, person_id, role)
VALUES
  ('creation', 'adam', '주역'),
  ('creation', 'eve', '주역'),
  ('flood', 'noah', '주역'),
  ('abraham_call', 'abraham', '주역'),
  ('exodus', 'moses', '주역'),
  ('david_goliath', 'david', '주역'),
  ('virgin_birth', 'jesus', '주역'),
  ('virgin_birth', 'mary_mother', '주역'),
  ('virgin_birth', 'joseph_husband', '조력자'),
  ('crucifixion', 'jesus', '주역'),
  ('crucifixion', 'peter', '목격자'),
  ('crucifixion', 'john_apostle', '목격자'),
  ('crucifixion', 'mary_mother', '목격자'),
  ('resurrection', 'jesus', '주역'),
  ('resurrection', 'mary_magdalene', '목격자'),
  ('pentecost', 'peter', '주역'),
  ('paul_conversion', 'paul', '주역')
ON CONFLICT (event_id, person_id) DO NOTHING;

INSERT INTO event_places (event_id, place_id, role)
VALUES
  ('creation', 'eden', '발생지'),
  ('exodus', 'egypt', '출발지'),
  ('sinai_covenant', 'sinai', '발생지'),
  ('conquest', 'canaan', '목적지'),
  ('virgin_birth', 'bethlehem', '발생지'),
  ('baptism', 'jordan_river', '발생지'),
  ('sermon_mount', 'galilee_sea', '인근지'),
  ('raising_lazarus', 'bethany', '발생지'),
  ('last_supper', 'jerusalem', '발생지'),
  ('crucifixion', 'golgotha', '발생지'),
  ('resurrection', 'jerusalem', '발생지'),
  ('ascension', 'jerusalem', '발생지'),
  ('pentecost', 'jerusalem', '발생지'),
  ('paul_conversion', 'damascus', '발생지')
ON CONFLICT (event_id, place_id) DO NOTHING;

-- ============================================
-- 그래프 탐색 함수: 구절과 연결된 인물 찾기
-- ============================================

CREATE OR REPLACE FUNCTION get_verse_people(
  verse_ref VARCHAR(50)
)
RETURNS TABLE (
  person_id VARCHAR(20),
  name_korean VARCHAR(100),
  role VARCHAR(50)
) AS $$
SELECT
  bp.id as person_id,
  bp.name_korean,
  pv.role
FROM people_verses pv
JOIN bible_people bp ON bp.id = pv.person_id
WHERE pv.reference = verse_ref
ORDER BY pv.role;
$$ LANGUAGE SQL;

-- ============================================
-- 그래프 탐색 함수: 구절과 연결된 장소 찾기
-- ============================================

CREATE OR REPLACE FUNCTION get_verse_places(
  verse_ref VARCHAR(50)
)
RETURNS TABLE (
  place_id VARCHAR(20),
  name_korean VARCHAR(100)
) AS $$
SELECT
  bp.id as place_id,
  bp.name_korean
FROM place_verses pv
JOIN bible_places bp ON bp.id = pv.place_id
WHERE pv.reference = verse_ref;
$$ LANGUAGE SQL;

-- ============================================
-- 그래프 탐색 함수: 인물 관련 구절 찾기
-- ============================================

CREATE OR REPLACE FUNCTION get_person_verses(
  p_person_id VARCHAR(20),
  max_results INT DEFAULT 10
)
RETURNS TABLE (
  reference VARCHAR(50),
  role VARCHAR(50),
  context TEXT
) AS $$
SELECT
  pv.reference,
  pv.role,
  pv.context
FROM people_verses pv
WHERE pv.person_id = p_person_id
ORDER BY pv.reference
LIMIT max_results;
$$ LANGUAGE SQL;

-- ============================================
-- 그래프 탐색 함수: 인물 관계 네트워크
-- ============================================

CREATE OR REPLACE FUNCTION get_related_people(
  p_person_id VARCHAR(20)
)
RETURNS TABLE (
  related_person_id VARCHAR(20),
  name_korean VARCHAR(100),
  relationship VARCHAR(50)
) AS $$
-- 부모
SELECT
  bp.id as related_person_id,
  bp.name_korean,
  '아버지' as relationship
FROM bible_people p
JOIN bible_people bp ON p.father_id = bp.id
WHERE p.id = p_person_id AND p.father_id IS NOT NULL

UNION ALL

SELECT
  bp.id,
  bp.name_korean,
  '어머니'
FROM bible_people p
JOIN bible_people bp ON p.mother_id = bp.id
WHERE p.id = p_person_id AND p.mother_id IS NOT NULL

UNION ALL

-- 자녀
SELECT
  bp.id,
  bp.name_korean,
  '자녀'
FROM bible_people bp
WHERE bp.father_id = p_person_id OR bp.mother_id = p_person_id

UNION ALL

-- 같은 사건에 참여한 인물
SELECT DISTINCT
  bp.id,
  bp.name_korean,
  '동역자'
FROM event_people ep1
JOIN event_people ep2 ON ep1.event_id = ep2.event_id
JOIN bible_people bp ON ep2.person_id = bp.id
WHERE ep1.person_id = p_person_id
  AND ep2.person_id != p_person_id;
$$ LANGUAGE SQL;
