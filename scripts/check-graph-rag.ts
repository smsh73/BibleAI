/**
 * Graph RAG 데이터베이스 상태 확인 스크립트
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function main() {
  console.log('📊 Graph RAG 데이터베이스 상태:\n')

  // 1. verse_relations 테이블 확인
  const { data: relations, count: relCount, error: relError } = await supabase
    .from('verse_relations')
    .select('*', { count: 'exact' })

  if (relError) {
    console.log('❌ verse_relations 테이블 오류:', relError.message)
    if (relError.message.includes('does not exist')) {
      console.log('   → 테이블이 없습니다. create-verse-relations.sql을 실행하세요.')
    }
  } else {
    console.log('✅ verse_relations 테이블: ' + (relCount || 0) + '개 관계')
    if (relations && relations.length > 0) {
      console.log('   샘플 관계:')
      relations.slice(0, 3).forEach(r => {
        console.log('   - ' + r.source_reference + ' → ' + r.target_reference + ' (' + r.relation_type + ')')
      })
    }
  }

  // 2. verse_themes 테이블 확인
  const { count: themeCount, error: themeError } = await supabase
    .from('verse_themes')
    .select('*', { count: 'exact', head: true })

  if (themeError) {
    console.log('\n❌ verse_themes 테이블 오류:', themeError.message)
    if (themeError.message.includes('does not exist')) {
      console.log('   → 테이블이 없습니다. create-verse-relations.sql을 실행하세요.')
    }
  } else {
    console.log('\n✅ verse_themes 테이블: ' + (themeCount || 0) + '개 태그')
  }

  // 3. 함수 테스트
  try {
    const { data: testGraph, error: graphError } = await supabase
      .rpc('get_connected_verses', {
        start_reference: '요한복음 3:16',
        max_depth: 1,
        max_results: 5
      })

    if (graphError) {
      console.log('\n❌ get_connected_verses 함수 오류:', graphError.message)
    } else {
      console.log('\n✅ get_connected_verses 함수: 정상 동작')
      console.log('   요한복음 3:16과 연결된 구절:', (testGraph || []).length + '개')
    }
  } catch (e: any) {
    console.log('\n❌ 함수 테스트 실패:', e.message)
  }

  console.log('\n═══════════════════════════════════════════════')
}

main().catch(console.error)
