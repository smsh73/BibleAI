const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(
  "https://ntbolrzflhpkpoziyrlj.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50Ym9scnpmbGhwa3Bveml5cmxqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTQzMDEyMCwiZXhwIjoyMDg1MDA2MTIwfQ.f_TnSC4xTGIudmboG-KbH4YphHz0yFKucfy7O54cqqk"
);

async function main() {
  // 2026-01-04 상세
  const { data: partial } = await supabase
    .from("bulletin_chunks")
    .select("page_number, section_type, title, content")
    .eq("bulletin_date", "2026-01-04")
    .order("page_number", { ascending: true });

  console.log("=== 2026-01-04 (3개만 추출됨) ===");
  if (partial) {
    partial.forEach(function (c) {
      console.log("P" + c.page_number + " | " + c.section_type + " | " + c.title);
      console.log("  내용:", (c.content || "").substring(0, 120));
    });
  }

  // 페이지별 section_type 패턴
  console.log("\n=== 페이지별 section_type 패턴 ===");
  const { data: all } = await supabase
    .from("bulletin_chunks")
    .select("page_number, section_type")
    .order("page_number", { ascending: true });

  var pattern = {};
  if (all) {
    all.forEach(function (c) {
      var key = "P" + c.page_number;
      if (pattern[key] === undefined) pattern[key] = {};
      if (pattern[key][c.section_type] === undefined) pattern[key][c.section_type] = 0;
      pattern[key][c.section_type]++;
    });
  }

  Object.keys(pattern)
    .sort()
    .forEach(function (page) {
      var types = pattern[page];
      var parts = Object.keys(types).map(function (t) {
        return t + "(" + types[t] + ")";
      });
      console.log(page + ": " + parts.join(", "));
    });

  // 기타 유형 청크
  console.log("\n=== 기타 유형 청크 상세 ===");
  const { data: etc } = await supabase
    .from("bulletin_chunks")
    .select("page_number, title, content, bulletin_date")
    .eq("section_type", "기타");

  if (etc) {
    etc.forEach(function (c) {
      console.log(c.bulletin_date + " P" + c.page_number + " | " + c.title);
      console.log("  내용:", (c.content || "").substring(0, 150));
    });
  }

  // content 길이 통계
  console.log("\n=== 청크 content 길이 통계 ===");
  const { data: lengths } = await supabase
    .from("bulletin_chunks")
    .select("page_number, section_type, content, bulletin_date")
    .order("bulletin_date", { ascending: false });

  if (lengths) {
    var shortChunks = lengths.filter(function (c) {
      return (c.content || "").length < 100;
    });
    var longChunks = lengths.filter(function (c) {
      return (c.content || "").length > 3000;
    });
    var avgLen =
      lengths.reduce(function (sum, c) {
        return sum + (c.content || "").length;
      }, 0) / lengths.length;

    console.log("평균 길이:", Math.round(avgLen) + "자");
    console.log("100자 미만:", shortChunks.length + "개");
    console.log("3000자 이상:", longChunks.length + "개");

    if (shortChunks.length > 0) {
      console.log("\n짧은 청크 목록:");
      shortChunks.forEach(function (c) {
        console.log(
          "  " + c.bulletin_date + " P" + c.page_number + " (" + (c.content || "").length + "자): " + (c.content || "").substring(0, 80)
        );
      });
    }
  }
}

main();
