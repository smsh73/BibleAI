/**
 * 데이터 초기화 API
 * POST /api/admin/reset
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

// 테이블이 존재하지 않는 에러인지 확인
function isTableNotFoundError(error: any): boolean {
  return error?.message?.includes('Could not find') ||
         error?.code === '42P01' ||
         error?.message?.includes('relation') && error?.message?.includes('does not exist')
}

export async function POST(request: NextRequest) {
  try {
    const { type } = await request.json()

    if (!type || !['news', 'bible', 'sermons', 'bulletin', 'all'].includes(type)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid type. Must be: news, bible, sermons, bulletin, or all'
      }, { status: 400 })
    }

    const results: string[] = []

    // 뉴스 데이터 삭제
    if (type === 'news' || type === 'all') {
      // 청크 삭제
      const { error: chunksError } = await getSupabase()
        .from('news_chunks')
        .delete()
        .neq('id', 0) // 모든 행 삭제

      if (chunksError) {
        if (isTableNotFoundError(chunksError)) {
          results.push('news_chunks 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`news_chunks 삭제 실패: ${chunksError.message}`)
        }
      } else {
        results.push('news_chunks 삭제 완료')
      }

      // 기사 삭제
      const { error: articlesError } = await getSupabase()
        .from('news_articles')
        .delete()
        .neq('id', 0)

      if (articlesError) {
        if (isTableNotFoundError(articlesError)) {
          results.push('news_articles 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`news_articles 삭제 실패: ${articlesError.message}`)
        }
      } else {
        results.push('news_articles 삭제 완료')
      }

      // 페이지 삭제
      const { error: pagesError } = await getSupabase()
        .from('news_pages')
        .delete()
        .neq('id', 0)

      if (pagesError) {
        if (isTableNotFoundError(pagesError)) {
          results.push('news_pages 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`news_pages 삭제 실패: ${pagesError.message}`)
        }
      } else {
        results.push('news_pages 삭제 완료')
      }

      // 호수 삭제
      const { error: issuesError } = await getSupabase()
        .from('news_issues')
        .delete()
        .neq('id', 0)

      if (issuesError) {
        if (isTableNotFoundError(issuesError)) {
          results.push('news_issues 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`news_issues 삭제 실패: ${issuesError.message}`)
        }
      } else {
        results.push('news_issues 삭제 완료')
      }
    }

    // 성경 임베딩 삭제 (구절은 유지)
    if (type === 'bible' || type === 'all') {
      const { error: bibleError } = await getSupabase()
        .from('bible_verses')
        .update({ embedding: null })
        .neq('id', 0)

      if (bibleError) {
        if (isTableNotFoundError(bibleError)) {
          results.push('bible_verses 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`bible_verses 임베딩 삭제 실패: ${bibleError.message}`)
        }
      } else {
        results.push('bible_verses 임베딩 삭제 완료')
      }
    }

    // 설교 데이터 삭제
    if (type === 'sermons' || type === 'all') {
      // 설교 청크 삭제
      const { error: sermonChunksError } = await getSupabase()
        .from('sermon_chunks')
        .delete()
        .neq('id', 0)

      if (sermonChunksError) {
        if (isTableNotFoundError(sermonChunksError)) {
          results.push('sermon_chunks 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`sermon_chunks 삭제 실패: ${sermonChunksError.message}`)
        }
      } else {
        results.push('sermon_chunks 삭제 완료')
      }

      // 설교 삭제
      const { error: sermonsError } = await getSupabase()
        .from('sermons')
        .delete()
        .neq('id', 0)

      if (sermonsError) {
        if (isTableNotFoundError(sermonsError)) {
          results.push('sermons 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`sermons 삭제 실패: ${sermonsError.message}`)
        }
      } else {
        results.push('sermons 삭제 완료')
      }
    }

    // 주보 데이터 삭제
    if (type === 'bulletin' || type === 'all') {
      // 주보 청크 삭제
      const { error: bulletinChunksError } = await getSupabase()
        .from('bulletin_chunks')
        .delete()
        .neq('id', 0)

      if (bulletinChunksError) {
        if (isTableNotFoundError(bulletinChunksError)) {
          results.push('bulletin_chunks 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`bulletin_chunks 삭제 실패: ${bulletinChunksError.message}`)
        }
      } else {
        results.push('bulletin_chunks 삭제 완료')
      }

      // 주보 섹션 삭제
      const { error: bulletinSectionsError } = await getSupabase()
        .from('bulletin_sections')
        .delete()
        .neq('id', 0)

      if (bulletinSectionsError) {
        if (isTableNotFoundError(bulletinSectionsError)) {
          results.push('bulletin_sections 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`bulletin_sections 삭제 실패: ${bulletinSectionsError.message}`)
        }
      } else {
        results.push('bulletin_sections 삭제 완료')
      }

      // 주보 호수 삭제 (bulletin_issues 테이블)
      const { error: bulletinIssuesError } = await getSupabase()
        .from('bulletin_issues')
        .delete()
        .neq('id', 0)

      if (bulletinIssuesError) {
        if (isTableNotFoundError(bulletinIssuesError)) {
          results.push('bulletin_issues 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`bulletin_issues 삭제 실패: ${bulletinIssuesError.message}`)
        }
      } else {
        results.push('bulletin_issues 삭제 완료')
      }

      // 주보 삭제 (bulletins 테이블 - 존재하는 경우)
      const { error: bulletinsError } = await getSupabase()
        .from('bulletins')
        .delete()
        .neq('id', 0)

      if (bulletinsError) {
        if (isTableNotFoundError(bulletinsError)) {
          results.push('bulletins 테이블 없음 (건너뜀)')
        } else {
          throw new Error(`bulletins 삭제 실패: ${bulletinsError.message}`)
        }
      } else {
        results.push('bulletins 삭제 완료')
      }
    }

    return NextResponse.json({
      success: true,
      message: `${type} 데이터 초기화 완료`,
      results
    })
  } catch (error: any) {
    console.error('Reset error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
