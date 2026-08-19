import { fetch } from 'sdk';

export async function checkWeatherForLocation(lat, lon) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=precipitation_probability,precipitation,temperature_2m,weathercode&timezone=auto&forecast_days=2`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.hourly) {
    return 'Could not fetch weather data.';
  }

  const times = data.hourly.time;
  const precipProb = data.hourly.precipitation_probability;
  const precip = data.hourly.precipitation;
  const temps = data.hourly.temperature_2m;

  const now = new Date();
  const rainHours = [];

  for (let i = 0; i < Math.min(times.length, 24); i++) {
    const hourTime = new Date(times[i]);
    if (hourTime >= now && precipProb[i] > 40) {
      rainHours.push({
        time: times[i],
        probability: precipProb[i],
        amount: precip[i],
        temp: temps[i],
      });
    }
  }

  if (rainHours.length === 0) {
    const currentTemp = temps[0];
    return `No rain expected in the next 24 hours.\nCurrent: ${currentTemp}C`;
  }

  const firstRain = rainHours[0];

  let msg = `Rain Alert!\n\nRain expected at:\n`;

  for (const r of rainHours.slice(0, 5)) {
    const time = new Date(r.time);
    const hours = time.getHours().toString().padStart(2, '0');
    const mins = time.getMinutes().toString().padStart(2, '0');
    msg += `${hours}:${mins} - ${r.probability}% chance, ${r.amount}mm\n`;
  }

  msg += `\nTemperature: ${firstRain.temp}C`;
  msg += `\nDon't forget your umbrella!`;

  return msg;
}
