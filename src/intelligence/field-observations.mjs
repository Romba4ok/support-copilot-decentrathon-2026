/** Player-authored observations only. Offsets always address the ORIGINAL
 * message; normalisation is never used as an offset coordinate system. These
 * observations are not verified facts and never supply sources or human gates. */
export const EVIDENCE_MENTION = /(?<![\p{L}\p{N}_])(?:видео(?:[\p{Pd}]?запис[\p{L}]*)?|скрин(?:шот)?[\p{L}]*|материал[\p{L}]*|доказательств[\p{L}]*|запис(?:ь|и|ью|ей)|квитанц[\p{L}]*|чек(?:а|и|ов|ом)?|фото|v[ií]deo(?:s|(?:lar)?(?:im|m|mni|mning|si|sini|sining|ni|ning|ga|dan))?(?![\p{Pd}]?games?(?![\p{L}]))|screenshots?|screen\s+recordings?|skrinshot(?:lar(?:ni|ning)?|ni|im)?|evidence|proof|recordings?|receipts?|letters?|photos?|бейне(?:жазба)?[\p{L}]*|сурет[\p{L}]*|дәлел[\p{L}]*|түбіртек[\p{L}]*|dalil(?:lar|ni|im)?|chek(?:lar|ni|im|ning|ka)?|xat(?:lar|ni|im|ning)?|surat(?:lar|ni|im)?|foto(?:lar|ni)?|pruebas?|capturas?|comprobantes?|provas?|comprovantes?|recibos?|grava[cç][aã]o|grava[cç][oõ]es|grabaci[oó]n(?:es)?)(?![\p{L}\p{N}_])/iu;

