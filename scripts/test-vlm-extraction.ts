/**
 * VLM 구조화 추출 vs 기존 OCR 비교 테스트
 *
 * 테스트 항목:
 * 1. 추출 정확도 (신문 이름 "열한시" 인식 여부)
 * 2. 추출 속도 (VLM vs OCR 시간 비교)
 * 3. 청크 텍스트 품질 (가독성, 완전성)
 *
 * 사용법: npx tsx scripts/test-vlm-extraction.ts
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface TestResult {
  method: string
  duration: number
  articleCount: number
  totalChars: number
  newspaperNameCorrect: boolean
  sampleText: string
  errors: string[]
}

async function main() {
  console.log('\n' + '='.repeat(70))
  console.log('🧪 VLM 구조화 추출 vs 기존 OCR 비교 테스트')
  console.log('='.repeat(70))

  // 1. 테스트 이미지 가져오기 (최신 호수의 첫 페이지)
  console.log('\n📥 테스트 이미지 가져오는 중...')

  const { data: latestPage, error: pageError } = await supabase
    .from('news_pages')
    .select('id, issue_id, page_number, image_url, ocr_text, ocr_provider')
    .order('id', { ascending: false })
    .limit(1)
    .single()

  if (pageError || !latestPage) {
    console.error('❌ 테스트 이미지를 찾을 수 없습니다:', pageError?.message)

    // 대안: 직접 URL에서 이미지 가져오기
    console.log('\n📥 웹에서 샘플 이미지 다운로드 중...')
    const testImageUrl = 'https://data.dimode.co.kr/sites/default/files/field/file/열한시_2024년11월호_1.jpg'

    try {
      const response = await fetch(testImageUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const imageBuffer = Buffer.from(await response.arrayBuffer())
      console.log(`✅ 이미지 다운로드 완료: ${(imageBuffer.length / 1024).toFixed(1)}KB`)

      await runExtractionTests(imageBuffer)
    } catch (fetchError: any) {
      console.error('❌ 이미지 다운로드 실패:', fetchError.message)
      console.log('\n💡 기존 DB 데이터로 청크 품질만 테스트합니다.')
      await testChunkQualityFromDB()
    }
    return
  }

  console.log(`✅ 테스트 이미지 발견: 페이지 ${latestPage.page_number}`)
  console.log(`   OCR 제공자: ${latestPage.ocr_provider}`)
  console.log(`   이미지 URL: ${latestPage.image_url?.substring(0, 60)}...`)

  // 이미지 다운로드
  if (latestPage.image_url) {
    try {
      const response = await fetch(latestPage.image_url)
      const imageBuffer = Buffer.from(await response.arrayBuffer())
      console.log(`✅ 이미지 다운로드 완료: ${(imageBuffer.length / 1024).toFixed(1)}KB`)

      await runExtractionTests(imageBuffer)
    } catch (fetchError: any) {
      console.error('❌ 이미지 다운로드 실패:', fetchError.message)
      console.log('\n💡 기존 OCR 결과로 품질 분석합니다.')
      analyzeExistingOCR(latestPage.ocr_text, latestPage.ocr_provider)
    }
  }

  // 청크 품질 테스트
  await testChunkQualityFromDB()
}

async function runExtractionTests(imageBuffer: Buffer) {
  console.log('\n' + '-'.repeat(70))
  console.log('📊 추출 테스트 시작')
  console.log('-'.repeat(70))

  const results: TestResult[] = []

  // 동적 import (ESM 모듈)
  const { extractStructuredWithVLM, performOCR, splitArticles } = await import('../lib/news-extractor')

  // ============ VLM 구조화 추출 테스트 ============
  console.log('\n🤖 [VLM 구조화 추출] 테스트 중...')
  const vlmStart = Date.now()

  try {
    const vlmResult = await extractStructuredWithVLM(imageBuffer, 'image/jpeg')
    const vlmDuration = Date.now() - vlmStart

    const vlmArticleCount = vlmResult.data.articles?.length || 0
    const vlmTotalChars = vlmResult.data.articles?.reduce((sum, a) => sum + (a.content?.length || 0), 0) || 0
    const vlmNewspaperCorrect = vlmResult.data.newspaper_name === '열한시' ||
                                 vlmResult.data.articles?.some(a => a.content?.includes('열한시'))

    results.push({
      method: `VLM-${vlmResult.provider}`,
      duration: vlmDuration,
      articleCount: vlmArticleCount,
      totalChars: vlmTotalChars,
      newspaperNameCorrect: vlmNewspaperCorrect,
      sampleText: vlmResult.data.articles?.[0]?.content?.substring(0, 200) || '',
      errors: vlmResult.corrections
    })

    console.log(`   ✅ 완료: ${vlmDuration}ms`)
    console.log(`   제공자: ${vlmResult.provider}`)
    console.log(`   기사 수: ${vlmArticleCount}개`)
    console.log(`   총 글자수: ${vlmTotalChars}자`)
    console.log(`   신문 이름 정확: ${vlmNewspaperCorrect ? '✅ 열한시' : '❌ 오류'}`)
    console.log(`   교정 적용: ${vlmResult.corrections.length}건`)

    if (vlmResult.data.articles?.[0]) {
      console.log(`   첫 기사 제목: ${vlmResult.data.articles[0].title}`)
    }
  } catch (vlmError: any) {
    console.log(`   ❌ 실패: ${vlmError.message}`)
    results.push({
      method: 'VLM',
      duration: Date.now() - vlmStart,
      articleCount: 0,
      totalChars: 0,
      newspaperNameCorrect: false,
      sampleText: '',
      errors: [vlmError.message]
    })
  }

  // ============ 기존 OCR 테스트 ============
  console.log('\n📝 [기존 OCR] 테스트 중...')
  const ocrStart = Date.now()

  try {
    const ocrResult = await performOCR(imageBuffer, 'image/jpeg', false) // 검증 없이
    const ocrDuration = Date.now() - ocrStart

    const ocrArticles = splitArticles(ocrResult.text)
    const ocrTotalChars = ocrResult.text.length
    const ocrNewspaperCorrect = ocrResult.text.includes('열한시')

    results.push({
      method: `OCR-${ocrResult.provider}`,
      duration: ocrDuration,
      articleCount: ocrArticles.length,
      totalChars: ocrTotalChars,
      newspaperNameCorrect: ocrNewspaperCorrect,
      sampleText: ocrResult.text.substring(0, 200),
      errors: []
    })

    console.log(`   ✅ 완료: ${ocrDuration}ms`)
    console.log(`   제공자: ${ocrResult.provider}`)
    console.log(`   기사 수: ${ocrArticles.length}개 (분리 후)`)
    console.log(`   총 글자수: ${ocrTotalChars}자`)
    console.log(`   신문 이름 정확: ${ocrNewspaperCorrect ? '✅ 열한시' : '❌ 오류'}`)

    // 오류 패턴 검색
    const errorPatterns = ['월한시', '월한세', '월간지', '한나홀', '위원목사']
    const foundErrors = errorPatterns.filter(p => ocrResult.text.includes(p))
    if (foundErrors.length > 0) {
      console.log(`   ⚠️ 발견된 오류 패턴: ${foundErrors.join(', ')}`)
    }
  } catch (ocrError: any) {
    console.log(`   ❌ 실패: ${ocrError.message}`)
    results.push({
      method: 'OCR',
      duration: Date.now() - ocrStart,
      articleCount: 0,
      totalChars: 0,
      newspaperNameCorrect: false,
      sampleText: '',
      errors: [ocrError.message]
    })
  }

  // ============ 기존 OCR + 검증 테스트 ============
  console.log('\n🔍 [기존 OCR + 검증] 테스트 중...')
  const ocrVerifyStart = Date.now()

  try {
    const ocrVerifyResult = await performOCR(imageBuffer, 'image/jpeg', true) // 검증 포함
    const ocrVerifyDuration = Date.now() - ocrVerifyStart

    const ocrVerifyArticles = splitArticles(ocrVerifyResult.text)
    const ocrVerifyTotalChars = ocrVerifyResult.text.length
    const ocrVerifyNewspaperCorrect = ocrVerifyResult.text.includes('열한시')

    results.push({
      method: `OCR+검증-${ocrVerifyResult.provider}`,
      duration: ocrVerifyDuration,
      articleCount: ocrVerifyArticles.length,
      totalChars: ocrVerifyTotalChars,
      newspaperNameCorrect: ocrVerifyNewspaperCorrect,
      sampleText: ocrVerifyResult.text.substring(0, 200),
      errors: []
    })

    console.log(`   ✅ 완료: ${ocrVerifyDuration}ms`)
    console.log(`   제공자: ${ocrVerifyResult.provider}`)
    console.log(`   기사 수: ${ocrVerifyArticles.length}개 (분리 후)`)
    console.log(`   총 글자수: ${ocrVerifyTotalChars}자`)
    console.log(`   신문 이름 정확: ${ocrVerifyNewspaperCorrect ? '✅ 열한시' : '❌ 오류'}`)
  } catch (ocrVerifyError: any) {
    console.log(`   ❌ 실패: ${ocrVerifyError.message}`)
  }

  // ============ 결과 비교 ============
  console.log('\n' + '='.repeat(70))
  console.log('📈 결과 비교')
  console.log('='.repeat(70))

  console.log('\n| 방법 | 시간 | 기사수 | 글자수 | 신문이름 |')
  console.log('|------|------|--------|--------|----------|')
  for (const r of results) {
    console.log(`| ${r.method.padEnd(20)} | ${(r.duration + 'ms').padEnd(8)} | ${String(r.articleCount).padEnd(6)} | ${String(r.totalChars).padEnd(6)} | ${r.newspaperNameCorrect ? '✅' : '❌'} |`)
  }

  // 최적 방법 추천
  const successfulResults = results.filter(r => r.articleCount > 0 && r.newspaperNameCorrect)
  if (successfulResults.length > 0) {
    const fastest = successfulResults.reduce((a, b) => a.duration < b.duration ? a : b)
    const mostArticles = successfulResults.reduce((a, b) => a.articleCount > b.articleCount ? a : b)

    console.log('\n💡 추천:')
    console.log(`   가장 빠른 방법: ${fastest.method} (${fastest.duration}ms)`)
    console.log(`   가장 많은 기사: ${mostArticles.method} (${mostArticles.articleCount}개)`)
  }

  // 샘플 텍스트 비교
  console.log('\n' + '-'.repeat(70))
  console.log('📝 샘플 텍스트 비교 (첫 200자)')
  console.log('-'.repeat(70))

  for (const r of results) {
    if (r.sampleText) {
      console.log(`\n[${r.method}]`)
      console.log(r.sampleText.substring(0, 200) + '...')
    }
  }
}

function analyzeExistingOCR(ocrText: string, provider: string) {
  console.log('\n📊 기존 OCR 결과 분석')
  console.log('-'.repeat(50))

  const hasCorrectName = ocrText.includes('열한시')
  const errorPatterns = ['월한시', '월한세', '월간지', '한나홀', '위원목사', '우임목사']
  const foundErrors = errorPatterns.filter(p => ocrText.includes(p))

  console.log(`   제공자: ${provider}`)
  console.log(`   총 글자수: ${ocrText.length}자`)
  console.log(`   신문 이름 정확: ${hasCorrectName ? '✅ 열한시' : '❌ 오류'}`)

  if (foundErrors.length > 0) {
    console.log(`   ⚠️ 발견된 오류 패턴: ${foundErrors.join(', ')}`)
  }

  console.log(`\n   샘플 (첫 300자):`)
  console.log('   ' + ocrText.substring(0, 300).replace(/\n/g, '\n   '))
}

async function testChunkQualityFromDB() {
  console.log('\n' + '='.repeat(70))
  console.log('📊 청크 텍스트 품질 분석 (DB 데이터)')
  console.log('='.repeat(70))

  // 최근 청크 가져오기
  const { data: chunks, error: chunkError } = await supabase
    .from('news_chunks')
    .select('id, chunk_text, article_title, issue_date, page_number')
    .order('id', { ascending: false })
    .limit(10)

  if (chunkError || !chunks || chunks.length === 0) {
    console.log('❌ 청크 데이터를 찾을 수 없습니다:', chunkError?.message)
    return
  }

  console.log(`\n📦 최근 ${chunks.length}개 청크 분석:`)
  console.log('-'.repeat(50))

  let totalLength = 0
  let errorCount = 0
  const errorPatterns = ['월한시', '월한세', '월간지', '한나홀', '위원목사', '우임목사', '요즘형']

  for (const chunk of chunks) {
    totalLength += chunk.chunk_text?.length || 0

    const foundErrors = errorPatterns.filter(p => chunk.chunk_text?.includes(p))
    if (foundErrors.length > 0) {
      errorCount++
      console.log(`\n⚠️ 오류 발견 - ${chunk.issue_date} p${chunk.page_number}`)
      console.log(`   기사: ${chunk.article_title}`)
      console.log(`   오류 패턴: ${foundErrors.join(', ')}`)
      console.log(`   내용: ${chunk.chunk_text?.substring(0, 100)}...`)
    }
  }

  const avgLength = Math.round(totalLength / chunks.length)
  const hasCorrectName = chunks.some(c => c.chunk_text?.includes('열한시'))

  console.log('\n' + '-'.repeat(50))
  console.log('📈 청크 품질 통계:')
  console.log(`   분석된 청크: ${chunks.length}개`)
  console.log(`   평균 청크 길이: ${avgLength}자`)
  console.log(`   오류 포함 청크: ${errorCount}개 (${((errorCount/chunks.length)*100).toFixed(1)}%)`)
  console.log(`   "열한시" 정확 인식: ${hasCorrectName ? '✅ 있음' : '❌ 없음'}`)

  // 샘플 청크 출력
  console.log('\n📝 샘플 청크 (가장 최근):')
  console.log('-'.repeat(50))
  const sampleChunk = chunks[0]
  console.log(`   호수: ${sampleChunk.issue_date}`)
  console.log(`   페이지: ${sampleChunk.page_number}`)
  console.log(`   기사: ${sampleChunk.article_title}`)
  console.log(`   길이: ${sampleChunk.chunk_text?.length}자`)
  console.log(`   내용:`)
  console.log('   ' + (sampleChunk.chunk_text?.substring(0, 400) || '').replace(/\n/g, '\n   '))
}

main().catch(console.error)
