/**
 * 교회별 사전 항목 수 확인
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
)

async function check() {
  // 교회 목록
  const { data: churches } = await supabase
    .from('churches')
    .select('id, name, code')
    .eq('is_active', true)
    .order('name')

  console.log('교회별 사전 항목 수:')
  console.log('='.repeat(50))

  let total = 0
  for (const church of churches || []) {
    const { count } = await supabase
      .from('church_dictionary')
      .select('*', { count: 'exact', head: true })
      .eq('church_id', church.id)

    const cnt = count || 0
    total += cnt
    if (cnt > 0) {
      console.log(`${church.name.padEnd(20)} ${cnt.toString().padStart(5)} 개`)
    } else {
      console.log(`${church.name.padEnd(20)}     0 개 ⚠️`)
    }
  }

  console.log('='.repeat(50))
  console.log(`총 항목 수: ${total}개`)
}

check().catch(console.error)
