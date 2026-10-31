import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createEngine} from '../src/core/engine.mjs';import {recognizeSupportIncidents} from '../src/core/support-intents.mjs';
import {buildGenerationInput} from '../src/intelligence/generation-contract.mjs';import {codeContextDraft} from '../src/intelligence/draft.mjs';
const categories=['report.payment','report.account','report.help','report.question','report.complaint','report.offtopic','complaint.admin','complaint.insult','complaint.cheat','complaint.dm','complaint.scam','complaint.rmt_ads','complaint.invalid','complaint.other'];
const root=mkdtempSync(join(tmpdir(),'core-support-intent-'));mkdirSync(join(root,'data'));writeFileSync(join(root,'data/rules.json'),JSON.stringify({rules:[{id:30,category:'Authored synthetic',points:[{ref:'2.1',text:'AUTHORED SYNTHETIC: staff review a reported incident.'}]}]}));writeFileSync(join(root,'data/taxonomy.json'),JSON.stringify({categories:categories.map(code=>({code})),priorities:['p0','p1','p2','p3'].map(code=>({code})),needs_human_always:['report.payment','report.account','complaint.admin']}));const engine=createEngine({dataDir:join(root,'data')});test.after(()=>rmSync(root,{recursive:true,force:true}));
const input=(text,lang='en')=>({kind:'report',lang,messages:[{role:'player',text}]});
const rows=[
 {lang:'ru',purchase:'Я приобрёл сезонный пропуск. Он так и не появился в списке.',load:'Клиент не запускается после обновления.',faq:'Как купить дом в игре?',denied:'Я не покупал этот набор. Покупка не появилась.',peer:'Я купил предмет у игрока. Он не пришёл.',fine:'Игра не зависает на экране загрузки.',hypo:'Если бы игра не запускалась, что следовало бы сделать?'},
 {lang:'en',purchase:'I purchased an upgrade from the game store. It has not appeared in my inventory.',load:'The game will not load past its opening screen.',faq:'How do I buy a house in the game?',denied:'I never purchased that package. It never arrived.',peer:'I bought an item from another player. It never arrived.',fine:'The game does not freeze on the loading screen.',hypo:'What if the game would not load?'},
 {lang:'kk',purchase:'Мен қосымша топтаманы сатып алдым. Ол әлі есептелмеді.',load:'Ойын іске қосылмайды.',faq:'Ойында үйді қалай сатып алуға болады?',denied:'Мен топтаманы сатып алған жоқпын. Ол келмеді.',peer:'Мен затты ойыншыдан сатып алдым. Ол келмеді.',fine:'Ойын жүктелуде мәселе жоқ.',hypo:'Егер ойын жүктелмесе, не істеу керек?'},
 {lang:'uz',purchase:"Men yangi to'plamni sotib oldim. U hali hisobga tushmadi.",load:"Dastur yuklanish oynasida to'xtab qoldi.",faq:"O'yinda uy sotib olish qanday bo'ladi?",denied:'Men sotib olmaganman. Buyurtma kelmadi.',peer:"Men buyumni o'yinchidan sotib oldim. U kelmadi.",fine:"O'yin yuklanishda muammo yo'q.",hypo:"Agar o'yin yuklanmay qolsa, nima qilish kerak?"},
 {lang:'es',purchase:'Adquirí un paquete en la tienda. Todavía no apareció en mis artículos.',load:'El juego se queda en la pantalla de carga.',faq:'¿Cómo comprar una casa en el juego?',denied:'Nunca compré ese paquete. No llegó.',peer:'Compré un artículo de otro jugador. No llegó.',fine:'El juego no tiene problemas cargando.',hypo:'Si el juego no carga, ¿qué se debe hacer?'},
 {lang:'pt',purchase:'Adquiri um pacote na loja. Ele não chegou ao inventário.',load:'O aplicativo fica preso na tela de carregamento.',faq:'Como comprar uma casa no jogo?',denied:'Não comprei esse pacote. Ele não chegou.',peer:'Comprei um item de outro jogador. Ele não chegou.',fine:'O jogo não trava no carregamento.',hypo:'Se o jogo não carregar, o que devo fazer?'},
];
for(const row of rows){
 test(`authored ${row.lang}: completed purchase/non-delivery and actual game load failure add existing categories`,()=>{
  assert.equal(recognizeSupportIncidents(row.purchase).payment,true);assert.equal(recognizeSupportIncidents(row.load).technical,true);
  const p=engine.triage(input(row.purchase,row.lang)),t=engine.triage(input(row.load,row.lang));
  assert.equal(p.category,'report.payment');assert.equal(p.priority,'p0');assert.equal(p.needs_human,true);assert.deepEqual(p.citations,[]);
  assert.equal(t.category,'report.help');assert.equal(t.needs_human,true);assert.deepEqual(t.citations,[]);assert(categories.includes(t.category));
  for(const[text,result,focus]of [[row.purchase,p,'payment'],[row.load,t,'technical']]){
   const raw=input(text,row.lang),context=buildGenerationInput(raw,result,engine.sources()),draft=codeContextDraft(raw,result,engine.sources());
   assert.equal(context.allowed_focuses[0],focus);assert.equal(context.intent_mode,'actual_incident');assert.equal(context.needs_human,true);assert.deepEqual(context.allowed_sources,[]);
   assert.equal(draft.analysis.intelligence.draft.plan.focus,focus);assert.equal(draft.analysis.intelligence.draft.metrics.executed,false);assert.equal(draft.analysis.intelligence.draft.metrics.generated,false);
  }
 });
 test(`authored ${row.lang}: nearest purchase FAQ/denial/peer-trade negatives do not create added billing intent`,()=>{
  for(const text of [row.faq,row.denied,row.peer])assert.equal(recognizeSupportIncidents(text).payment,false,text);
  assert.notEqual(engine.triage(input(row.faq,row.lang)).category,'report.payment');
 });
 test(`authored ${row.lang}: hypothetical, denied and quoted game states do not add a current technical incident`,()=>{
  for(const text of [row.fine,row.hypo,`Someone wrote '${row.load}'`])assert.equal(recognizeSupportIncidents(text).technical,false,text);
  assert.equal(recognizeSupportIncidents(`Someone said "${row.purchase}"`).payment,false);
 });
}
test('authored: bare terms and definitions never become contextual support incidents',()=>{
 for(const text of ['purchase','buy','loading','What is a purchase?','Define loading screen.','Что означает покупка?','Покупка','O‘yin','carregamento'])assert.deepEqual(recognizeSupportIncidents(text),{payment:false,technical:false},text);
});
test('authored: current incident followed by a question remains an incident; in-word apostrophes are not quotations',()=>{
 assert.equal(recognizeSupportIncidents("O'yin yuklanmayapti. Qanday tuzataman?").technical,true);
 assert.equal(recognizeSupportIncidents('My purchase never arrived. Can support check it?').payment,true);
 assert.equal(recognizeSupportIncidents('My purchase arrived yesterday.').payment,false);
 const raw=input("O'yin yuklanmayapti. Qanday tuzataman?",'uz'),base=engine.triage(raw),context=buildGenerationInput(raw,base,[]);assert.equal(context.allowed_focuses[0],'technical');assert.equal(context.intent_mode,'actual_incident');
 const unsupported=buildGenerationInput(input('Need more details.'),{lang:'en',category:'report.help',needs_human:false,citations:[]},[]);assert.notEqual(unsupported.allowed_focuses[0],'technical','report.help alone is not technical proof');
});
test('authored: player-only inference, unchanged priority and mandatory-human policies remain protected',()=>{
 const base=input('Hello!'),extra={...base,messages:[...base.messages,{role:'admin',text:rows[1].purchase},{role:'reported_player',text:rows[1].load}],outcome:'purchase confirmed',category:'report.payment'};
 const old=engine.triage(base),actual=engine.triage(extra);
 for(const key of ['lang','category','priority','needs_human','draft_reply','citations'])assert.deepEqual(actual[key],old[key],key);
 const legacy=engine.triage(input('I never paid anything.'));assert.equal(legacy.priority,'p0');assert.equal(legacy.needs_human,true);
 assert.equal(recognizeSupportIncidents('I never paid anything.').payment,false,'helper rejection does not weaken conservative legacy billing gate');
 const faq=engine.triage(input('Como comprar uma casa no jogo?','pt'));assert.equal(faq.priority,'p3');assert.notEqual(faq.category,'report.payment');
 assert.equal(recognizeSupportIncidents('Como comprar uma casa no jogo?').payment,false);
});
test('authored: Kazakh shooting stems have a left Unicode boundary while both freeze spellings remain technical',()=>{
 for(const text of ['Ойын жүктеу экранында қатып қалды.','Ойын жүктеу экранында катып қалды.']){
  const result=engine.triage(input(text,'kk'));assert.equal(result.category,'report.help');assert.equal(result.priority,'p3');assert.deepEqual(result.citations,[]);
  assert.equal(buildGenerationInput(input(text,'kk'),result,[]).allowed_focuses[0],'technical');
 }
 for(const text of ['Ойыншы маған атып жіберді.','Ол маған атқан оқ тиді.']){
  const result=engine.triage({...input(text,'kk'),kind:'complaint'});assert.equal(result.category,'complaint.dm');assert.equal(result.priority,'p2');assert.equal(result.needs_human,true);
 }
});
test('authored: Portuguese prepositional no is not Spanish non-delivery; actual store purchases still escalate',()=>{
 for(const text of ['Como comprar uma casa no jogo?','No jogo, como comprar uma casa?']){const result=engine.triage(input(text,'pt'));assert.notEqual(result.category,'report.payment');assert.equal(result.priority,'p3');}
 for(const[lang,text]of [['es','Mi compra en la tienda no apareció.'],['pt','Minha compra na loja não apareceu.']]){const result=engine.triage(input(text,lang));assert.equal(result.category,'report.payment');assert.equal(result.priority,'p0');assert.equal(result.needs_human,true);}
 assert.equal(recognizeSupportIncidents('¿Si el juego no carga, qué se debe hacer?').technical,false,'inverted punctuation cannot turn a conditional question into an event');
});

