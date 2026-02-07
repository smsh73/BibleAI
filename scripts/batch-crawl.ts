/**
 * 전체 교회 배치 딥 크롤링 스크립트
 * 사용법: npx tsx scripts/batch-crawl.ts [startIndex]
 */

import * as dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
dotenv.config({ path: '.env.local' })

const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabase = createClient(supabaseUrl, supabaseKey)

interface CrawlSummary {
  churchCode: string
  churchName: string
  success: boolean
  crawlTime: number
  navigationCount: number
  boardsCount: number
  dictionaryCount: number
  errorsCount: number
  error?: string
}

async function main() {
  const startIndex = parseInt(process.argv[2] || '0')

  console.log(`\n🚀 전체 교회 배치 딥 크롤링 시작\n`)
  console.log(`시작 인덱스: ${startIndex}`)

  // 교회 목록 조회
  const { data: churches, error } = await supabase
    .from('churches')
    .select('code, name, homepage_url')
    .eq('is_active', true)
    .order('name')

  if (error || !churches) {
    console.error('교회 목록 조회 실패:', error?.message)
    process.exit(1)
  }

  console.log(`총 ${churches.length}개 교회\n`)

  // 크롤러 import
  const { crawlChurchWebsite } = await import('../lib/church-crawler')

  const summaries: CrawlSummary[] = []
  const startTime = Date.now()

  for (let i = startIndex; i < churches.length; i++) {
    const church = churches[i]
    const progress = `[${i + 1}/${churches.length}]`

    console.log(`\n${'='.repeat(60)}`)
    console.log(`${progress} ${church.name} (${church.code})`)
    console.log(`URL: ${church.homepage_url}`)
    console.log('='.repeat(60))

    try {
      const result = await crawlChurchWebsite(church.code, {
        maxDepth: 3,
        maxPages: 100,  // 각 교회당 최대 100페이지
        extractPeople: true,
        extractBoards: true,
        extractContacts: true,
        extractMedia: true,
        deepCrawl: true,
        delayMs: 800,  // 서버 부하 방지
        onProgress: (p) => {
          if ((p as any).status && !p.currentUrl) {
            console.log(`   ${(p as any).status}`)
          }
        }
      })

      const summary: CrawlSummary = {
        churchCode: church.code,
        churchName: church.name,
        success: result.success,
        crawlTime: result.crawlTime,
        navigationCount: result.structure?.navigation?.length || 0,
        boardsCount: result.structure?.boards?.length || 0,
        dictionaryCount: result.dictionary?.length || 0,
        errorsCount: result.errors?.length || 0
      }

      if (result.success) {
        console.log(`✅ 완료 (${(result.crawlTime / 1000).toFixed(1)}s)`)
        console.log(`   메뉴: ${summary.navigationCount}, 게시판: ${summary.boardsCount}, 사전: ${summary.dictionaryCount}`)
      } else {
        summary.error = result.errors?.[0]
        console.log(`❌ 실패: ${summary.error}`)
      }

      summaries.push(summary)

    } catch (err: any) {
      console.log(`❌ 오류: ${err.message}`)
      summaries.push({
        churchCode: church.code,
        churchName: church.name,
        success: false,
        crawlTime: 0,
        navigationCount: 0,
        boardsCount: 0,
        dictionaryCount: 0,
        errorsCount: 1,
        error: err.message
      })
    }

    // 교회 간 딜레이 (서버 부하 방지)
    if (i < churches.length - 1) {
      console.log(`\n⏳ 다음 교회까지 5초 대기...\n`)
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  // 최종 요약
  const totalTime = Date.now() - startTime
  const successful = summaries.filter(s => s.success).length
  const failed = summaries.filter(s => !s.success).length
  const totalDict = summaries.reduce((sum, s) => sum + s.dictionaryCount, 0)
  const totalNav = summaries.reduce((sum, s) => sum + s.navigationCount, 0)

  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 최종 결과`)
  console.log('='.repeat(60))
  console.log(`총 소요 시간: ${(totalTime / 1000 / 60).toFixed(1)}분`)
  console.log(`성공: ${successful}개 / 실패: ${failed}개`)
  console.log(`총 네비게이션: ${totalNav}개`)
  console.log(`총 사전 항목: ${totalDict}개`)

  if (failed > 0) {
    console.log(`\n⚠️ 실패한 교회:`)
    summaries.filter(s => !s.success).forEach(s => {
      console.log(`   - ${s.churchName}: ${s.error}`)
    })
  }

  // 결과 파일 저장
  const fs = await import('fs')
  const resultFile = `crawl-result-${new Date().toISOString().split('T')[0]}.json`
  fs.writeFileSync(resultFile, JSON.stringify(summaries, null, 2))
  console.log(`\n📄 결과 파일: ${resultFile}`)
}

main().catch(console.error)
