/**
 * 주보 VLM 구조화 추출 테스트
 *
 * 테스트 항목:
 * 1. 추출 속도 (VLM vs 기존 OCR)
 * 2. 추출 품질 (섹션 수, 고유명사 인식)
 * 3. 정확도 (이름, 직분, 숫자)
 *
 * 사용법: npx tsx scripts/test-bulletin-vlm.ts
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface TestResult {
  method: string
  duration: number
  sectionCount: number
  totalChars: number
  namesFound: number
  confidence: number
  sampleContent: string
}

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('🧪 주보 VLM 구조화 추출 테스트')
  console.log('='.repeat(70))

  // 1. 테스트 이미지 가져오기
  console.log('\n📥 테스트 이미지 가져오는 중...')

  const { data: latestBulletin, error: bulletinError } = await supabase
    .from('bulletin_issues')
    .select('id, bulletin_date, board_id, status')
    .eq('status', 'completed')
    .order('bulletin_date', { ascending: false })
    .limit(1)
    .single()

  if (bulletinError || !latestBulletin) {
    console.log('❌ 완료된 주보가 없습니다. 웹에서 테스트 이미지 다운로드...')

    // 안양제일교회 주보 URL (샘플)
    const testImageUrl = 'https://data.dimode.co.kr/sites/default/files/field/file/anjeil_bulletin_sample.jpg'

    try {
      const response = await fetch(testImageUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const imageBuffer = Buffer.from(await response.arrayBuffer())
      console.log(`✅ 이미지 다운로드 완료: ${(imageBuffer.length / 1024).toFixed(1)}KB`)

      await runExtractionTests(imageBuffer)
    } catch (fetchError: any) {
      console.error('❌ 이미지 다운로드 실패:', fetchError.message)
      console.log('\n💡 기존 DB 청크 품질만 테스트합니다.')
      await testChunkQualityFromDB()
    }
    return
  }

  console.log(`✅ 주보 발견: ${latestBulletin.bulletin_date}`)

  // 주보 이미지 URL 가져오기
  const boardId = latestBulletin.board_id
  const detailUrl = `https://www.anyangjeil.org/Board/Detail/65/${boardId}`

  try {
    const response = await fetch(detailUrl)
    const html = await response.text()

    // 이미지 URL 추출
    const imgRegex = /src="(https:\/\/data\.dimode\.co\.kr[^"]+\.jpg)\s*"/g
    const matches = [...html.matchAll(imgRegex)]

    if (matches.length === 0) {
      console.log('❌ 이미지를 찾을 수 없습니다.')
      await testChunkQualityFromDB()
      return
    }

    // 첫 번째 이미지로 테스트
    const firstImageUrl = matches[0][1].trim()
    console.log(`📄 첫 페이지 이미지: ${firstImageUrl.substring(0, 50)}...`)

    const imgResponse = await fetch(firstImageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.anyangjeil.org/'
      }
    })

    if (!imgResponse.ok) throw new Error(`HTTP ${imgResponse.status}`)

    const imageBuffer = Buffer.from(await imgResponse.arrayBuffer())
    console.log(`✅ 이미지 다운로드 완료: ${(imageBuffer.length / 1024).toFixed(1)}KB`)

    await runExtractionTests(imageBuffer)
  } catch (error: any) {
    console.error('❌ 이미지 가져오기 실패:', error.message)
    await testChunkQualityFromDB()
  }

  // 청크 품질 테스트
  await testChunkQualityFromDB()
}

async function runExtractionTests(imageBuffer: Buffer) {
  console.log('\n' + '-'.repeat(70))
  console.log('📊 추출 테스트 시작')
  console.log('-'.repeat(70))

  const results: TestResult[] = []
  const base64 = imageBuffer.toString('base64')

  // 동적 import
  const { extractBulletinWithVLM, analyzeBulletinPage } = await import('../lib/bulletin-ocr')

  // ============ VLM 구조화 추출 테스트 ============
  console.log('\n🤖 [VLM 구조화 추출] 테스트 중...')
  const vlmStart = Date.now()

  try {
    const vlmResult = await extractBulletinWithVLM(base64, 'image/jpeg')
    const vlmDuration = Date.now() - vlmStart

    const sectionCount = vlmResult.data.sections?.length || 0
    const totalChars = vlmResult.data.sections?.reduce((sum, s) => sum + (s.content?.length || 0), 0) || 0
    const namesFound = vlmResult.data.proper_nouns?.names?.length || 0

    results.push({
      method: `VLM-${vlmResult.provider}`,
      duration: vlmDuration,
      sectionCount,
      totalChars,
      namesFound,
      confidence: vlmResult.data.uncertain_texts?.length === 0 ? 0.95 : 0.8,
      sampleContent: vlmResult.data.sections?.[0]?.content?.substring(0, 200) || ''
    })

    console.log(`   ✅ 완료: ${vlmDuration}ms`)
    console.log(`   제공자: ${vlmResult.provider}`)
    console.log(`   섹션 수: ${sectionCount}개`)
    console.log(`   총 글자수: ${totalChars}자`)
    console.log(`   이름 인식: ${namesFound}개`)
    console.log(`   교정 적용: ${vlmResult.corrections.length}건`)

    if (vlmResult.data.proper_nouns?.names?.length > 0) {
      console.log(`   인식된 이름: ${vlmResult.data.proper_nouns.names.slice(0, 5).join(', ')}`)
    }

  } catch (vlmError: any) {
    console.log(`   ❌ 실패: ${vlmError.message}`)
    results.push({
      method: 'VLM',
      duration: Date.now() - vlmStart,
      sectionCount: 0,
      totalChars: 0,
      namesFound: 0,
      confidence: 0,
      sampleContent: ''
    })
  }

  // ============ 기존 OCR (레거시) 테스트 ============
  console.log('\n📝 [기존 OCR + 검증] 테스트 중...')

  // 환경변수 임시 변경하여 레거시 모드 강제
  const originalEnv = process.env.USE_BULLETIN_VLM
  process.env.USE_BULLETIN_VLM = 'false'

  const ocrStart = Date.now()

  try {
    const ocrResult = await analyzeBulletinPage(base64, 1, 'image/jpeg')
    const ocrDuration = Date.now() - ocrStart

    const sectionCount = ocrResult.sections?.length || 0
    const totalChars = ocrResult.validatedText?.length || 0
    const namesFound = ocrResult.properNouns?.names?.length || 0

    results.push({
      method: 'OCR+검증',
      duration: ocrDuration,
      sectionCount,
      totalChars,
      namesFound,
      confidence: ocrResult.overallConfidence,
      sampleContent: ocrResult.validatedText?.substring(0, 200) || ''
    })

    console.log(`   ✅ 완료: ${ocrDuration}ms`)
    console.log(`   페이지 유형: ${ocrResult.pageType}`)
    console.log(`   섹션 수: ${sectionCount}개`)
    console.log(`   총 글자수: ${totalChars}자`)
    console.log(`   이름 인식: ${namesFound}개`)
    console.log(`   신뢰도: ${(ocrResult.overallConfidence * 100).toFixed(1)}%`)
    console.log(`   경고: ${ocrResult.warnings.length}건`)

  } catch (ocrError: any) {
    console.log(`   ❌ 실패: ${ocrError.message}`)
  }

  // 환경변수 복원
  process.env.USE_BULLETIN_VLM = originalEnv

  // ============ 결과 비교 ============
  console.log('\n' + '='.repeat(70))
  console.log('📈 결과 비교')
  console.log('='.repeat(70))

  console.log('\n| 방법 | 시간 | 섹션 | 글자수 | 이름 | 신뢰도 |')
  console.log('|------|------|------|--------|------|--------|')
  for (const r of results) {
    console.log(`| ${r.method.padEnd(12)} | ${(r.duration + 'ms').padEnd(8)} | ${String(r.sectionCount).padEnd(4)} | ${String(r.totalChars).padEnd(6)} | ${String(r.namesFound).padEnd(4)} | ${(r.confidence * 100).toFixed(0)}% |`)
  }

  // 속도 비교
  if (results.length >= 2) {
    const vlm = results.find(r => r.method.startsWith('VLM'))
    const ocr = results.find(r => r.method === 'OCR+검증')

    if (vlm && ocr && vlm.duration > 0 && ocr.duration > 0) {
      const speedup = ocr.duration / vlm.duration
      console.log('\n💡 분석:')
      console.log(`   VLM이 ${speedup.toFixed(1)}배 ${speedup > 1 ? '빠름' : '느림'}`)
      console.log(`   VLM 섹션: ${vlm.sectionCount}개 vs OCR 섹션: ${ocr.sectionCount}개`)
    }
  }

  // 샘플 텍스트 비교
  console.log('\n' + '-'.repeat(70))
  console.log('📝 샘플 텍스트 비교 (첫 200자)')
  console.log('-'.repeat(70))

  for (const r of results) {
    if (r.sampleContent) {
      console.log(`\n[${r.method}]`)
      console.log(r.sampleContent + '...')
    }
  }
}

async function testChunkQualityFromDB() {
  console.log('\n' + '='.repeat(70))
  console.log('📊 주보 청크 품질 분석 (DB 데이터)')
  console.log('='.repeat(70))

  // 최근 청크 가져오기
  const { data: chunks, error: chunkError } = await supabase
    .from('bulletin_chunks')
    .select('id, content, section_type, title, bulletin_date')
    .order('id', { ascending: false })
    .limit(20)

  if (chunkError || !chunks || chunks.length === 0) {
    console.log('❌ 청크 데이터를 찾을 수 없습니다:', chunkError?.message)
    return
  }

  console.log(`\n📦 최근 ${chunks.length}개 청크 분석:`)
  console.log('-'.repeat(50))

  let totalLength = 0
  let errorCount = 0
  const errorPatterns = ['위원목사', '우임목사', '한나홀', '전도샤']

  const sectionTypes: Record<string, number> = {}

  for (const chunk of chunks) {
    totalLength += chunk.content?.length || 0

    // 섹션 유형 통계
    const type = chunk.section_type || '기타'
    sectionTypes[type] = (sectionTypes[type] || 0) + 1

    // 오류 패턴 확인
    const foundErrors = errorPatterns.filter(p => chunk.content?.includes(p))
    if (foundErrors.length > 0) {
      errorCount++
      console.log(`\n⚠️ 오류 발견 - ${chunk.bulletin_date}`)
      console.log(`   섹션: ${chunk.section_type} - ${chunk.title}`)
      console.log(`   오류 패턴: ${foundErrors.join(', ')}`)
    }
  }

  const avgLength = Math.round(totalLength / chunks.length)

  console.log('\n' + '-'.repeat(50))
  console.log('📈 청크 품질 통계:')
  console.log(`   분석된 청크: ${chunks.length}개`)
  console.log(`   평균 청크 길이: ${avgLength}자`)
  console.log(`   오류 포함 청크: ${errorCount}개 (${((errorCount/chunks.length)*100).toFixed(1)}%)`)

  console.log('\n   섹션 유형 분포:')
  for (const [type, count] of Object.entries(sectionTypes).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${type}: ${count}개`)
  }

  // 샘플 청크 출력
  if (chunks[0]) {
    console.log('\n📝 샘플 청크 (가장 최근):')
    console.log('-'.repeat(50))
    console.log(`   날짜: ${chunks[0].bulletin_date}`)
    console.log(`   섹션: ${chunks[0].section_type}`)
    console.log(`   제목: ${chunks[0].title}`)
    console.log(`   길이: ${chunks[0].content?.length}자`)
    console.log(`   내용:`)
    console.log('   ' + (chunks[0].content?.substring(0, 400) || '').replace(/\n/g, '\n   '))
  }
}

main().catch(console.error)