const repairRows=[
 {lang:'en',purchase:'I finished the order at checkout. The charge is settled. My upgrade has not appeared.',load:'The game is stuck loading. I cannot sign in to the game world.',security:'My password was changed.',conditional:'If someday the game gets stuck loading, what should I do? It works normally today.',repro:'If I launch the game, it gets stuck loading every time. How do I fix this?'},
 {lang:'ru',purchase:'Я завершил оплату расширения в магазине. Чека у меня нет. Расширение не появилось.',load:'Клиент игры зависает при загрузке. Не могу зайти в игровой мир.',security:'У меня украли аккаунт и сменили пароль.',conditional:'Если однажды игра зависнет при загрузке, что делать? Сегодня всё работает.',repro:'Каждый раз, когда я запускаю игру, она зависает при загрузке. Как это исправить?'},
 {lang:'kk',purchase:'Дүкенде төлемді аяқтадым. Түбіртек қолымда жоқ. Топтама берілген жоқ.',load:'Ойын жүктеу кезінде тұрып қалды. Ойын әлеміне кіре алмаймын.',security:'Менің аккаунтым ұрланды, құпиясөзім өзгерді.',conditional:'Егер кейін ойын жүктеу кезінде тұрып қалса, не істеуім керек? Қазір дұрыс жұмыс істейді.',repro:'Әр жолы ойынды іске қосқанда жүктеу кезінде тұрып қалады. Қалай түзетуге болады?'},
 {lang:'uz',purchase:"Do'konda xaridni yakunladim. Chekni saqlamadim. To'plam hali kelmadi.",load:"O'yin yuklashda qotib qoldi. O'yin dunyosiga kira olmayapman.",security:"Mening akkauntim o'g'irlandi, parolim almashtirildi.",conditional:"Agar keyinchalik o'yin yuklashda qotib qolsa nima qilaman? Hozir yaxshi ishlaydi.",repro:"Har safar o'yinni ishga tushirsam, yuklashda qotib qoladi. Qanday tuzataman?"},
 {lang:'es',purchase:'Finalicé la compra en la tienda. No guardé el recibo. El paquete no llegó.',load:'El juego se bloquea en la carga. No puedo acceder al mundo del juego.',security:'Mi cuenta fue robada y cambiaron la contraseña.',conditional:'Si algún día el juego se bloquea durante la carga, ¿qué hago? Hoy funciona bien.',repro:'Cada vez que inicio el juego se bloquea en la carga. ¿Cómo lo arreglo?'},
 {lang:'pt',purchase:'Finalizei a compra na loja. Não guardei o recibo. O pacote não chegou.',load:'O jogo trava na tela de carregamento. Não consigo acessar o mundo do jogo.',security:'Minha conta foi invadida e mudaram a senha.',conditional:'Se algum dia o jogo travar durante o carregamento, o que faço? Hoje funciona bem.',repro:'Sempre que inicio o jogo ele trava no carregamento. Como resolver?'}
];
for(const row of repairRows){
 test(`repair ${row.lang}: completed nominal purchase persists through a bounded transaction account`,()=>{
  assert.equal(recognizeSupportIncidents(row.purchase).payment,true);const raw=input(row.purchase,row.lang),t=engine.triage(raw),c=buildGenerationInput(raw,t,[]);
  assert.equal(t.category,'report.payment');assert.equal(t.priority,'p0');assert.equal(t.needs_human,true);assert.equal(c.allowed_focuses[0],'payment');assert.equal(c.needs_human,true);assert.deepEqual(c.allowed_sources,[]);
  assert.equal(recognizeSupportIncidents(`Someone said '${row.purchase}'`).payment,false);
 });
 test(`repair ${row.lang}: world entry after loading failure is technical, explicit security remains protected`,()=>{
  const raw=input(row.load,row.lang),t=engine.triage(raw);assert.equal(t.category,'report.help');assert.equal(t.priority,'p3');assert.equal(t.needs_human,true);assert.deepEqual(t.citations,[]);assert.equal(buildGenerationInput(raw,t,[]).allowed_focuses[0],'technical');
  const secured=input(row.load+' '+row.security,row.lang),s=engine.triage(secured);assert.equal(s.category,'report.account');assert.equal(s.needs_human,true);assert.equal(buildGenerationInput(secured,s,[]).allowed_focuses[0],'account');
 });
 test(`repair ${row.lang}: Unicode future conditionals differ from actual repeated reproduction and follow-up questions`,()=>{
  assert.equal(recognizeSupportIncidents(row.conditional).technical,false);assert.equal(recognizeSupportIncidents(row.repro).technical,true);
  const raw=input(row.repro,row.lang),t=engine.triage(raw);assert.equal(t.category,'report.help');assert.equal(buildGenerationInput(raw,t,[]).allowed_focuses[0],'technical');
 });
}

