/**
 * 성경 버전 목록 API
 * GET /api/bible/versions
 *
 * 활성화된 성경 버전 목록을 반환합니다.
 */

import { NextResponse } from 'next/server'
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

// 기본 지원 버전
const DEFAULT_VERSIONS = [
  { id: 'GAE', name_korean: '개역개정', name_english: 'Korean Revised Version (New)', language: 'ko', is_default: true, is_active: true },
  { id: 'KRV', name_korean: '개역한글', name_english: 'Korean Revised Version', language: 'ko', is_default: false, is_active: true },
  { id: 'NIV', name_korean: 'NIV', name_english: 'New International Version', language: 'en', is_default: false, is_active: true },
  { id: 'ESV', name_korean: 'ESV', name_english: 'English Standard Version', language: 'en', is_default: false, is_active: true }
]

export async function GET() {
  try {
    // bible_versions 테이블에서 버전 목록 조회
    const { data: dbVersions, error: versionsError } = await getSupabase()
      .from('bible_versions')
      .select('*')
      .eq('is_active', true)
      .order('id')

    // 버전별 구절 수 및 임베딩 수 조회 (count 사용으로 1000개 제한 문제 해결)
    const verseCountMap: Record<string, number> = {}
    const embeddedCountMap: Record<string, number> = {}

    // 각 버전별로 개별 count 쿼리 실행
    const versionIds = ['GAE', 'KRV', 'NIV', 'ESV']

    await Promise.all(versionIds.map(async (versionId) => {
      if (versionId === 'GAE') {
        // GAE는 version_id가 'GAE'이거나 null인 레코드 모두 포함
        const { count: verseCountGAE } = await getSupabase()
          .from('bible_verses')
          .select('*', { count: 'exact', head: true })
          .eq('version_id', 'GAE')

        const { count: verseCountNull } = await getSupabase()
          .from('bible_verses')
          .select('*', { count: 'exact', head: true })
          .is('version_id', null)

        verseCountMap['GAE'] = (verseCountGAE || 0) + (verseCountNull || 0)

        const { count: embeddedCountGAE } = await getSupabase()
          .from('bible_verses')
          .select('*', { count: 'exact', head: true })
          .eq('version_id', 'GAE')
          .not('embedding', 'is', null)

        const { count: embeddedCountNull } = await getSupabase()
          .from('bible_verses')
          .select('*', { count: 'exact', head: true })
          .is('version_id', null)
          .not('embedding', 'is', null)

        embeddedCountMap['GAE'] = (embeddedCountGAE || 0) + (embeddedCountNull || 0)
      } else {
        // 다른 버전은 해당 version_id만 카운트
        const { count: verseCount } = await getSupabase()
          .from('bible_verses')
          .select('*', { count: 'exact', head: true })
          .eq('version_id', versionId)

        verseCountMap[versionId] = verseCount || 0

        const { count: embeddedCount } = await getSupabase()
          .from('bible_verses')
          .select('*', { count: 'exact', head: true })
          .eq('version_id', versionId)
          .not('embedding', 'is', null)

        embeddedCountMap[versionId] = embeddedCount || 0
      }
    }))

    // DB 버전 또는 기본 버전 사용
    const versions = (dbVersions && dbVersions.length > 0 ? dbVersions : DEFAULT_VERSIONS).map(v => ({
      ...v,
      verse_count: verseCountMap[v.id] || 0,
      embedded_count: embeddedCountMap[v.id] || 0
    }))

    // 데이터가 있는 버전만 필터링 (선택사항)
    const activeVersions = versions.filter(v => v.verse_count > 0 || v.is_default)

    // 100% 완료된 버전만 필터링 (챗봇용)
    const completedVersions = versions.filter(v =>
      v.verse_count > 0 && v.embedded_count === v.verse_count
    )

    // 기본 버전 결정: 완료된 버전 중 is_default가 있으면 그것, 없으면 첫 번째
    const defaultVersion = completedVersions.find(v => v.is_default)?.id
      || completedVersions[0]?.id
      || 'GAE'

    return NextResponse.json({
      success: true,
      versions: activeVersions.length > 0 ? activeVersions : versions,
      completedVersions, // 100% 완료된 버전 (챗봇 드롭다운용)
      defaultVersion
    })
  } catch (error: any) {
    console.error('버전 목록 조회 오류:', error)

    // 오류 시 기본 버전 반환
    return NextResponse.json({
      success: true,
      versions: DEFAULT_VERSIONS,
      defaultVersion: 'GAE'
    })
  }
}
