/**
 * 성경 크롤링/추출 API
 * POST /api/bible/extract
 *
 * 웹사이트에서 성경 구절을 크롤링하여 데이터베이스에 저장합니다.
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

// 성경 버전 설정
const BIBLE_VERSIONS: Record<string, { path: string; encoding: string }> = {
  GAE: { path: 'B_GAE', encoding: 'euc-kr' },
  KRV: { path: 'B_KRV', encoding: 'euc-kr' },
  NIV: { path: 'B_NIV', encoding: 'utf-8' },
  ESV: { path: 'B_ESV', encoding: 'utf-8' }
}

// 성경 66권 정보
const BIBLE_BOOKS = {
  구약: [
    { name: '창세기', chapters: 50 }, { name: '출애굽기', chapters: 40 }, { name: '레위기', chapters: 27 },
    { name: '민수기', chapters: 36 }, { name: '신명기', chapters: 34 }, { name: '여호수아', chapters: 24 },
    { name: '사사기', chapters: 21 }, { name: '룻기', chapters: 4 }, { name: '사무엘상', chapters: 31 },
    { name: '사무엘하', chapters: 24 }, { name: '열왕기상', chapters: 22 }, { name: '열왕기하', chapters: 25 },
    { name: '역대상', chapters: 29 }, { name: '역대하', chapters: 36 }, { name: '에스라', chapters: 10 },
    { name: '느헤미야', chapters: 13 }, { name: '에스더', chapters: 10 }, { name: '욥기', chapters: 42 },
    { name: '시편', chapters: 150 }, { name: '잠언', chapters: 31 }, { name: '전도서', chapters: 12 },
    { name: '아가', chapters: 8 }, { name: '이사야', chapters: 66 }, { name: '예레미야', chapters: 52 },
    { name: '예레미야애가', chapters: 5 }, { name: '에스겔', chapters: 48 }, { name: '다니엘', chapters: 12 },
    { name: '호세아', chapters: 14 }, { name: '요엘', chapters: 3 }, { name: '아모스', chapters: 9 },
    { name: '오바댜', chapters: 1 }, { name: '요나', chapters: 4 }, { name: '미가', chapters: 7 },
    { name: '나훔', chapters: 3 }, { name: '하박국', chapters: 3 }, { name: '스바냐', chapters: 3 },
    { name: '학개', chapters: 2 }, { name: '스가랴', chapters: 14 }, { name: '말라기', chapters: 4 }
  ],
  신약: [
    { name: '마태복음', chapters: 28 }, { name: '마가복음', chapters: 16 }, { name: '누가복음', chapters: 24 },
    { name: '요한복음', chapters: 21 }, { name: '사도행전', chapters: 28 }, { name: '로마서', chapters: 16 },
    { name: '고린도전서', chapters: 16 }, { name: '고린도후서', chapters: 13 }, { name: '갈라디아서', chapters: 6 },
    { name: '에베소서', chapters: 6 }, { name: '빌립보서', chapters: 4 }, { name: '골로새서', chapters: 4 },
    { name: '데살로니가전서', chapters: 5 }, { name: '데살로니가후서', chapters: 3 }, { name: '디모데전서', chapters: 6 },
    { name: '디모데후서', chapters: 4 }, { name: '디도서', chapters: 3 }, { name: '빌레몬서', chapters: 1 },
    { name: '히브리서', chapters: 13 }, { name: '야고보서', chapters: 5 }, { name: '베드로전서', chapters: 5 },
    { name: '베드로후서', chapters: 3 }, { name: '요한1서', chapters: 5 }, { name: '요한2서', chapters: 1 },
    { name: '요한3서', chapters: 1 }, { name: '유다서', chapters: 1 }, { name: '요한계시록', chapters: 22 }
  ]
}

// HTML에서 절 파싱
function parseVerses(html: string): Record<number, string> {
  const verses: Record<number, string> = {}

  // <ol> 태그 내의 <li> 태그에서 절 추출
  const olMatches = html.matchAll(/<ol[^>]*start="(\d+)"[^>]*>([\s\S]*?)<\/ol>/gi)

  for (const olMatch of olMatches) {
    const startVerse = parseInt(olMatch[1])
    const olContent = olMatch[2]

    // <li> 태그 찾기
    const liMatches = olContent.matchAll(/<li[^>]*>[\s\S]*?<font[^>]*class="tk4l"[^>]*>([\s\S]*?)<\/font>/gi)

    let verseNum = startVerse
    for (const liMatch of liMatches) {
      let verseText = liMatch[1]
        .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1') // <a> 태그 제거
        .replace(/<[^>]+>/g, '') // 다른 태그 제거
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (verseText) {
        verses[verseNum] = verseText
      }
      verseNum++
    }
  }

  return verses
}

// 장 추출
async function fetchChapter(versionId: string, bookNum: number, chapterNum: number): Promise<Record<number, string> | null> {
  const config = BIBLE_VERSIONS[versionId]
  if (!config) return null

  const url = `http://www.holybible.or.kr/${config.path}/cgi/bibleftxt.php?VR=${versionId}&VL=${bookNum}&CN=${chapterNum}&CV=99`

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) return null

    // 인코딩 처리
    const buffer = await response.arrayBuffer()
    const decoder = new TextDecoder(config.encoding)
    const html = decoder.decode(buffer)

    return parseVerses(html)
  } catch (error) {
    console.error(`Fetch error for ${versionId} ${bookNum}:${chapterNum}:`, error)
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const { version } = await request.json()

    if (!version || !BIBLE_VERSIONS[version]) {
      return NextResponse.json({
        success: false,
        error: `지원하지 않는 버전입니다. 지원 버전: ${Object.keys(BIBLE_VERSIONS).join(', ')}`
      }, { status: 400 })
    }

    let totalVerses = 0
    let bookNum = 0

    // 구약/신약 순회
    for (const [testament, books] of Object.entries(BIBLE_BOOKS)) {
      for (const book of books) {
        bookNum++

        // 각 장 순회
        for (let chapter = 1; chapter <= book.chapters; chapter++) {
          const verses = await fetchChapter(version, bookNum, chapter)

          if (verses && Object.keys(verses).length > 0) {
            // 구절 데이터 준비
            const versesData = Object.entries(verses).map(([verseNum, content]) => ({
              version_id: version,
              testament,
              book_name: book.name,
              book_number: bookNum,
              chapter,
              verse: parseInt(verseNum),
              content,
              reference: `${book.name} ${chapter}:${verseNum}`
            }))

            // Upsert (기존 데이터가 있으면 업데이트)
            const { error } = await getSupabase()
              .from('bible_verses')
              .upsert(versesData, {
                onConflict: 'version_id,book_name,chapter,verse'
              })

            if (error) {
              console.error(`Upsert error for ${book.name} ${chapter}:`, error)
            } else {
              totalVerses += versesData.length
            }
          }

          // 서버 부하 방지
          await new Promise(resolve => setTimeout(resolve, 300))
        }

        console.log(`${version} ${book.name} 완료 (${totalVerses}개 구절)`)
      }
    }

    return NextResponse.json({
      success: true,
      version,
      verseCount: totalVerses,
      message: `${version} 버전 추출 완료: ${totalVerses}개 구절`
    })
  } catch (error: any) {
    console.error('Bible extract error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
