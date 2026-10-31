import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { normalizeText, detectLanguage, replies, informationalReplies } from './language.mjs';
import { loadSources, createRetriever, retrieveKnowledge } from './retrieval.mjs';
import { recognizeSupportIncidents, isTechnicalEntryIncident } from './support-intents.mjs';

export const MODE = 'local-retrieval-templates';
export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; this.status = 400; this.code = 'INVALID_INPUT'; }
}

const patterns = {
  payment: /плат[её]ж|оплат|донат|задон|(?:верни|возврат).*деньг|(?:списал|снял|сняли|сняло).{0,30}деньг|деньг.{0,30}(?:списал|снял|сняли|сняло)|не приш[её]л.*(?:гк|донат)|payment|\bpaid\b|\bpayed\b|donat|refund|chargeback|pagu[eé]|\bpago\b|pagamento|reembolso|cobraron|cobrado|cobraram|cobran[cç]a|төлем|төлед|ақша.*(?:келме|шешіл|ұстал)|to'lov|tolov|pul.*(?:kelma|yechildi)/u,
  hack: /взлом|украл[и]?.*акк|акк.*(?:украл|угнал)|угнал[и]?.*акк|потерял.*доступ|не могу.*(?:войти|зайти)|сменил[и]?.*парол|hacked|stolen account|cannot (?:log|sign)|account.*stolen|invad|roubaram.*conta|robaron.*cuenta|cuenta.*rob|buzib|akkaunt.*(?:o'g'ir|ogir)|аккаунт.*бұз|аккаунтыма.*кір|құпиясөз/u,
  account: /аккаунт|акк(?: |$)|пропал[аио]?.*(?:машин|имущество|деньг)|account|akkaunt|cuenta|\bconta\b|мүлік|есептік|жоғал/u,
  appeal: /разбан|размут|забанил|забанен|сним(?:ите|ать).*?(?:бан|мут|наказ)|(?:бан|мут|варн|наказ|деморган|дмг).*(?:без причин|не соглас|ошиб|незакон|ни за что)|не соглас|апелляц|обжал|bann?ed|unban|appeal|unmute|banid|banead|sanci[oó]n|puni[cç][aã]o|jazo|ban.*(?:sababsiz|bekor)|бұғат|жазамен|жаза.*(?:келісп|себепсіз)/u,
  admin: /(?:жалоб|жб|незакон|ошиб|злоупотреб|без причин|неправомер).{0,70}админ|админ.{0,70}(?:жалоб|жб|выдал|дал мут|дал бан|наказ|посадил|незакон|без причин)|administrator.*(?:abuse|complaint)|admin.*(?:abuse|punish|bann|appeal|complaint|haqorat|sababsiz)|(?:administrador|әкімші).*(?:abuso|sanci|puni|шағым|себепсіз)|shikoyat.*admin/u,
  threat: /докс|деанон|найду.*(?:адрес|жизн|дом|тебя)|убью.*(?:реал|жизн|семь)|угр(?:ож|оз).*(?:реал|жизн|семь|вне игр)|threat.*(?:real|life)|kill you.*real|doxx|amea[cç]a.*(?:real|vida)|amenaz.*(?:real|vida)|өмір.*қорқыт|hayot.*tahdid/u,
  cheat: /чит|читер|аим|аимбот|aimbot|wallhack|cheat|\bsoft\b|софт|летает|сквозь стен|скрипт|макрос|autoclick|автоклик|trapac|trampa|truco|hile|外挂|чит қолдан/u,
  scam: /мошен|обман|скам|вымог|не отдал|разв[её]л|кинул|scam|fraud|extort|estaf|enga[nñ]|golpe|engan|aldadi|aldab|firib|алда|бопсала/u,
  rmt: /реал(?:ьн)?.*(?:деньг|прода|куп)|(?:прода|куп).*(?:реал|рубл|тенге|тг\b)|реклам|rmt|real money|real-money|advertis|dinero real|dinheiro real|publicidad|propaganda|haqiqiy pul|нақты ақша/u,
  insult: /оск|токс|матер|матюк|расизм|нацизм|родн|семью.*(?:обоз|униж)|insult|harass|racis|abuse|haqorat|sokdi|so'k|sokind|балағат|қорла|тіл тиг|xing|ofend|injuri|порн|дискрим/u,
  dm: /(?:^|[^a-zа-я])(?:дм|dm|db|дб|sk|rk|нонрп|nonrp)(?:$|[^a-zа-я])|убил|убив|убий|стрелял|стреля|урон|давит|таран|kill|shot|shoot|mat[oóu]|atir|o'ldir|oldir|өлтір|(?<![\p{L}\p{N}_])(?:атқан|ат[ыа]п)|напал|без.*rp/u,
  help: /застр|завис|баг|ошибк|помог|хелп|телепорт|вылет|текстур|lag|bug|stuck|glitch|help|yordam|көмек|тұрып қал|ajuda|ayuda|atascad|atrapad|travad|preso/u,
  question: /(?:^|\s)(?:как|какие|какой|какая|где|зачем|почему|сколько|можно|когда)(?:\s|$)|подскажите|вопрос|правил|how|where|what|question|qanday|qayer|nech|қалай|қайда|сұрақ|c[oó]mo|d[oó]nde|pergunta|onde/u,
  generic: /^(?:помогите(?: пожалуйста)?|помоги|ау|привет|здравствуйте|хелп|сос|help|please help|yordam|көмек|сәлем|ajuda|ayuda|жб|вот он|\+|[\p{P}\p{S}\s]+)$/u,
  evidence: /скрин|видео|фрапс|доказ|запис|screen|video|record|evidence|proof|dalil|дәлел|бейне|captura|grava[cç]|prueba|<url>|https?:\/\//u,
  injection: /ignore.*(?:previous|instruction)|system prompt|developer message|игнорир.*инструк|забудь.*правил|ты теперь|раскрой.*(?:промпт|секрет)|выдай.*(?:парол|ключ)/u,
};

