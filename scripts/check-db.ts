import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function main() {
  console.log('📊 데이터베이스 현재 상태:\n')

  // 전체 카운트
  const { count: totalCount } = await supabase
    .from('bible_verses')
    .select('*', { count: 'exact', head: true })

  console.log('총 구절 수: ' + (totalCount || 0).toLocaleString() + '개')

  // GAE 버전 카운트
  const { count: gaeCount } = await supabase
    .from('bible_verses')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', 'GAE')

  console.log('GAE (개역개정): ' + (gaeCount || 0).toLocaleString() + '개')

  // NIV 버전 카운트
  const { count: nivCount } = await supabase
    .from('bible_verses')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', 'NIV')

  console.log('NIV: ' + (nivCount || 0).toLocaleString() + '개')

  // GAE 임베딩 카운트
  const { count: gaeEmbedded } = await supabase
    .from('bible_verses')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', 'GAE')
    .not('embedding', 'is', null)

  console.log('\nGAE 임베딩 완료: ' + (gaeEmbedded || 0).toLocaleString() + '개')

  // NIV 임베딩 카운트
  const { count: nivEmbedded } = await supabase
    .from('bible_verses')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', 'NIV')
    .not('embedding', 'is', null)

  console.log('NIV 임베딩 완료: ' + (nivEmbedded || 0).toLocaleString() + '개')

  // NIV 샘플 데이터
  const { data: nivSamples } = await supabase
    .from('bible_verses')
    .select('reference, content')
    .eq('version_id', 'NIV')
    .limit(3)

  if (nivSamples && nivSamples.length > 0) {
    console.log('\nNIV 샘플:')
    nivSamples.forEach(v => {
      const content = v.content || ''
      console.log('  ' + v.reference + ': ' + content.substring(0, 60) + '...')
    })
  }
}

main().catch(console.error)
