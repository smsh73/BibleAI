/**
 * NIV 성경 벡터 임베딩 스크립트
 *
 * 데이터베이스에 이미 업로드된 NIV 구절에 임베딩을 추가합니다.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('환경 변수가 설정되지 않았습니다.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const BATCH_SIZE = 100
const VERSION = 'NIV'

async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: texts
    })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`OpenAI API error: ${error.error?.message || response.status}`)
  }

  const data = await response.json()
  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding)
}

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('   NIV 성경 임베딩 스크립트')
  console.log('═══════════════════════════════════════════════\n')

  // 1. 임베딩되지 않은 NIV 구절 카운트
  console.log('📊 임베딩 대기 중인 NIV 구절 조회...')

  const { count: totalPending, error: countError } = await supabase
    .from('bible_verses')
    .select('*', { count: 'exact', head: true })
    .eq('version_id', VERSION)
    .is('embedding', null)

  if (countError) {
    console.error('카운트 오류:', countError.message)
    process.exit(1)
  }

  if (!totalPending || totalPending === 0) {
    console.log('✅ 모든 NIV 구절이 이미 임베딩되어 있습니다.')
    return
  }

  console.log(`📝 임베딩 대기: ${totalPending.toLocaleString()}개 구절\n`)

  // 2. 배치 단위로 조회 및 처리 (Supabase 기본 1000개 제한 우회)
  const FETCH_SIZE = 1000
  let processedTotal = 0

  // 3. 배치 처리 (반복적으로 1000개씩 조회)
  let successCount = 0
  let errorCount = 0
  const startTime = Date.now()

  while (true) {
    // 임베딩되지 않은 구절 1000개 조회
    const { data: pendingVerses, error: fetchError } = await supabase
      .from('bible_verses')
      .select('id, content, reference')
      .eq('version_id', VERSION)
      .is('embedding', null)
      .order('id')
      .limit(FETCH_SIZE)

    if (fetchError) {
      console.error('\n조회 오류:', fetchError.message)
      break
    }

    if (!pendingVerses || pendingVerses.length === 0) {
      break
    }

    // 이 배치 처리
    for (let i = 0; i < pendingVerses.length; i += BATCH_SIZE) {
      const batch = pendingVerses.slice(i, i + BATCH_SIZE)

      process.stdout.write(`\r처리 중... ${successCount.toLocaleString()}/${totalPending.toLocaleString()} (${Math.round(successCount / totalPending * 100)}%)`)

      try {
        // 임베딩 생성
        const texts = batch.map(v => v.content)
        const embeddings = await generateEmbeddings(texts)

        // 각 구절 업데이트
        for (let j = 0; j < batch.length; j++) {
          const { error: updateError } = await supabase
            .from('bible_verses')
            .update({ embedding: embeddings[j] })
            .eq('id', batch[j].id)

          if (updateError) {
            errorCount++
          } else {
            successCount++
          }
        }

        // Rate limit 방지
        await new Promise(resolve => setTimeout(resolve, 300))

      } catch (error: any) {
        console.error(`\n❌ 배치 오류:`, error.message)
        errorCount += batch.length

        // Rate limit 오류 시 더 오래 대기
        if (error.message?.includes('rate') || error.message?.includes('429')) {
          console.log('\n⏳ Rate limit 대기 중... (60초)')
          await new Promise(resolve => setTimeout(resolve, 60000))
        }
      }
    }

    processedTotal += pendingVerses.length
  }

  const elapsed = (Date.now() - startTime) / 1000

  console.log(`\n\n✅ 임베딩 완료!`)
  console.log(`📊 결과:`)
  console.log(`   - 성공: ${successCount.toLocaleString()}개`)
  console.log(`   - 실패: ${errorCount.toLocaleString()}개`)
  console.log(`   - 소요 시간: ${Math.floor(elapsed / 60)}분 ${Math.floor(elapsed % 60)}초`)
  console.log(`   - 예상 비용: $${(successCount * 0.00002).toFixed(4)}`)
}

main().catch(console.error)
