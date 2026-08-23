const crypto = require('crypto');

const BASE = 'https://offers.bocmacau.com';
const API = `${BASE}/cmsSys/api/channel/http.do?service=getPageData`;
const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn7goJQI8cZXKF6DLbJ3hJYoMtzHOIt4tuJhgki8JyUGCoIodrPV3cx8D6z+lrEmPzGlmFwc56FnTsBa+nnTHrUSpWDdIoQGDKJ4u6PBJ7nXcHqv3IoOIh60z8qm5qmlbqdrdtlCfludJKwUGnwIVQYd7w7DA7LfprJ82LmROA0k3UbJ4+6eS3C9OT/bLB6rJsFf8nIDpBwh+DdflglVPhE5ljGNU1Rj4PuAyySBCrENqScsGuAqYyUBjDfuNF6vuapJ1oR/CL9YIRP0gO/cy7gI4VIFmJvtYOE0sAFpGNe1ObbvSPMAaHHX1yDlGoAUgatw8OfDHEirZfoLhSEZ4yQIDAQAB
-----END PUBLIC KEY-----`;
const iv = Buffer.alloc(16);
Buffer.from('BOCMCMSBANKSKEY', 'utf8').copy(iv);
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomKey() {
  return Array.from({length: 16}, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
}
function aesEncrypt(text, key) {
  const cipher = crypto.createCipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), iv);
  return Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]).toString('base64');
}
function aesDecrypt(text, key) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', Buffer.from(key, 'utf8'), iv);
  return Buffer.concat([decipher.update(Buffer.from(text, 'base64')), decipher.final()]).toString('utf8');
}
function parseDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function isCurrent(item, today) {
  if (item.isActive === false) return false;
  const start = parseDate(item.startDate);
  const end = parseDate(item.endDate);
  return (!start || start <= today) && (!end || end >= today);
}
function absolute(value) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${BASE}/${String(value).replace(/^\/+/, '')}`;
}
function collectCurrentCards(node, today, output) {
  if (Array.isArray(node)) {
    for (const item of node) collectCurrentCards(item, today, output);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const cardSets = [];
  if (node.type === 'baseCuration' && Array.isArray(node.tabs)) {
    for (const tab of node.tabs) {
      if (tab.type === 'YH' || tab.titleHk === '精選優惠') {
        cardSets.push(tab.bannerPictures || [], tab.normalPictures || []);
      }
    }
  }
  if (node.type === 'baseSwiper') cardSets.push(node.pictures || []);
  for (const cards of cardSets) {
    for (const card of cards) {
      if (!isCurrent(card, today)) continue;
      const title = String(card.name || card.titleHk || '').trim();
      const link = absolute(card.pageUrlHk || card.url || '');
      const image = absolute(card.imgUrlHk || card.fileWebUrl || '');
      if (!title || !link || !image) continue;
      output.push({
        bank: '中國銀行 (澳門)',
        title: title.slice(0, 100),
        description: '中國銀行澳門官方優惠，請按此查看活動詳情。',
        period: card.startDate && card.endDate ? `${card.startDate.replaceAll('-', '/')}-${card.endDate.replaceAll('-', '/')}` : '最新優惠',
        link_url: link,
        image_url: image,
        source_date: card.startDate || '',
      });
    }
  }
  for (const value of Object.values(node)) if (value && typeof value === 'object') collectCurrentCards(value, today, output);
}
async function requestPageData() {
  const service = 'pageInfoService/getPageData';
  const body = {header: {service, staticData: false, options: [], _t: Date.now()}, payload: {channel: 'H5'}};
  const plaintext = JSON.stringify(body);
  const key = randomKey();
  const signature = crypto.createHash('md5').update(key + plaintext).digest('hex');
  const encrypted = aesEncrypt(plaintext, key);
  const encryptedKey = crypto.publicEncrypt({key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING}, Buffer.from(key, 'utf8')).toString('base64');
  const envelope = [signature, encrypted, encryptedKey].join(String.fromCharCode(29));
  const response = await fetch(API, {method: 'POST', headers: {'Content-Type': 'application/json;charset=utf-8'}, body: envelope});
  const raw = await response.text();
  if (!response.ok) throw new Error(`中銀官方接口回應 ${response.status}`);
  return JSON.parse(aesDecrypt(raw, key));
}
async function main() {
  const response = await requestPageData();
  if (!response.success || !response.result) throw new Error('中銀官方接口未回傳優惠頁面資料');
  let content = response.result.pageContent;
  if (typeof content === 'string') content = JSON.parse(content);
  const today = parseDate(response.result.currentDate) || new Date();
  const cards = [];
  collectCurrentCards(content, today, cards);
  const unique = new Map();
  for (const card of cards) {
    const key = card.link_url;
    if (!unique.has(key) || card.source_date > unique.get(key).source_date) unique.set(key, card);
  }
  const offers = [...unique.values()]
    .sort((a, b) => b.source_date.localeCompare(a.source_date) || a.title.localeCompare(b.title, 'zh-Hant'))
    .slice(0, 9)
    .map(({source_date, ...offer}) => offer);
  console.log(JSON.stringify(offers));
}
main().catch(error => { console.error(error.stack || String(error)); process.exit(1); });