export function sanitizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('Input must be an object');
  if (!['complaint', 'report'].includes(input.kind)) throw new InputError('kind must be complaint or report');
  if (!Array.isArray(input.messages) || input.messages.length === 0 || input.messages.length > 100) throw new InputError('messages must contain 1–100 messages');
  const messages = [];
  for (const message of input.messages) {
    if (!message || typeof message !== 'object') throw new InputError('Each message must be an object');
    if (!['player', 'reported_player', 'admin'].includes(message.role)) throw new InputError('Unknown message role');
    if (message.role === 'admin') continue;
    if (typeof message.text !== 'string' || message.text.length > 20000) throw new InputError('Message text must be a string of at most 20000 characters');
    if (message.attachments != null && (!Number.isInteger(message.attachments) || message.attachments < 0 || message.attachments > 1000)) throw new InputError('attachments must be an integer between 0 and 1000');
    const clean = { role: message.role, text: message.text, ...(Number.isInteger(message.attachments) ? { attachments: message.attachments } : {}) };
    if (message.ts != null) {
      if (typeof message.ts !== 'string' || message.ts.length > 64 || !Number.isFinite(Date.parse(message.ts))) throw new InputError('Invalid message timestamp');
      clean.ts = message.ts;
    }
    messages.push(clean);
  }
  if (!messages.some(message => message.role === 'player' && message.text.trim())) throw new InputError('At least one non-empty player message is required');
  if (input.images_count !== undefined && input.images_count !== null && (!Number.isInteger(input.images_count) || input.images_count < 0 || input.images_count > 1000)) throw new InputError('images_count must be an integer between 0 and 1000');
  const result = { kind: input.kind, messages };
  // This allowlist intentionally excludes outcomes, labels and status.
  for (const key of ['ticket_id', 'id', 'created_at', 'reporter_hash', 'reported_hash', 'reported_nick', 'rule_refs_raw', 'lang', 'server_lang', 'region', 'server']) {
    if (input[key] == null) continue;
    if (typeof input[key] !== 'string' || input[key].length > (key === 'rule_refs_raw' ? 2000 : 256)) throw new InputError(`Invalid ${key}`);
    if (key === 'created_at' && !Number.isFinite(Date.parse(input[key]))) throw new InputError('Invalid created_at timestamp');
    result[key] = input[key];
  }
  if (Number.isInteger(input.images_count)) result.images_count = input.images_count;
  return result;
}

