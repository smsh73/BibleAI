import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function main() {
  // 설교 데이터
  const { count: sermonCount } = await supabase
    .from('sermons')
    .select('*', { count: 'exact', head: true })

  const { count: sermonChunkCount } = await supabase
    .from('sermon_chunks')
    .select('*', { count: 'exact', head: true })

  const { count: sermonEmbeddedCount } = await supabase
    .from('sermon_chunks')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  // 뉴스 데이터
  const { count: newsIssueCount } = await supabase
    .from('news_issues')
    .select('*', { count: 'exact', head: true })

  const { count: newsChunkCount } = await supabase
    .from('news_chunks')
    .select('*', { count: 'exact', head: true })

  const { count: newsEmbeddedCount } = await supabase
    .from('news_chunks')
    .select('*', { count: 'exact', head: true })
    .not('embedding', 'is', null)

  console.log('📺 설교 데이터:')
  console.log('   설교 수: ' + (sermonCount || 0))
  console.log('   청크 수: ' + (sermonChunkCount || 0))
  console.log('   임베딩: ' + (sermonEmbeddedCount || 0))

  console.log('\n📰 뉴스 데이터:')
  console.log('   호수: ' + (newsIssueCount || 0))
  console.log('   청크 수: ' + (newsChunkCount || 0))
  console.log('   임베딩: ' + (newsEmbeddedCount || 0))
}

main().catch(e => console.error(e.message))
