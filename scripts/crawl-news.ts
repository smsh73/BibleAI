/**
 * 열한시 신문 전체 크롤링 스크립트
 *
 * 1. 웹사이트에서 호수 목록 스캔
 * 2. 각 호수별 이미지 URL 수집
 * 3. OCR 처리 및 텍스트 추출
 * 4. 메타데이터 추출 및 청킹
 * 5. 벡터 임베딩 생성
 */

import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

const BASE_URL = 'https://www.anyangjeil.org'
const BOARD_ID = 66

// OCR 프롬프트
const OCR_PROMPT = `이 이미지는 한국 교회의 월간 신문 "열한시"의 한 면입니다.
이미지에서 모든 한글 텍스트를 정확하게 추출해주세요.

추출 규칙:
1. 제목, 소제목, 본문 내용을 모두 추출
2. 기사별로 구분하여 추출 (### 로 구분)
3. 사진 캡션도 포함
4. 광고 문구도 포함
5. 원본 텍스트를 최대한 그대로 유지
6. 줄바꿈과 단락 구조 유지

형식:
### 기사 1
제목: (제목)
유형: (목회편지/교회소식/행사안내/광고/인물소개/기타)
내용: (본문 내용)

### 기사 2
...`

// 목록 페이지에서 호수 정보 수집
async function fetchIssuesFromPage(page: number): Promise<any[]> {
  const url = `${BASE_URL}/Board/Index/${BOARD_ID}?page=${page}`
  const response = await fetch(url)
  const html = await response.text()

  const issues: any[] = []
  const documentRegex = /<div class="each-document">[\s\S]*?href="\/Board\/Detail\/66\/(\d+)[^"]*"[\s\S]*?<a class="title"[^>]*title="(\d{4})년\s*(\d{1,2})월호"/g

  let match
  while ((match = documentRegex.exec(html)) !== null) {
    const boardId = parseInt(match[1])
    const year = parseInt(match[2])
    const month = parseInt(match[3])

    const baseIssue = 433
    const baseYear = 2020
    const baseMonth = 2
    const monthsDiff = (year - baseYear) * 12 + (month - baseMonth)
    const issueNumber = baseIssue + monthsDiff

    issues.push({
      issue_number: issueNumber,
      issue_date: `${year}년 ${month}월호`,
      year,
      month,
      board_id: boardId,
      page_count: 8,
      status: 'pending'
    })
  }

  return issues
}

// 특정 호수의 이미지 URL 추출
async function fetchIssueImages(boardId: number): Promise<string[]> {
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

// OCR 수행 (base64 이미지 사용)
async function performOCR(imageUrl: string): Promise<string> {
  try {
    // 1. 이미지를 먼저 다운로드하여 base64로 변환
    const base64Image = await downloadImageAsBase64(imageUrl)

    if (!base64Image) {
      return ''
    }

    // 2. base64 데이터로 OCR 수행
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

// 텍스트를 청크로 분할
function splitIntoChunks(text: string, issueId: number, pageNumber: number): any[] {
  const chunks: any[] = []
  const articles = text.split(/###\s*기사\s*\d+/i).filter(a => a.trim())

  articles.forEach((article, idx) => {
    const titleMatch = article.match(/제목:\s*(.+)/i)
    const typeMatch = article.match(/유형:\s*(.+)/i)
    const contentMatch = article.match(/내용:\s*([\s\S]+)/i)

    const title = titleMatch ? titleMatch[1].trim() : `기사 ${idx + 1}`
    const type = typeMatch ? typeMatch[1].trim() : '기타'
    const content = contentMatch ? contentMatch[1].trim() : article.trim()

    if (content.length > 50) {
      chunks.push({
        issue_id: issueId,
        page_number: pageNumber,
        chunk_index: idx,
        title,
        article_type: type,
        content: content.substring(0, 2000),
        char_count: content.length
      })
    }
  })

  return chunks
}

// 임베딩 생성
async function createEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000)
  })
  return response.data[0].embedding
}

// 메인 크롤링 함수
async function main() {
  console.log('═══════════════════════════════════════════════')
  console.log('   열한시 신문 전체 크롤링')
  console.log('═══════════════════════════════════════════════\n')

  // 1. 호수 스캔
  console.log('📋 호수 목록 스캔 중...')
  const allIssues: any[] = []

  for (let page = 1; page <= 10; page++) {
    const issues = await fetchIssuesFromPage(page)
    if (issues.length === 0) break
    allIssues.push(...issues)
    console.log(`   페이지 ${page}: ${issues.length}개 호수 발견`)
    await new Promise(r => setTimeout(r, 500))
  }

  // 중복 제거
  const uniqueIssues = allIssues.filter((issue, index, self) =>
    index === self.findIndex(i => i.issue_number === issue.issue_number)
  )

  console.log(`\n✅ 총 ${uniqueIssues.length}개 호수 발견\n`)

  // 2. DB에 호수 저장
  console.log('💾 호수 정보 저장 중...')
  let newCount = 0

  for (const issue of uniqueIssues) {
    const { data: existing } = await supabase
      .from('news_issues')
      .select('id')
      .eq('issue_number', issue.issue_number)
      .single()

    if (!existing) {
      const { data, error } = await supabase
        .from('news_issues')
        .insert(issue)
        .select()
        .single()

      if (!error) newCount++
    }
  }

  console.log(`   새로운 호수 ${newCount}개 저장\n`)

  // 3. 처리할 호수 조회
  const { data: pendingIssues } = await supabase
    .from('news_issues')
    .select('*')
    .eq('status', 'pending')
    .order('issue_number', { ascending: false })
    .limit(5)

  if (!pendingIssues || pendingIssues.length === 0) {
    console.log('✅ 처리할 신규 호수가 없습니다.')
    return
  }

  console.log(`📰 ${pendingIssues.length}개 호수 OCR 처리 시작...\n`)

  // 4. 각 호수 처리
  for (const issue of pendingIssues) {
    console.log(`\n[${ issue.issue_date}] 처리 중...`)

    // 이미지 URL 가져오기
    const imageUrls = await fetchIssueImages(issue.board_id)
    console.log(`   이미지 ${imageUrls.length}개 발견`)

    // 각 페이지 OCR 처리
    let totalChunks = 0

    for (let i = 0; i < imageUrls.length; i++) {
      const imageUrl = imageUrls[i]
      process.stdout.write(`   페이지 ${i + 1}/${imageUrls.length} OCR...`)

      const ocrText = await performOCR(imageUrl)

      if (ocrText) {
        // 청크 분할
        const chunks = splitIntoChunks(ocrText, issue.id, i + 1)

        // 임베딩 및 저장
        for (const chunk of chunks) {
          try {
            const embedding = await createEmbedding(chunk.content)
            await supabase.from('news_chunks').insert({
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

    // 호수 상태 업데이트
    await supabase
      .from('news_issues')
      .update({ status: 'completed', page_count: imageUrls.length })
      .eq('id', issue.id)

    console.log(`   완료: ${totalChunks}개 청크 저장`)
  }

  console.log('\n═══════════════════════════════════════════════')
  console.log('✅ 크롤링 완료!')
  console.log('═══════════════════════════════════════════════')
}

main().catch(console.error)
