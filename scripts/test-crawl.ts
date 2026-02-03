/**
 * 크롤러 테스트 스크립트
 * 사용법: npx tsx scripts/test-crawl.ts [churchCode]
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

// 동적 import로 church-crawler 모듈 로드
async function main() {
  const churchCode = process.argv[2] || 'saemoonan'

  console.log(`\n🔍 ${churchCode} 크롤링 테스트 시작...\n`)

  try {
    // crawlChurchWebsite 함수 import
    const { crawlChurchWebsite } = await import('../lib/church-crawler')

    const result = await crawlChurchWebsite(churchCode, {
      maxDepth: 3,
      maxPages: 50,
      extractPeople: true,
      extractBoards: true,
      extractContacts: true,
      extractMedia: true,
      deepCrawl: true,
      delayMs: 500,
      onProgress: (progress) => {
        if (progress.currentUrl) {
          console.log(`📄 [${progress.crawledPages}/${progress.totalPages || '?'}] ${progress.status}: ${progress.currentUrl?.substring(0, 60)}`)
        } else {
          console.log(`📊 ${progress.status}`)
        }
      }
    })

    console.log('\n' + '='.repeat(60))
    console.log('📊 크롤링 결과 요약')
    console.log('='.repeat(60))

    if (result.success) {
      console.log(`✅ 성공`)
      console.log(`   - 소요 시간: ${(result.crawlTime / 1000).toFixed(1)}초`)
      console.log(`   - 네비게이션: ${result.structure?.navigation?.length || 0}개`)
      console.log(`   - 게시판: ${result.structure?.boards?.length || 0}개`)
      console.log(`   - 팝업: ${result.popups?.length || 0}개`)
      console.log(`   - 사전 항목: ${result.dictionary?.length || 0}개`)
      console.log(`   - 분류 체계: ${result.taxonomy?.length || 0}개`)

      // 네비게이션 출력
      if (result.structure?.navigation?.length > 0) {
        console.log('\n📌 네비게이션 메뉴:')
        result.structure.navigation.slice(0, 10).forEach((nav: any, i: number) => {
          console.log(`   ${i + 1}. ${nav.title} ${nav.url ? `→ ${nav.url.substring(0, 50)}` : ''}`)
          if (nav.children?.length > 0) {
            nav.children.slice(0, 5).forEach((child: any, j: number) => {
              console.log(`      ${i + 1}.${j + 1} ${child.title}${child.url ? ` → ${child.url.substring(0, 40)}` : ''}`)
            })
            if (nav.children.length > 5) {
              console.log(`      ... 외 ${nav.children.length - 5}개`)
            }
          }
        })
        if (result.structure.navigation.length > 10) {
          console.log(`   ... 외 ${result.structure.navigation.length - 10}개`)
        }
      }

      // 사전 항목 출력
      if (result.dictionary?.length > 0) {
        console.log('\n📚 사전 항목:')
        const byCategory: Record<string, any[]> = {}
        result.dictionary.forEach((d: any) => {
          if (!byCategory[d.category]) byCategory[d.category] = []
          byCategory[d.category].push(d)
        })

        Object.entries(byCategory).forEach(([category, items]) => {
          console.log(`   [${category}] ${items.length}개`)
          items.slice(0, 5).forEach((item: any) => {
            console.log(`      - ${item.term}${item.subcategory ? ` (${item.subcategory})` : ''}`)
          })
          if (items.length > 5) {
            console.log(`      ... 외 ${items.length - 5}개`)
          }
        })
      }

      // 에러
      if (result.errors?.length > 0) {
        console.log('\n⚠️ 에러:')
        result.errors.slice(0, 5).forEach((err: string) => {
          console.log(`   - ${err.substring(0, 80)}`)
        })
        if (result.errors.length > 5) {
          console.log(`   ... 외 ${result.errors.length - 5}개`)
        }
      }
    } else {
      console.log(`❌ 실패`)
      console.log(`   에러: ${result.errors?.join(', ')}`)
    }

  } catch (error: any) {
    console.error('\n❌ 크롤링 오류:', error.message)
    console.error(error.stack)
  }
}

main().catch(console.error)