function classify(input, text) {
  const flags = Object.fromEntries(Object.entries(patterns).map(([key, regex]) => [key, regex.test(text)]));
  const support = recognizeSupportIncidents(input.messages.filter(message => message.role === 'player').map(message => message.text).join('\n'));
  flags.payment ||= support.payment;
  flags.help ||= support.technical;
  // Only a verified client/world-entry failure can disambiguate weak access
  // words. The shared predicate refuses security/authentication/property loss.
  if (isTechnicalEntryIncident(input.messages.filter(message => message.role === 'player').map(message => message.text).join('\n'))) {
    flags.hack = false;
    flags.account = false;
  }
  const meaningful = text.replace(/<(?:url|email|handle|digits)>/gu, '').trim();
  flags.vague = !meaningful || flags.generic || meaningful.length < 3;
  flags.harmlessGreeting = /^(?:привет|ау|спасибо|добрый день|здравствуйте|hello|hi|thanks|hola|gracias|olá|ola|obrigad[oa]|сәлем|сәлеметсіз бе|рақмет|salom|rahmat)[\s!.?]*$/u.test(text);
  const inquiry = /что такое|что значит|что означает|как|какие|нужны|what (?:is|does)|how (?:do|to|can)|qué|que (?:es|significa)|c[oó]mo|quais|o que|como|қалай|деген не|қандай|nima|qanday/u.test(text);
  const hasIncident = /меня.{0,50}(?:убил|оскорб|наказ|взлом)|мне.{0,50}(?:выдал|дал бан)|i (?:was|have been)|me (?:mat[oó]|insult)|meni.{0,50}(?:haqorat|oldir)|мені.*(?:балағат|өлтір)/u.test(text) || support.payment || support.technical;
  // A term such as DM itself matches an allegation keyword. Only a complete,
  // bounded glossary question can exempt that keyword; appended events cannot.
  const glossaryTerm = '(?:dm|дм|rp|рп|deathmatch|roleplay)';
  const pureGlossary = new RegExp(`^(?:(?:подскажите[, ]*)?(?:что такое|что значит|что означает)\\s+${glossaryTerm}|what (?:is|does)\\s+${glossaryTerm}(?: mean)?|¿?\\s*(?:qué|que) (?:es|significa)\\s+${glossaryTerm}|o que (?:é|significa)\\s+${glossaryTerm}|${glossaryTerm}\\s+(?:деген не|нені білдіреді|nima))[\\s?!.]*$`, 'u').test(text);
  const substantiveRisk = flags.cheat || flags.scam || flags.rmt || flags.insult || (flags.dm && !pureGlossary);
  flags.substantiveAllegation = Boolean(hasIncident || substantiveRisk);
  const safeInquiry = inquiry && !flags.substantiveAllegation && !flags.payment && !flags.hack && !flags.appeal && !flags.admin && !flags.threat && !flags.injection;
  flags.infoTopic = safeInquiry && /(?:^|[^a-zа-я])(?:dm|дм)(?:$|[^a-zа-я])|deathmatch/u.test(text) ? 'glossaryDM'
    : safeInquiry && /(?:^|[^a-zа-я])(?:rp|рп)(?:$|[^a-zа-я])|roleplay|ролеплей/u.test(text) ? 'glossaryRP'
      : safeInquiry && /жалоб|complaint|reclama|queja|шағым|shikoyat/u.test(text) && /оформ|подать|состав|напис|сведен|информаци|нужны|необходим|требован|file|submit|present|enviar|жібер|бер|yubor/u.test(text) ? 'filing'
        : safeInquiry && /доказательств|evidence|proof|prueba|prova|дәлел|dalil/u.test(text) ? 'evidence' : null;
  let category;
  if (input.kind === 'report') {
    category = flags.payment ? 'report.payment' : (flags.hack || flags.account) ? 'report.account'
      : flags.infoTopic ? 'report.question'
      : (flags.appeal || flags.admin || flags.cheat || flags.scam || flags.rmt || flags.insult || flags.dm || flags.threat) ? 'report.complaint'
      : flags.vague ? 'report.offtopic' : flags.help ? 'report.help' : flags.question ? 'report.question' : 'report.offtopic';
  } else {
    category = flags.admin || flags.appeal ? 'complaint.admin' : flags.infoTopic || flags.vague ? 'complaint.invalid'
      : flags.cheat ? 'complaint.cheat' : flags.rmt ? 'complaint.rmt_ads' : flags.scam ? 'complaint.scam'
      : flags.insult || flags.threat ? 'complaint.insult' : flags.dm ? 'complaint.dm'
      : flags.question && !flags.payment && !flags.hack ? 'complaint.invalid' : 'complaint.other';
  }
  let priority = flags.payment || flags.hack || flags.threat || /массов.*баг|mass.*bug/u.test(text) ? 'p0'
    : flags.cheat || flags.rmt || flags.admin || flags.appeal || (flags.scam && /\d+\s*(?:кк|мил|million)|крупн|large|katta/iu.test(text)) ? 'p1'
      : flags.insult || flags.dm || flags.scam || flags.account ? 'p2' : 'p3';
  if (flags.infoTopic || flags.harmlessGreeting) priority = 'p3';
  return { flags, category, priority };
}

