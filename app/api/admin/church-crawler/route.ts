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

/**
 * GET: 교회 목록 및 구조 조회
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')
    const churchCode = searchParams.get('churchCode')
    const category = searchParams.get('category')

    // 스키마 존재 여부 확인
    if (action === 'checkSchema') {
      try {
        const { data, error } = await getSupabase()
          .from('churches')
          .select('id')
          .limit(1)

        // 테이블이 없거나 스키마 캐시에 없는 경우
        if (error) {
          const errorMsg = error.message.toLowerCase()
          if (errorMsg.includes('does not exist') ||
              errorMsg.includes('schema cache') ||
              errorMsg.includes('relation') ||
              errorMsg.includes('not found')) {
            return NextResponse.json({
              schemaReady: false,
              error: error.message,
              hint: 'Supabase SQL Editor에서 scripts/church-crawler-schema.sql을 실행하세요.'
            })
          }
        }
        return NextResponse.json({ schemaReady: true })
      } catch (e: any) {
        return NextResponse.json({
          schemaReady: false,
          error: e.message
        })
      }
    }

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
      const { data: church } = await getSupabase()
        .from('churches')
        .select('id')
        .eq('code', churchCode)
        .single()

      if (!church) {
        return NextResponse.json({ error: '교회를 찾을 수 없습니다' }, { status: 404 })
      }

      const { data: logs } = await getSupabase()
        .from('church_crawl_logs')
        .select('*')
        .eq('church_id', church.id)
        .order('created_at', { ascending: false })
        .limit(10)

      return NextResponse.json({ success: true, logs })
    }

    // 분류 체계 조회
    if (action === 'taxonomy' && churchCode) {
      const { data: church } = await getSupabase()
        .from('churches')
        .select('id')
        .eq('code', churchCode)
        .single()

      if (!church) {
        return NextResponse.json({ error: '교회를 찾을 수 없습니다' }, { status: 404 })
      }

      const { data: taxonomy } = await getSupabase()
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

    // 스키마 초기화 (테이블 생성)
    if (action === 'initSchema') {
      try {
        // churches 테이블 생성
        const { error: churchesError } = await getSupabase().rpc('exec_sql', {
          sql: `
            CREATE TABLE IF NOT EXISTS churches (
              id SERIAL PRIMARY KEY,
              name VARCHAR(100) NOT NULL,
              code VARCHAR(50) UNIQUE NOT NULL,
              homepage_url TEXT NOT NULL,
              logo_url TEXT,
              description TEXT,
              denomination VARCHAR(100),
              address TEXT,
              phone VARCHAR(50),
              is_active BOOLEAN DEFAULT true,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS church_site_structure (
              id SERIAL PRIMARY KEY,
              church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,
              parent_id INTEGER REFERENCES church_site_structure(id) ON DELETE CASCADE,
              page_type VARCHAR(50) NOT NULL,
              title VARCHAR(200) NOT NULL,
              url TEXT,
              url_pattern TEXT,
              depth INTEGER DEFAULT 0,
              sort_order INTEGER DEFAULT 0,
              css_selector TEXT,
              content_type VARCHAR(50),
              has_children BOOLEAN DEFAULT false,
              is_external BOOLEAN DEFAULT false,
              extracted_data JSONB,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS church_dictionary (
              id SERIAL PRIMARY KEY,
              church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,
              term VARCHAR(200) NOT NULL,
              category VARCHAR(100) NOT NULL,
              subcategory VARCHAR(100),
              definition TEXT,
              aliases TEXT[],
              related_terms TEXT[],
              metadata JSONB,
              source_url TEXT,
              confidence FLOAT DEFAULT 1.0,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              UNIQUE(church_id, term, category)
            );

            CREATE TABLE IF NOT EXISTS church_taxonomy (
              id SERIAL PRIMARY KEY,
              church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,
              parent_id INTEGER REFERENCES church_taxonomy(id) ON DELETE CASCADE,
              name VARCHAR(200) NOT NULL,
              taxonomy_type VARCHAR(50) NOT NULL,
              depth INTEGER DEFAULT 0,
              path TEXT,
              description TEXT,
              metadata JSONB,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
              UNIQUE(church_id, taxonomy_type, path)
            );

            CREATE TABLE IF NOT EXISTS church_crawl_logs (
              id SERIAL PRIMARY KEY,
              church_id INTEGER REFERENCES churches(id) ON DELETE CASCADE,
              crawl_type VARCHAR(50) NOT NULL,
              status VARCHAR(20) DEFAULT 'pending',
              pages_crawled INTEGER DEFAULT 0,
              items_extracted INTEGER DEFAULT 0,
              errors_count INTEGER DEFAULT 0,
              started_at TIMESTAMP WITH TIME ZONE,
              completed_at TIMESTAMP WITH TIME ZONE,
              error_message TEXT,
              result_summary JSONB,
              created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
          `
        })

        // RPC가 없는 경우 직접 테이블 생성 시도
        if (churchesError) {
          // 테이블이 이미 존재하는지 확인하고 없으면 에러 반환
          const { error: testError } = await getSupabase()
            .from('churches')
            .select('id')
            .limit(1)

          if (testError && testError.message.includes('does not exist')) {
            return NextResponse.json({
              success: false,
              error: 'Supabase SQL Editor에서 스키마를 수동으로 실행해주세요. scripts/church-crawler-schema.sql 파일을 참조하세요.',
              hint: '관리자 콘솔 > SQL Editor에서 스키마 파일을 실행하세요.'
            }, { status: 400 })
          }
        }

        return NextResponse.json({ success: true, message: '스키마가 준비되었습니다.' })
      } catch (error: any) {
        return NextResponse.json({
          success: false,
          error: error.message,
          hint: 'scripts/church-crawler-schema.sql 파일을 Supabase SQL Editor에서 수동으로 실행해주세요.'
        }, { status: 500 })
      }
    }

    // 크롤링 실행
    if (action === 'crawl' && churchCode) {
      const deepCrawl = options?.deepCrawl ?? false
      const maxDepth = options?.maxDepth || (deepCrawl ? 5 : 3)
      const maxPages = options?.maxPages || (deepCrawl ? 200 : 100)

      console.log(`[Church Crawler API] 크롤링 시작: ${churchCode} (deepCrawl: ${deepCrawl}, maxDepth: ${maxDepth}, maxPages: ${maxPages})`)

      const result = await crawlChurchWebsite(churchCode, {
        maxDepth,
        maxPages,
        extractPeople: options?.extractPeople ?? true,
        extractBoards: options?.extractBoards ?? true,
        extractContacts: options?.extractContacts ?? true,
        extractMedia: options?.extractMedia ?? true,
        deepCrawl,
        delayMs: options?.delayMs || 500
      })

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: deepCrawl ? '딥 크롤링 완료' : '크롤링 완료',
          result: {
            churchId: result.churchId,
            crawlTime: result.crawlTime,
            totalPages: result.structure?.metadata.totalPages || 0,
            crawledPages: result.progress?.crawledPages || 0,
            navigationCount: result.structure?.navigation.length || 0,
            boardsCount: result.structure?.boards.length || 0,
            popupsCount: result.popups?.length || 0,
            dictionaryCount: result.dictionary?.length || 0,
            taxonomyCount: result.taxonomy?.length || 0,
            errorsCount: result.errors?.length || 0,
            deepCrawl,
            maxDepth,
            // 확장 정보 카운트
            contactsCount: result.extendedInfo?.contactsCount || 0,
            socialMediaCount: result.extendedInfo?.socialMediaCount || 0,
            mediaCount: result.extendedInfo?.mediaCount || 0,
            worshipTimesCount: result.extendedInfo?.worshipTimesCount || 0
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

      const { data, error } = await getSupabase()
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

    // 교회 정보 수정
    if (action === 'updateChurch') {
      const { code, homepageUrl, name, denomination } = body

      if (!code) {
        return NextResponse.json({ error: '교회 코드가 필요합니다' }, { status: 400 })
      }

      const updateData: any = { updated_at: new Date().toISOString() }
      if (homepageUrl) updateData.homepage_url = homepageUrl
      if (name) updateData.name = name
      if (denomination) updateData.denomination = denomination

      const { data, error } = await getSupabase()
        .from('churches')
        .update(updateData)
        .eq('code', code)
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

      const { data: church } = await getSupabase()
        .from('churches')
        .select('id')
        .eq('code', code)
        .single()

      if (!church) {
        return NextResponse.json({ error: '교회를 찾을 수 없습니다' }, { status: 404 })
      }

      let savedCount = 0
      for (const entry of entries) {
        const { error } = await getSupabase()
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
