/**
 * 성경 상호참조 데이터 가져오기 스크립트
 *
 * 데이터 소스: OpenBible.info Cross References (Treasury of Scripture Knowledge 기반)
 * - 약 340,000개의 상호참조
 * - Creative Commons Attribution License
 *
 * 사용법:
 * npx ts-node scripts/import-cross-references.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as https from 'https'
import * as dotenv from 'dotenv'

// 환경 변수 로드
dotenv.config({ path: '.env.local' })

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase 환경 변수가 설정되지 않았습니다.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

// ============================================
// 영어 약어 → 한글 성경 이름 매핑
// ============================================

const BOOK_NAME_MAP: Record<string, string> = {
  // 구약 (39권)
  'Gen': '창세기',
  'Exod': '출애굽기',
  'Lev': '레위기',
  'Num': '민수기',
  'Deut': '신명기',
  'Josh': '여호수아',
  'Judg': '사사기',
  'Ruth': '룻기',
  '1Sam': '사무엘상',
  '2Sam': '사무엘하',
  '1Kgs': '열왕기상',
  '2Kgs': '열왕기하',
  '1Chr': '역대상',
  '2Chr': '역대하',
  'Ezra': '에스라',
  'Neh': '느헤미야',
  'Esth': '에스더',
  'Job': '욥기',
  'Ps': '시편',
  'Prov': '잠언',
  'Eccl': '전도서',
  'Song': '아가',
  'Isa': '이사야',
  'Jer': '예레미야',
  'Lam': '예레미야애가',
  'Ezek': '에스겔',
  'Dan': '다니엘',
  'Hos': '호세아',
  'Joel': '요엘',
  'Amos': '아모스',
  'Obad': '오바댜',
  'Jonah': '요나',
  'Mic': '미가',
  'Nah': '나훔',
  'Hab': '하박국',
  'Zeph': '스바냐',
  'Hag': '학개',
  'Zech': '스가랴',
  'Mal': '말라기',

  // 신약 (27권)
  'Matt': '마태복음',
  'Mark': '마가복음',
  'Luke': '누가복음',
  'John': '요한복음',
  'Acts': '사도행전',
  'Rom': '로마서',
  '1Cor': '고린도전서',
  '2Cor': '고린도후서',
  'Gal': '갈라디아서',
  'Eph': '에베소서',
  'Phil': '빌립보서',
  'Col': '골로새서',
  '1Thess': '데살로니가전서',
  '2Thess': '데살로니가후서',
  '1Tim': '디모데전서',
  '2Tim': '디모데후서',
  'Titus': '디도서',
  'Phlm': '빌레몬서',
  'Heb': '히브리서',
  'Jas': '야고보서',
  '1Pet': '베드로전서',
  '2Pet': '베드로후서',
  '1John': '요한일서',
  '2John': '요한이서',
  '3John': '요한삼서',
  'Jude': '유다서',
  'Rev': '요한계시록'
}

// 관계 유형 결정 (투표 수 기반)
function determineRelationType(votes: number): string {
  if (votes >= 80) return 'quotation'        // 매우 강한 연결 - 인용
  if (votes >= 60) return 'parallel'         // 강한 연결 - 평행본문
  if (votes >= 40) return 'thematic'         // 중간 연결 - 주제적
  if (votes >= 20) return 'theological'      // 약한 연결 - 신학적
  return 'semantic'                           // 의미적 유사
}

// 관계 강도 계산 (0-1 스케일)
function calculateStrength(votes: number): number {
  // 최대 투표수를 300으로 가정
  const maxVotes = 300
  const normalized = Math.min(votes, maxVotes) / maxVotes
  return Math.round(normalized * 100) / 100
}

// 영어 참조를 한글 참조로 변환
// 예: "Gen.1.1" → "창세기 1:1"
// 예: "Prov.8.22-Prov.8.30" → "잠언 8:22-30"
function convertReference(engRef: string): string | null {
  try {
    // 범위 참조 처리 (예: Prov.8.22-Prov.8.30)
    if (engRef.includes('-')) {
      const parts = engRef.split('-')
      const start = convertSingleReference(parts[0])
      const endParts = parts[1].split('.')

      if (!start) return null

      // 같은 책의 범위면 끝 구절만 표시
      if (parts[0].split('.')[0] === endParts[0]) {
        const endVerse = endParts[endParts.length - 1]
        return `${start}-${endVerse}`
      }

      const end = convertSingleReference(parts[1])
      if (!end) return null
      return `${start} - ${end}`
    }

    return convertSingleReference(engRef)
  } catch {
    return null
  }
}

function convertSingleReference(ref: string): string | null {
  // 형식: Book.Chapter.Verse (예: Gen.1.1)
  const parts = ref.split('.')
  if (parts.length < 3) return null

  const bookAbbr = parts[0]
  const chapter = parts[1]
  const verse = parts[2]

  const koreanBook = BOOK_NAME_MAP[bookAbbr]
  if (!koreanBook) {
    // 알 수 없는 책 (외경 등)
    return null
  }

  return `${koreanBook} ${chapter}:${verse}`
}

// URL에서 텍스트 파일 다운로드
async function downloadFile(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // 리다이렉트 처리
        downloadFile(response.headers.location!).then(resolve).catch(reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      let data = ''
      response.on('data', chunk => data += chunk)
      response.on('end', () => resolve(data))
      response.on('error', reject)
    }).on('error', reject)
  })
}

// 데이터 파싱
interface CrossReference {
  sourceReference: string
  targetReference: string
  relationType: string
  strength: number
  description: string
}

function parseData(data: string): CrossReference[] {
  const lines = data.trim().split('\n')
  const references: CrossReference[] = []

  let skipped = 0
  let parsed = 0

  for (const line of lines) {
    // 주석이나 빈 줄 무시
    if (line.startsWith('#') || line.trim() === '') continue

    const parts = line.split('\t')
    if (parts.length < 3) continue

    const [fromRef, toRef, votesStr] = parts
    const votes = parseInt(votesStr, 10)

    // 음수 투표는 무시 (약한 연결)
    if (isNaN(votes) || votes < 0) {
      skipped++
      continue
    }

    // 한글 참조로 변환
    const sourceReference = convertReference(fromRef)
    const targetReference = convertReference(toRef)

    if (!sourceReference || !targetReference) {
      skipped++
      continue
    }

    // 자기 참조 무시
    if (sourceReference === targetReference) {
      skipped++
      continue
    }

    references.push({
      sourceReference,
      targetReference,
      relationType: determineRelationType(votes),
      strength: calculateStrength(votes),
      description: `OpenBible.info 상호참조 (투표: ${votes})`
    })

    parsed++
  }

  console.log(`파싱 완료: ${parsed}개 성공, ${skipped}개 건너뜀`)
  return references
}

// 배치 삽입
async function insertBatch(
  references: CrossReference[],
  batchSize: number = 1000
): Promise<{ success: number; failed: number }> {
  let success = 0
  let failed = 0

  const totalBatches = Math.ceil(references.length / batchSize)

  for (let i = 0; i < references.length; i += batchSize) {
    const batch = references.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1

    try {
      const { error } = await supabase
        .from('verse_relations')
        .upsert(
          batch.map(ref => ({
            source_reference: ref.sourceReference,
            target_reference: ref.targetReference,
            relation_type: ref.relationType,
            strength: ref.strength,
            description: ref.description
          })),
          {
            onConflict: 'source_reference,target_reference,relation_type',
            ignoreDuplicates: true
          }
        )

      if (error) {
        console.error(`배치 ${batchNum}/${totalBatches} 실패:`, error.message)
        failed += batch.length
      } else {
        success += batch.length
        console.log(`배치 ${batchNum}/${totalBatches} 완료 (${success}/${references.length})`)
      }
    } catch (err) {
      console.error(`배치 ${batchNum}/${totalBatches} 에러:`, err)
      failed += batch.length
    }

    // Rate limiting
    if (i + batchSize < references.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return { success, failed }
}

// 메인 함수
async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  성경 상호참조 데이터 가져오기')
  console.log('  데이터 소스: OpenBible.info (Treasury of Scripture Knowledge)')
  console.log('═══════════════════════════════════════════════════════════')
  console.log()

  const url = 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/sources/extras/cross_references.txt'

  console.log('1. 데이터 다운로드 중...')
  let data: string
  try {
    data = await downloadFile(url)
    console.log(`   다운로드 완료: ${(data.length / 1024 / 1024).toFixed(2)} MB`)
  } catch (err) {
    console.error('다운로드 실패:', err)
    process.exit(1)
  }

  console.log()
  console.log('2. 데이터 파싱 중...')
  const references = parseData(data)
  console.log(`   총 ${references.length}개 상호참조`)

  console.log()
  console.log('3. 관계 유형 통계:')
  const typeStats: Record<string, number> = {}
  for (const ref of references) {
    typeStats[ref.relationType] = (typeStats[ref.relationType] || 0) + 1
  }
  for (const [type, count] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${type}: ${count}개`)
  }

  console.log()
  console.log('4. 데이터베이스에 삽입 중...')
  const result = await insertBatch(references)

  console.log()
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  완료!')
  console.log(`  성공: ${result.success}개`)
  console.log(`  실패: ${result.failed}개`)
  console.log('═══════════════════════════════════════════════════════════')
}

main().catch(console.error)
