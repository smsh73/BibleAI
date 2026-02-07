/**
 * 성경 임베딩 API
 * POST /api/bible/embed
 *
 * 성경 구절에 벡터 임베딩을 생성합니다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const BATCH_SIZE = 100
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536

export async function POST(request: NextRequest) {
  try {
    const { version } = await request.json()

    if (!version) {
      return NextResponse.json({
        success: false,
        error: '버전을 지정해주세요.'
      }, { status: 400 })
    }

    // 임베딩이 없는 구절 조회
    const { data: pendingVerses, error: fetchError } = await getSupabase()
      .from('bible_verses')
      .select('id, content')
      .eq('version_id', version)
      .is('embedding', null)
      .order('id')

    if (fetchError) {
      throw new Error(`구절 조회 실패: ${fetchError.message}`)
    }

    if (!pendingVerses || pendingVerses.length === 0) {
      return NextResponse.json({
        success: true,
        version,
        embeddedCount: 0,
        message: '모든 구절이 이미 임베딩되어 있습니다.'
      })
    }

    console.log(`${version}: ${pendingVerses.length}개 구절 임베딩 시작`)

    let embeddedCount = 0
    const totalBatches = Math.ceil(pendingVerses.length / BATCH_SIZE)

    // 배치 처리
    for (let i = 0; i < pendingVerses.length; i += BATCH_SIZE) {
      const batch = pendingVerses.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1

      try {
        // 배치 임베딩 생성
        const response = await openai.embeddings.create({
          model: EMBEDDING_MODEL,
          input: batch.map(v => v.content),
          dimensions: EMBEDDING_DIMENSIONS
        })

        // 각 구절 업데이트
        for (let j = 0; j < batch.length; j++) {
          const embedding = response.data[j].embedding

          const { error: updateError } = await getSupabase()
            .from('bible_verses')
            .update({ embedding })
            .eq('id', batch[j].id)

          if (updateError) {
            console.error(`구절 ${batch[j].id} 업데이트 실패:`, updateError)
          } else {
            embeddedCount++
          }
        }

        console.log(`${version}: 배치 ${batchNum}/${totalBatches} 완료 (${embeddedCount}/${pendingVerses.length})`)

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error: any) {
        console.error(`배치 ${batchNum} 임베딩 실패:`, error.message)

        // 쿼타 에러 시 중단
        if (error.code === 'insufficient_quota' || error.status === 429) {
          return NextResponse.json({
            success: false,
            error: 'OpenAI API 쿼타가 소진되었습니다.',
            embeddedCount
          }, { status: 429 })
        }
      }
    }

    return NextResponse.json({
      success: true,
      version,
      embeddedCount,
      totalVerses: pendingVerses.length,
      message: `${version} 버전 임베딩 완료: ${embeddedCount}/${pendingVerses.length}개`
    })
  } catch (error: any) {
    console.error('Bible embed error:', error)
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 })
  }
}
