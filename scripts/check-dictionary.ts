/**
 * DB 사전 테이블 상태 확인
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

async function check() {
  // 사전 테이블 데이터 수 확인
  const { count: dictCount, error: dictError } = await supabase
    .from('church_dictionary')
    .select('*', { count: 'exact', head: true })

  console.log('church_dictionary 테이블:', dictCount || 0, '개 항목')
  if (dictError) console.log('오류:', dictError.message)

  // 사이트 구조 테이블
  const { count: structCount } = await supabase
    .from('church_site_structure')
    .select('*', { count: 'exact', head: true })

  console.log('church_site_structure 테이블:', structCount || 0, '개 항목')

  // 크롤 로그 확인
  const { data: logs } = await supabase
    .from('church_crawl_logs')
    .select('church_id, success, created_at, dictionary_count')
    .order('created_at', { ascending: false })
    .limit(10)

  console.log('\n최근 크롤링 로그:')
  if (logs && logs.length > 0) {
    logs.forEach(log => {
      console.log(`  - church_id: ${log.church_id}, 성공: ${log.success}, 사전: ${log.dictionary_count || 0}개`)
    })
  } else {
    console.log('  (로그 없음)')
  }

  // 샘플 사전 데이터
  const { data: sampleDict } = await supabase
    .from('church_dictionary')
    .select('term, category, church_id')
    .limit(10)

  console.log('\n샘플 사전 데이터:')
  if (sampleDict && sampleDict.length > 0) {
    sampleDict.forEach(d => {
      console.log(`  - ${d.term} (${d.category}) - church_id: ${d.church_id}`)
    })
  } else {
    console.log('  (데이터 없음)')
  }
}

check().catch(console.error)
