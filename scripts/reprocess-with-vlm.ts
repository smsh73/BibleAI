/**
 * VLM으로 기존 뉴스 이슈 재처리 스크립트
 *
 * 사용법: npx tsx scripts/reprocess-with-vlm.ts
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { extractStructuredWithVLM } from '../lib/news-extractor'

const supabase = createClient(
  (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface NewsPage {
  id: number
  issue_id: number
  page_number: number
  image_url: string
  ocr_text: string | null
  ocr_provider: string | null
}

interface NewsIssue {
  id: number
  issue_date: string
  status: string
}

async function reprocessAllIssues() {
  console.log('\n' + '='.repeat(70))
  console.log('🔄 VLM으로 기존 뉴스 이슈 재처리')
  console.log('='.repeat(70))

  // 1. 완료된 이슈 목록 가져오기
  const { data: issues, error: issuesError } = await supabase
    .from('news_issues')
    .select('id, issue_date, status')
    .eq('status', 'completed')
    .order('issue_date', { ascending: false })

  if (issuesError || !issues) {
    console.error('❌ 이슈 목록 조회 실패:', issuesError?.message)
    return
  }

  console.log(`\n📋 재처리 대상: ${issues.length}개 이슈`)
  for (const issue of issues) {
    console.log(`   - ${issue.issue_date} (ID: ${issue.id})`)
  }

  // 2. 각 이슈 재처리
  for (const issue of issues) {
    await reprocessIssue(issue)
  }

  console.log('\n' + '='.repeat(70))
  console.log('✅ 모든 이슈 재처리 완료!')
  console.log('='.repeat(70))
}

async function reprocessIssue(issue: NewsIssue) {
  console.log(`\n${'─'.repeat(70)}`)
  console.log(`📰 ${issue.issue_date} 재처리 중...`)
  console.log(`${'─'.repeat(70)}`)

  // 1. 해당 이슈의 페이지 가져오기
  const { data: pages, error: pagesError } = await supabase
    .from('news_pages')
    .select('id, issue_id, page_number, image_url, ocr_text, ocr_provider')
    .eq('issue_id', issue.id)
    .order('page_number', { ascending: true })

  if (pagesError || !pages || pages.length === 0) {
    console.log(`   ⚠️ 페이지 없음: ${pagesError?.message}`)
    return
  }

  console.log(`   📄 페이지 수: ${pages.length}`)

  // 2. 기존 articles와 chunks 삭제
  console.log('   🗑️ 기존 articles/chunks 삭제 중...')

  await supabase
    .from('news_chunks')
    .delete()
    .eq('issue_id', issue.id)

  await supabase
    .from('news_articles')
    .delete()
    .eq('issue_id', issue.id)

  // 3. 각 페이지 VLM으로 재처리
  let totalArticles = 0
  let totalChunks = 0
  let totalCorrections = 0

  for (const page of pages) {
    console.log(`\n   📄 페이지 ${page.page_number} 처리 중...`)

    if (!page.image_url) {
      console.log(`      ⚠️ 이미지 URL 없음, 건너뜀`)
      continue
    }

    try {
      // 이미지 다운로드
      const response = await fetch(page.image_url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const imageBuffer = Buffer.from(await response.arrayBuffer())
      console.log(`      ✅ 이미지 다운로드: ${(imageBuffer.length / 1024).toFixed(1)}KB`)

      // VLM 추출
      const contentType = page.image_url.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg'
      const vlmResult = await extractStructuredWithVLM(imageBuffer, contentType)

      console.log(`      ✅ VLM 추출 완료: ${vlmResult.provider}`)
      console.log(`         기사 수: ${vlmResult.data.articles?.length || 0}`)
      console.log(`         교정 수: ${vlmResult.corrections.length}`)

      totalCorrections += vlmResult.corrections.length

      // OCR 텍스트 업데이트 (전체 텍스트로)
      const fullText = vlmResult.data.articles?.map(a =>
        `[${a.title}]\n${a.content}`
      ).join('\n\n') || ''

      await supabase
        .from('news_pages')
        .update({
          ocr_text: fullText,
          ocr_provider: `VLM-${vlmResult.provider}`,
        })
        .eq('id', page.id)

      // 기사 저장
      if (vlmResult.data.articles && vlmResult.data.articles.length > 0) {
        for (const article of vlmResult.data.articles) {
          // news_articles에 저장
          const { data: savedArticle, error: articleError } = await supabase
            .from('news_articles')
            .insert({
              issue_id: issue.id,
              page_id: page.id,
              title: article.title || '제목 없음',
              content: article.content || '',
              article_type: article.type || 'article',
            })
            .select('id')
            .single()

          if (articleError) {
            console.log(`      ⚠️ 기사 저장 실패: ${articleError.message}`)
            continue
          }

          totalArticles++

          // news_chunks에 저장 (기사 내용을 청크로)
          if (article.content && article.content.length > 0) {
            // 긴 내용은 청크로 분할 (500자 기준)
            const chunks = splitIntoChunks(article.content, 500)

            for (let i = 0; i < chunks.length; i++) {
              const { error: chunkError } = await supabase
                .from('news_chunks')
                .insert({
                  issue_id: issue.id,
                  article_id: savedArticle?.id,
                  page_number: page.page_number,
                  issue_date: issue.issue_date,
                  article_title: article.title || '제목 없음',
                  article_type: article.type || 'article',
                  chunk_text: chunks[i],
                  chunk_index: i,
                })

              if (!chunkError) {
                totalChunks++
              }
            }
          }
        }
      }

    } catch (pageError: any) {
      console.log(`      ❌ 페이지 처리 실패: ${pageError.message}`)
    }

    // API 속도 제한 방지
    await new Promise(resolve => setTimeout(resolve, 2000))
  }

  console.log(`\n   📊 ${issue.issue_date} 결과:`)
  console.log(`      기사: ${totalArticles}개`)
  console.log(`      청크: ${totalChunks}개`)
  console.log(`      교정: ${totalCorrections}건`)
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = []
  const paragraphs = text.split(/\n\n+/)
  let currentChunk = ''

  for (const para of paragraphs) {
    if (currentChunk.length + para.length + 2 <= maxLength) {
      currentChunk += (currentChunk ? '\n\n' : '') + para
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim())
      }
      // 긴 단락은 문장 단위로 분할
      if (para.length > maxLength) {
        const sentences = para.split(/(?<=[.!?。])\s+/)
        currentChunk = ''
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? ' ' : '') + sentence
          } else {
            if (currentChunk) {
              chunks.push(currentChunk.trim())
            }
            currentChunk = sentence
          }
        }
      } else {
        currentChunk = para
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim())
  }

  return chunks.length > 0 ? chunks : [text]
}

// 단일 이슈만 재처리
async function reprocessSingleIssue(issueId: number) {
  const { data: issue, error } = await supabase
    .from('news_issues')
    .select('id, issue_date, status')
    .eq('id', issueId)
    .single()

  if (error || !issue) {
    console.error('❌ 이슈를 찾을 수 없습니다:', error?.message)
    return
  }

  await reprocessIssue(issue)
}

// CLI 인자 처리
const args = process.argv.slice(2)
if (args.includes('--issue') && args.indexOf('--issue') + 1 < args.length) {
  const issueId = parseInt(args[args.indexOf('--issue') + 1])
  reprocessSingleIssue(issueId).catch(console.error)
} else {
  reprocessAllIssues().catch(console.error)
}
