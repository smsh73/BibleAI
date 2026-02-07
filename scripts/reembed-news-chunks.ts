/**
 * News Chunks 재임베딩 스크립트
 * 768 -> 1536 차원 마이그레이션 후 실행
 *
 * 실행: npx ts-node scripts/reembed-news-chunks.ts
 * 또는: npx tsx scripts/reembed-news-chunks.ts
 *
 * 환경변수 필요:
 * - OPENAI_API_KEY
 * - NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_KEY
 */

import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import * as path from 'path'

// .env.local 로드
dotenv.config({ path: path.join(__dirname, '../.env.local') })

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

const BATCH_SIZE = 100  // DB에서 가져올 청크 수
const EMBEDDING_BATCH_SIZE = 50  // OpenAI 배치 크기

/**
 * 배치 임베딩 생성 (1536 차원)
 */
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
    dimensions: 1536
  })
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding)
}

/**
 * 모든 청크 재임베딩
 */
async function reembedAllChunks() {
  console.log('🔄 News Chunks 재임베딩 시작 (1536 차원)...\n')

  // 임베딩이 필요한 청크 수 확인
  const { count: totalCount, error: countError } = await supabase
    .from('news_chunks')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)

  if (countError) {
    console.error('❌ 청크 수 조회 실패:', countError.message)
    return
  }

  console.log(`📊 재임베딩이 필요한 청크 수: ${totalCount}`)

  if (totalCount === 0) {
    console.log('✅ 모든 청크가 이미 임베딩되어 있습니다!')
    return
  }

  let processed = 0
  let failed = 0
  let hasMore = true
  const startTime = Date.now()

  while (hasMore) {
    // 임베딩이 없는 청크 가져오기
    const { data: chunks, error } = await supabase
      .from('news_chunks')
      .select('id, chunk_text')
      .is('embedding', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE)

    if (error) {
      console.error('❌ 청크 조회 실패:', error.message)
      break
    }

    if (!chunks || chunks.length === 0) {
      hasMore = false
      break
    }

    // OpenAI 배치 크기로 분할 처리
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE)
      const texts = batch.map(c => c.chunk_text)

      try {
        const embeddings = await generateEmbeddingsBatch(texts)

        // 각 청크 업데이트
        for (let j = 0; j < batch.length; j++) {
          const { error: updateError } = await supabase
            .from('news_chunks')
            .update({ embedding: embeddings[j] })
            .eq('id', batch[j].id)

          if (updateError) {
            console.error(`❌ 청크 ${batch[j].id} 업데이트 실패:`, updateError.message)
            failed++
          } else {
            processed++
          }
        }

        // 진행률 표시
        const progress = ((processed + failed) / totalCount! * 100).toFixed(1)
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
        process.stdout.write(`\r⏳ 진행: ${processed}/${totalCount} (${progress}%) - 경과: ${elapsed}s`)

        // Rate limiting (200ms 대기)
        await new Promise(resolve => setTimeout(resolve, 200))

      } catch (embeddingError: any) {
        console.error('\n❌ 임베딩 오류:', embeddingError.message)

        // Rate limit 오류면 더 긴 대기
        if (embeddingError.message?.includes('rate limit')) {
          console.log('⏳ Rate limit - 10초 대기...')
          await new Promise(resolve => setTimeout(resolve, 10000))
        } else {
          // 다른 오류면 5초 대기 후 계속
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
        failed += batch.length
      }
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('\n\n✅ 재임베딩 완료!')
  console.log(`   - 성공: ${processed}개`)
  console.log(`   - 실패: ${failed}개`)
  console.log(`   - 총 소요시간: ${totalTime}초`)

  // 최종 확인
  const { count: remaining } = await supabase
    .from('news_chunks')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)

  if (remaining && remaining > 0) {
    console.log(`\n⚠️ 아직 임베딩이 필요한 청크: ${remaining}개`)
    console.log('   스크립트를 다시 실행해주세요.')
  }
}

/**
 * 임베딩 비용 추정
 */
async function estimateCost() {
  const { count } = await supabase
    .from('news_chunks')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null)

  if (!count) {
    console.log('임베딩이 필요한 청크가 없습니다.')
    return
  }

  // 평균 청크 크기: ~500자 = ~125 토큰
  const avgTokensPerChunk = 125
  const totalTokens = count * avgTokensPerChunk
  const costPer1MTokens = 0.02  // text-embedding-3-small 가격
  const estimatedCost = (totalTokens / 1_000_000) * costPer1MTokens

  console.log('💰 비용 추정:')
  console.log(`   - 청크 수: ${count}개`)
  console.log(`   - 예상 토큰: ~${totalTokens.toLocaleString()}`)
  console.log(`   - 예상 비용: ~$${estimatedCost.toFixed(4)}`)
}

// CLI 처리
const command = process.argv[2] || 'run'

switch (command) {
  case 'run':
    reembedAllChunks().catch(console.error)
    break
  case 'estimate':
    estimateCost().catch(console.error)
    break
  default:
    console.log('사용법:')
    console.log('  npx tsx scripts/reembed-news-chunks.ts run      - 재임베딩 실행')
    console.log('  npx tsx scripts/reembed-news-chunks.ts estimate - 비용 추정')
}
