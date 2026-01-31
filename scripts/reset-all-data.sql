-- =============================================
-- 전체 데이터 초기화 스크립트
-- 기사 추출 및 벡터 임베딩 모두 삭제
-- Supabase SQL Editor에서 실행
-- =============================================

-- ⚠️ 주의: 이 스크립트는 모든 데이터를 삭제합니다!
-- 실행 전 반드시 백업을 생성하세요.

-- =============================================
-- 1. 뉴스 데이터 초기화
-- =============================================

-- 청크 데이터 삭제 (임베딩 포함)
TRUNCATE TABLE news_chunks CASCADE;

-- 기사 데이터 삭제
TRUNCATE TABLE news_articles CASCADE;

-- 페이지 데이터 삭제
TRUNCATE TABLE news_pages CASCADE;

-- 호수 데이터 삭제
TRUNCATE TABLE news_issues CASCADE;

-- =============================================
-- 2. 성경 임베딩 초기화 (구절 데이터는 유지)
-- =============================================

-- 성경 구절 임베딩만 NULL로 설정 (구절 텍스트는 유지)
UPDATE bible_verses SET embedding = NULL;

-- 또는 완전 삭제를 원하면:
-- TRUNCATE TABLE bible_verses CASCADE;

-- =============================================
-- 3. 설교 데이터 초기화
-- =============================================

-- 설교 청크 삭제
TRUNCATE TABLE sermon_chunks CASCADE;

-- 설교 데이터 삭제
TRUNCATE TABLE sermons CASCADE;

-- =============================================
-- 4. 시퀀스 리셋 (선택사항)
-- =============================================

-- ALTER SEQUENCE news_issues_id_seq RESTART WITH 1;
-- ALTER SEQUENCE news_pages_id_seq RESTART WITH 1;
-- ALTER SEQUENCE news_articles_id_seq RESTART WITH 1;
-- ALTER SEQUENCE news_chunks_id_seq RESTART WITH 1;
-- ALTER SEQUENCE sermons_id_seq RESTART WITH 1;
-- ALTER SEQUENCE sermon_chunks_id_seq RESTART WITH 1;

-- =============================================
-- 5. 초기화 확인
-- =============================================

SELECT 'news_issues' as table_name, COUNT(*) as row_count FROM news_issues
UNION ALL
SELECT 'news_pages', COUNT(*) FROM news_pages
UNION ALL
SELECT 'news_articles', COUNT(*) FROM news_articles
UNION ALL
SELECT 'news_chunks', COUNT(*) FROM news_chunks
UNION ALL
SELECT 'bible_verses', COUNT(*) FROM bible_verses
UNION ALL
SELECT 'bible_verses (with embedding)', COUNT(*) FROM bible_verses WHERE embedding IS NOT NULL
UNION ALL
SELECT 'sermons', COUNT(*) FROM sermons
UNION ALL
SELECT 'sermon_chunks', COUNT(*) FROM sermon_chunks;

-- =============================================
-- 롤백이 필요한 경우
-- =============================================
-- PostgreSQL은 DDL에 대해 트랜잭션을 지원합니다.
-- 문제 발생 시 Supabase 대시보드에서 Point-in-Time Recovery를 사용하세요.
