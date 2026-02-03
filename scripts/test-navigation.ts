/**
 * 교회 홈페이지 네비게이션 구조 분석 테스트
 * 사용법: npx tsx scripts/test-navigation.ts
 */

import * as cheerio from 'cheerio'

const testChurches = [
  { name: '광림교회', url: 'https://www.klmc.church/' },
  { name: '꽃동산교회', url: 'http://www.flowergarden.or.kr/' },
  { name: '충현교회', url: 'https://www.choonghyunchurch.or.kr/' },
]

interface NavItem {
  text: string
  href?: string
  children?: NavItem[]
}

async function fetchHTML(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
      },
      redirect: 'follow'
    })

    if (!response.ok) {
      console.log(`  HTTP ${response.status} - ${url}`)
      return null
    }

    return await response.text()
  } catch (error: any) {
    console.log(`  Fetch error: ${error.message}`)
    return null
  }
}

function analyzeNavigation(html: string, churchName: string): void {
  const $ = cheerio.load(html)

  console.log(`\n${'='.repeat(60)}`)
  console.log(`📍 ${churchName}`)
  console.log('='.repeat(60))

  // 1. HTML 기본 정보
  console.log('\n1️⃣ 기본 정보:')
  console.log(`   - Title: ${$('title').text().trim().substring(0, 50)}`)
  console.log(`   - Body 클래스: ${$('body').attr('class')?.substring(0, 50) || '없음'}`)

  // 2. 네비게이션 요소 검색
  const navSelectors = [
    'nav', 'header nav', '#gnb', '.gnb', '#nav', '.nav',
    '#menu', '.menu', '.main-menu', '.navigation', '.top-menu',
    'ul.depth1', 'ul.lnb', 'ul.gnb', '.gnb-menu',
    '.menu-wrap', '.nav-wrap', '.gnb-wrap',
    '.header-menu', '.top-nav', '.allmenu',
    'nav.navbar', '.navbar-nav', 'ul.navbar-nav'
  ]

  console.log('\n2️⃣ 네비게이션 요소:')
  const foundNavs: string[] = []
  for (const selector of navSelectors) {
    const count = $(selector).length
    if (count > 0) {
      foundNavs.push(`${selector} (${count})`)
    }
  }
  if (foundNavs.length > 0) {
    foundNavs.forEach(nav => console.log(`   ✓ ${nav}`))
  } else {
    console.log('   ⚠️ 표준 네비게이션 요소 없음')
  }

  // 3. 헤더 영역 분석
  console.log('\n3️⃣ 헤더 영역 분석:')
  const $header = $('header, #header, .header, #gnb-wrap, .gnb-wrap').first()
  if ($header.length > 0) {
    console.log(`   - 헤더 태그: ${$header.prop('tagName')?.toLowerCase() || 'unknown'}`)
    console.log(`   - 헤더 클래스: ${$header.attr('class')?.substring(0, 60) || '없음'}`)
    console.log(`   - 헤더 ID: ${$header.attr('id') || '없음'}`)

    // 헤더 내 링크 수
    const headerLinks = $header.find('a').length
    console.log(`   - 헤더 내 링크 수: ${headerLinks}개`)

    // 헤더 내 메인 메뉴 후보
    const menuCandidates = $header.find('ul > li > a, nav a, .menu a, .gnb a')
    console.log(`   - 메뉴 후보 링크 수: ${menuCandidates.length}개`)
  } else {
    console.log('   ⚠️ 헤더 영역 없음')
  }

  // 4. 1차 메뉴 항목 추출 시도
  console.log('\n4️⃣ 1차 메뉴 항목:')
  let menuItems: NavItem[] = []

  // 방법 1: 일반 nav 구조
  const $nav = $('nav, #gnb, .gnb, .main-menu, .gnb-menu, .menu, .top-menu').first()
  if ($nav.length > 0) {
    $nav.find('> ul > li > a, > li > a, > div > ul > li > a').each((i, el) => {
      const $a = $(el)
      const text = $a.text().trim().replace(/\s+/g, ' ').substring(0, 30)
      const href = $a.attr('href')
      if (text && text.length > 0 && text.length < 30) {
        menuItems.push({ text, href })
      }
    })
  }

  // 방법 2: depth1 클래스
  if (menuItems.length === 0) {
    $('.depth1, ul.depth1, .menu-depth1').find('> li > a').each((i, el) => {
      const $a = $(el)
      const text = $a.text().trim().replace(/\s+/g, ' ').substring(0, 30)
      const href = $a.attr('href')
      if (text && text.length > 0 && text.length < 30) {
        menuItems.push({ text, href })
      }
    })
  }

  // 방법 3: Bootstrap navbar
  if (menuItems.length === 0) {
    $('.navbar-nav > li > a, .navbar-nav > .nav-item > a').each((i, el) => {
      const $a = $(el)
      const text = $a.text().trim().replace(/\s+/g, ' ').substring(0, 30)
      const href = $a.attr('href')
      if (text && text.length > 0 && text.length < 30) {
        menuItems.push({ text, href })
      }
    })
  }

  if (menuItems.length > 0) {
    menuItems.slice(0, 10).forEach((item, i) => {
      console.log(`   ${i + 1}. ${item.text}${item.href ? ` → ${item.href.substring(0, 50)}` : ''}`)
    })
    if (menuItems.length > 10) {
      console.log(`   ... 외 ${menuItems.length - 10}개`)
    }
  } else {
    console.log('   ⚠️ 메뉴 항목 추출 실패')

    // 대체 방법: 헤더 영역 모든 링크
    console.log('\n   [대체] 헤더 영역 링크 목록:')
    const $headerArea = $('header, #header, .header').first()
    $headerArea.find('a').slice(0, 15).each((i, el) => {
      const $a = $(el)
      const text = $a.text().trim().replace(/\s+/g, ' ').substring(0, 25)
      const href = $a.attr('href')
      if (text && href && href !== '#' && href !== 'javascript:void(0)') {
        console.log(`   - ${text} → ${href.substring(0, 40)}`)
      }
    })
  }

  // 5. 특이 구조 분석
  console.log('\n5️⃣ 특이 구조:')
  // iframe
  const iframeCount = $('iframe').length
  if (iframeCount > 0) console.log(`   - iframe: ${iframeCount}개`)

  // JavaScript 메뉴 (onclick 등)
  const jsMenus = $('[onclick*="menu"], [onclick*="open"], [onclick*="show"]').length
  if (jsMenus > 0) console.log(`   - JS 클릭 메뉴: ${jsMenus}개`)

  // 전체메뉴 버튼
  const allMenuBtn = $('[class*="all"], [class*="total"], [class*="allmenu"], [id*="allmenu"]').filter('button, a, div').length
  if (allMenuBtn > 0) console.log(`   - 전체메뉴 버튼: ${allMenuBtn}개`)

  // 반응형/모바일 메뉴
  const mobileMenu = $('[class*="mobile"], [class*="m-menu"], [class*="m_menu"]').length
  if (mobileMenu > 0) console.log(`   - 모바일 메뉴: ${mobileMenu}개`)

  // data 속성 메뉴
  const dataMenus = $('[data-menu], [data-nav], [data-depth]').length
  if (dataMenus > 0) console.log(`   - data 속성 메뉴: ${dataMenus}개`)
}

async function main() {
  console.log('교회 홈페이지 네비게이션 구조 분석 시작\n')

  for (const church of testChurches) {
    console.log(`\n📡 ${church.name} HTML 가져오는 중...`)
    const html = await fetchHTML(church.url)

    if (html) {
      analyzeNavigation(html, church.name)
    } else {
      console.log(`❌ ${church.name} - HTML 가져오기 실패`)
    }

    // 요청 간 딜레이
    await new Promise(resolve => setTimeout(resolve, 1000))
  }

  console.log('\n\n✅ 분석 완료')
}

main().catch(console.error)
