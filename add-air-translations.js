// Script to add 10 new translation keys (refresh button, AQI, UV) to 22 languages
import { readFileSync, writeFileSync } from 'fs';

const newKeys = {
  uk: {
    btn_refresh: 'Оновити', toast_updated: 'Оновлено',
    aqi_label: 'Якість повітря', uv_label: 'УФ-індекс',
    aqi_good: 'Добре', aqi_moderate: 'Помірно', aqi_poor: 'Погано',
    aqi_unhealthy: 'Нездорово', aqi_very_unhealthy: 'Дуже нездорово', aqi_hazardous: 'Небезпечно',
  },
  en: {
    btn_refresh: 'Refresh', toast_updated: 'Updated',
    aqi_label: 'Air quality', uv_label: 'UV index',
    aqi_good: 'Good', aqi_moderate: 'Moderate', aqi_poor: 'Poor',
    aqi_unhealthy: 'Unhealthy', aqi_very_unhealthy: 'Very unhealthy', aqi_hazardous: 'Hazardous',
  },
  ru: {
    btn_refresh: 'Обновить', toast_updated: 'Обновлено',
    aqi_label: 'Качество воздуха', uv_label: 'УФ-индекс',
    aqi_good: 'Хорошее', aqi_moderate: 'Умеренное', aqi_poor: 'Плохое',
    aqi_unhealthy: 'Нездоровое', aqi_very_unhealthy: 'Очень нездоровое', aqi_hazardous: 'Опасное',
  },
  pl: {
    btn_refresh: 'Odśwież', toast_updated: 'Zaktualizowano',
    aqi_label: 'Jakość powietrza', uv_label: 'Indeks UV',
    aqi_good: 'Dobra', aqi_moderate: 'Umiarkowana', aqi_poor: 'Słaba',
    aqi_unhealthy: 'Niezdrowa', aqi_very_unhealthy: 'Bardzo niezdrowa', aqi_hazardous: 'Groźna',
  },
  de: {
    btn_refresh: 'Aktualisieren', toast_updated: 'Aktualisiert',
    aqi_label: 'Luftqualität', uv_label: 'UV-Index',
    aqi_good: 'Gut', aqi_moderate: 'Mäßig', aqi_poor: 'Schlecht',
    aqi_unhealthy: 'Ungesund', aqi_very_unhealthy: 'Sehr ungesund', aqi_hazardous: 'Gefährlich',
  },
  fr: {
    btn_refresh: 'Actualiser', toast_updated: 'Mis à jour',
    aqi_label: "Qualité de l'air", uv_label: 'Indice UV',
    aqi_good: 'Bonne', aqi_moderate: 'Modérée', aqi_poor: 'Mauvaise',
    aqi_unhealthy: 'Malsaine', aqi_very_unhealthy: 'Très malsaine', aqi_hazardous: 'Dangereuse',
  },
  es: {
    btn_refresh: 'Actualizar', toast_updated: 'Actualizado',
    aqi_label: 'Calidad del aire', uv_label: 'Índice UV',
    aqi_good: 'Buena', aqi_moderate: 'Moderada', aqi_poor: 'Mala',
    aqi_unhealthy: 'Insalubre', aqi_very_unhealthy: 'Muy insalubre', aqi_hazardous: 'Peligrosa',
  },
  it: {
    btn_refresh: 'Aggiorna', toast_updated: 'Aggiornato',
    aqi_label: "Qualità dell'aria", uv_label: 'Indice UV',
    aqi_good: 'Buona', aqi_moderate: 'Moderata', aqi_poor: 'Scarsa',
    aqi_unhealthy: 'Malsana', aqi_very_unhealthy: 'Molto malsana', aqi_hazardous: 'Pericolosa',
  },
  pt: {
    btn_refresh: 'Atualizar', toast_updated: 'Atualizado',
    aqi_label: 'Qualidade do ar', uv_label: 'Índice UV',
    aqi_good: 'Boa', aqi_moderate: 'Moderada', aqi_poor: 'Má',
    aqi_unhealthy: 'Insalubre', aqi_very_unhealthy: 'Muito insalubre', aqi_hazardous: 'Perigosa',
  },
  nl: {
    btn_refresh: 'Vernieuwen', toast_updated: 'Bijgewerkt',
    aqi_label: 'Luchtkwaliteit', uv_label: 'UV-index',
    aqi_good: 'Goed', aqi_moderate: 'Matig', aqi_poor: 'Slecht',
    aqi_unhealthy: 'Ongezond', aqi_very_unhealthy: 'Zeer ongezond', aqi_hazardous: 'Gevaarlijk',
  },
  cs: {
    btn_refresh: 'Obnovit', toast_updated: 'Aktualizováno',
    aqi_label: 'Kvalita vzduchu', uv_label: 'UV index',
    aqi_good: 'Dobrá', aqi_moderate: 'Střední', aqi_poor: 'Špatná',
    aqi_unhealthy: 'Nezdravá', aqi_very_unhealthy: 'Velmi nezdravá', aqi_hazardous: 'Nebezpečná',
  },
  sk: {
    btn_refresh: 'Obnoviť', toast_updated: 'Aktualizované',
    aqi_label: 'Kvalita vzduchu', uv_label: 'UV index',
    aqi_good: 'Dobrá', aqi_moderate: 'Stredná', aqi_poor: 'Zlá',
    aqi_unhealthy: 'Nezdravá', aqi_very_unhealthy: 'Veľmi nezdravá', aqi_hazardous: 'Nebezpečná',
  },
  ro: {
    btn_refresh: 'Reîmprospătare', toast_updated: 'Actualizat',
    aqi_label: 'Calitatea aerului', uv_label: 'Indice UV',
    aqi_good: 'Bună', aqi_moderate: 'Moderată', aqi_poor: 'Proastă',
    aqi_unhealthy: 'Nesănătoasă', aqi_very_unhealthy: 'Foarte nesănătoasă', aqi_hazardous: 'Periculoasă',
  },
  hu: {
    btn_refresh: 'Frissítés', toast_updated: 'Frissítve',
    aqi_label: 'Levegőminőség', uv_label: 'UV-index',
    aqi_good: 'Jó', aqi_moderate: 'Mérsékelt', aqi_poor: 'Rossz',
    aqi_unhealthy: 'Egészségtelen', aqi_very_unhealthy: 'Nagyon egészségtelen', aqi_hazardous: 'Veszedelmes',
  },
  bg: {
    btn_refresh: 'Опресняване', toast_updated: 'Обновено',
    aqi_label: 'Качество на въздуха', uv_label: 'UV индекс',
    aqi_good: 'Добро', aqi_moderate: 'Умерено', aqi_poor: 'Лошо',
    aqi_unhealthy: 'Нездравословно', aqi_very_unhealthy: 'Много нездравословно', aqi_hazardous: 'Опасно',
  },
  hr: {
    btn_refresh: 'Osvježi', toast_updated: 'Ažurirano',
    aqi_label: 'Kakovost zraka', uv_label: 'UV indeks',
    aqi_good: 'Dobro', aqi_moderate: 'Umjereno', aqi_poor: 'Loše',
    aqi_unhealthy: 'Nezdravo', aqi_very_unhealthy: 'Vrlo nezdravo', aqi_hazardous: 'Opasno',
  },
  tr: {
    btn_refresh: 'Yenile', toast_updated: 'Güncellendi',
    aqi_label: 'Hava kalitesi', uv_label: 'UV endeksi',
    aqi_good: 'İyi', aqi_moderate: 'Orta', aqi_poor: 'Kötü',
    aqi_unhealthy: 'Sağlıksız', aqi_very_unhealthy: 'Çok sağlıksız', aqi_hazardous: 'Tehlikeli',
  },
  ar: {
    btn_refresh: 'تحديث', toast_updated: 'تم التحديث',
    aqi_label: 'جودة الهواء', uv_label: 'مؤشر الأشعة فوق البنفسجية',
    aqi_good: 'جيد', aqi_moderate: 'متوسط', aqi_poor: 'سيئ',
    aqi_unhealthy: 'غير صحي', aqi_very_unhealthy: 'غير صحي جدا', aqi_hazardous: 'خطير',
  },
  he: {
    btn_refresh: 'רענון', toast_updated: 'עודכן',
    aqi_label: 'איכות האוויר', uv_label: 'מדד UV',
    aqi_good: 'טוב', aqi_moderate: 'בינוני', aqi_poor: 'גרוע',
    aqi_unhealthy: 'לא בריא', aqi_very_unhealthy: 'לא בריא מאוד', aqi_hazardous: 'מסוכן',
  },
  zh: {
    btn_refresh: '刷新', toast_updated: '已更新',
    aqi_label: '空气质量', uv_label: '紫外线指数',
    aqi_good: '好', aqi_moderate: '中等', aqi_poor: '较差',
    aqi_unhealthy: '不健康', aqi_very_unhealthy: '很不健康', aqi_hazardous: '危险',
  },
  ja: {
    btn_refresh: '更新', toast_updated: '更新しました',
    aqi_label: '大気の質', uv_label: 'UV指数',
    aqi_good: '良好', aqi_moderate: '中程度', aqi_poor: '悪い',
    aqi_unhealthy: '不健康', aqi_very_unhealthy: '非常に不健康', aqi_hazardous: '危険',
  },
  ko: {
    btn_refresh: '새로고침', toast_updated: '업데이트됨',
    aqi_label: '대기 질', uv_label: '자외선 지수',
    aqi_good: '좋음', aqi_moderate: '보통', aqi_poor: '나쁨',
    aqi_unhealthy: '건강에 해로움', aqi_very_unhealthy: '매우 해로움', aqi_hazardous: '위험',
  },
};

let content = readFileSync('./lib/i18n.js', 'utf8');

for (const [lang, keys] of Object.entries(newKeys)) {
  const langPattern = new RegExp(`(  ${lang}: \\{[\\s\\S]*?)(\\n  \\},)`);
  const match = content.match(langPattern);
  if (!match) {
    console.log(`Could not find section for ${lang}`);
    continue;
  }
  const keysStr = Object.entries(keys).map(([k, v]) => `    ${k}: '${v.replace(/'/g, "\\'")}',`).join('\n');
  const insertPoint = match[1].lastIndexOf('\n');
  const before = match[1].substring(0, insertPoint);
  const after = match[1].substring(insertPoint);
  const newSection = before + '\n' + keysStr + after + match[2];
  content = content.replace(match[0], newSection + '\n');
  console.log(`Added ${Object.keys(keys).length} keys to ${lang}`);
}

writeFileSync('./lib/i18n.js', content);
console.log('Done!');