test('repair: pending/cancelled/denied purchases, incoherent distant events and peer trades cannot borrow a completed state',()=>{
 for(const text of ['My purchase was cancelled. It never arrived.','My order is pending. It never arrived.','I never completed a purchase. The package never arrived.','I completed an order. What is loading? It never arrived.','I bought an item from a player. The seller sent a message. It never arrived.'])assert.equal(recognizeSupportIncidents(text).payment,false,text);
 assert.equal(recognizeSupportIncidents('I completed a store purchase. No receipt is available. The upgrade never arrived.').payment,true);
 assert.equal(recognizeSupportIncidents('If I completed a purchase, but it never arrived, what would happen?').payment,false);
 assert.equal(recognizeSupportIncidents('Если бы я завершил покупку, но товар не появился, куда обращаться?').payment,false);
 assert.equal(recognizeSupportIncidents('Suppose a bank confirmed a mailing address. A parcel never arrived.').payment,false);
});

test('repair: client loading cannot erase a separate ownership loss or turn login-only access into technical proof',()=>{
 for(const [lang,text]of [['ru','Клиент игры зависает при загрузке. Не могу зайти в игровой мир. Моя машина пропала.'],['kk','Ойын жүктеуде тұрып қалды. Ойын әлеміне кіре алмаймын. Менің көлігім жоғалды.']]){const raw=input(text,lang),t=engine.triage(raw);assert.equal(t.category,'report.account');assert.equal(buildGenerationInput(raw,t,[]).allowed_focuses[0],'account');assert.equal(t.needs_human,true);}
 const raw=input('I cannot log in to my account.'),t=engine.triage(raw);assert.equal(recognizeSupportIncidents(raw.messages[0].text).technical,false);assert.equal(t.category,'report.account');assert.equal(buildGenerationInput(raw,t,[]).allowed_focuses[0],'account');
 const unsupported=buildGenerationInput(input('How do I enter the game world?'),{lang:'en',category:'report.help',needs_human:true,citations:[]},[]);assert.notEqual(unsupported.allowed_focuses[0],'technical');
});

