/**
 * 설교 기반 강해 API
 * POST /api/sermon-commentary
 * - 특정 성경 구절에 대한 목사님의 설교 내용 기반 강해 생성
 * - AI Fallback: OpenAI → Claude → Gemini → Perplexity
 * - 할루시네이션 금지: 설교 추출 내용에 근거한 답변만
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    _supabase = createClient(url, key)
  }
  return _supabase
}

// API 키 관리
let apiKeyCache: Record<string, string> = {}
let apiKeyCacheTime = 0
const API_KEY_CACHE_TTL = 5 * 60 * 1000

async function fetchStoredApiKeys(): Promise<Record<string, string>> {
  const now = Date.now()
  if (Object.keys(apiKeyCache).length > 0 && (now - apiKeyCacheTime) < API_KEY_CACHE_TTL) {
    return apiKeyCache
  }

  try {
    const { data } = await getSupabase()
      .from('api_keys')
      .select('provider, key')
      .eq('is_active', true)

    const keys: Record<string, string> = {}
    for (const row of data || []) {
      try {
        keys[row.provider] = Buffer.from(row.key, 'base64').toString('utf-8')
      } catch {
        keys[row.provider] = row.key
      }
    }

    apiKeyCache = keys
    apiKeyCacheTime = Date.now()
    return keys
  } catch {
    return apiKeyCache
  }
}

async function getApiKey(provider: string): Promise<string | null> {
  const stored = await fetchStoredApiKeys()
  if (stored[provider]) return stored[provider]

  const envKeys: Record<string, string | undefined> = {
    openai: process.env.OPENAI_API_KEY,
    anthropic: process.env.ANTHROPIC_API_KEY,
    google: process.env.GOOGLE_API_KEY,
    perplexity: process.env.PERPLEXITY_API_KEY
  }
  return envKeys[provider] || null
}

// 임베딩 생성
async function createEmbedding(text: string): Promise<number[]> {
  const apiKey = await getApiKey('openai')
  if (!apiKey) throw new Error('OpenAI API key not available')
  const openai = new OpenAI({ apiKey })
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text.substring(0, 8000),
    dimensions: 1536
  })
  return response.data[0].embedding
}

// 설교 검색 (구절 기반)
async function searchSermonsByReference(reference: string): Promise<any[]> {
  try {
    const queryEmbedding = await createEmbedding(reference)

    const { data, error } = await getSupabase().rpc('hybrid_search_sermons', {
      query_embedding: queryEmbedding,
      query_text: reference,
      match_count: 5,
      vector_weight: 0.7,
      keyword_weight: 0.3
    })

    if (error) {
      console.error('[sermon-commentary] 설교 검색 오류:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('[sermon-commentary] 검색 실패:', error)
    return []
  }
}

// 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 안양제일교회의 목사님이 설교하신 내용을 바탕으로 성경 강해를 전해주는 AI 어시스턴트입니다.

역할:
- 주어진 설교 내용만을 근거로 해당 성경 구절에 대한 강해를 전달합니다.
- 목사님의 설교 스타일을 존중하면서 내용을 정리합니다.

절대 규칙:
1. 제공된 설교 내용에 없는 것은 절대 만들어내지 마세요 (할루시네이션 금지)
2. 설교 내용을 직접 인용하거나 요약하세요
3. 어떤 설교에서 발췌한 것인지 출처를 명시하세요

답변 형식:
- 친절하고 이해하기 쉽게 설명
- 2-3문단으로 간결하게 정리
- 설교 제목과 날짜를 출처로 표기
- 핵심 메시지를 강조`

export async function POST(req: NextRequest) {
  try {
    const { reference } = await req.json()

    if (!reference) {
      return NextResponse.json({ error: 'reference is required' }, { status: 400 })
    }

    console.log(`[sermon-commentary] 구절 "${reference}" 강해 검색 시작`)

    // 1. 설교 검색
    const sermonResults = await searchSermonsByReference(reference)

    if (!sermonResults || sermonResults.length === 0) {
      console.log(`[sermon-commentary] "${reference}" 관련 설교 없음`)
      return NextResponse.json({ found: false })
    }

    console.log(`[sermon-commentary] ${sermonResults.length}개 설교 청크 발견`)

    // 2. 컨텍스트 구성
    const context = sermonResults.map((r: any, i: number) => {
      const title = r.video_title || '제목 없음'
      const speaker = r.speaker || ''
      const date = r.upload_date || ''
      const content = r.content || ''
      return `[설교 ${i + 1}] ${title}${speaker ? ` (${speaker})` : ''}${date ? ` - ${date}` : ''}\n"${content}"`
    }).join('\n\n')

    const userPrompt = `다음 설교 내용을 바탕으로 "${reference}" 구절에 대한 강해를 전해주세요.

${context}

위 설교 내용에 근거하여 "${reference}"에 대한 목사님의 강해를 친절하고 이해하기 쉽게 정리해주세요.`

    // 3. AI 응답 생성 (4단계 fallback)
    let commentary = ''
    let provider = ''

    // OpenAI
    try {
      const apiKey = await getApiKey('openai')
      if (!apiKey) throw new Error('No OpenAI key')
      const openai = new OpenAI({ apiKey })
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ]
      })
      commentary = response.choices[0]?.message?.content || ''
      provider = 'OpenAI'
      console.log(`[sermon-commentary] OpenAI 응답 생성 완료`)
    } catch (e: any) {
      console.log(`[sermon-commentary] OpenAI 실패: ${e.message?.substring(0, 50)}`)
    }

    // Claude
    if (!commentary) {
      try {
        const apiKey = await getApiKey('anthropic')
        if (!apiKey) throw new Error('No Anthropic key')
        const anthropic = new Anthropic({ apiKey })
        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }]
        })
        const textBlock = response.content.find(b => b.type === 'text')
        commentary = textBlock ? (textBlock as any).text : ''
        provider = 'Claude'
        console.log(`[sermon-commentary] Claude 응답 생성 완료`)
      } catch (e: any) {
        console.log(`[sermon-commentary] Claude 실패: ${e.message?.substring(0, 50)}`)
      }
    }

    // Gemini
    if (!commentary) {
      try {
        const apiKey = await getApiKey('google')
        if (!apiKey) throw new Error('No Google key')
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })
        const result = await model.generateContent(`${SYSTEM_PROMPT}\n\n${userPrompt}`)
        commentary = result.response.text()
        provider = 'Gemini'
        console.log(`[sermon-commentary] Gemini 응답 생성 완료`)
      } catch (e: any) {
        console.log(`[sermon-commentary] Gemini 실패: ${e.message?.substring(0, 50)}`)
      }
    }

    // Perplexity
    if (!commentary) {
      try {
        const apiKey = await getApiKey('perplexity')
        if (!apiKey) throw new Error('No Perplexity key')
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'sonar',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt }
            ],
            max_tokens: 1024
          })
        })
        const data = await response.json()
        commentary = data.choices?.[0]?.message?.content || ''
        provider = 'Perplexity'
        console.log(`[sermon-commentary] Perplexity 응답 생성 완료`)
      } catch (e: any) {
        console.log(`[sermon-commentary] Perplexity 실패: ${e.message?.substring(0, 50)}`)
      }
    }

    if (!commentary) {
      return NextResponse.json({
        found: true,
        error: '모든 AI 서비스가 일시적으로 사용 불가능합니다.'
      }, { status: 503 })
    }

    // 출처 정보
    const sources = sermonResults.slice(0, 3).map((r: any) => ({
      title: r.video_title,
      speaker: r.speaker,
      date: r.upload_date,
      videoUrl: r.video_url,
      startTime: r.start_time
    }))

    return NextResponse.json({
      found: true,
      commentary,
      provider,
      sources
    })

  } catch (error: any) {
    console.error('[sermon-commentary] 오류:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
