/**
 * 성경 벡터 임베딩 스크립트 (멀티버전 지원)
 *
 * 사용법:
 *   cd bible-chatbot
 *   npx tsx scripts/embed-bible.ts status           # 임베딩 상태 확인
 *   npx tsx scripts/embed-bible.ts embed GAE        # 개역개정 임베딩
 *   npx tsx scripts/embed-bible.ts embed KRV        # 개역한글 임베딩
 *   npx tsx scripts/embed-bible.ts search "검색어"  # 검색 테스트
 *
 * 지원 버전:
 *   - GAE: 개역개정 (기본값)
 *   - KRV: 개역한글
 *   - NIV: New International Version
 *   - ESV: English Standard Version
 *
 * 주의:
 *   - Supabase SQL 스키마가 먼저 실행되어야 합니다 (sql/setup-pgvector.sql)
 *   - 멀티버전 마이그레이션 필요: sql/migrate-to-multiversion.sql
 *   - .env.local에 SUPABASE_SERVICE_KEY가 설정되어야 합니다
 *   - OpenAI API 비용: 약 31,000 구절 × $0.00002/1K tokens ≈ $0.62
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// 환경 변수 로드
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set')
  process.exit(1)
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_KEY is not set')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 지원 버전 목록
const SUPPORTED_VERSIONS = ['GAE', 'KRV', 'NIV', 'ESV'] as const
type BibleVersionId = typeof SUPPORTED_VERSIONS[number]

// 타입 정의
interface BibleData {
  version?: string       // 버전 ID (GAE, KRV 등)
  version_name?: string  // 버전 이름 (개역개정, 개역한글 등)
  language?: string      // 언어 (ko, en)
  구약: Record<string, BookData>
  신약: Record<string, BookData>
  metadata?: any
}

interface BookData {
  book_number: number
  total_chapters: number
  chapters: Record<string, Record<string, string>>
}

interface BibleVerse {
  testament: '구약' | '신약'
  book_name: string
  book_number: number
  chapter: number
  verse: number
  content: string
  reference: string
  version_id: string  // 버전 ID 추가
}

// 성경 JSON 파싱 (버전 지원)
function parseBibleJson(filePath: string, versionId: string): BibleVerse[] {
  console.log(`📖 성경 데이터 로드 중: ${filePath} (버전: ${versionId})`)

  const rawData = fs.readFileSync(filePath, 'utf-8')
  const data: BibleData = JSON.parse(rawData)

  // JSON에 버전 정보가 있으면 확인
  const fileVersion = data.version || versionId
  if (fileVersion && fileVersion !== versionId) {
    console.log(`⚠️ 파일 버전(${fileVersion})과 요청 버전(${versionId})이 다릅니다. 요청 버전 사용.`)
  }

  const verses: BibleVerse[] = []

  for (const testament of ['구약', '신약'] as const) {
    const books = data[testament]
    if (!books) continue

    for (const [bookName, bookData] of Object.entries(books)) {
      for (const [chapterNum, chapterVerses] of Object.entries(bookData.chapters)) {
        for (const [verseNum, content] of Object.entries(chapterVerses)) {
          verses.push({
            testament,
            book_name: bookName,
            book_number: bookData.book_number,
            chapter: parseInt(chapterNum),
            verse: parseInt(verseNum),
            content,
            reference: `${bookName} ${chapterNum}:${verseNum}`,
            version_id: versionId  // 버전 ID 포함
          })
        }
      }
    }
  }

  console.log(`✅ 총 ${verses.length}개 구절 파싱 완료 (버전: ${versionId})`)
  return verses
}

// 배치 임베딩 생성
async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
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
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown'}`)
  }

  const data = await response.json()
  return data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding)
}

// 메인 임베딩 함수
async function embedBibleVerses(verses: BibleVerse[]) {
  const BATCH_SIZE = 100  // 한 번에 처리할 구절 수
  const EMBEDDING_BATCH_SIZE = 500  // OpenAI 배치 크기

  let totalSuccess = 0
  let totalFailed = 0
  let totalCost = 0

  console.log(`\n🚀 임베딩 시작: ${verses.length}개 구절`)
  console.log(`📦 배치 크기: ${BATCH_SIZE}개`)
  console.log(`💰 예상 비용: $${(verses.length * 0.00002).toFixed(2)}\n`)

  const startTime = Date.now()

  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(verses.length / BATCH_SIZE)

    process.stdout.write(`\r[${batchNum}/${totalBatches}] 처리 중... (${totalSuccess}/${verses.length} 완료)`)

    try {
      // 1. 임베딩 생성 (더 작은 배치로 분할)
      const embeddingsAll: number[][] = []

      for (let j = 0; j < batch.length; j += EMBEDDING_BATCH_SIZE) {
        const embeddingBatch = batch.slice(j, j + EMBEDDING_BATCH_SIZE)
        const texts = embeddingBatch.map(v => v.content)
        const embeddings = await generateEmbeddingsBatch(texts)
        embeddingsAll.push(...embeddings)

        // 토큰 비용 계산 (대략)
        const tokens = texts.join(' ').length / 4
        totalCost += tokens * 0.00002 / 1000

        // Rate limit 방지
        if (j + EMBEDDING_BATCH_SIZE < batch.length) {
          await new Promise(resolve => setTimeout(resolve, 200))
        }
      }

      // 2. Supabase에 업로드
      const versesWithEmbeddings = batch.map((v, idx) => ({
        ...v,
        embedding: embeddingsAll[idx]
      }))

      const { error } = await supabase
        .from('bible_verses')
        .upsert(versesWithEmbeddings, {
          onConflict: 'version_id,book_name,chapter,verse'  // 버전 포함
        })

      if (error) {
        console.error(`\n❌ 배치 ${batchNum} 업로드 실패:`, error.message)
        totalFailed += batch.length
      } else {
        totalSuccess += batch.length
      }

    } catch (error: any) {
      console.error(`\n❌ 배치 ${batchNum} 오류:`, error.message)
      totalFailed += batch.length

      // Rate limit 오류 시 더 오래 대기
      if (error.message?.includes('rate limit')) {
        console.log('⏳ Rate limit 대기 중... (60초)')
        await new Promise(resolve => setTimeout(resolve, 60000))
      }
    }

    // 다음 배치 전 대기
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  const elapsed = (Date.now() - startTime) / 1000

  console.log(`\n\n✅ 임베딩 완료!`)
  console.log(`📊 결과:`)
  console.log(`   - 성공: ${totalSuccess}개`)
  console.log(`   - 실패: ${totalFailed}개`)
  console.log(`   - 소요 시간: ${Math.floor(elapsed / 60)}분 ${Math.floor(elapsed % 60)}초`)
  console.log(`   - 예상 비용: $${totalCost.toFixed(4)}`)
}

// 임베딩 상태 확인 (버전별)
async function checkEmbeddingStatus(versionId?: string) {
  console.log('\n📊 현재 임베딩 상태:')

  // 버전별 통계 조회
  const { data: versionStats, error } = await supabase
    .from('bible_verses')
    .select('version_id')

  if (error) {
    console.error('상태 조회 오류:', error.message)
  }

  // 버전별 그룹화
  const stats: Record<string, { total: number; embedded: number }> = {}

  if (versionStats) {
    for (const row of versionStats) {
      const vid = row.version_id || 'GAE'
      if (!stats[vid]) stats[vid] = { total: 0, embedded: 0 }
      stats[vid].total++
    }
  }

  // 임베딩 완료된 것만 카운트
  const { data: embeddedStats } = await supabase
    .from('bible_verses')
    .select('version_id')
    .not('embedding', 'is', null)

  if (embeddedStats) {
    for (const row of embeddedStats) {
      const vid = row.version_id || 'GAE'
      if (stats[vid]) stats[vid].embedded++
    }
  }

  // 전체 통계
  let totalAll = 0
  let embeddedAll = 0

  for (const [vid, s] of Object.entries(stats)) {
    totalAll += s.total
    embeddedAll += s.embedded
    const pct = s.total ? Math.round((s.embedded / s.total) * 100) : 0
    console.log(`   [${vid}] ${s.embedded}/${s.total} (${pct}%)`)
  }

  console.log(`   ────────────────`)
  console.log(`   총계: ${embeddedAll}/${totalAll} (${totalAll ? Math.round((embeddedAll / totalAll) * 100) : 0}%)`)

  // 특정 버전 요청시 해당 버전 통계 반환
  if (versionId && stats[versionId]) {
    return stats[versionId]
  }

  return { total: totalAll, embedded: embeddedAll }
}

// 임베딩 테스트
async function testEmbedding() {
  console.log('\n🧪 임베딩 테스트...')

  // 테스트 쿼리
  const testQuery = '두려워하지 말라 하나님이 함께 하시리라'

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: testQuery
    })
  })

  if (!response.ok) {
    console.error('❌ OpenAI 연결 실패')
    return false
  }

  const data = await response.json()
  const embedding = data.data[0].embedding

  console.log(`✅ OpenAI 연결 성공 (임베딩 차원: ${embedding.length})`)

  // Supabase 연결 테스트
  const { data: testData, error } = await supabase
    .from('bible_verses')
    .select('id')
    .limit(1)

  if (error) {
    console.error('❌ Supabase 연결 실패:', error.message)
    return false
  }

  console.log('✅ Supabase 연결 성공')

  return true
}

// 벡터 검색 테스트
async function testVectorSearch(query: string) {
  console.log(`\n🔍 검색 테스트: "${query}"`)

  // 쿼리 임베딩 생성
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: query
    })
  })

  const data = await response.json()
  const queryEmbedding = data.data[0].embedding

  // 벡터 검색
  const { data: results, error } = await supabase.rpc('vector_search_bible', {
    query_embedding: queryEmbedding,
    match_count: 5,
    filter_testament: null
  })

  if (error) {
    console.error('❌ 검색 오류:', error.message)
    return
  }

  console.log('\n📖 검색 결과:')
  results?.forEach((r: any, i: number) => {
    console.log(`\n${i + 1}. ${r.reference} (유사도: ${(r.similarity * 100).toFixed(1)}%)`)
    console.log(`   "${r.content}"`)
  })
}

// 메인 실행
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('   BibleAI 벡터 임베딩 스크립트 (멀티버전)')
  console.log('═══════════════════════════════════════════════')

  // 1. 연결 테스트
  const isConnected = await testEmbedding()
  if (!isConnected) {
    console.error('\n❌ 연결 테스트 실패. 환경 변수를 확인하세요.')
    process.exit(1)
  }

  // 2. 명령어 처리
  const command = process.argv[2] || 'status'
  const versionArg = process.argv[3]?.toUpperCase() as BibleVersionId | undefined

  switch (command) {
    case 'status':
      // 상태 확인
      await checkEmbeddingStatus()
      break

    case 'embed': {
      // 임베딩 실행 (버전 지정 필수)
      const version = versionArg || 'GAE'
      if (!SUPPORTED_VERSIONS.includes(version as any)) {
        console.error(`\n❌ 지원하지 않는 버전: ${version}`)
        console.log(`   지원 버전: ${SUPPORTED_VERSIONS.join(', ')}`)
        break
      }

      console.log(`\n📌 버전: ${version}`)

      // 해당 버전 상태 확인
      const { total, embedded } = await checkEmbeddingStatus(version)

      if (embedded > 0 && embedded >= total && total > 0) {
        console.log(`\n✅ ${version} 버전의 모든 구절이 이미 임베딩되었습니다.`)
        break
      }

      // JSON 파일 경로 (버전별)
      const bibleJsonPath = path.join(__dirname, `../../bible_${version.toLowerCase()}_full.json`)

      if (!fs.existsSync(bibleJsonPath)) {
        console.error(`\n❌ 성경 데이터 파일이 없습니다: ${bibleJsonPath}`)
        console.log(`   먼저 Python 스크립트로 데이터를 추출하세요:`)
        console.log(`   python extract_bible.py --version ${version}`)
        break
      }

      const verses = parseBibleJson(bibleJsonPath, version)

      // 이미 임베딩된 구절 제외
      if (embedded > 0) {
        const { data: existingVerses } = await supabase
          .from('bible_verses')
          .select('book_name, chapter, verse')
          .eq('version_id', version)
          .not('embedding', 'is', null)

        const existingSet = new Set(
          existingVerses?.map(v => `${v.book_name}-${v.chapter}-${v.verse}`)
        )

        const pendingVerses = verses.filter(
          v => !existingSet.has(`${v.book_name}-${v.chapter}-${v.verse}`)
        )

        if (pendingVerses.length === 0) {
          console.log(`\n✅ ${version} 버전의 모든 구절이 이미 임베딩되었습니다.`)
          break
        }

        console.log(`\n⏳ ${pendingVerses.length}개 구절 임베딩 대기 중...`)
        await embedBibleVerses(pendingVerses)
      } else {
        await embedBibleVerses(verses)
      }
      break
    }

    case 'search':
      // 검색 테스트
      const searchQuery = process.argv[3] || '하나님의 사랑'
      await testVectorSearch(searchQuery)
      break

    case 'reset': {
      // 임베딩 초기화 (주의!)
      const resetVersion = versionArg
      if (resetVersion) {
        console.log(`\n⚠️ ${resetVersion} 버전의 임베딩을 삭제합니다...`)
        const { error } = await supabase
          .from('bible_verses')
          .update({ embedding: null })
          .eq('version_id', resetVersion)

        if (error) {
          console.error('❌ 초기화 실패:', error.message)
        } else {
          console.log(`✅ ${resetVersion} 임베딩 초기화 완료`)
        }
      } else {
        console.log('\n⚠️ 모든 버전의 임베딩을 삭제합니다...')
        const { error } = await supabase
          .from('bible_verses')
          .update({ embedding: null })
          .neq('id', 0)

        if (error) {
          console.error('❌ 초기화 실패:', error.message)
        } else {
          console.log('✅ 임베딩 초기화 완료')
        }
      }
      break
    }

    default:
      console.log(`
사용법:
  npx tsx scripts/embed-bible.ts [command] [version]

명령어:
  status              현재 임베딩 상태 확인 (기본값)
  embed [VERSION]     성경 구절 임베딩 실행
  search "검색어"      벡터 검색 테스트
  reset [VERSION]     임베딩 삭제 (주의!)

지원 버전:
  GAE    개역개정 (기본값)
  KRV    개역한글
  NIV    New International Version
  ESV    English Standard Version

예시:
  npx tsx scripts/embed-bible.ts status
  npx tsx scripts/embed-bible.ts embed GAE
  npx tsx scripts/embed-bible.ts embed KRV
  npx tsx scripts/embed-bible.ts search "하나님의 사랑"
  npx tsx scripts/embed-bible.ts reset GAE
      `)
  }

  console.log('\n═══════════════════════════════════════════════')
}

main().catch(console.error)
