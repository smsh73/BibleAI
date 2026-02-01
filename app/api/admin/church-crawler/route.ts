/**
 * 교회 홈페이지 크롤링 API
 *
 * GET: 교회 목록 및 구조 조회
 * POST: 크롤링 실행
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  crawlChurchWebsite,
  getChurchStructure,
  getChurchDictionary,
  getChurches,
  type CrawlResult
} from '@/lib/church-crawler'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

/**
 * GET: 교회 목록 및 구조 조회
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')
    const churchCode = searchParams.get('churchCode')
    const category = searchParams.get('category')

    // 교회 목록 조회
    if (action === 'list' || !action) {
      const churches = await getChurches()
      return NextResponse.json({ success: true, churches })
    }

    // 특정 교회 구조 조회
    if (action === 'structure' && churchCode) {
      const structure = await getChurchStructure(churchCode)
      if (!structure) {
        return NextResponse.json({ error: '구조를 찾을 수 없습니다' }, { status: 404 })
      }
      return NextResponse.json({ success: true, structure })
    }

    // 특정 교회 사전 조회
    if (action === 'dictionary' && churchCode) {
      const dictionary = await getChurchDictionary(churchCode, category || undefined)
      return NextResponse.json({ success: true, dictionary })
    }

    // 크롤링 로그 조회
    if (action === 'logs' && churchCode) {
      const { data: church } = await supabase
        .from('churches')
        .select('id')
        .eq('code', churchCode)
        .single()

      if (!church) {
        return NextResponse.json({ error: '교회를 찾을 수 없습니다' }, { status: 404 })
      }

      const { data: logs } = await supabase
        .from('church_crawl_logs')
        .select('*')
        .eq('church_id', church.id)
        .order('created_at', { ascending: false })
        .limit(10)

      return NextResponse.json({ success: true, logs })
    }

    // 분류 체계 조회
    if (action === 'taxonomy' && churchCode) {
      const { data: church } = await supabase
        .from('churches')
        .select('id')
        .eq('code', churchCode)
        .single()

      if (!church) {
        return NextResponse.json({ error: '교회를 찾을 수 없습니다' }, { status: 404 })
      }

      const { data: taxonomy } = await supabase
        .from('church_taxonomy')
        .select('*')
        .eq('church_id', church.id)
        .order('depth')
        .order('name')

      return NextResponse.json({ success: true, taxonomy })
    }

    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })

  } catch (error: any) {
    console.error('[Church Crawler API] GET 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST: 크롤링 실행
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, churchCode, options } = body

    // 크롤링 실행
    if (action === 'crawl' && churchCode) {
      console.log(`[Church Crawler API] 크롤링 시작: ${churchCode}`)

      const result = await crawlChurchWebsite(churchCode, {
        maxDepth: options?.maxDepth || 3,
        maxPages: options?.maxPages || 100,
        extractPeople: options?.extractPeople ?? true,
        extractBoards: options?.extractBoards ?? true
      })

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: '크롤링 완료',
          result: {
            churchId: result.churchId,
            crawlTime: result.crawlTime,
            totalPages: result.structure?.metadata.totalPages || 0,
            navigationCount: result.structure?.navigation.length || 0,
            boardsCount: result.structure?.boards.length || 0,
            dictionaryCount: result.dictionary?.length || 0,
            taxonomyCount: result.taxonomy?.length || 0
          }
        })
      } else {
        return NextResponse.json({
          success: false,
          errors: result.errors
        }, { status: 400 })
      }
    }

    // 새 교회 추가
    if (action === 'addChurch') {
      const { name, code, homepageUrl, denomination } = body

      if (!name || !code || !homepageUrl) {
        return NextResponse.json({ error: '필수 필드가 누락되었습니다' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('churches')
        .insert({
          name,
          code,
          homepage_url: homepageUrl,
          denomination
        })
        .select()
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ success: true, church: data })
    }

    // 사전 항목 추가/수정
    if (action === 'updateDictionary') {
      const { churchCode: code, entries } = body

      const { data: church } = await supabase
        .from('churches')
        .select('id')
        .eq('code', code)
        .single()

      if (!church) {
        return NextResponse.json({ error: '교회를 찾을 수 없습니다' }, { status: 404 })
      }

      let savedCount = 0
      for (const entry of entries) {
        const { error } = await supabase
          .from('church_dictionary')
          .upsert({
            church_id: church.id,
            term: entry.term,
            category: entry.category,
            subcategory: entry.subcategory,
            definition: entry.definition,
            aliases: entry.aliases || [],
            related_terms: entry.relatedTerms || [],
            metadata: entry.metadata,
            source_url: entry.sourceUrl,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'church_id,term,category'
          })

        if (!error) savedCount++
      }

      return NextResponse.json({
        success: true,
        message: `${savedCount}개 항목 저장됨`
      })
    }

    return NextResponse.json({ error: '알 수 없는 action입니다' }, { status: 400 })

  } catch (error: any) {
    console.error('[Church Crawler API] POST 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
