/**
 * Voice 설정 관리 API
 * GET: Voice ID 조회
 * POST: Voice ID 저장
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

interface VoiceSettings {
  voice_id: string
  provider: 'elevenlabs' | 'openai' | 'google'
  updated_at: string
}

/**
 * GET: Voice 설정 조회
 */
export async function GET() {
  try {
    // admin_settings 테이블에서 voice 설정 조회
    const { data, error } = await getSupabase()
      .from('admin_settings')
      .select('key, value, updated_at')
      .eq('key', 'voice_settings')
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('Voice settings fetch error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // 설정이 없으면 환경 변수 사용
    if (!data) {
      return NextResponse.json({
        success: true,
        settings: {
          voice_id: process.env.ELEVENLABS_VOICE_ID || '',
          provider: 'elevenlabs',
          source: 'env'
        }
      })
    }

    // value가 이미 객체인 경우와 문자열인 경우 모두 처리
    const settings = (typeof data.value === 'string'
      ? JSON.parse(data.value)
      : data.value) as VoiceSettings
    return NextResponse.json({
      success: true,
      settings: {
        ...settings,
        source: 'database'
      }
    })

  } catch (error: any) {
    console.error('Voice settings API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * POST: Voice 설정 저장
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { voice_id, provider = 'elevenlabs' } = body

    if (!voice_id) {
      return NextResponse.json({ error: 'voice_id is required' }, { status: 400 })
    }

    const settings: VoiceSettings = {
      voice_id,
      provider,
      updated_at: new Date().toISOString()
    }

    // admin_settings 테이블에 upsert
    const { error } = await getSupabase()
      .from('admin_settings')
      .upsert({
        key: 'voice_settings',
        value: JSON.stringify(settings),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'key'
      })

    if (error) {
      console.error('Voice settings save error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      settings
    })

  } catch (error: any) {
    console.error('Voice settings save error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
