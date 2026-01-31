/**
 * OCR 및 기사 추출 테스트 스크립트
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { readFileSync } from 'fs'
import { performOCR, splitArticles, extractMetadata } from '../lib/news-extractor'

async function testOCR() {
  console.log('=== OCR 테스트 시작 ===\n')

  // 테스트 이미지 로드
  const imagePath = './test-images/504-page1.jpg'
  console.log(`이미지 경로: ${imagePath}`)

  try {
    const imageBuffer = readFileSync(imagePath)
    console.log(`이미지 크기: ${(imageBuffer.length / 1024).toFixed(1)}KB\n`)

    // 1. OCR 수행
    console.log('1. OCR 수행 중...')
    const startTime = Date.now()
    const { text: ocrText, provider } = await performOCR(imageBuffer, 'image/jpeg')
    const ocrTime = Date.now() - startTime
    console.log(`   - 제공자: ${provider}`)
    console.log(`   - 소요시간: ${(ocrTime / 1000).toFixed(1)}초`)
    console.log(`   - 추출된 텍스트 길이: ${ocrText.length}자\n`)

    // OCR 결과 출력 (일부)
    console.log('--- OCR 결과 (처음 2000자) ---')
    console.log(ocrText.substring(0, 2000))
    console.log('---\n')

    // 2. 기사 분리
    console.log('2. 기사 분리 중...')
    const articles = splitArticles(ocrText)
    console.log(`   - 분리된 기사 수: ${articles.length}개\n`)

    // 3. 각 기사별 메타데이터 추출
    console.log('3. 기사별 메타데이터 추출 중...')
    for (let i = 0; i < articles.length; i++) {
      console.log(`\n--- 기사 ${i + 1} ---`)
      console.log(`내용 (처음 300자): ${articles[i].substring(0, 300)}...`)

      const metadata = await extractMetadata(articles[i])
      console.log(`\n메타데이터:`)
      console.log(`  - 제목: ${metadata.title}`)
      console.log(`  - 유형: ${metadata.article_type || '미분류'}`)
      console.log(`  - 화자: ${metadata.speaker || '없음'}`)
      console.log(`  - 행사명: ${metadata.event_name || '없음'}`)
      console.log(`  - 성경구절: ${metadata.bible_references?.join(', ') || '없음'}`)
      console.log(`  - 키워드: ${metadata.keywords?.join(', ') || '없음'}`)
    }

    console.log('\n=== 테스트 완료 ===')

  } catch (error: any) {
    console.error('테스트 실패:', error.message)
    console.error(error.stack)
  }
}

testOCR()
