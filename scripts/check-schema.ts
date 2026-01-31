import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkSchema() {
  console.log('=== 데이터베이스 스키마 확인 ===\n')

  // 각 테이블의 컬럼 정보 조회
  const tables = ['news_issues', 'news_pages', 'news_articles', 'news_chunks']

  for (const table of tables) {
    console.log(`\n--- ${table} 테이블 ---`)

    // 테이블이 존재하는지 확인을 위해 빈 쿼리 실행
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(0)

    if (error) {
      console.log(`오류: ${error.message}`)
      console.log(`힌트: ${error.hint || '없음'}`)
    } else {
      console.log('테이블 존재함')

      // 실제 데이터 하나 가져와서 컬럼 확인
      const { data: sample, error: sampleError } = await supabase
        .from(table)
        .select('*')
        .limit(1)

      if (!sampleError && sample && sample.length > 0) {
        console.log('컬럼:', Object.keys(sample[0]).join(', '))
      } else {
        // 테이블이 비어있으면 insert 시도로 컬럼 확인
        console.log('(테이블이 비어있음 - insert 시도로 필요 컬럼 확인 필요)')
      }
    }
  }

  // 필요한 컬럼 정의
  console.log('\n\n=== 필요한 컬럼 정의 ===')
  console.log(`
news_issues:
  - id (auto)
  - issue_number (int)
  - issue_date (text)
  - year (int)
  - month (int)
  - board_id (int)
  - page_count (int)
  - source_type (text) <-- 누락 가능성
  - status (text)
  - created_at (timestamp)
  - updated_at (timestamp)

news_pages:
  - id (auto)
  - issue_id (int)
  - page_number (int)
  - image_url (text)
  - file_hash (text)
  - ocr_text (text)
  - ocr_provider (text)
  - status (text)

news_articles:
  - id (auto)
  - issue_id (int)
  - page_id (int)
  - title (text)
  - content (text)
  - article_type (text)
  - speaker (text)
  - event_name (text)
  - event_date (text)
  - bible_references (text[])
  - keywords (text[])

news_chunks:
  - id (auto)
  - article_id (int)
  - issue_id (int)
  - chunk_index (int)
  - chunk_text (text)
  - issue_number (int)
  - issue_date (text)
  - page_number (int)
  - article_title (text)
  - article_type (text)
  - embedding (vector(768))
  `)
}

checkSchema().catch(console.error)
