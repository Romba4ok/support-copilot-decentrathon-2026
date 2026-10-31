import { normalizeText } from './language.mjs';

// Additive incident features, not a replacement for conservative risk gates.
// A completed/claimed purchase needs a non-delivery event; a technical feature
// needs both the game/client and an actual start/load failure. No source IDs,
// categories, metadata, outcomes or instruction-shaped flags enter this module.
function withoutQuotations(text) {
  const pairs={'"':'"',"'":"'",'«':'»','“':'”','‘':'’'},chars=[...String(text)];let open=null;
  for(let i=0;i<chars.length;i++){
    const c=chars[i],before=/[\p{L}\p{N}]/u.test(chars[i-1]||''),after=/[\p{L}\p{N}]/u.test(chars[i+1]||'');
    if((c==="'"||c==='‘'||c==='’')&&before&&after)continue;
    if(open){if(c===open.close){for(let n=open.start;n<=i;n++)chars[n]=' ';open=null;}continue;}
    if(pairs[c]&&(!(c==="'"||c==='‘')||!before))open={start:i,close:pairs[c]};
  }
  if(open)for(let n=open.start;n<chars.length;n++)chars[n]=' ';
  return chars.join('');
}
// Unicode token boundaries are essential here: JavaScript's \b is ASCII-only.
const hypothetical = /^(?:what if|if|suppose|imagine|если|предположим|егер|agar|faraz|si|supong[\p{L}]*|se|suponh[\p{L}]*)(?![\p{L}\p{N}_])/u;
const repeatedReproduction = /every time|each time|whenever i|каждый раз|всякий раз|әр жолы|әрбір рет|har safar|har gal|cada vez|sempre que/u;
const conditionalQuestion = /^(?:what|how|where|should|could|что|куда|как|қайда|қалай|не істеу|nima|qayer|qanday|qu[eé]|d[oó]nde|c[oó]mo|onde|o que)[^.!?]{0,100}(?<![\p{L}])(?:if|если|егер|agar|si|se)(?![\p{L}\p{N}_])/u;
const counterfactual = text => conditionalQuestion.test(text) || hypothetical.test(text) && (!repeatedReproduction.test(text) || /^(?:what if|suppose|imagine|предположим|faraz|supong|suponh)|(?<![\p{L}])(?:would|ever)(?![\p{L}])|(?:^|\s)бы(?:\s|$)|бір күні|когда-нибудь/u.test(text));
const definition = /^(?:what (?:is|does)|how (?:do|to|can)|can i|could i|should i|define|definition|что (?:такое|значит|означает)|как (?:купить|приобрести|заказать|запустить)|определени|деген не|нені білдіреді|қалай (?:сатып|іске)|nima|qanday (?:sotib|xarid|ishga)|(?:¿\s*)?(?:qué|que) (?:es|significa)|c[oó]mo (?:comprar|adquirir|iniciar)|o que (?:é|significa)|como (?:comprar|adquirir|iniciar))/u;
const instruction = /^(?:ignore|pretend|output|return json|игнорир|представь что|выведи|ignora|finja)/u;
const peer = /(?<![\p{L}])(?:player|friend|seller|another user|игрок[\p{L}]*|друг[\p{L}]*|продав[\p{L}]*|ойыншы[\p{L}]*|досым|o'yinchi[\p{L}]*|do'st[\p{L}]*|sotuvchi[\p{L}]*|jugador|amigo|vendedor|jogador)(?![\p{L}])/u;
const trade = /buy|bought|purchas|trad|sold|sell|send|sent|transfer|куп|прод|обмен|перев[её]л|отдал|сделк|сатып|берді|sotib|sotdim|yubor|o'tkaz|compr|vend|envi|transfer|troc/u;
const housing = /(?<![\p{L}])(?:house|home|apartment|дом[\p{L}]*|квартир[\p{L}]*|үй|uy|casa|apartamento)(?![\p{L}])/u;
const storeBilling = /shop|store|checkout|card|bill|charge|receipt|плат[её]ж|оплат|карт[ауы]|магазин|донат|төлем|дүкен|карта|to'lov|do'kon|karta|pago|pagamento|tienda|loja|tarjeta|cart[aã]o/u;
const completedPurchase = /(?<![\p{L}])(?:bought|purchased|ordered|оплатил[аи]?|купил[аи]?|приобр[её]л[аи]?|заказал[аи]?|сатып алдым|сатып алдық|сатып алғанмын|төлем жасадым|sotib oldim|sotib oldik|sotib olganman|xarid qildim|compr[eé]|adquir[ií]|ped[ií]|comprei|adquiri)(?![\p{L}])/u;
const purchaseNoun = /(?<![\p{L}])(?:purchase|order|покупк[\p{L}]*|заказ[\p{L}]*|сатып ал[уы][\p{L}]*|xarid[\p{L}]*|buyurtma[\p{L}]*|compra|pedido)(?![\p{L}])/u;
const completedNominal = /(?:completed|finished|finali[sz]ed)[^.!?]{0,45}(?:purchase|order|payment)|(?:purchase|order|payment)[^.!?]{0,35}(?:completed|settled|successful)|(?:совершил[аи]?|завершил[аи]?)[^.!?]{0,35}(?:покуп|оплат|плат[её]ж)|(?:сатып ал|төлем)[^.!?]{0,35}(?:аяқтадым|жасадым)|(?:to'lov|xarid)[^.!?]{0,30}(?:yakunladim|tugatdim)|(?:complet[eé]|finalic[eé]|conclu[ií]|finalizei)[^.!?]{0,30}(?:pago|compra|pagamento)/u;
const settledCharge = /(?:charge|debit)[^.!?]{0,35}(?:settled|completed|confirmed)|(?:банк[^.!?]{0,30}подтверд[^.!?]{0,20}списан|списани[^.!?]{0,30}подтверд)|ақша[\p{L}]*[^.!?]{0,35}(?:есептен шық|шегеріл|ұстал)|(?:pul|hisobimdan|kartamdan)[^.!?]{0,35}(?:yechilgan|yechildi)/u;
const charge = /(?:money|card|funds|account)[^.!?]{0,50}(?:was |were |has been |got )?(?:charged|debited|deducted)|(?:деньг[\p{L}]*|средств[\p{L}]*)[^.!?]{0,45}(?:списан|списал|удержан|снят)|ақша[^.!?]{0,45}(?:шегеріл|ұстал|алын)|(?:pul|hisobimdan|kartamdan)[^.!?]{0,45}(?:yechildi|olindi)|(?:tarjeta|dinero|cart[aã]o|saldo)[^.!?]{0,45}(?:cobr|debit|descont)/u;
const deniedPurchase = /(?:did not|didn't|have not|haven't|never|не)[^.!?]{0,30}(?:buy|bought|purchas|order|покуп|купил|заказ)|(?:no|nunca)\s+(?:compr[eé]|adquir[ií]|comprei|adquiri)|n[aã]o\s+(?:comprei|adquiri)|сатып\s+(?:алма|алған жоқ)|(?:sotib\s+olmad|sotib\s+olmagan|xarid\s+qilmad)|(?:not|never|не)\s+(?:been\s+|было\s+)?(?:charged|debited|списан)/u;
const unfinishedPurchase = /(?:purchase|order|payment)[^.!?]{0,25}(?:not completed|incomplete|cancelled|canceled|pending)|(?:покупк|заказ|плат[её]ж)[^.!?]{0,25}(?:не заверш|отмен[её]н)|(?:төлем|сатып ал)[^.!?]{0,25}(?:аяқталма|жасалма)|(?:to'lov|xarid)[^.!?]{0,25}(?:yakunlanma|qilinma)|(?:compra|pago|pagamento|pedido)[^.!?]{0,25}(?:cancelad|pendiente|pendente|n[aã]o conclu|no complet)/u;
const nonDelivery = /(?:never|not|didn't|hasn't|haven't|no)\s+(?:yet\s+|been\s+|was\s+|have\s+)?(?:arriv|appear|deliver|receiv|credit|show)|(?:did not|has not|have not)\s+(?:arriv|appear|receiv|credit|show)|(?:не|так и не)\s+(?:приш|появ|зачисл|начисл|достав|получ|выда)|(?:келмеді|түспеді|қосылмады|берілмеді|пайда болмады|есептелмеді|жетпеді)|(?:түскен|келген|берілген|қосылған)\s+жоқ|(?:kelmadi|tushmadi|qo'shilmadi|berilmadi|yetib kelmadi|paydo bo'lmadi)|(?:no|nunca)\s+(?:lleg|aparec|recib|entreg|acredit)|n[aã]o\s+(?:cheg|aparec|receb|entreg|credit)|nunca\s+cheg/u;
const game = /(?<![\p{L}])(?:game|client|application|app|игр[\p{L}]*|клиент[\p{L}]*|приложени[\p{L}]*|ойын[\p{L}]*|қосымша[\p{L}]*|o'yin[\p{L}]*|dastur[\p{L}]*|juego|cliente|aplicaci[oó]n|jogo|aplicativo)(?![\p{L}])/u;
const loading = /load|launch|start|загруз|запуск|старте|жүкте|іске қос|yukla|ishga tush|carg|inici|arranc|carreg/u;
const startFailure = /(?:doesn't|does not|won't|will not|cannot|can't)\s+(?:start|load|launch|open)|failed\s+to\s+(?:start|load|launch)|не\s+(?:запуска|загружа|открыва)|іске\s+қосылмай|ашылмай|жүктелмей|(?:ishga\s+tushmay|ochilmay|yuklanmay)|no\s+(?:inicia|arranca|abre|carga)|n[aã]o\s+(?:inicia|abre|carrega)/u;
const stuckLoading = /stuck|freez|frozen|never ends|endless|infinite|keeps loading|завис|застр|застыв|висит|бесконечн|остановил|тұрып қал|[қк]атып қал|шексіз|қолмай|qolib ket|to'xtab qol|qotib qol|cheksiz|se queda|se qued[oó]|se bloque|congel|sin terminar|infinita|trav|preso|sem terminar|infinito/u;
const deniedFailure = /not\s+(?:stuck|frozen)|(?:doesn't|does not)\s+(?:freeze|get stuck)|(?:no|without)\s+(?:problem|issue)[^.!?]{0,20}load|не\s+(?:завис|застр)|(?:нет|без)\s+проблем[^.!?]{0,25}загруз|жүкте[^.!?]{0,25}мәселе\s+жоқ|yuklan[^.!?]{0,25}muammo\s+yo'q|no\s+(?:se bloquea|tiene problemas)|n[aã]o\s+(?:trava|tem problemas)/u;

export function recognizeSupportIncidents(rawPlayerText) {
  const statements=withoutQuotations(rawPlayerText).split(/[.!?;\n]+/u).map(value=>normalizeText(value).replace(/^[¿¡]+/u,'').trim()).filter(Boolean);
  let payment=false,technical=false,denied=false,purchaseUntil=-1,tradeUntil=-1;
  for(let index=0;index<statements.length;index++){
    const current=statements[index];
    if(counterfactual(current)||definition.test(current)||instruction.test(current)){purchaseUntil=-1;continue;}
    if(deniedPurchase.test(current)||unfinishedPurchase.test(current)){denied=true;purchaseUntil=-1;continue;}
    const prior=statements[index-1]||'',window=prior+' '+current;
    const direct=completedPurchase.test(current)||completedNominal.test(current)||charge.test(current)||settledCharge.test(current);
    if(direct){denied=false;purchaseUntil=index+2;if(storeBilling.test(current)&&!peer.test(current))tradeUntil=-1;}
    // Carry a claimed transaction only across a small local account. Explicit
    // denials/questions/conditionals break it; peer trades keep their own scope.
    if(peer.test(current)&&trade.test(current))tradeUntil=index+2;
    const actualPurchase=direct||!denied&&(purchaseUntil>=index||purchaseNoun.test(current));
    const peerTrade=tradeUntil>=index||peer.test(window)&&trade.test(window),gameplayProperty=housing.test(window)&&!storeBilling.test(window);
    if(actualPurchase&&nonDelivery.test(current)&&!peerTrade&&!gameplayProperty)payment=true;
    const hasGame=game.test(current)||game.test(prior)&&!counterfactual(prior)&&!definition.test(prior);
    if(hasGame&&!deniedFailure.test(current)&&(startFailure.test(current)||loading.test(current)&&stuckLoading.test(current)))technical=true;
  }
  return {payment,technical};
}

// A loading failure plus inability to enter the game world is not evidence of
// stolen credentials. Keep explicit authentication, security and ownership loss
// conservative, even when a separate client malfunction is also described.
export function isTechnicalEntryIncident(rawPlayerText) {
  if(!recognizeSupportIncidents(rawPlayerText).technical)return false;
  const text=normalizeText(withoutQuotations(rawPlayerText));
  const protectedAccount=/password|credential|hacked|stolen|takeover|lost.{0,25}(?:access|account|possess|property)|парол|взлом|укра|угнал|потер[\p{L}]*.{0,25}доступ|пропал[\p{L}]*.{0,25}(?:имуществ|машин)|құпиясөз|ұрлан|бұзыл|мүл[іи]к.{0,20}жоғал|parol|o'g'ir|buzil|mulk.{0,20}yo'qol|contrase[nñ]a|rob[\p{L}]*.{0,20}cuenta|cuenta.{0,20}rob|perd[ií].{0,20}(?:acceso|propiedad)|senha|invad|roub|perdi.{0,20}(?:acesso|bens)|(?:my|мой|мо[её]й|менің|mening|mi|minha)\s+(?:account|аккаунт[\p{L}]*|тіркелгі[\p{L}]*|akkaunt[\p{L}]*|cuenta|conta)/u;
  const ownedLoss=/(?:my (?:car|house|items|inventory|property)|(?:машин|имуществ|инвентар)[\p{L}]*|(?:көліг|машина|мүліг|мүлік)[\p{L}]*|(?:mashinam|mulk|buyumlarim)[\p{L}]*|(?:mi|mis) (?:coche|casa|bienes|objetos)|(?:meu|minha|meus) (?:carro|casa|bens|itens))[^.!?]{0,45}(?:disappear|went missing|transferred|пропал|исчез|переоформ|жоғал|аудар|yo'qol|o'tkaz|desaparec|transfer|sumiu)/u;
  if(protectedAccount.test(text)||ownedLoss.test(text))return false;
  const entry=/(?:войти|зайти)[^.!?]{0,30}(?:игр|мир|клиент)|(?:enter|get into|join|(?:log|sign) ?in)[^.!?]{0,30}(?:game|world|client)|(?:ойын|әлем)[^.!?]{0,35}(?:кіре|кіріп)|(?:o'yin|dunyo)[^.!?]{0,35}(?:kira|kirol)|(?:entrar|acceder|acessar)[^.!?]{0,35}(?:juego|mundo|jogo|cliente)/u;
  return entry.test(text);
}
