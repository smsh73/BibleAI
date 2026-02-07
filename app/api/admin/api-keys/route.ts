/**
 * 관리자 API - API 키 관리 (Supabase 저장)
 * GET /api/admin/api-keys - 전체 조회
 * POST /api/admin/api-keys - 생성/업데이트
 * DELETE /api/admin/api-keys - 삭제
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import type { AIProvider } from '@/types'

// Supabase 클라이언트
function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) return null
  return createClient(url, key)
}

// 간단한 암호화 (프로덕션에서는 더 강력한 암호화 사용)
function encryptKey(key: string): string {
  return Buffer.from(key).toString('base64')
}

function decryptKey(encrypted: string): string {
  return Buffer.from(encrypted, 'base64').toString('utf-8')
}

// GET: 모든 API 키 조회 (키는 마스킹)
export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabase()
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      )
    }

    const { data: apiKeys, error } = await supabase
      .from('api_keys')
      .select('*')
      .order('priority', { ascending: true })

    if (error) {
      console.error('Get API keys error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch API keys' },
        { status: 500 }
      )
    }

    // 키 마스킹
    const maskedKeys = (apiKeys || []).map((key: any) => {
      const decrypted = key.key ? decryptKey(key.key) : ''
      return {
        id: key.id,
        provider: key.provider,
        keyPreview: decrypted ? `${decrypted.slice(0, 10)}***` : 'Not set',
        isActive: key.is_active,
        priority: key.priority,
        createdAt: key.created_at,
        updatedAt: key.updated_at
      }
    })

    return NextResponse.json(maskedKeys)
  } catch (error) {
    console.error('Get API keys error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch API keys' },
      { status: 500 }
    )
  }
}

// POST: API 키 생성/업데이트
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { provider, key, isActive = true, priority = 0 } = body

    if (!provider || !key) {
      return NextResponse.json(
        { error: 'Provider and key are required' },
        { status: 400 }
      )
    }

    // 유효한 provider 체크 (youtube 추가)
    const validProviders: AIProvider[] = ['openai', 'anthropic', 'google', 'perplexity', 'youtube']
    if (!validProviders.includes(provider)) {
      return NextResponse.json(
        { error: 'Invalid provider' },
        { status: 400 }
      )
    }

    const supabase = getSupabase()
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      )
    }

    // 암호화
    const encryptedKey = encryptKey(key)

    // 기존 키 확인
    const { data: existing } = await supabase
      .from('api_keys')
      .select('id')
      .eq('provider', provider)
      .single()

    let result
    if (existing) {
      // 업데이트
      const { data, error } = await supabase
        .from('api_keys')
        .update({
          key: encryptedKey,
          is_active: isActive,
          priority,
          updated_at: new Date().toISOString()
        })
        .eq('provider', provider)
        .select()
        .single()

      if (error) throw error
      result = data
    } else {
      // 새로 생성
      const { data, error } = await supabase
        .from('api_keys')
        .insert({
          provider,
          key: encryptedKey,
          is_active: isActive,
          priority
        })
        .select()
        .single()

      if (error) throw error
      result = data
    }

    return NextResponse.json({
      id: result.id,
      provider: result.provider,
      isActive: result.is_active,
      priority: result.priority
    })
  } catch (error) {
    console.error('Save API key error:', error)
    return NextResponse.json(
      { error: 'Failed to save API key' },
      { status: 500 }
    )
  }
}

// DELETE: API 키 삭제
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const provider = searchParams.get('provider')

    if (!provider) {
      return NextResponse.json(
        { error: 'Provider is required' },
        { status: 400 }
      )
    }

    const supabase = getSupabase()
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database not configured' },
        { status: 500 }
      )
    }

    const { error } = await supabase
      .from('api_keys')
      .delete()
      .eq('provider', provider)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete API key error:', error)
    return NextResponse.json(
      { error: 'Failed to delete API key' },
      { status: 500 }
    )
  }
}
