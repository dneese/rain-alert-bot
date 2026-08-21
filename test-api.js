// Standalone test: verify Open-Meteo timezone fix
// Usage: node test-api.js

const LAT = 49.82506;
const LON = 23.951567;

async function testOpenMeteo() {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m&minutely_15=precipitation,precipitation_probability&hourly=precipitation_probability,precipitation,temperature_2m,wind_speed_10m&timezone=auto&forecast_days=2`;
  
  const res = await fetch(url);
  const data = await res.json();
  const tzOffsetSec = data.utc_offset_seconds || 0;
  const tzOffsetMs = tzOffsetSec * 1000;

  console.log(`Timezone: ${data.timezone} (offset: ${tzOffsetSec}s = ${tzOffsetSec/3600}h)`);
  console.log(`Current time UTC: ${new Date().toISOString()}`);
  console.log(`Current time local: ${new Date(Date.now() + tzOffsetMs).toISOString()}`);
  console.log();

  // BUGGY: + offset
  function apiTimeToMsBuggy(timeStr) {
    return new Date(timeStr + 'Z').getTime() + tzOffsetMs;
  }
  // FIXED: - offset  
  function apiTimeToMsFixed(timeStr) {
    return new Date(timeStr + 'Z').getTime() - tzOffsetMs;
  }

  const nowUtcMs = Date.now();

  // Test with real minutely_15 data
  const minutelyTimes = data.minutely_15?.time?.slice(0, 12) || [];
  console.log(`--- Minutely 15 (first 12 entries) ---`);
  console.log(`API time strings: ${minutelyTimes.map(t => t.split('T')[1]).join(', ')}`);
  console.log();

  console.log(`BUGGY (+offset): nowLocalMs = ${nowUtcMs + tzOffsetMs}`);
  console.log(`FIXED (-offset): nowLocalMs = ${nowUtcMs}`);
  console.log();

  const buggyNow = nowUtcMs + tzOffsetMs;
  const fixedNow = nowUtcMs;

  let buggyPass = 0, fixedPass = 0;
  for (const t of minutelyTimes) {
    const buggyMs = apiTimeToMsBuggy(t);
    const fixedMs = apiTimeToMsFixed(t);
    const buggyFuture = buggyMs >= buggyNow;
    const fixedFuture = fixedMs >= fixedNow;
    const buggyDiffMin = Math.round((buggyMs - buggyNow) / 60000);
    const fixedDiffMin = Math.round((fixedMs - fixedNow) / 60000);
    if (buggyFuture) buggyPass++;
    if (fixedFuture) fixedPass++;
    console.log(`${t.split('T')[1]}: BUGGY ${buggyFuture ? '+' : ''}${buggyDiffMin}m | FIXED ${fixedFuture ? '+' : ''}${fixedDiffMin}m`);
  }
  console.log();
  console.log(`BUGGY: ${buggyPass}/${minutelyTimes.length} entries pass filter`);
  console.log(`FIXED: ${fixedPass}/${minutelyTimes.length} entries pass filter`);
  console.log();

  // Test footer display
  const nowLocalDisplay = new Date(nowUtcMs + tzOffsetMs);
  const nowTimeStr = `${String(nowLocalDisplay.getUTCHours()).padStart(2, '0')}:${String(nowLocalDisplay.getUTCMinutes()).padStart(2, '0')}`;
  console.log(`Footer time display: ${nowTimeStr} (should be local Kyiv time)`);

  // Test formatDate
  const todayStr = new Date(nowUtcMs + tzOffsetMs).toISOString().split('T')[0];
  console.log(`Today in Kyiv: ${todayStr}`);

  // Show current conditions
  const c = data.current;
  const WMO_CODES = {
    0: { icon: '☀️', rain: false }, 1: { icon: '🌤', rain: false }, 2: { icon: '⛅', rain: false }, 3: { icon: '☁️', rain: false },
    45: { icon: '🌫', rain: false }, 48: { icon: '🌫', rain: false },
    51: { icon: '🌦', rain: true }, 53: { icon: '🌦', rain: true }, 55: { icon: '🌧', rain: true },
    61: { icon: '🌦', rain: true }, 63: { icon: '🌧', rain: true }, 65: { icon: '🌧', rain: true },
    80: { icon: '🌦', rain: true }, 81: { icon: '🌧', rain: true }, 82: { icon: '🌧', rain: true },
    95: { icon: '⛈', rain: true }, 96: { icon: '⛈', rain: true }, 99: { icon: '⛈', rain: true },
  };
  const wmo = WMO_CODES[c.weather_code] || { icon: '🌤', rain: false };
  console.log();
  console.log(`Current: ${wmo.icon} ${c.temperature_2m}°C, humidity ${c.relative_humidity_2m}%, precip ${c.precipitation}mm, WMO ${c.weather_code}`);
  console.log(`is_raining (from WMO): ${wmo.rain}`);
  console.log(`is_raining (from precip): ${c.precipitation > 0}`);

  // Show first 8 hourly with corrected times
  console.log();
  console.log(`--- Hourly (fixed times) ---`);
  const hourly = data.hourly;
  for (let i = 0; i < Math.min(8, hourly.time.length); i++) {
    const fixedMs = apiTimeToMsFixed(hourly.time[i]);
    if (fixedMs < nowUtcMs) continue;
    const time = hourly.time[i].split('T')[1];
    const mm = hourly.precipitation[i];
    const prob = hourly.precipitation_probability[i];
    console.log(`${time}: ${prob}% rain, ${mm}mm precip`);
  }
}

testOpenMeteo().catch(console.error);