function citationIds(category, flags, text) {
  if (flags.injection) return [];
  if (flags.threat) return ['30:2.6'];
  if (flags.appeal || flags.admin) return ['30:3.4', '31:1.3.1'];
  if (flags.hack || (category === 'report.account')) return ['30:1.4'];
  if (flags.payment) return [];
  if (flags.infoTopic === 'glossaryDM') return ['43:DM'];
  if (flags.infoTopic === 'glossaryRP') return ['43:RP'];
  if (flags.infoTopic === 'filing') return ['31:1.3.1', '31:1.3.2'];
  if (flags.infoTopic === 'evidence') return ['31:1.3.1', '31:1.2.10'];
  if (flags.cheat) return ['30:5.2'];
  if (flags.rmt) return /реклам|advertis|publicidad|propaganda/u.test(text) ? ['30:2.3'] : ['30:4.4'];
  if (flags.scam) return /вымог|extort|бопсала/u.test(text) ? ['30:4.2'] : ['30:4.1'];
  if (flags.insult) return /расизм|racis|дискрим/u.test(text) ? ['30:2.4'] : ['30:2.1'];
  if (flags.dm) {
    if (/зел[её]н|\bgz\b|зз|green zone|zona verde|жасыл|yashil/u.test(text)) return ['32:1.1'];
    if (/дом|квартир|house|home|casa|үй/u.test(text)) return ['30:5.4'];
    if (/вышел.*(?:игр|rp)|уход.*рп|quit.*rp/u.test(text)) return ['30:5.3'];
    return ['43:DM'];
  }
  if (category === 'complaint.invalid' || category === 'complaint.other') return ['31:1.3.3'];
  return [];
}

function extractRefs(text) {
  const found = text.match(/(?:ЖБ\s*|GZ\s*|ОП\s*)?\b\d{1,2}(?:\.\d{1,2}){1,3}(?:\s*(?:ОП|ЖБ|GZ))?/giu) || [];
  return [...new Set(found.map(value => value.trim().replace(/\s+/gu, ' ')))].slice(0, 12);
}

