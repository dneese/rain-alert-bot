// Timezone math verification
const tzOffsetSec = 10800; // UTC+3 Europe/Kyiv

// Simulate API returns "2026-08-21T08:15" meaning 08:15 Kyiv = 05:15 UTC
const apiTimes = ["2026-08-21T08:15", "2026-08-21T08:30", "2026-08-21T09:00", "2026-08-21T10:00"];

// "now" = 08:30 Kyiv = 05:30 UTC
const nowUtcMs = new Date("2026-08-21T05:30:00Z").getTime();

console.log("=== BUGGY (current code: + offset) ===");
for (const t of apiTimes) {
  const ms = new Date(t + 'Z').getTime() + tzOffsetSec * 1000;
  const nowLocalMs = nowUtcMs + tzOffsetSec * 1000;
  const isFuture = ms >= nowLocalMs;
  const diffMin = Math.round((ms - nowLocalMs) / 60000);
  console.log(`  ${t}: future=${isFuture}, diff=${diffMin}min ${isFuture ? 'PASS (but should it be?)' : 'FILTERED'}`);
}

console.log("\n=== FIXED (correct: - offset) ===");
for (const t of apiTimes) {
  const ms = new Date(t + 'Z').getTime() - tzOffsetSec * 1000; // real UTC
  const isFuture = ms >= nowUtcMs; // compare real UTC to real UTC
  const diffMin = Math.round((ms - nowUtcMs) / 60000);
  console.log(`  ${t}: future=${isFuture}, diff=${diffMin}min ${isFuture ? 'PASS' : 'FILTERED (correct - it is past)'}`);
}

console.log("\n=== DISPLAY ===");
console.log(`  timeStr.split('T')[1] for each: ${apiTimes.map(t => t.split('T')[1]).join(', ')}`);
const nowLocal = new Date(nowUtcMs + tzOffsetSec * 1000);
console.log(`  Footer now: ${String(nowLocal.getUTCHours()).padStart(2,'0')}:${String(nowLocal.getUTCMinutes()).padStart(2,'0')} (expect 08:30)`);

console.log("\n=== FORMAT DATE ===");
const todayStr = new Date(nowUtcMs + tzOffsetSec * 1000).toISOString().split('T')[0];
console.log(`  Today: ${todayStr}`);
for (const t of apiTimes) {
  console.log(`  ${t.split('T')[0]} === ${todayStr} ? ${t.split('T')[0] === todayStr ? 'TODAY' : 'NOT TODAY'}`);
}
