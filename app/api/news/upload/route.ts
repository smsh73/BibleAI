/**
 * PDF 업로드 및 처리 API
 * POST /api/news/upload
 * - 복수 PDF 파일 업로드
 * - 중복 파일 필터링 (해시 기반)
 * - 증분 처리
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  performOCR,
  processImageToArticles,
  saveNewsIssue,
  updateIssueStatus,
  generateFileHash,
  extractMetadata,
  chunkText,
  createBatchEmbeddings,
  saveNewsPage,
  saveNewsArticle,
  saveNewsChunk,
  splitArticles
} from '@/lib/news-extractor'
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// PDF 파일명에서 호수 정보 추출
function parseFilename(filename: string): { issueNumber: number; issueDate: string; year: number; month: number } | null {
  // 패턴 1: 열한시504호.pdf, 열한시504호-1.pdf
  const pattern1 = filename.match(/열한시\s*(\d+)호/i)
  if (pattern1) {
    const issueNumber = parseInt(pattern1[1])
    // 호수로 년월 역계산 (433호 = 2020년 2월)
    const monthsFromBase = issueNumber - 433
    const year = 2020 + Math.floor((1 + monthsFromBase) / 12)
    const month = ((1 + monthsFromBase) % 12) + 1
    return {
      issueNumber,
      issueDate: `${year}년 ${month}월호`,
      year,
      month
    }
  }

  // 패턴 2: 2026년1월호.pdf, 2026-01.pdf
  const pattern2 = filename.match(/(\d{4})[-년]?\s*(\d{1,2})[-월]?호?/i)
  if (pattern2) {
    const year = parseInt(pattern2[1])
    const month = parseInt(pattern2[2])
    const issueNumber = 433 + (year - 2020) * 12 + (month - 2)
    return {
      issueNumber,
      issueDate: `${year}년 ${month}월호`,
      year,
      month
    }
  }

  return null
}

// PDF 텍스트 추출 (동적 require 사용)
async function extractPdfText(pdfBuffer: Buffer): Promise<{ text: string; pageCount: number } | null> {
  try {
    // CommonJS require 사용
    const pdfParse = require('pdf-parse')
    const pdfData = await pdfParse(pdfBuffer)
    return {
      text: pdfData.text,
      pageCount: pdfData.numpages
    }
  } catch (error) {
    console.log('PDF 텍스트 추출 실패:', error)
    return null
  }
}

// PDF 파일 처리
async function processPdfFile(
  pdfBuffer: Buffer,
  filename: string,
  issueInfo: { issueNumber: number; issueDate: string; year: number; month: number }
): Promise<{ articles: number; chunks: number }> {
  let totalArticles = 0
  let totalChunks = 0

  // PDF에서 텍스트 직접 추출 시도
  const pdfData = await extractPdfText(pdfBuffer)

  if (pdfData && pdfData.text && pdfData.text.length > 500) {
    console.log(`PDF 텍스트 직접 추출: ${pdfData.text.length}자`)

    // 이슈 저장
    const issueId = await saveNewsIssue({
      issue_number: issueInfo.issueNumber,
      issue_date: issueInfo.issueDate,
      year: issueInfo.year,
      month: issueInfo.month,
      board_id: 0,
      page_count: pdfData.pageCount,
      source_type: 'pdf',
      status: 'processing'
    })

    // 페이지 저장
    const pageId = await saveNewsPage({
      issue_id: issueId,
      page_number: 1,
      file_hash: generateFileHash(pdfBuffer),
      ocr_text: pdfData.text,
      ocr_provider: 'pdf-parse',
      status: 'completed'
    })

    // 기사 분리 및 처리
    const articles = splitArticles(pdfData.text)

    for (const articleText of articles) {
      const metadata = await extractMetadata(articleText)

      const articleId = await saveNewsArticle({
        issue_id: issueId,
        page_id: pageId,
        title: metadata.title,
        content: metadata.content,
        article_type: metadata.article_type,
        speaker: metadata.speaker,
        event_name: metadata.event_name,
        event_date: metadata.event_date,
        bible_references: metadata.bible_references,
        keywords: metadata.keywords
      })
      totalArticles++

      // 청킹 및 임베딩
      const chunks = chunkText(metadata.content)
      const embeddings = await createBatchEmbeddings(chunks)

      for (let i = 0; i < chunks.length; i++) {
        await saveNewsChunk({
          article_id: articleId,
          issue_id: issueId,
          chunk_index: i,
          chunk_text: chunks[i],
          issue_number: issueInfo.issueNumber,
          issue_date: issueInfo.issueDate,
          page_number: 1,
          article_title: metadata.title,
          article_type: metadata.article_type,
          embedding: embeddings[i]
        })
        totalChunks++
      }
    }

    await updateIssueStatus(issueId, 'completed')
    return { articles: totalArticles, chunks: totalChunks }
  }

  // PDF가 이미지 기반이면 오류
  throw new Error('이미지 기반 PDF는 현재 지원되지 않습니다. JPG 이미지로 변환 후 업로드해주세요.')
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]

    if (files.length === 0) {
      return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 })
    }

    const results = []
    let totalProcessed = 0
    let totalSkipped = 0
    let totalFailed = 0

    for (const file of files) {
      const filename = file.name
      console.log(`처리 중: ${filename}`)

      try {
        // 파일 읽기
        const buffer = Buffer.from(await file.arrayBuffer())
        const fileHash = generateFileHash(buffer)

        // 중복 체크
        const { data: existing } = await supabase
          .from('news_pages')
          .select('id')
          .eq('file_hash', fileHash)
          .single()

        if (existing) {
          console.log(`중복 파일 스킵: ${filename}`)
          results.push({
            filename,
            status: 'skipped',
            reason: '이미 처리된 파일입니다.'
          })
          totalSkipped++
          continue
        }

        // 호수 정보 파싱
        const issueInfo = parseFilename(filename)
        if (!issueInfo) {
          results.push({
            filename,
            status: 'failed',
            error: '파일명에서 호수 정보를 추출할 수 없습니다. (예: 열한시504호.pdf)'
          })
          totalFailed++
          continue
        }

        // 파일 확장자 확인
        const ext = filename.toLowerCase().split('.').pop()

        if (ext === 'pdf') {
          // PDF 처리
          const result = await processPdfFile(buffer, filename, issueInfo)
          results.push({
            filename,
            status: 'processed',
            issueNumber: issueInfo.issueNumber,
            issueDate: issueInfo.issueDate,
            articles: result.articles,
            chunks: result.chunks
          })
          totalProcessed++
        } else if (['jpg', 'jpeg', 'png'].includes(ext || '')) {
          // 이미지 처리
          // 이슈가 이미 있는지 확인
          let issueId: number

          const { data: existingIssue } = await supabase
            .from('news_issues')
            .select('id')
            .eq('issue_number', issueInfo.issueNumber)
            .single()

          if (existingIssue) {
            issueId = existingIssue.id
          } else {
            issueId = await saveNewsIssue({
              issue_number: issueInfo.issueNumber,
              issue_date: issueInfo.issueDate,
              year: issueInfo.year,
              month: issueInfo.month,
              board_id: 0,
              page_count: 1,
              source_type: 'upload',
              status: 'processing'
            })
          }

          // 페이지 번호 추출 (열한시504호-3.jpg -> 3)
          const pageMatch = filename.match(/-(\d+)\.[^.]+$/)
          const pageNumber = pageMatch ? parseInt(pageMatch[1]) : 1

          // 처리
          const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'
          const result = await processImageToArticles(
            buffer,
            issueId,
            issueInfo.issueNumber,
            issueInfo.issueDate,
            pageNumber,
            mimeType
          )

          await updateIssueStatus(issueId, 'completed')

          results.push({
            filename,
            status: 'processed',
            issueNumber: issueInfo.issueNumber,
            issueDate: issueInfo.issueDate,
            pageNumber,
            articles: result.articles,
            chunks: result.chunks
          })
          totalProcessed++
        } else {
          results.push({
            filename,
            status: 'failed',
            error: '지원되지 않는 파일 형식입니다. (PDF, JPG, PNG만 지원)'
          })
          totalFailed++
        }

      } catch (error: any) {
        console.error(`${filename} 처리 실패:`, error)
        results.push({
          filename,
          status: 'failed',
          error: error.message
        })
        totalFailed++
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: files.length,
        processed: totalProcessed,
        skipped: totalSkipped,
        failed: totalFailed
      },
      results
    })

  } catch (error: any) {
    console.error('파일 업로드 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