function declaredEvidence(text) {
  if (/<url>|https?:\/\//u.test(text)) return true;
  const clauses = text.split(/[.!?;\n]+|,\s*(?:но|but|pero|mas|ammo|бірақ)\s*/u);
  const negative = /(?:нет|нету|не имею|не прилож|не запис|не сним)|\b(?:without|missing|sin|sem)\b|\bno (?:evidence|proof|screenshots?|video)|(?:do not|don't|does not|doesn't) have|жоқ|yo'q|yoq|não (?:tenho|há)|без\s+(?:скрин|видео|доказ)/u;
  const positive = /(?:есть(?! ли)|имеется|имеются|прилож(?:ены|ен[ао]?|ил[аи]?|у)|прикреп(?:лены|лен[ао]?|ил[аи]?|лю)|прилага(?:ю|ем)|отправ(?:ил[аи]?|лены)|предостав(?:ил[аи]?|лены)|сохранил|записал|на (?:видео|скрин))|\b(?:have|attached|provided|included|recorded)\b|\b(?:bor|ilova|tengo|adjunt|tenho|anex|enviei)\b|тірке|тіркел|бар/u;
  return clauses.some(clause => patterns.evidence.test(clause) && !negative.test(clause) && positive.test(clause));
}

function duplicateOf(input, normalized, history) {
  if (!input.reporter_hash || !input.created_at || !Array.isArray(history)) return null;
  const timestamp = Date.parse(input.created_at);
  if (!Number.isFinite(timestamp)) return null;
  for (let index = history.length - 1; index >= 0; index--) {
    const item = history[index]?.input || history[index];
    if (!item || item.reporter_hash !== input.reporter_hash || item.kind !== input.kind || (item.reported_hash || '') !== (input.reported_hash || '') || (item.reported_nick || '') !== (input.reported_nick || '')) continue;
    const previousTime = Date.parse(item.created_at);
    const delta = timestamp - previousTime;
    if (!Number.isFinite(previousTime) || delta < 0 || delta > 3600000) continue;
    const previousText = normalizeText((item.messages || []).filter(message => message.role === 'player' && typeof message.text === 'string').map(message => message.text).join('\n'));
    // Exact normalized problem matching avoids merging different incidents with a shared category.
    if (previousText && previousText === normalized) return String(item.ticket_id || item.id || `history:${index}`);
  }
  return null;
}

export function createEngine({ dataDir = process.env.DATA_DIR || fileURLToPath(new URL('../../../handout/', import.meta.url)) } = {}) {
  const sourceDir = resolve(dataDir);
  const allSources = loadSources(sourceDir);
  const taxonomy = JSON.parse(readFileSync(join(sourceDir, 'taxonomy.json'), 'utf8'));
  if (!Array.isArray(taxonomy.categories) || !Array.isArray(taxonomy.priorities)) throw new Error('Invalid taxonomy.json');
  const knownCategories = new Set(taxonomy.categories.map(category => category.code));
  const retrieve = createRetriever(allSources);
  const knowledge = JSON.parse(readFileSync(new URL('../../data/knowledge.json', import.meta.url), 'utf8')).entries;
  function triage(rawInput, { history = [] } = {}) {
    const input = sanitizeInput(rawInput);
    const playerText = input.messages.filter(message => message.role === 'player').map(message => message.text).join('\n');
    const text = normalizeText(playerText);
    const language = detectLanguage(text, input);
    const { flags, category, priority } = classify(input, text);
    if (!knownCategories.has(category)) throw new Error(`Category ${category} is absent from taxonomy.json`);
    const hasEvidence = Boolean((input.images_count || 0) + input.messages.filter(message => message.role === 'player').reduce((sum, message) => sum + (message.attachments || 0), 0)) || declaredEvidence(text);
    const relevantIds = citationIds(category, flags, text);
    // Semantic gates determine candidate applicability; BM25 ranks only those candidates.
    const matched = retrieve(`${text} ${flags.insult ? 'оскорбление личности игрока' : ''}`, { allowedIds: relevantIds, limit: 2 });
    const citations = matched.map(({ id, section_id, section, ref, text: sourceText }) => ({ id, section_id, section, ref, text: sourceText }));
    const cited = matched.map(source => source.label);
    const kbSources = retrieveKnowledge(knowledge, text, category, flags);
    const duplicate = duplicateOf(input, text, history);
    const nickname = input.reported_nick || playerText.match(/\b[A-Za-z][A-Za-z0-9]{1,30}_[A-Za-z][A-Za-z0-9]{1,30}\b/u)?.[0] || null;
    const server = input.server || playerText.match(/(?:сервер|server|servidor|сервері)\s*(?:№|#|номер)?\s*(\d{1,3})/iu)?.[1] || null;
    const reasons = ['Автономный режим: retrieval по локальным источникам и шаблоны; confidence — эвристика.'];
    const mandatoryHuman = flags.payment || flags.hack || flags.appeal || flags.admin || flags.threat || (taxonomy.needs_human_always || []).includes(category);
    const allegation = !flags.infoTopic && (input.kind === 'complaint' || category === 'report.complaint');
    const lacksGrounding = relevantIds.length > citations.length || (category === 'report.question' && !flags.infoTopic);
    const safeInformation = Boolean(flags.infoTopic && citations.length === relevantIds.length && citations.length > 0 && !language.uncertain);
    const safeClarification = flags.harmlessGreeting && !mandatoryHuman && !flags.injection;
    const needsHuman = Boolean(mandatoryHuman || (!safeInformation && !safeClarification));
    if (flags.payment) reasons.push('Платежи и возвраты проверяет человек.');
    if (flags.hack) reasons.push('Подозрение на взлом или потерю доступа: обязательная проверка человеком.');
    if (flags.appeal || flags.admin) reasons.push('Апелляция или жалоба на администратора: обязательная проверка человеком.');
    if (flags.threat) reasons.push('Угрозы вне игры или раскрытие персональных данных: критическая эскалация.');
    if (allegation) reasons.push('Утверждения игрока не являются установленным нарушением; решение проверяет администратор.');
    if (hasEvidence) reasons.push('Материалы заявлены или приложены по метаданным; их содержимое сервису недоступно.');
    if (flags.vague) reasons.push('Недостаточно сведений: требуется уточнение сути обращения.');
    if (flags.injection) reasons.push('Инструкции внутри обращения недоверенны и не исполняются.');
    if (language.uncertain) reasons.push('Язык короткого или смешанного сообщения определён с ограниченной уверенностью.');
    if (lacksGrounding) reasons.push('В доступных источниках недостаточно опоры для точного ответа.');
    if (duplicate) reasons.push(`Повтор того же автора и проблемы в течение часа: ${duplicate}.`);
    if (safeInformation) reasons.push('Автоматическая справка по найденным правилам; решение по нарушению не принималось.');
    if (safeClarification) reasons.push('Безопасное автоматическое уточнение приветствия; решение по нарушению не принималось.');
    const template = replies[language.lang];
    let body = [template.greeting, duplicate ? template.duplicate : template.received];
    if (cited.length) body.push(`${template.rule} ${cited.join(', ')}. ${template.conditional}`);
    // Retrieve the curated guidance before choosing the corresponding localized template.
    // Sensitive topics retain their hard gate even if a generic entry scores higher.
    const allowedTopics = [flags.payment && 'payment', (flags.hack || category === 'report.account') && 'account', (flags.appeal || flags.admin) && 'appeal', category === 'report.help' && 'help'].filter(Boolean);
    const retrievedTopic = kbSources.find(source => allowedTopics.includes(source.id))?.id;
    const topic = retrievedTopic || allowedTopics[0] || (category === 'report.question' ? 'question' : 'request');
    body.push(template[topic]);
    if (hasEvidence) body.push(template.materials);
    if (needsHuman) body.push(template.human);
    if (safeInformation || safeClarification) {
      const info = informationalReplies[language.lang];
      const retrievedInfo = kbSources.find(source => source.id === flags.infoTopic)?.id;
      body = [template.greeting, safeInformation ? info[retrievedInfo || flags.infoTopic] : info.greeting];
      if (safeInformation) body.push(`${info.source} ${cited.join(', ')}.`);
      body.push(info.notice);
    }
    let confidence = flags.vague ? 0.31 : flags.injection ? 0.36 : 0.66;
    if (mandatoryHuman && !flags.vague) confidence = 0.87;
    if (citations.length && !flags.vague) confidence += 0.05;
    if (language.uncertain) confidence -= 0.12;
    return {
      lang: language.lang, category, priority,
      is_spam_or_duplicate: Boolean(duplicate || (flags.vague && /^[\p{P}\p{S}\s]+$/u.test(text))),
      extracted: { nickname, rule_refs: extractRefs(`${playerText}\n${input.rule_refs_raw || ''}`), has_evidence: hasEvidence, server },
      draft_reply: { lang: language.lang, text: body.join('\n\n'), cited },
      needs_human: needsHuman, confidence: Math.round(Math.max(0.1, Math.min(0.94, confidence)) * 100) / 100, reasons,
      citations,
      analysis: {
        normalized_text: text,
        claims: input.messages.map(message => ({ role: message.role, text: message.text })),
        evidence_status: hasEvidence ? 'declared_unverified' : 'not_provided',
        mode: MODE, knowledge_sources: kbSources.map(({ id, title, text: content }) => ({ id, title, text: content })),
        ...(duplicate ? { duplicate_of: duplicate } : {}),
      },
    };
  }
  return { triage, sources: () => allSources.map(source => ({ ...source })), taxonomy, mode: MODE };
}