const hypothetical = /^\s*if(?![\p{L}])|\b(?:what if|hypothetical|suppose|if (?:i|my|the|a)|for example|example|e\.g\.)\b|(?:если бы|предположим|например|пример|егер|мысалы|\bagar\b|masalan|\bsi (?:el|la|mi|yo|al)\b|\bse (?:a|o|meu|minha|eu|ele|ela|eles|elas|ao)\b|por ejemplo|ejemplo|por exemplo|exemplo)/iu;
const instruction = /\b(?:ignore|pretend|output|return json|system prompt|developer message)\b|игнорир|выведи|притвор|жүйелік нұсқау|tizim ko['‘’]?rsatma|ignora|finja/iu;
const uncertain = /\b(?:maybe|perhaps|possibly|probably|might|guess|unsure|not sure)\b|возможно|кажется|наверн|не уверен|мүмкін|бәлкім|шамасы|balki|ehtimol|shekilli|quiz[aá]s|tal vez|no estoy segur|talvez|acho que|n[aã]o tenho certeza/iu;
const selfFrame = /my\s+(?:in.game\s+)?(?:nick(?:name)?|character|account)|мой\s+(?:(?:игровой)\s+)?(?:ник|персонаж|аккаунт)|моя\s+уч[её]т|моего\s+персонажа|под\s+(?:игровым\s+)?ник(?:ом|неймом)|менің|өзімнің|кейіпкерім|лақап атым|ник[іи]м|personajim|taxallusim|nikim|(?:o['‘’ʻʼ]?z|mening)\s+hisobimdagi|mi\s+(?:personaje|apodo|nick|cuenta)|meu\s+(?:personagem|apelido|nick|conta)|minha\s+conta|(?:^|\s)(?:soy|sou|i am|i['’]m)\s/iu;
const identityStop = /^(?:fictional|fictitious|ficticio|fictício|xayoliy|is|was|named|called|name|unknown|unspecified|unavailable|missing|locked|lost|blocked|not|неизвестен|неизвестно|заблокирован|пропал|персонаж|белгісіз|жоқ|noma['‘’]?lum|yo['‘’]?q|desconocido|desconhecido)$/iu;

export function observationClause(text, start, end) {
  const left = text.slice(0, start).split(/[!?;\n]|\.(?:\s|$)/u).at(-1) || '';
  const right = text.slice(end).split(/[!?;\n]|\.(?:\s|$)/u)[0] || '';
  return { before: left, after: right, text: left + text.slice(start, end) + right };
}

function quotedSpans(text) {
  const spans=[], closes={'«':'»','“':'”','"':'"',"'":"'",'‘':'’'};
  let open=null;
  for(let i=0;i<text.length;i++){
    const ch=text[i],wordBefore=/[\p{L}\p{N}_]/u.test(text[i-1]||''),wordAfter=/[\p{L}\p{N}_]/u.test(text[i+1]||'');
    // English contractions and Uzbek o'yin / o‘yin are not quotation marks.
    if((ch==="'"||ch==='‘'||ch==='’')&&wordBefore&&wordAfter)continue;
    if(open){if(ch===open.close){spans.push({start:open.start,end:i+1,content:text.slice(open.start+1,i)});open=null;}continue;}
    if(closes[ch]&&(!(ch==="'"||ch==='‘')||!wordBefore))open={start:i,close:closes[ch]};
  }
  if(open)spans.push({start:open.start,end:text.length,content:text.slice(open.start+1)});
  return spans;
}

function emailLikeSpan(text,start,end){
  const character=/[\p{L}\p{N}._%+@-]/u;
  let left=start,right=end;
  while(left>0&&character.test(text[left-1]))left--;
  while(right<text.length&&character.test(text[right]))right++;
  return text.slice(left,right).includes('@');
}

function unperformedSteps(text,start,end) {
  const c=observationClause(text,start,end);
  if(/^\s*(?:please\s+)?(?:try|consider)\s+(?:opening|pressing|selecting|clicking|entering|restarting|launching)(?![\p{L}])/iu.test(c.text))return true;
  let scope=c.text;
  // A quoted menu title such as "Tomorrow" is not a temporal intention.
  for(const q of quotedSpans(scope).reverse())scope=scope.slice(0,q.start)+' '.repeat(q.end-q.start)+scope.slice(q.end);
  const futureAction=/\b(?:will|shall|may|might|could|going to|plan(?:ning)? to|intend to)\s+(?:open|press|select|click|enter|restart|launch)|\b(?:i|we)['’]ll\s+(?:open|press|select|click|enter|restart|launch)|(?:планирую|собираюсь|буду)\s+(?:откры|наж|выбр|запус|перезапус)|\b(?:voy|vamos|vou|iremos)\s+(?:a\s+)?(?:abrir|pulsar|seleccionar|reiniciar|selecionar|pressionar)/iu;
  // Spanish "por la mañana" names a daypart, not a future intention.
  const futurePeriod=/(?<![\p{L}])(?:tomorrow|next (?:week|month)|завтра|послезавтра|ертең|ertaga|amanh[ãa])(?![\p{L}])|^\s*mañana(?![\p{L}])/iu;
  // Evaluate assertion markers over the action's complete clause, not only
  // before the excerpt: several languages place a modal/inference after it.
  const inferred=/\b(?:i|we)\s+(?:assume|suppose|suspect|predict|expect|think|believe)|\b(?:may|might|could)\s+(?:crash|freeze|close)|(?<![\p{L}])(?:предполага[\p{L}]*|полагаю|думаю|может|mumkin|taxmin|supong[\p{L}]*|imagino|podr[ií]a|poderia|suponh[\p{L}]*)(?![\p{L}])|deb\s+o['‘’ʻʼ]?yla[\p{L}]*|деп\s+ойла[\p{L}]*/iu;
  if(futureAction.test(scope)||futurePeriod.test(scope)||uncertain.test(scope)||inferred.test(scope))return true;
  const tail=text.slice(end,end+200);
  const untried=/\b(?:i|we)\s+(?:have not|haven't|haven’t|did not|didn't|didn’t)\s+(?:yet\s+)?(?:tried|tested|attempted|performed)\s+(?:this|that|these)(?:\s+(?:sequence|steps|actions|procedure))?(?=\s*(?:[.!?;]|yet\b|$))|(?:это|эти шаги)\s+(?:ещ[её]\s+)?не\s+(?:пробовал|проверял|выполнял)|(?:мұны|бұл қадамдарды).{0,20}(?:сынамадым|орындамадым)|buni.{0,20}(?:sinamadim|bajarmadim)|no lo he probado|n[aã]o tentei isso/iu;
  const prediction=/\b(?:this|that|it)\s+is\s+(?:(?:only|just)\s+)?(?:(?:my|our|a)\s+)?(?:prediction|guess|hypothesis|assumption)|(?:это|бұл)\s+(?:(?:лишь|только|тек)\s+)?(?:прогноз|предположени|догадк|болжам)|\bbu\s+taxmin|(?:es|[eé]|solo|apenas|s[oó])\s+(?:(?:solo|apenas|s[oó])\s+)?(?:(?:un[ao]?|uma?)\s+)?(?:predicci[oó]n|previs[aã]o|hip[oó]tese)/iu;
  const notObserved=/(?:я|мы)\s+(?:этого|такого|это)\s+не\s+(?:наблюда[\p{L}]*|проверя[\p{L}]*|выполня[\p{L}]*)|(?:buni|shuni)\s+(?:o['‘’]?zim\s+)?(?:kuzatma[\p{L}]*|sinama[\p{L}]*)|(?:no|nunca)\s+lo\s+he\s+(?:observado|probado)|n[aã]o\s+(?:observei|vi)\s+isso/iu;
  return untried.test(tail)||prediction.test(tail)||notObserved.test(tail);
}

/** Quoted VALUES after a declaration are allowed; quoted examples/instructions
 * and hypothetical assertions are not declarations about the current incident. */
export function observationAssertion(text, start, end, field) {
  const c = observationClause(text, start, end), value = text.slice(start, end);
  if (field === 'reproduction_steps' && unperformedSteps(text,start,end)) return 'hypothetical';
  if (hypothetical.test(c.before) && !(field === 'reproduction_steps' && observedReproductionAt(text,start,end)) || instruction.test(c.before)) return 'hypothetical';
  if (/^(?:should|could|may|can) i (?:say|write|claim)\b/iu.test(value)) return 'hypothetical';
  if (field === 'reproduction_steps' && /^(?:(?:should|could|can|must|may|do|would)\s+i\b|(?:нужно|надо|можно)\s+ли(?![\p{L}]))|керек\s+пе|kerakmi/iu.test(value)) return 'hypothetical';
  if (field === 'reproduction_steps' && (hypothetical.test(c.text)||/(?<![\p{L}])[\p{L}]+(?:сам|сем|sam|sem)(?![\p{L}])/iu.test(c.text)) && !observedReproductionAt(text,start,end)) return 'hypothetical';
  if (field === 'reproduction_steps' && /^(?:how (?:do|can|to)|what if|куда|как (?:мне|надо|нужно)|қалай|qanday|c[oó]mo|como|e se)\b/iu.test(c.text.trim())) return 'hypothetical';
  const quoted = quotedSpans(text).find(q=>start>q.start&&start<q.end||q.start>=start&&q.start<end&&/\s/u.test(q.content));
  if (quoted) {
    const reporting=observationClause(text,quoted.start,quoted.end).before;
    const selfStatement=/(?<![\p{L}])(?:i|my|we|я|мы|мой|моя|мен|біз|менің|men|biz|mening|yo|mi|eu|meu|minha)(?![\p{L}])/iu.test(quoted.content)&&/server|сервер|servidor|play|игра|ойна|o['‘’]?yna|juego|jogo|nick|ник|paid|оплат|төле|to['‘’]?la/iu.test(quoted.content);
    if (/said|wrote|suggest|should i say|quote|example|написал|сказал|цитат|пример|деді|жазды|мысал|келтір|aytdi|yozdi|misol|keltir|iqtibos|dijo|escribi[oó]|cit[oó]|disse|escreveu|citou|ejemplo|exemplo/iu.test(reporting) || /\s/u.test(quoted.content)&&selfStatement) return 'quoted';
  }
  // Check the whole contact token before a nickname regexp's shorter capture
  // could turn its local part (including dotted local parts) into a game name.
  if (['participant','platform','server','transaction_id'].includes(field) && emailLikeSpan(text,start,end)) return 'uncertain';
  if(field==='participant'&&(/['‘’ʻʼ]/u.test(text[end]||'')&&/[\p{L}\p{N}]/u.test(text[end+1]||'')||/['‘’ʻʼ]/u.test(text[start-1]||'')&&/[\p{L}\p{N}]/u.test(text[start-2]||'')))return 'uncertain';
  if (field === 'platform') {
    const local=c.before.split(/[,;]|\bbut\b|\bpero\b|\bmas\b|(?:^|\s)(?:но|бірақ|lekin)(?=\s)/iu).at(-1).trim();
    if (/^(?:(?:can|could|should|would|may|might|must|do|does)\s+(?:i|we|you|a|an|the|my|our)\b|могу\s+ли|можно\s+ли|puedo\b|podr[ií]a\b|posso\b|poderia\b)/iu.test(local) || /\bif\s+(?:(?:i|we|my|our|a|an|the)\s+)?$/iu.test(local)) return 'hypothetical';
    // Contracted denial of owning/using a device is not a failed game action:
    // "can't launch the game on my Mac" still supplies its device.
    if (/\b(?:don|doesn|didn|haven|hasn|hadn|won|wouldn|shouldn|couldn|can)['’]t(?:\s+(?:really|ever|previously|normally|usually|been)){0,2}\s+(?:play(?:ed|ing|s)?|use(?:d|s)?|using|own(?:ed|s)?|have|had|possess)(?:\s+(?:on|with|a|an|the|my|our|this|that|any)){0,4}\s*$/iu.test(local)) return 'negated';
    // Portuguese "no meu" is a location preposition, not Spanish/English no.
    if (/(?:\b(?:not|never|n[aã]o)|не|нет)(?:\s+[\p{L}'‘’-]+){0,4}\s*$/iu.test(local) || /\bno\s+(?:juego|tengo|uso|utilizo|puedo|poseo)(?:\s+[\p{L}'‘’-]+){0,3}\s*$/iu.test(local) || /\b(?:have|own)\s+no\s*$/iu.test(local) || /^[-\p{L}\s]{0,20}(?:ойнамай|қолданбай|o['‘’]?ynamay|ishlatmay|yo['‘’]?q|емес|emas)/iu.test(c.after)) return 'negated';
    const before = c.before.slice(-100), last = pattern => [...before.matchAll(pattern)].at(-1)?.index ?? -1;
    const identity = last(/nick|name|ник|лақап|никім|taxallus|ismli|apodo|apelido/giu);
    const device = last(/platform|device|play(?:ing)? on|on my|на мо[её]м|на платформ|құрыл|quril|en mi|no meu|plataforma|dispositivo/giu);
    if (identity > device || /^\s+(?:деген|ismli)\s+/iu.test(c.after)) return 'uncertain';
    if (/^(?:Mac|Switch)$/iu.test(value) && device < 0 && !/^\s*[.!?]?\s*$/u.test(c.before+c.after) && !/құрыл|quril|device|платформ|устройств|dispositivo/iu.test(c.after)) return 'uncertain';
  }
  if (uncertain.test(c.before.slice(-100)) || field === 'server' && uncertain.test(value) || /^\s*(?:,?\s*(?:maybe|perhaps|наверное|возможно|мүмкін|balki|quiz[aá]s|talvez))\b/iu.test(c.after)) return 'uncertain';
  if (field !== 'evidence') {
    const portugueseDeviceLocation=['platform','location','server'].includes(field)&&/\bno\s*$/iu.test(c.before)&&/\b(?:jogo|joguei|testei|reproduzi|abri|executei|instalei|reiniciei|falha|trava|fechou)\b/iu.test(c.before);
    if (/(?:\bnot|\bn[aã]o|не|емес|emas)\s*(?:the\s+|a\s+|на\s+|в\s+)?[«“"']?\s*$/iu.test(c.before) || !portugueseDeviceLocation&&/\bno\s*(?:the\s+|a\s+)?[«“"']?\s*$/iu.test(c.before) || /^\s*(?:емес|emas)(?=$|[^\p{L}])/iu.test(c.after)) return 'negated';
    if (field === 'reproduction_steps' && /\b(?:did not|didn't|never|have not|haven't)\b|(?:^|\s)не\s|жасама|ашпады|ochmad|bosmad|no\s+(?:abr[ií]|puls[eé]|hice)|n[aã]o\s+(?:abri|apertei|fiz)/iu.test(value)) return 'negated';
    if (field === 'reproduction_steps' && /(?:not|without)\s+(?:opening|pressing|selecting|clicking|entering|restarting|launching)|без\s+(?:открытия|нажатия|выбора|запуска)/iu.test(value)) return 'negated';
    if (['dated_value','event_time','payment_date','amount'].includes(field)) {
      if (/(?<![\p{L}])(?:not|never|не|no|n[aã]o)(?:\s+(?:on|at|in|в|на|el|en|em|às)){0,2}\s*$/iu.test(c.before)) return 'negated';
      const local = c.before.split(/\bbut\b|\bpero\b|\bmas\b|(?:^|\s)(?:но|бірақ|lekin)(?=\s)/iu).at(-1);
      if (/(?:did not|didn't|never|was not|wasn't|не)\s+(?:[\p{L}]+\s+){0,4}(?:crash|happen|occur|pay|paid|buy|bought|purchase|charged|cost|произош|случ|закрыв|плат|куп)[\p{L}]*(?:\s+[\p{L}]+){0,3}\s*$/iu.test(local) || /(?:жабылма|болма|жасаған жоқ|yopilmadi|bo['‘’]?lmadi|to['‘’]?lamad|no (?:ocurri[oó]|pagu[eé]|compr[eé])|n[aã]o (?:aconteceu|paguei|comprei|custou))/iu.test(local)) return 'negated';
    }
  }
  return 'asserted';
}

export function participantSubject(text, start, end) {
  const c = observationClause(text, start, end);
  const before = c.before.slice(-100) + text.slice(start,end);
  const last=pattern=>[...before.matchAll(new RegExp(pattern.source,pattern.flags+'g'))].at(-1)?.index??-1;
  const own=last(selfFrame),reported=last(/reported|another|other player|player(?:\s|$)|игрок[\p{L}]*(?:\s|$)|нарушител|ойыншы[\p{L}]*|o['‘’]?yinchi[\p{L}]*|jugador(?:\s|$)|jogador(?:\s|$)|(?:report|denunciar|reportar)\s+(?:a\s+)?|жалуюсь\s+на/iu);
  if (/^\s+(?:(?:деген|атты)\s+ойыншы|(?:ismli|nomli)\s+o['‘’]?yinchi)/iu.test(c.after)) return 'reported';
  return own>reported?'self':reported>=0?'reported':'unspecified';
}

const nickname = "[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_-]|['‘’ʻʼ](?=[\\p{L}\\p{N}])){1,63}";
const identities = [
  ['self', `(?:my (?:in.game )?(?:nick(?:name)?|character(?:'s)?(?: name)?|account name)|i play as)\\s*(?:(?:is\\s+)?(?:called|named)|is|[:=—-])?\\s*[«“"']?(${nickname})`],
  ['self', `(?:мой (?:игровой )?(?:ник(?:нейм)?|персонаж)|ник моего персонажа|имя моего персонажа|моего персонажа зовут|персонажа зовут)\\s*(?:называется|это|зовут|[:=—-])?\\s*[«“"']?(${nickname})`],
  ['self', `(?:(?:менің\\s+)?(?:кейіпкерім(?:нің)?(?:\\s+аты)?|лақап атым|ойындағы (?:атым|ник(?:ім)?)))\\s*[:=—-]?\\s*[«“"']?(${nickname})`],
  ['self', `(?:(?:mening\\s+|o['‘’ʻʼ]?yindagi\\s+)?(?:(?:personajim|qahramonim)(?:ning)?(?:\\s+(?:ismi|nomi))?|taxallusim|nikim))\\s*[:=—-]?\\s*[«“"']?(${nickname})`],
  ['self', `(?:mi (?:personaje|cuenta)(?: del juego)? se llama|mi (?:apodo|nick)(?: en el juego)?(?: es)?|juego como|meu personagem(?: do jogo)? se chama|meu (?:apelido|nick)(?: no jogo)?(?: [eé])?|jogo como)\\s*[:=—-]?\\s*[«“"']?(${nickname})`],
  ['reported', `(?:player (?:named|called)|игрока зовут|игрок с ником|ник (?:игрока|нарушителя)|ойыншының (?:аты|лақап аты)|o['‘’]?yinchining (?:ismi|taxallusi)|(?:el )?jugador (?:se llama|llamado)|(?:o )?jogador (?:se chama|chamado))\\s*[:=—-]?\\s*[«“"']?(${nickname})`],
  ['reported', `(${nickname})\\s+(?:деген\\s+ойыншы(?:ны|ға|дан)?|ismli\\s+o['‘’]?yinchi)`],
  ['self', `(${nickname})\\s+(?:деген|атты)\\s+кейіпкерім(?:нің|е|ді|де|нен|мен)?`],
  ['self', `(?:my\\s+(?:game\\s+)?character|mi\\s+personaje|meu\\s+personagem)\\s*,\\s*(${nickname})\\s*,`],
].map(([subject_role, source]) => ({ subject_role, pattern: new RegExp(source + '(?=$|[^\\p{L}\\p{N}_-])', 'giu') }));

// Unlabelled account/character aliases need a possessive or an explicit
// first-person access frame. Capitalised Unicode handles are conservative here;
// lower-case aliases remain supported after explicit nickname/name labels.
const alias = `([\\p{Lu}](?:[\\p{L}\\p{N}_-]|['‘’ʻʼ](?=[\\p{L}\\p{N}])){1,63})`;
const accountIdentities = [
  `(?:[Mm]y|[Oo]ur)\\s+(?:game\\s+)?(?:account|character)\\s+${alias}`,
  `(?:[Мм]ой|[Сс]вой|[Мм]оего|[Сс]воего|[Сс]воему|[Мм]оему|[Сс]воём|[Мм]оём)\\s+(?:игров[\\p{L}]*\\s+)?(?:аккаунт[\\p{L}]*|персонаж[\\p{L}]*)\\s+${alias}`,
  `(?:[Мм]енің|[Өө]зімнің)\\s+${alias}\\s+(?:аккаунт|кейіпкер)[\\p{L}]*`,
  `${alias}\\s+(?:akkauntim|personajim)[\\p{L}]*`,
  `(?:[Mm]i|[Nn]uestra)\\s+(?:cuenta|personaje)\\s+${alias}`,
  `(?:[Mm]inha|[Mm]eu|[Nn]ossa|[Nn]osso)\\s+(?:conta|personagem)\\s+${alias}`,
  `(?:[Pp]erdi|[Rr]ecuperar|[Aa]cessar)\\s+(?:o\\s+)?(?:acesso\\s+[aà]\\s+)?conta\\s+${alias}`,
].map(source => new RegExp(source+'(?=$|[^\\p{L}\\p{N}_-])','gu'));

const relativeDate = /(?<![\p{L}\p{N}_])((?:(?:сегодня|вчера|позавчера|today|yesterday|бүгін|кеше|алдыңғы күні|bugun|kecha|o['‘’]?tgan kuni|hoy|ayer|anteayer|hoje|ontem|anteontem)(?:\s+(?:(?:утром|днём|днем|вечером|ночью)|(?:morning|afternoon|evening|night)|(?:таңертең|түсте|кешке|түнде)|(?:ertalab|kunduzi|kechqurun|tunda)|(?:por la (?:mañana|tarde|noche))|(?:de manhã|[aà] tarde|[aà] noite)))?|(?:в\s+)?(?:прошл(?:ый|ую)\s+)?(?:понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|(?:(?:last|on)\s+)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:\s+(?:morning|afternoon|evening|night))?|(?:(?:өткен|осы)\s+)?(?:дүйсенбі|сейсенбі|сәрсенбі|бейсенбі|жұма|сенбі|жексенбі)(?:\s+(?:күні|кешке|таңертең))?|(?:(?:o['‘’]?tgan)\s+)?(?:dushanba|seshanba|chorshanba|payshanba|juma|shanba|yakshanba)(?:\s+kuni)?|(?:el\s+)?(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\s+pasado)?|(?:na\s+|no\s+)?(?:segunda-feira|ter[cç]a-feira|quarta-feira|quinta-feira|sexta-feira|s[aá]bado|domingo)(?:\s+passad[oa])?|(?:утром|вечером|ночью|таңертең|кешке|түнде|ertalab|kechqurun|tunda)|(?:this|last)\s+(?:morning|afternoon|evening|night)|esta\s+(?:mañana|tarde|noche|manhã|noite)))(?![\p{L}\p{N}_])/giu;
const platform = /(?<![\p{L}\p{N}_])((?:Mac(?:Book)?(?:\s+(?:Air|Pro))?|macOS|Android|iOS|Windows|Linux|iPhone|iPad|PC|PlayStation(?:\s*[345])?|PS[345]|Xbox(?:\s+(?:One|Series\s*[SX]|360))?|Nintendo\s+Switch|Switch))(?![\p{L}\p{N}_])/giu;
const actions = /(?<![\p{L}])(?:I\s+(?:open(?:ed)?|press(?:ed)?|select(?:ed)?|click(?:ed)?|enter(?:ed)?|log(?:ged)? in|restart(?:ed)?|launch(?:ed)?|went|change(?:d)?)|я\s+(?:открыл|открываю|нажал|нажимаю|выбрал|выбираю|вош[её]л|вхожу|заш[её]л|захожу|перезаш[её]л|запустил|запускаю|перезапустил|переустановил|поменял)|(?:открываю|нажимаю|выбираю|вхожу|захожу|перезапускаю|запускаю|меняю)|(?:аштым|ашамын|бастым|басамын|таңдадым|таңдаймын|кірдім|кіремін|қостым|қосамын|қайта кірдім)|(?:ochdim|ochaman|bosdim|bosaman|tanladim|tanlayman|kirdim|kiraman|qayta kirdim|ishga tushirdim)|(?:abr[ií]|abro|puls[eé]|pulso|seleccion[eé]|selecciono|entr[eé]|entro|reinici[eé]|reinicio|inici[eé]|cambi[eé]|cambio)|(?:abri|abro|apertei|aperto|pressionei|pressiono|selecionei|seleciono|entrei|entro|reiniciei|reinicio|iniciei|mudei|mudo|troquei|salvei))(?![\p{L}])/giu;
const actionContext = /\b(?:then|after|when|and|before)\b|затем|потом|после|когда|сначала|и\s|алдымен|кейін|соң|\sде[,\s]|avval|keyin|so['‘’]?ng|luego|despu[eé]s|al\s|antes|depois|ao\s|antes|crash|freez|closed|stuck|ошиб|вылет|завис|пропал|исчез|қат|жабыл|қарая|qot|yopil|cierra|bloque|trav|fech/iu;
const place = /(?<![\p{L}])((?:на|у|возле|около|в)\s+(?:рынк[\p{L}]*|стадион[\p{L}]*|арен[\p{L}]*|двор[\p{L}]*)|(?:at|near|inside|in)\s+(?:the\s+)?(?:market|stadium|arena|yard)|(?:базар|нарық|стадион|аула|арена)[\p{L}]{0,8}(?:да|де|та|те|жанында)|(?:bozor|stadion|hovli|arena)[\p{L}]{0,5}(?:da|yonida)|(?:en|cerca de|junto a)\s+(?:el|la|un|una)\s+(?:mercado|estadio|arena|patio)|(?:no|na|perto do|perto da)\s+(?:mercado|est[aá]dio|arena|p[aá]tio))(?![\p{L}])/giu;

// Open values follow closed grammatical declarations, never a server-name list.
const titleToken = String.raw`(?!(?:I|My|Our|Men|Biz|Мен|Менің|Біз|Мой|Моя|Mi|Meu|Minha)(?=$|\s))[\p{Lu}](?:[\p{L}\p{N}_-]|['‘’ʻʼ](?=[\p{L}\p{N}])){1,39}`;
const serverTitleToken=String.raw`(?!(?:I|My|Our|Men|Biz|Мен|Менің|Біз|Мой|Моя|Mi|Meu|Minha)(?=$|\s))[\p{Lu}](?:[\p{L}\p{N}_-]|['‘’ʻʼ](?=[\p{L}\p{N}])){1,39}`;
const namedValue = `${serverTitleToken}(?:\\s+${serverTitleToken}){0,2}`;
const serverMarker = String.raw`(?:[Ss]erver(?:lar)?(?:imiz|ingiz|im|i)?(?:dagi|da|dan|ga|ning|ni)?(?:man|san|miz|siz|dir)?|[Сс]ервер[\p{L}]{0,10}|[Ss]ervidor)`;
const neutralEntity=String.raw`(?:fictional|fictitious|fict[ií]ci[oa]|xayoliy)`;
const namedServers = [
  new RegExp(`(?<![\\p{L}\\p{N}_])${serverMarker}\\s*(?:${neutralEntity}\\s+)?(?:(?:[Ii]s|[Nn]amed|[Cc]alled|[Nn]ame(?: is)?|[Ee]s|[Éé]|атауы|nomi)\\s*)?[:=\\p{Pd}]?\\s*[«“\"']?(${namedValue})(?=$|[^\\p{L}\\p{N}_'‘’ʻʼ-])`,'gu'),
  new RegExp(`(?<![\\p{L}\\p{N}_])[«“"']?(${namedValue})[»”"']?\\s+${serverMarker}(?=$|[^\\p{L}\\p{N}_-])`,'gu'),
];
const serverPredicate = /^(?:offline|online|loading|crashed|unknown|unavailable|missing|time|error|not|is|was|are|время|недоступен|завис|отключ[её]н|белгісіз|жоқ|noma['‘’]?lum|desconocido|desconhecido|hor[aá]rio|hora)$/iu;
const gameFrame = /in (?:the )?game|в игре|ойында|o['‘’]?yinda|en el juego|no jogo/iu;
const nonGamePerson = /(?:my|our)\s+(?:co-?worker|colleague|neighbou?r|classmate|employer|boss|aunt|uncle|mother|father|sister|brother|cousin|wife|husband|relative)|(?:мой|моя|мои|наш|наша|наши)\s+(?:коллег|сосед|однокласс|однокурс|начальник|мам|пап|т[её]т|дяд|сестр|брат|супруг|родствен)|(?:менің|біздің)\s+(?:әріптес|көрші|сыныптас|әпке|аға|іні|қарындас|туыс)|(?:mening|bizning)\s+(?:hamkasb|qo['‘’]?shni|sinfdosh|opa|aka|uka|singil|xola|tog['‘’]?a)|(?:mi|nuestro|nuestra)\s+(?:compa[ñn]er[oa] de (?:trabajo|clase|escuela)|colega|vecin[oa]|madre|padre|t[ií]a|t[ií]o|hermana|hermano|prima|primo)|(?:meu|minha|nosso|nossa)\s+(?:colega|vizinh[oa]|m[aã]e|pai|tia|tio|irm[aã]|irm[aã]o|prima|primo)/iu;
const outsideGameFrame = /real life|outside (?:the )?game|not (?:in|related to) (?:a |the )?game|в реальной жизни|не (?:в игре|связан[\p{L}]* с игрой)|ойыннан тыс|o['‘’]?yindan tashqari|fuera del juego|no (?:tiene relaci[oó]n|ocurri[oó]).{0,25}juego|fora do jogo|n[aã]o aconteceu.{0,15}jogo/iu;
const actorLocation = String.raw`(?:(?:[\p{L}'‘’ʻʼ-]{2,30}\s+){1,3}(?:жанында|қасында|ішінде|алдында|артында|yonida|ichida|oldida|orqasida)\s+)?`;
const actorAct = String.raw`(?:insult(?:ed|s)|threaten(?:ed|s)|scammed|attacked|blocked|оскорб[\p{L}]*|угрожа[\p{L}]*|обман[\p{L}]*|қорла[\p{L}]*|балағат[\p{L}]*|алда[\p{L}]*|haqorat\s+qil[\p{L}]*|aldadi|me\s+(?:insult(?:[oó]|ou)|amenaz[oó]|amea[cç]ou|estaf[oó]|enganou)|(?:мені|маған)\s+${actorLocation}(?:қорла[\p{L}]*|алда[\p{L}]*)|(?:meni|menga)\s+${actorLocation}(?:haqorat\s+qil[\p{L}]*|aldadi))`;
const bareActor = new RegExp(`(?<![\\p{L}\\p{N}_'‘’ʻʼ])(${titleToken})(?=\\s+${actorAct}(?![\\p{L}]))`,'gu');
const additionalActions = /(?<![\p{L}])(?:opening|pressing|selecting|clicking|entering|restarting|launching|open|press|select|click|restart|launch|открытия|нажатия|выбора|запуска|открыть|нажать|выбрать|запустить|ашып|басып|таңдап|таңдағаннан|басқан|бассам|таңдасам|іске қосып|ашу|басу|ochib|bosib|bossam|tanlasam|tanlab|tanlagandan|ishga tushirib|abrir|pulsar|seleccionar|reiniciar|clicar|apertar|selecionar|pressionar)(?![\p{L}])/giu;
const observedFailure = /freez|froze|crash|stuck|goes blank|завис|вылет|закрыва|переста[её]т|қатып|жабыл|qotib|yopil|bloque|se cierra|trav|fecha/iu;
// Nonfinite actions alone do not establish execution. Require an affirmative
// current/past result, rather than an infinitive/future failure stem.
const assertedFailure = /(?<![\p{L}])(?:freezes|froze|frozen|crashes|crashed|stuck|goes blank|closed|зависает|зависал[аио]?|зависл[аио]?|вылетает|вылетел[аио]?|закрывается|закрыл[аои]сь|қатып\s+қал(?:ады|ды|ған)|жабыл(?:ады|ды|ған)|qotib\s+qol(?:adi|di|gan)|yopil(?:adi|di|gan)|se\s+(?:bloquea|bloque[oó]|cierra|cerr[oó])|trava|travou|fecha|fechou)(?![\p{L}])|(?:does not|doesn't|won't)\s+(?:start|load|open)|не\s+(?:запускается|загружается|открывается)|(?:бос|қара|ақ)\s+терезе\s+(?:шығады|пайда болады)|bo['‘’ʻʼ]?sh\s+oyna\s+(?:paydo bo['‘’ʻʼ]?ladi|chiqadi)|(?:screen|window)\s+(?:turns?|becomes?|is)\s+(?:blank|black|white)|(?:окно|экран)\s+(?:становится|стал[ао]?)\s+(?:пустым|белым|ч[её]рным)|(?:pantalla|ventana)\s+(?:queda|se queda)\s+en blanco|(?:tela|janela)\s+fica\s+em branco/iu;
export function observedReproduction(text) {
  return /every time|each time|whenever|каждый раз|всякий раз|әр жолы|әрбір рет|(?:басқан|таңдаған|ашқан)\s+сайын|har safar|har gal|cada vez|sempre que/iu.test(text) && (observedFailure.test(text)||assertedFailure.test(text)) && !/what if|suppose|imagine|hypothetic|\bwould\b|если бы|предположим|мүмкін|faraz|supong|suponh/iu.test(text);
}
export function observedReproductionAt(text,start,end){
 const c=observationClause(text,start,end);if(observedReproduction(c.text))return true;
 if(!assertedFailure.test(c.text))return false;
 const nearby=text.slice(end,end+200);
 return /(?:this|it).{0,45}(?:happened again|repeated|recurs)|(?:это|сбой|мәселе|ақау).{0,65}(?:повторил|повторя|қайталан)|(?:bu|holat).{0,50}(?:takrorlan|har safar)|әр жолы|cada vez|se repite|sempre que|se repete/iu.test(nearby)&&!/did not|didn't|не повтор|қайталанба|takrorlanma|no se repite|n[aã]o se repete/iu.test(nearby);
}
const months = String.raw`(?:January|February|March|April|May|June|July|August|September|October|November|December|январ[ьяе]|феврал[ьяе]|март[ае]?|апрел[ьяе]|ма[йяе]|июн[ьяе]|июл[ьяе]|август[ае]?|сентябр[ьяе]|октябр[ьяе]|ноябр[ьяе]|декабр[ьяе]|(?:қаңтар|ақпан|наурыз|сәуір|мамыр|маусым|шілде|тамыз|қыркүйек|қазан|қараша|желтоқсан)(?:тың|тің|ның|нің|да|де|нда|нде|нан|нен|ға|ге)?|(?:yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|noyabr|dekabr)(?:ning|da)?|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|janeiro|fevereiro|março|maio|junho|julho|setembro|outubro|novembro|dezembro)`;
const day = String.raw`(?:3[01]|[12]\d|0?[1-9])`;
const clock = String.raw`(?:\s*(?:,\s*)?(?:at|в|сағат|soat|a las|[aàá]s)?\s+(?:[01]?\d|2[0-3]):[0-5]\d)`;
const year = String.raw`(?:\s+(?:de\s+)?20\d{2}(?:\s+(?:года|г\.|жыл(?:ғы|ы)?))?)?`;
const naturalDates = [
  new RegExp(`(?<![\\p{L}\\p{N}_])(${day}(?:-го)?(?:\\s+(?:de\\s+)?|-)${months}${year}${clock}?)(?![\\p{L}\\p{N}_])`,'giu'),
  new RegExp(`(?<![\\p{L}\\p{N}_])(${months}\\s+${day}(?:st|nd|rd|th|-інде|-ында|-сі|-i|-kuni)?(?:,)?${year}${clock}?)(?![\\p{L}\\p{N}_])`,'giu'),
  new RegExp(`(?<![\\p{L}\\p{N}_])(20\\d{2}(?:\\s+жыл(?:ғы|ы)?|[- ]yil)\\s+(?:${months}\\s+${day}(?:-інде|-ында|-сі)?|${day}-${months})(?:\\s+kuni)?${clock}?)(?![\\p{L}\\p{N}_])`,'giu'),
];
const moneyPrefix = /(?<![\p{L}\p{N}_])((?:R\$|US\$|[$€₸₽])\s*(?:\d{1,3}(?:[., \u00a0]\d{3})+|\d{1,7})(?:[.,]\d{1,2})?)(?![\p{L}\p{N}_])/giu;
const referenceKinds = [
  ['order',String.raw`(?:order\s*(?:reference|number|no\.?|id)|(?:номер|код)\s+заказа|тапсырыс\s*(?:нөмірі|коды)|buyurtma\s*(?:raqami|kodi)|(?:n[uú]mero|c[oó]digo|refer[eê]ncia)\s+(?:de\s+|do\s+)?pedido)`],
  ['receipt',String.raw`(?:receipt\s*(?:reference|number|no\.?|id)|(?:номер|код)\s+(?:чека|квитанции)|түбіртек\s*(?:нөмірі|коды)|chek\s*(?:raqami|kodi)|(?:n[uú]mero|c[oó]digo)\s+(?:del?\s+|do\s+)?(?:recibo|comprobante|comprovante))`],
  ['payment_reference',String.raw`(?:payment\s+reference|референс\s+платежа|төлем\s+сілтемесі|to['‘’]?lov\s+havolasi|referencia\s+de\s+pago|refer[eê]ncia\s+do\s+pagamento)`],
].map(([reference_type,label])=>({reference_type,pattern:new RegExp(`(${label}\\s*(?:(?:is|es|é)\\s*)?[:#№=\\p{Pd}]?\\s*(?=[A-Z0-9_-]*\\d)[A-Z0-9][A-Z0-9_-]{2,31})(?![\\p{L}\\p{N}_-])`,'giu')}));

const transactionLabel=String.raw`(?:payment\s+transaction\s+(?:reference|id|identifier|number)|(?:transaction|payment)\s*(?:id|identifier|number)|(?:идентификатор|номер|код)\s+(?:(?:плат[её]жной|банковской|покупочной)\s+){0,2}(?:операции|транзакции|платежа)|(?:банк|төлем)\s+(?:операциясының|транзакциясының)\s+(?:(?:бірегей|нақты)\s+)?(?:идентификаторы|нөмірі|коды)|(?:to['‘’ʻʼ]?lov\s+)?tranzaksiy(?:a|asi|asining)\s+(?:(?:noyob|aniq)\s+)?(?:id|raqami|kodi|identifikatori)|(?:identificador|c[oó]digo|n[uú]mero|id)\s+(?:(?:[uú]nic[oa]|banc[aá]ri[oa])\s+)?(?:de\s+la\s+|da\s+|de\s+)?(?:transacci[oó]n|operaci[oó]n|transa[cç][aã]o|opera[cç][aã]o)(?:\s+(?:de\s+)?(?:pago|pagamento|bancaria|banc[aá]ria))?)`;
const typedTransaction=new RegExp(`${transactionLabel}\\s*(?:(?:is|es|é|это)\\s*)?[:#№=\\p{Pd}]?\\s*((?=[A-Z0-9_\\p{Pd}]*\\d)[A-Z0-9][A-Z0-9_\\p{Pd}]{2,63})(?![\\p{L}\\p{N}_\\p{Pd}])`,'giu');
const isoCurrencies=String.raw`(?:USD|EUR|GBP|KZT|RUB|UZS|BRL|CAD|AUD|JPY|CNY|TRY|CHF)`;
const moneyNumber=String.raw`(?:\d{1,3}(?:[., \u00a0\u202f]\d{3})+|\d{1,7})(?:[.,]\d{1,2})?`;
const adjectivalMoney=new RegExp(`(?<![\\p{L}\\p{N}_])(${moneyNumber}\\s+(?:игровых?\\s+рубл[её]й|game\\s+(?:credits?|currency)|cr[eé]ditos?\\s+(?:de\\s+)?jogo))(?![\\p{L}\\p{N}_])`,'giu');
const isoMoney=[new RegExp(`(?<![\\p{L}\\p{N}_])(${moneyNumber}\\s*${isoCurrencies})(?![\\p{L}\\p{N}_])`,'giu'),new RegExp(`(?<![\\p{L}\\p{N}_])(${isoCurrencies}\\s*${moneyNumber})(?![\\p{L}\\p{N}_])`,'giu')];
const naturalIdentity=[
 ['self',true,`(?:i am|i['’]m|soy|sou)\\s+(${nickname})`,true],
 ['self',false,`(?:я\\s+)?(?:играю|захожу)\\s+под\\s+(?:игровым\\s+)?(?:ником|никнеймом)\\s*[:=\\p{Pd}]?\\s*(${nickname})`],
 ['self',false,`(?:менің\\s+)?(?:ник[іи]м|ойындағы атым)\\s*[:=\\p{Pd}]?\\s*(${nickname})`],
 ['self',false,`(?:өзімнің|менің)\\s+(${nickname})\\s+(?:атты\\s+)?(?:аккаунт|кейіпкер)[\\p{L}]*`],
 ['self',false,`(?:o['‘’ʻʼ]?z|mening)\\s+(?:hisobimdagi|akkauntimdagi)\\s+(${nickname})\\s+(?:qahramon|personaj)[\\p{L}]*`],
 ['self',false,`(?:my|our)\\s+(?:game\\s+)?account\\s+(?:uses|has)\\s+(?:the\\s+)?(?:nickname|nick|name)\\s+(${nickname})`],
 ['self',false,`(?:minha|nossa)\\s+conta\\s+(?:usa|utiliza)\\s+(?:o\\s+)?(?:apelido|nick|nome)\\s+(${nickname})`],
 ['reported',false,`(?:i want to report(?:\\s+player)?|i am reporting(?:\\s+player)?|жалуюсь на(?:\\s+игрока)?|(?:quiero\\s+)?(?:denunciar a|reportar a)|(?:quero\\s+)?denunciar)\\s+(${titleToken})`,true],
 ['reported',false,`(${nickname})\\s+(?:атты\\s+ойыншы|nomli\\s+o['‘’ʻʼ]?yinchi)`],
].map(([subject_role,needsContext,p,capOnly=false])=>({subject_role,needsContext,capOnly,pattern:new RegExp(p+'(?![\\p{L}\\p{N}_-])','giu')}));
const gameIdentityContext=/game|server|сервер|игр[\p{L}]*|ойын|o['‘’ʻʼ]?yin|servidor|juego|jogo|кейіпкер|personaj|qahramon|personagem/iu;
const directionalPlace=[
 String.raw`(?:у|возле|около|на|в|рядом с)\s+(?:(?:северн|южн|восточн|западн|центральн)[\p{L}]*\s+)?(?:причал|пирс|станци|набережн|платформ|вокзал|склад|рынк|мост)[\p{L}]*`,
 String.raw`(?:at|near|by|on|in)\s+(?:the\s+)?(?:(?:north(?:ern)?|south(?:ern)?|east(?:ern)?|west(?:ern)?|central)\s+)?(?:pier|dock|station|platform|depot|warehouse|market|bridge)`,
 String.raw`(?:(?:солтүстік|оңтүстік|шығыс|батыс|орталық)\s+)?(?:аялдама|станция|базар|қойма|көпір|айлақ)[\p{L}]*\s+(?:жанында|қасында|алдында|ішінде)`,
 String.raw`(?:(?:shimoliy|janubiy|sharqiy|g['‘’ʻʼ]?arbiy|markaziy)\s+)?(?:bekat|stansiya|bozor|ombor|ko['‘’ʻʼ]?prik)[\p{L}]*\s+(?:yonida|oldida|ichida)`,
 String.raw`(?:en|junto a|cerca de)\s+(?:el|la|un|una)\s+(?:estaci[oó]n|muelle|plataforma|almac[eé]n|mercado|puente)(?:\s+(?:del?|al)\s+(?:norte|sur|este|oeste))?`,
 String.raw`(?:n[oa]|perto d[oa]|ao lado d[oa])\s+(?:cais|esta[cç][aã]o|plataforma|dep[oó]sito|mercado|ponte)(?:\s+(?:(?:do|ao)\s+)?(?:norte|sul|leste|oeste))?`,
].map(p=>new RegExp(`(?<![\\p{L}])(${p})(?![\\p{L}])`,'giu'));

// Open modifiers/possessors around physical-location heads, not place-name lists.
const placeWord=String.raw`[\p{L}][\p{L}'‘’ʻʼ-]*`;
const eventPlaces=[
 String.raw`(?:bekat|stansiya|ombor|darvoza|eshik|bino)(?:lar)?(?:i|imiz|ingiz)?(?:da|dagi|ning\s+(?:oldida|yonida|ichida))`,
 String.raw`(?:у|возле|около|перед|за|на|в|рядом с)\s+(?:${placeWord}\s+){0,2}(?:ворот[\p{L}]*|двер[\p{L}]*|вход[\p{L}]*|выход[\p{L}]*|касс[\p{L}]*|стойк[\p{L}]*)(?:\s+${placeWord}){0,2}`,
 String.raw`(?:at|near|by|beside|outside|inside|off|in front of)\s+(?:the\s+|a\s+)?(?:${placeWord}\s+){0,2}(?:gate|door|entrance|exit|counter|(?:loading\s+)?bay)(?:\s+of\s+(?:the\s+)?${placeWord}(?:\s+${placeWord})?)?`,
 String.raw`(?!(?:да|де|та|те|ойыншы|мен|біз|ол|ақау|оқиға)\s)${placeWord}(?:\s+${placeWord}){0,2}\s+(?:алдында|артында|жанында|қасында|ішінде)`,
 String.raw`(?!(?:o['‘’ʻʼ]?yinchi|men|biz|u|hodisa|nosozlik)\s)${placeWord}(?:\s+${placeWord}){0,2}\s+(?:oldida|orqasida|yonida|ichida)`,
 String.raw`(?:(?:en|junto a|frente a|cerca de)\s+)?(?:la|el|al)\s+(?:${placeWord}\s+){0,2}(?:puerta|entrada|salida|ventanilla|mostrador)(?:\s+(?:de|del)\s+(?:la\s+|el\s+)?${placeWord}){0,2}`,
 String.raw`(?:na|no|perto da|perto do|junto à|junto ao)\s+(?:porta|portão|entrada|saída|balcão)(?:\s+(?!(?:de|do|da)\s)${placeWord}){0,2}(?:\s+(?:de|do|da)\s+${placeWord}(?:\s+${placeWord})?)?`,
].map(p=>new RegExp(`(?<![\\p{L}\\p{N}-])(${p})(?![\\p{L}])`,'giu'));
function locationIncident(text){
 // Evaluate newly supported actions at their own predicate: an unrelated
 // denial, or a denied action followed by an actual contrast, is distinct.
 const denied=/(?:did not|didn't|does not|doesn't|do not|don't|never|was not|wasn't|were not|weren't|n[aã]o)(?:\s+(?:actually|really|ever|deliberately|intentionally|realmente|deliberadamente|intencionalmente)){0,2}\s*$/iu;
 const actualAction=[...text.matchAll(/(?<![\p{L}])(?:shov[\p{L}]*|estacionou)(?![\p{L}])/giu)].some(m=>!denied.test(text.slice(0,m.index)));
 return actualAction||(/(?:event|incident|happened|occurred|blocked|attacked|struck|hit|closed|перекры|толк|удар|произош|это было|инцидент|оқиға|итерді|болды|итермел|hodisa|itardi|urdi|bo['‘’]?ldi|ocurri[oó]|incidente|bloque[oó]|cerrando|golpe[oó]|aconteceu|ocorreu|bloqueou|bateu)/iu.test(text)&&!/(?:did not|didn't|never|was not)\s+(?:happen|occur|block|attack|shov[\p{L}]*)|не\s+(?:произош|было|перекры|толк|удар)|болмады|итерген жоқ|itarmadi|bo['‘’]?lmadi|no\s+(?:ocurri[oó]|bloque[oó])|n[aã]o\s+(?:aconteceu|ocorreu|bloqueou|estacionou)/iu.test(text));
}

const causalFailure=/(?<![\p{L}])(?:makes?|made|causes?|caused)\s+(?:the\s+)?(?:game|client|app)\s+(?:to\s+)?(?:close|crash|freeze|stop)(?![\p{L}])/giu;
function causativeFailure(text){for(const m of text.matchAll(causalFailure))if(!/(?:not|never|n['’]t|will|would|might|could)\s*$/iu.test(text.slice(0,m.index)))return true;return false;}

export function completeReproductionExcerpt(text,start,end,max=100){
 let stop=Math.min(end,start+max),cut=stop<end||/[\p{L}\p{N}]/u.test(text[stop]||'')&&/[\p{L}\p{N}]/u.test(text[stop-1]||'');
 const prefix=text.slice(start,stop),q=quotedSpans(text).find(q=>q.start>=start&&q.start<stop&&q.end>stop);if(q){stop=q.start;cut=true;}
 if(cut||/\b(?:and|the|then|a|an|to)\s*$|(?:^|\s)(?:и|затем|потом|кейін|keyin|y|e)\s*$/iu.test(text.slice(start,stop))){
  const part=text.slice(start,stop),boundaries=[...part.matchAll(/[,;]|\s+(?:and|then|затем|потом|и|кейін|keyin|luego|depois|y|e)(?=\s)/giu)].map(m=>m.index);
  const safe=boundaries.filter(i=>i>=12&&[...part.slice(0,i).matchAll(actions),...part.slice(0,i).matchAll(additionalActions)].length>0).at(-1);
  if(safe===undefined)return null;stop=start+safe;
 }
 while(stop>start&&/[\s,;]/u.test(text[stop-1]))stop--;
 if(stop-start<3||stop-start>max||quotedSpans(text).some(q=>q.start>=start&&q.start<stop&&q.end>stop))return null;
 return{start,end:stop,value:text.slice(start,stop)};
}

export function describedNaturalEvent(text) {
  const session=/(?:was|were|got|have been)\s+(?:unexpectedly\s+|suddenly\s+)?(?:logged|signed)\s+out|(?:меня|нас)[^.!?;\n]{0,20}(?:выбросило|выкинуло|разлогинило)[^.!?;\n]{0,20}(?:аккаунт|сесси)|(?:аккаунт|сессия)[\p{L}]*[^.!?;\n]{0,25}(?:шығарып жіберді|шығып қалдым)|(?:akkaunt|hisob|sessiya)[\p{L}]*[^.!?;\n]{0,25}(?:chiqarib yubordi|chiqib ketdim)|(?:me|nos)\s+(?:desconect[oó]|cerr[oó] la sesi[oó]n)|(?:fui|fomos)\s+desconectad[oa]s?|sess[aã]o\s+(?:foi\s+)?encerrada/giu;
  for(const m of text.matchAll(session)){const before=text.slice(Math.max(0,m.index-35),m.index);if(!/(?:not|never|no|n[aã]o|не)\s*$/iu.test(before)&&!/(?:не|not)\s+(?:выбросило|выкинуло|разлогинило)/iu.test(m[0]))return true;}
  if (/(?<![\p{L}])(?:ocurre|ocorre|happens|происходит|болады|yuz beradi)(?![\p{L}])/iu.test(text)) return true;
  if (/(?:сбой|авари|ақау|nosozlik|fallo|falha)[^.!?\n]{0,65}(?:произош|болды|yuz berdi|ocurri|aconteceu)/iu.test(text)) return true;
  if (/(?:game|client|игр[\p{L}]*|ойын|o['‘’]?yin|juego|jogo)[^.!?\n]{0,50}(?:crash|froze|closed|закрыл|завис|вылет|жабыл|қатып|yopil|qot|cerr[oó]|travou|fechou)/iu.test(text)) return true;
  // Past action sequences can date the reported incident, but filing a ticket,
  // arranging a meeting or a successful login alone cannot date it.
  return !/successful|successfully|успешн|сәтті|muvaffaqiyat|ticket|support request|meeting|обращени|заявлен|встреч|өтініш|murojaat|solicitud|solicita[cç][aã]o/iu.test(text) && [...text.matchAll(actions)].length > 0 && actionContext.test(text);
}

/** Independent of topic prediction. The caller may map an explicitly observed
 * subject to its requested role, but cannot retype dates based on a topic. */
export function observePlayerFields(input) {
  const observations = [];
  const add = (field, message_index, text, start, end, extra = {}) => {
    const assertion = observationAssertion(text, start, end, field);
    observations.push({ field, value: text.slice(start, end), message_index, start, end, role: 'player', assertion, ...extra });
  };
  input.messages.forEach((message, message_index) => {
    if (message.role !== 'player') return;
    const text = message.text;
    for (const {subject_role, pattern} of identities) for (const match of text.matchAll(pattern)) {
      const value = match[1]; if (identityStop.test(value)) continue;
      const start = match.index + match[0].lastIndexOf(value);
      if(/(?:деген|атты)\s+$/iu.test(text.slice(0,match.index)))continue;
      // A denied naming predicate is not an entity. A colon-delimited nickname
      // with the same ordinary word remains a literal value.
      if(/^(?:не|not)$/iu.test(value)&&/^\s+(?:называется|зовут|named|called)(?![\p{L}])/iu.test(text.slice(start+value.length)))continue;
      // A possessive character noun can precede a separately named server.
      // The following server label owns that value, not the earlier identity.
      if(new RegExp(`^\\s+${serverMarker}(?![\\p{L}])`,'u').test(text.slice(start+value.length)))continue;
      add('participant', message_index, text, start, start + value.length, {subject_role});
    }
    for (const pattern of accountIdentities) for (const match of text.matchAll(pattern)) {
      const value=match[1];if(identityStop.test(value))continue;
      // "O'z akkauntim" is the reflexive possessive noun phrase, not a bare
      // account named O'z. Explicit nickname labels still allow that literal.
      if(/^o['‘’ʻʼ]z$/iu.test(value))continue;
      const start=match.index+match[0].indexOf(value);add('participant',message_index,text,start,start+value.length,{subject_role:'self'});
    }
    for (const {subject_role,needsContext,capOnly,pattern} of naturalIdentity) for (const match of text.matchAll(pattern)){
      const value=match[1],start=match.index+match[0].indexOf(value),end=start+value.length,c=observationClause(text,start,end);
      if(identityStop.test(value)||capOnly&&!/^\p{Lu}/u.test(value)||needsContext&&(!gameIdentityContext.test(c.text)||nonGamePerson.test(c.text)&&!gameFrame.test(c.before)))continue;
      add('participant',message_index,text,start,end,{subject_role});
    }
    const aliasLabels=new RegExp(`(?<![\\p{L}])(?:alias|laqabi|laqabim|apelido|apodo)\\s+(?:${neutralEntity}\\s+)?[«“"']?(${nickname})(?![\\p{L}\\p{N}_-])`,'giu');
    for(const match of text.matchAll(aliasLabels)){
      const value=match[1],start=match.index+match[0].lastIndexOf(value),end=start+value.length,c=observationClause(text,start,end);
      // A proposed future name is not an existing game identity. A lost
      // account still has its asserted alias, so denial of access is allowed.
      const naming=/(?:will|shall|going to|plan(?:ning)? to|intend to)\s+(?:create|use|call|name|rename)|(?:do not|don't|did not|didn't|never)\s+(?:use|call|name|rename)|(?:буду|планирую)\s+(?:наз|созд)|(?:voy|vou)\s+(?:a\s+)?(?:crear|criar|usar|llamar|chamar|nombrar|nomear)|(?:no|n[aã]o)\s+(?:uso|us[eé]|llamo|chamo|chamei)/iu;
      if(naming.test(c.before))continue;
      const own=/(?:my|own)\s+(?:account|character)|mi\s+(?:propia\s+)?(?:cuenta|personaje)|minha\s+conta|meu\s+personagem|laqabim/iu.test(c.before);
      const reported=/another\s+player|boshqa\s+o['‘’ʻʼ]?yinchi|outro\s+jogador|otro\s+jugador/iu.test(c.before);
      if((own||reported)&&!identityStop.test(value))add('participant',message_index,text,start,end,{subject_role:reported?'reported':'self'});
    }
    const leftLabels=[...text.matchAll(namedServers[1])].flatMap(m=>{const valueEnd=m[0].lastIndexOf(m[1])+m[1].length,label=new RegExp(serverMarker,'u').exec(m[0].slice(valueEnd));if(!label||!/(?:сервер[\p{L}]*(?:інде|індегі|імде|де)|server(?:lar)?(?:imiz|ingiz|im|i)?(?:dagi|da|dan|ga|ning|ni)(?:man|san|miz|siz|dir)?)$/iu.test(label[0]))return[];return[{start:m.index+valueEnd+label.index,end:m.index+m[0].length}];});
    for (const [orientation,pattern] of namedServers.entries()) for (const match of text.matchAll(pattern)) {
      const value=match[1],start=match.index+match[0].indexOf(value),end=start+value.length,c=observationClause(text,start,end);
      if(orientation===0&&leftLabels.some(label=>label.start===match.index))continue;
      const declaration=/(?:^|\s)(?:on|at|in|на|в|en el|no|na)\s+(?:server[\p{L}]*|сервер[\p{L}]*|servidor)(?:\s+(?:fictional|fictitious|fict[ií]ci[oa]|xayoliy))?\s*$/iu.test(c.before)||/named|called|name|атауы|nomi|[:=—–-]|\b(?:is|es|é)\b/iu.test(match[0].slice(0,match[0].indexOf(value)));
      const playing=/\b(?:play|playing|juego|jogo|o['‘’]?ynay|o['‘’]?ynayman)\b|играю|ойнай|менің|мой|my\s+server|серверім/iu.test(c.text);
      const left=orientation===1&&leftLabels.find(label=>label.end===match.index+match[0].length);
      if(!serverPredicate.test(value)&&!value.split(/\s+/u).some(v=>serverPredicate.test(v))&&(declaration||playing||left))add('server',message_index,text,start,end,left?{server_orientation:'left',label_start:left.start,label_end:left.end}:{});
    }
    for (const match of text.matchAll(bareActor)) {
      const value=match[1],c=observationClause(text,match.index,match.index+value.length);
      if(outsideGameFrame.test(c.text)||nonGamePerson.test(c.text)&&!gameFrame.test(c.before))continue;
      if(gameFrame.test(c.before)||/[\p{Ll}][\p{Lu}]|_|[\p{L}]\d/u.test(value))add('participant',message_index,text,match.index,match.index+value.length,{subject_role:'reported'});
    }
    for (const pattern of naturalDates) for (const match of text.matchAll(pattern))add('dated_value',message_index,text,match.index,match.index+match[1].length,{temporal_role:'unresolved'});
    for (const match of text.matchAll(moneyPrefix))add('amount',message_index,text,match.index,match.index+match[1].length);
    for(const match of text.matchAll(adjectivalMoney))add('amount',message_index,text,match.index,match.index+match[1].length);
    for (const pattern of isoMoney) for(const match of text.matchAll(pattern))add('amount',message_index,text,match.index,match.index+match[1].length);
    for (const match of text.matchAll(typedTransaction)){const start=match.index+match[0].lastIndexOf(match[1]);add('transaction_id',message_index,text,start,start+match[1].length,{reference_type:'transaction'});}
    for (const {reference_type,pattern} of referenceKinds) for (const match of text.matchAll(pattern))add('transaction_id',message_index,text,match.index,match.index+match[1].length,{reference_type});
    for (const match of text.matchAll(relativeDate)) {
      const start=match.index,baseEnd=start+match[1].length,suffix=new RegExp('^'+clock+String.raw`(?:-(?:да|де|та|те)|\s+da)?`,'iu').exec(text.slice(baseEnd));
      add('dated_value',message_index,text,start,baseEnd+(suffix?.[0].length||0),{temporal_role:'unresolved'});
    }
    for (const match of text.matchAll(platform)) add('platform', message_index, text, match.index, match.index + match[1].length);
    for (const match of text.matchAll(place)) add('location',message_index,text,match.index,match.index+match[1].length);
    for (const pattern of directionalPlace) for(const match of text.matchAll(pattern))add('location',message_index,text,match.index,match.index+match[1].length);
    for(const pattern of eventPlaces)for(const match of text.matchAll(pattern)){const start=match.index,c=observationClause(text,start,start+match[1].length);if(!locationIncident(c.text))continue;const value=match[1].split(/\s+(?:and|but|и|но|бірақ|lekin|y|pero|e|mas)\s+/iu)[0];add('location',message_index,text,start,start+value.length);}
    for (const clause of text.matchAll(/(?:\.(?!\s|$)|[^.!?;\n])+/gu)) {
      if (/(?:не (?:помню|знаю)[^.!?]{0,30}когда|(?:do not|don't|cannot|can't) (?:remember|know)[^.!?]{0,30}when|қашан[^.!?]{0,35}(?:есімде жоқ|білмей)|(?:qachon|(?:aniq\s+)?(?:vaqt|soat)(?:ini|i|ning)?)[^.!?]{0,35}(?:eslay olmay|bilmay)|no (?:recuerdo|s[eé])[^.!?]{0,30}cu[aá]ndo|n[aã]o (?:lembro|sei)[^.!?]{0,30}quando)/iu.test(clause[0])) add('event_time',message_index,text,clause.index,clause.index+clause[0].length,{availability:'unavailable'});
    }
    for (const clause of text.matchAll(/(?:\.(?!\s|$)|[^.!?;\n])+/gu)) {
      const finite = [...clause[0].matchAll(actions)],nonfinite=[...clause[0].matchAll(additionalActions)];
      const sequence=actionContext.test(clause[0])||/открытия|выбора|ашып|таңдағаннан|ochib|tanlagandan/iu.test(clause[0])||observedReproductionAt(text,clause.index,clause.index+clause[0].length);
      const explicit=/^(?:to reproduce|reproduction|шаги|қайтал|takrorlash|pasos|passos)/iu.test(clause[0].trim());
      if(!(finite.length&&(sequence||finite.length>=2)||nonfinite.length&&(sequence&&(assertedFailure.test(clause[0])||causativeFailure(clause[0]))||explicit)))continue;
      const start=clause.index+clause[0].search(/\S/u),end=clause.index+clause[0].trimEnd().length,excerpt=completeReproductionExcerpt(text,start,end);
      if(excerpt)add('reproduction_steps',message_index,text,excerpt.start,excerpt.end);
    }
  });
  return observations;
}