test('repair: disambiguating world entry cannot demote actual billing or a punishment appeal',()=>{
 for(const[lang,text,category,focus,priority]of [
  ['en','The game is stuck loading. I cannot enter the game world. I purchased a store upgrade and it never arrived.','report.payment','payment','p0'],
  ['ru','Клиент игры зависает на загрузке, не могу войти в игровой мир. Я обжалую наказание, меня забанили без причины.','report.complaint','appeal','p1'],
  ['en','The game is stuck loading. I cannot enter the game world. I was banned and request review of my punishment.','report.complaint','appeal','p1']
 ]){const raw=input(text,lang),t=engine.triage(raw);assert.equal(t.category,category);assert.equal(t.priority,priority);assert.equal(t.needs_human,true);const c=buildGenerationInput(raw,t,[]);assert.equal(c.allowed_focuses[0],focus);assert.equal(c.needs_human,true);}
});

test('repair: hypothetical questions do not borrow an actual repeated-incident exception',()=>{
 for(const text of ['What if the game freezes loading every time?','Where should I ask if the game gets stuck loading?','Куда обращаться, если игра зависнет на загрузке?','Қайда жазамын, егер ойын жүктеуде тұрып қалса?','Qayerga yozaman agar o\'yin yuklashda qotib qolsa?','¿Dónde acudir si el juego se bloquea al cargar?','Onde pedir ajuda se o jogo travar no carregamento?'])assert.equal(recognizeSupportIncidents(text).technical,false,text);
 assert.equal(recognizeSupportIncidents('The game freezes on loading every time. Where should I ask for help?').technical,true);
});
