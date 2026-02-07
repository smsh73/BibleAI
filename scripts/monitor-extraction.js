const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  "https://ntbolrzflhpkpoziyrlj.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50Ym9scnpmbGhwa3Bveml5cmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDEyMCwiZXhwIjoyMDg1MDA2MTIwfQ.f_TnSC4xTGIudmboG-KbH4YphHz0yFKucfy7O54cqqk"
);

async function main() {
  var completedRes = await supabase.from("bulletin_issues").select("*", { count: "exact", head: true }).eq("status", "completed");
  var pendingRes = await supabase.from("bulletin_issues").select("*", { count: "exact", head: true }).eq("status", "pending");
  var chunksRes = await supabase.from("bulletin_chunks").select("*", { count: "exact", head: true });

  console.log("=== 처리 현황 ===");
  console.log("완료:", completedRes.count, "/ 대기:", pendingRes.count, "/ 총 청크:", chunksRes.count);

  // 최근 청크 상세 확인
  var result = await supabase
    .from("bulletin_chunks")
    .select("page_number, section_type, title, content, bulletin_date")
    .order("bulletin_date", { ascending: false })
    .order("page_number", { ascending: true })
    .limit(30);

  var chunks = result.data;
  if (chunks) {
    var currentDate = "";
    chunks.forEach(function (c) {
      if (c.bulletin_date !== currentDate) {
        currentDate = c.bulletin_date;
        console.log("\n=== " + c.bulletin_date + " ===");
      }
      // 마크다운 기호 포함 여부 체크
      var content = c.content || "";
      var hasHash = content.indexOf("#") >= 0;
      var hasStar = /\*[^*]/.test(content);
      var mdFlag = (hasHash || hasStar) ? " [MD!!]" : "";
      console.log("P" + c.page_number + " | " + c.section_type + " | " + c.title + " | " + content.length + "자" + mdFlag);
    });

    // 첫 번째 주보의 모든 페이지 상세 출력
    if (chunks.length > 0) {
      var firstDate = chunks[0].bulletin_date;
      console.log("\n\n========================================");
      console.log("=== " + firstDate + " 상세 내용 ===");
      console.log("========================================");

      var dateChunks = chunks.filter(function (c) { return c.bulletin_date === firstDate; });
      dateChunks.forEach(function (c) {
        console.log("\n--- P" + c.page_number + " [" + c.section_type + "] " + c.title + " ---");
        console.log(c.content);
        console.log("--- 끝 (" + (c.content || "").length + "자) ---");
      });
    }
  }
}

main().catch(console.error);
