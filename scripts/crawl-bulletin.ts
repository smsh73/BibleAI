/**
 * 주보 크롤링 스크립트
 *
 * 1. 웹사이트에서 주보 목록 스캔
 * 2. 각 주보별 이미지 URL 수집
 * 3. OCR 처리 및 텍스트 추출
 * 4. 섹션별 청킹 (예배순서, 교회소식, 광고 등)
 * 5. 벡터 임베딩 생성
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const BASE_URL = 'https://www.anyangjeil.org'
const BOARD_ID = 65

// OCR 프롬프트 (주보용)
const OCR_PROMPT = `이 이미지는 한국 교회의 주보(예배순서지)의 한 페이지입니다.
이미지에서 모든 한글 텍스트를 정확하게 추출해주세요.

추출 규칙:
1. 섹션별로 구분하여 추출 (### 로 구분)
2. 각 섹션의 유형을 명시
3. 제목, 내용, 일시, 장소 등 구조화된 정보 추출
4. 원본 텍스트를 최대한 그대로 유지
5. 줄바꿈과 단락 구조 유지

형식:
### 섹션 1
유형: (예배순서/교회소식/광고/기도제목/헌금/봉사자/교회학교/성경봉독/찬송/새가족/감사/추모 등)
제목: (섹션 제목)
내용: (본문 내용)

### 섹션 2
...`

// 이미지 다운로드 및 base64 변환
async function downloadImageAsBase64(imageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'image/jpeg,image/png,image/*',
        'Referer': 'https://www.anyangjeil.org/'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(arrayBuffer).toString('base64')
    const contentType = response.headers.get('content-type') || 'image/jpeg'

    return `data:${contentType};base64,${base64}`
  } catch (error: any) {
    console.error(`\n   이미지 다운로드 실패: ${error.message}`)
    return null
  }
}

// 목록 페이지에서 주보 정보 수집
async function fetchBulletinsFromPage(page: number): Promise<any[]> {
  const url = `${BASE_URL}/Board/Index/${BOARD_ID}?page=${page}`
  const response = await fetch(url)
  const html = await response.text()

  const bulletins: any[] = []

  // 주보 링크 및 제목 추출 패턴
  // 예: href="/Board/Detail/65/66638" title="2026년 02월 01일 주보"
  const documentRegex = /<a[^>]*href="\/Board\/Detail\/65\/(\d+)[^"]*"[^>]*title="(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*주보"/g

  let match
  while ((match = documentRegex.exec(html)) !== null) {
    const boardId = parseInt(match[1])
    const year = parseInt(match[2])
    const month = parseInt(match[3])
    const day = parseInt(match[4])

    const bulletinDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    const title = `${year}년 ${month}월 ${day}일 주보`

    bulletins.push({
      bulletin_date: bulletinDate,
      title,
      board_id: boardId,
      year,
      month,
      day,
      page_count: 8,
      status: 'pending'
    })
  }

  return bulletins
}

// 특정 주보의 이미지 URL 추출
async function fetchBulletinImages(boardId: number): Promise<string[]> {
  const url = `${BASE_URL}/Board/Detail/${BOARD_ID}/${boardId}`
  const response = await fetch(url)
  const html = await response.text()

  const imageUrls: string[] = []
  const imgRegex = /src="(https:\/\/data\.dimode\.co\.kr[^"]+\.jpg)\s*"/g

  let match
  while ((match = imgRegex.exec(html)) !== null) {
    imageUrls.push(match[1].trim())
  }

  return imageUrls
}

// OCR 수행 (base64 이미지 사용)
async function performOCR(imageUrl: string): Promise<string> {
  try {
    const base64Image = await downloadImageAsBase64(imageUrl)

    if (!base64Image) {
      return ''
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            { type: 'image_url', image_url: { url: base64Image, detail: 'high' } }
          ]
        }
      ],
      max_tokens: 4096
    })

    return response.choices[0]?.message?.content || ''
  } catch (error: any) {
    console.error('OCR 오류:', error.message)
    return ''
  }
}

// 텍스트를 청크로 분할 (주보 섹션 기반)
function splitIntoChunks(text: string, issueId: number, pageNumber: number, bulletinDate: string, bulletinTitle: string): any[] {
  const chunks: any[] = []
  const sections = text.split(/###\s*섹션\s*\d+/i).filter(s => s.trim())

  const dateObj = new Date(bulletinDate)
  const year = dateObj.getFullYear()
  const month = dateObj.getMonth() + 1

  sections.forEach((section, idx) => {
    const typeMatch = section.match(/유형:\s*(.+)/i)
    const titleMatch = section.match(/제목:\s*(.+)/i)
    const contentMatch = section.match(/내용:\s*([\s\S]+)/i)

    const sectionType = typeMatch ? typeMatch[1].trim() : '기타'
    const title = titleMatch ? titleMatch[1].trim() : `섹션 ${idx + 1}`
    const content = contentMatch ? contentMatch[1].trim() : section.trim()

    if (content.length > 30) {
      chunks.push({
        issue_id: issueId,
        page_number: pageNumber,
        chunk_index: idx,
        section_type: sectionType,
        title,
        content: content.substring(0, 2000),
        bulletin_date: bulletinDate,
        bulletin_title: bulletinTitle,
        year,
        month
      })
    }
  })

  return chunks
}

// 임베딩 생성
async function createEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
    dimensions: 1536
  })
  return response.data[0].embedding
}

// 메인 크롤링 함수
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('   주보 전체 크롤링')
  console.log('═══════════════════════════════════════════════\n')

  // 1. 주보 스캔
  console.log('📋 주보 목록 스캔 중...')
  const allBulletins: any[] = []

  for (let page = 1; page <= 60; page++) {
    const bulletins = await fetchBulletinsFromPage(page)
    if (bulletins.length === 0) break
    allBulletins.push(...bulletins)
    console.log(`   페이지 ${page}: ${bulletins.length}개 주보 발견`)
    await new Promise(r => setTimeout(r, 500))
  }

  // 중복 제거
  const uniqueBulletins = allBulletins.filter((bulletin, index, self) =>
    index === self.findIndex(b => b.bulletin_date === bulletin.bulletin_date)
  )

  console.log(`\n✅ 총 ${uniqueBulletins.length}개 주보 발견\n`)

  // 2. DB에 주보 저장
  console.log('💾 주보 정보 저장 중...')
  let newCount = 0

  for (const bulletin of uniqueBulletins) {
    const { data: existing } = await supabase
      .from('bulletin_issues')
      .select('id')
      .eq('bulletin_date', bulletin.bulletin_date)
      .single()

    if (!existing) {
      const { error } = await supabase
        .from('bulletin_issues')
        .insert(bulletin)

      if (!error) newCount++
    }
  }

  console.log(`   새로운 주보 ${newCount}개 저장\n`)

  // 3. 처리할 주보 조회
  const { data: pendingBulletins } = await supabase
    .from('bulletin_issues')
    .select('*')
    .eq('status', 'pending')
    .order('bulletin_date', { ascending: false })
    .limit(5)

  if (!pendingBulletins || pendingBulletins.length === 0) {
    console.log('✅ 처리할 신규 주보가 없습니다.')
    return
  }

  console.log(`📰 ${pendingBulletins.length}개 주보 OCR 처리 시작...\n`)

  // 4. 각 주보 처리
  for (const bulletin of pendingBulletins) {
    console.log(`\n[${bulletin.title}] 처리 중...`)

    // 이미지 URL 가져오기
    const imageUrls = await fetchBulletinImages(bulletin.board_id)
    console.log(`   이미지 ${imageUrls.length}개 발견`)

    // 각 페이지 OCR 처리
    let totalChunks = 0

    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i]
      process.stdout.write(`   페이지 ${i + 1}/${imageUrls.length} OCR...`)

      const ocrText = await performOCR(imageUrl)

      if (ocrText) {
        // 청크 분할
        const chunks = splitIntoChunks(
          ocrText,
          bulletin.id,
          i + 1,
          bulletin.bulletin_date,
          bulletin.title
        )

        // 임베딩 및 저장
        for (const chunk of chunks) {
          try {
            const embedding = await createEmbedding(chunk.content)
            await supabase.from('bulletin_chunks').insert({
              ...chunk,
              embedding
            })
            totalChunks++
          } catch (e: any) {
            console.error(' 임베딩 오류:', e.message)
          }
        }

        console.log(` ✓ (${chunks.length}개 청크)`)
      } else {
        console.log(' ✗ (OCR 실패)')
      }

      // Rate limit 방지
      await new Promise(r => setTimeout(r, 2000))
    }

    // 주보 상태 업데이트
    await supabase
      .from('bulletin_issues')
      .update({ status: 'completed', page_count: imageUrls.length })
      .eq('id', bulletin.id)

    console.log(`   완료: ${totalChunks}개 청크 저장`)
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log('✅ 주보 크롤링 완료!')
  console.log('═══════════════════════════════════════════════')
}

main().catch(console.error)
