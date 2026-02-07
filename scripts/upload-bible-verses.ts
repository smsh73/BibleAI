/**
 * 성경 데이터 업로드 스크립트 (임베딩 없이)
 *
 * OpenAI API 없이 성경 구절만 데이터베이스에 업로드합니다.
 * 임베딩은 나중에 별도로 생성할 수 있습니다.
 *
 * 사용법:
 *   cd bible-chatbot
 *   npx tsx scripts/upload-bible-verses.ts GAE
 *   npx tsx scripts/upload-bible-verses.ts NIV
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

// 환경 변수 로드
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_KEY is not set')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// 지원 버전 목록
const SUPPORTED_VERSIONS = ['GAE', 'KRV', 'NIV', 'ESV'] as const
type BibleVersionId = typeof SUPPORTED_VERSIONS[number]

interface BibleData {
  version?: string
  version_name?: string
  language?: string
  구약: Record<string, BookData>
  신약: Record<string, BookData>
  metadata?: any
}

interface BookData {
  book_number: number
  total_chapters?: number
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
  version_id: string
}

function parseBibleJson(filePath: string, versionId: string): BibleVerse[] {
  console.log(`📖 성경 데이터 로드 중: ${filePath} (버전: ${versionId})`)

  const rawData = fs.readFileSync(filePath, 'utf-8')
  const data: BibleData = JSON.parse(rawData)

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
            version_id: versionId
          })
        }
      }
    }
  }

  console.log(`✅ 총 ${verses.length}개 구절 파싱 완료`)
  return verses
}

async function uploadVerses(verses: BibleVerse[]) {
  const BATCH_SIZE = 500
  let totalSuccess = 0
  let totalFailed = 0

  console.log(`\n🚀 업로드 시작: ${verses.length}개 구절`)

  const startTime = Date.now()

  for (let i = 0; i < verses.length; i += BATCH_SIZE) {
    const batch = verses.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const totalBatches = Math.ceil(verses.length / BATCH_SIZE)

    process.stdout.write(`\r[${batchNum}/${totalBatches}] 업로드 중... (${totalSuccess}/${verses.length})`)

    try {
      const { error } = await supabase
        .from('bible_verses')
        .upsert(batch, {
          onConflict: 'version_id,book_name,chapter,verse'
        })

      if (error) {
        console.error(`\n❌ 배치 ${batchNum} 오류:`, error.message)
        totalFailed += batch.length
      } else {
        totalSuccess += batch.length
      }
    } catch (error: any) {
      console.error(`\n❌ 배치 ${batchNum} 예외:`, error.message)
      totalFailed += batch.length
    }

    // 서버 부하 방지
    await new Promise(resolve => setTimeout(resolve, 200))
  }

  const elapsed = (Date.now() - startTime) / 1000

  console.log(`\n\n✅ 업로드 완료!`)
  console.log(`📊 결과:`)
  console.log(`   - 성공: ${totalSuccess}개`)
  console.log(`   - 실패: ${totalFailed}개`)
  console.log(`   - 소요 시간: ${Math.floor(elapsed)}초`)
}

async function checkStatus() {
  console.log('\n📊 현재 데이터베이스 상태:\n')

  const { data, error } = await supabase
    .from('bible_verses')
    .select('version_id')

  if (error) {
    console.error('❌ 조회 오류:', error.message)
    return
  }

  // 버전별 그룹화
  const stats: Record<string, number> = {}
  for (const row of data || []) {
    const vid = row.version_id || 'GAE'
    stats[vid] = (stats[vid] || 0) + 1
  }

  let total = 0
  for (const [vid, count] of Object.entries(stats)) {
    console.log(`   [${vid}] ${count.toLocaleString()}개 구절`)
    total += count
  }

  if (total === 0) {
    console.log('   (데이터 없음)')
  } else {
    console.log(`   ────────────────`)
    console.log(`   총계: ${total.toLocaleString()}개`)
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('   BibleAI 성경 데이터 업로드 (임베딩 없이)')
  console.log('═══════════════════════════════════════════════')

  // 연결 테스트
  const { error: testError } = await supabase
    .from('bible_verses')
    .select('id')
    .limit(1)

  if (testError) {
    console.error('❌ Supabase 연결 실패:', testError.message)
    process.exit(1)
  }
  console.log('✅ Supabase 연결 성공')

  const command = process.argv[2]?.toUpperCase()

  if (!command || command === 'STATUS') {
    await checkStatus()
    console.log(`
사용법:
  npx tsx scripts/upload-bible-verses.ts STATUS   현재 상태 확인
  npx tsx scripts/upload-bible-verses.ts GAE      개역개정 업로드
  npx tsx scripts/upload-bible-verses.ts NIV      NIV 업로드
`)
    return
  }

  if (!SUPPORTED_VERSIONS.includes(command as any)) {
    console.error(`\n❌ 지원하지 않는 버전: ${command}`)
    console.log(`   지원 버전: ${SUPPORTED_VERSIONS.join(', ')}`)
    return
  }

  const version = command as BibleVersionId
  const bibleJsonPath = path.join(__dirname, `../../bible_${version.toLowerCase()}_full.json`)

  if (!fs.existsSync(bibleJsonPath)) {
    console.error(`\n❌ 성경 데이터 파일이 없습니다: ${bibleJsonPath}`)
    console.log(`   먼저 Python 스크립트로 데이터를 추출하세요:`)
    console.log(`   python extract_bible.py --version ${version}`)
    return
  }

  const verses = parseBibleJson(bibleJsonPath, version)
  await uploadVerses(verses)
  await checkStatus()

  console.log('\n═══════════════════════════════════════════════')
}

main().catch(console.error)
