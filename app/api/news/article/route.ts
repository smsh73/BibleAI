/**
 * 기사 전문 조회 API
 * GET /api/news/article?id={article_id}
 * - 해당 기사의 모든 청크를 합쳐서 전문 반환
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const articleId = searchParams.get('id')

    if (!articleId) {
      return NextResponse.json({ error: '기사 ID가 필요합니다.' }, { status: 400 })
    }

    // 해당 기사의 모든 청크 조회 (chunk_index 순서대로)
    const { data: chunks, error } = await getSupabase()
      .from('news_chunks')
      .select('chunk_text, chunk_index, article_title, article_type, issue_number, issue_date, page_number')
      .eq('article_id', articleId)
      .order('chunk_index', { ascending: true })

    if (error) {
      console.error('기사 조회 오류:', error)
      return NextResponse.json({ error: '기사를 불러올 수 없습니다.' }, { status: 500 })
    }

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
    }

    // 모든 청크의 텍스트를 합침 (오버랩 제거)
    let fullContent = ''
    const overlapRatio = 0.2

    chunks.forEach((chunk, idx) => {
      if (idx === 0) {
        fullContent = chunk.chunk_text
      } else {
        // 오버랩 부분 제거하고 합침
        const prevChunkLength = chunks[idx - 1].chunk_text.length
        const overlapSize = Math.floor(prevChunkLength * overlapRatio)

        // 현재 청크에서 오버랩 부분 찾기
        const currentText = chunk.chunk_text
        const overlapText = fullContent.slice(-overlapSize)

        // 오버랩 부분이 현재 청크 시작 부분과 일치하는지 확인
        const overlapIndex = currentText.indexOf(overlapText.slice(-50))

        if (overlapIndex > 0 && overlapIndex < 150) {
          // 오버랩 부분을 건너뛰고 나머지 추가
          fullContent += currentText.slice(overlapIndex + overlapText.slice(-50).length)
        } else {
          // 오버랩을 찾지 못하면 그냥 추가 (줄바꿈으로 구분)
          fullContent += '\n' + currentText
        }
      }
    })

    // 첫 번째 청크의 메타데이터 사용
    const meta = chunks[0]

    return NextResponse.json({
      success: true,
      article: {
        id: articleId,
        title: meta.article_title,
        type: meta.article_type,
        issueNumber: meta.issue_number,
        issueDate: meta.issue_date,
        pageNumber: meta.page_number,
        content: fullContent.trim(),
        chunkCount: chunks.length
      }
    })

  } catch (error: any) {
    console.error('기사 전문 조회 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
