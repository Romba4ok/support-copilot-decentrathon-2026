import test from 'node:test';import assert from 'node:assert/strict';
import{buildFieldStates,buildGenerationInput,renderPlan}from'../src/intelligence/generation-contract.mjs';
const input=(text,lang='en')=>({kind:'report',lang,messages:[{role:'admin',text:'Server Secret. Order ID ADMIN-45.'},{role:'player',text}]});
const rows=[
 {lang:'en',server:'I play on server Amber Meadow.',name:'Amber Meadow',actor:'In the game, DriftHeron insulted me.',nick:'DriftHeron',steps:'After opening the menu and selecting a tool, the game freezes.',date:'The crash happened on September 14th, 2026 at 08:17.',dateValue:'September 14th, 2026 at 08:17',purchase:'I paid R$ 47,90 for a bundle.',amount:'R$ 47,90',ref:'My order reference is OR-5842.',label:'order',uncertain:'Maybe I play on server Amber Meadow.',hypo:'What if opening the menu and selecting a tool made the game freeze?'},
 {lang:'ru',server:'Играю на сервере Янтарный Луг.',name:'Янтарный Луг',actor:'В игре ЖарПтица оскорбил меня.',nick:'ЖарПтица',steps:'После открытия меню и выбора инструмента клиент зависает.',date:'Сбой произошёл 14-го сентября 2026 года в 08:17.',dateValue:'14-го сентября 2026 года в 08:17',purchase:'Я заплатил 47,90 рубля за набор.',amount:'47,90 рубля',ref:'Номер заказа: OR-5842.',label:'заказа',uncertain:'Кажется, играю на сервере Янтарный Луг.',hypo:'Если бы после открытия меню клиент завис, что делать?'},
 {lang:'kk',server:'Менің серверім — Алтын Жайлау.',name:'Алтын Жайлау',actor:'Ойында КүмісҚұс мені қорлады.',nick:'КүмісҚұс',steps:'Мәзірді ашып, құралды таңдағаннан кейін ойын қатып қалады.',date:'Сбой 2026 жылғы қыркүйектің 14-інде сағат 08:17 болды.',dateValue:'2026 жылғы қыркүйектің 14-інде сағат 08:17',purchase:'Мен 47,90 теңге төледім.',amount:'47,90 теңге',ref:'Тапсырыс нөмірі: OR-5842.',label:'Тапсырыс',uncertain:'Бәлкім, серверім — Алтын Жайлау.',hypo:'Егер мәзірді ашып, құралды таңдасам, ойын қатып қалуы мүмкін бе?'},
 {lang:'uz',server:"Men Sokin Vodiy serverida o'ynayman.",name:'Sokin Vodiy',actor:"O'yinda KumushQush meni haqorat qildi.",nick:'KumushQush',steps:"Menyuni ochib, asbobni tanlagandan keyin o'yin qotib qoladi.",date:"Hodisa 2026-yil 14-sentabr kuni soat 08:17 da bo'ldi.",dateValue:'2026-yil 14-sentabr kuni soat 08:17',purchase:"Men 47,90 so'm to'ladim.",amount:"47,90 so'm",ref:'Buyurtma raqami: OR-5842.',label:'Buyurtma',uncertain:"Balki Sokin Vodiy serverida o'ynayman.",hypo:"Agar menyuni ochib, asbobni tanlasam, o'yin qotib qoladimi?"},
 {lang:'es',server:'Juego en el servidor Prado Ámbar.',name:'Prado Ámbar',actor:'En el juego GarzaSolar me insultó.',nick:'GarzaSolar',steps:'Al abrir el menú y seleccionar una herramienta, el juego se bloquea.',date:'El fallo ocurrió el 14 de septiembre de 2026 a las 08:17.',dateValue:'14 de septiembre de 2026 a las 08:17',purchase:'Pagué 47,90 euros por el paquete.',amount:'47,90 euros',ref:'Número de pedido: OR-5842.',label:'pedido',uncertain:'Quizás juego en el servidor Prado Ámbar.',hypo:'¿Qué pasaría si al abrir el menú se bloqueara el juego?'},
 {lang:'pt',server:'Jogo no servidor Prado Dourado.',name:'Prado Dourado',actor:'No jogo GarçaSolar me insultou.',nick:'GarçaSolar',steps:'Ao abrir o menu e selecionar uma ferramenta, o jogo trava.',date:'A falha ocorreu em 14 de setembro de 2026 às 08:17.',dateValue:'14 de setembro de 2026 às 08:17',purchase:'Paguei R$ 47,90 pelo pacote.',amount:'R$ 47,90',ref:'Número do pedido: OR-5842.',label:'pedido',uncertain:'Talvez jogo no servidor Prado Dourado.',hypo:'E se ao abrir o menu o jogo travasse?'}
];
const fact=(s,f)=>s.facts.find(v=>v.field===f);
function rawFact(s,f,raw){assert.equal(s.field_states[f].state,'supplied',f);const v=fact(s,f);assert(v,f);assert.equal(v.provenance.message_index,1);assert.equal(v.value,raw.messages[1].text.slice(v.provenance.start,v.provenance.end));return v;}
for(const r of rows){
 test(`F9 ${r.lang}: explicitly named server without a names dictionary, with uncertainty contrast`,()=>{const raw=input(r.server,r.lang),s=buildFieldStates(raw);assert.equal(rawFact(s,'server',raw).value,r.name);const uncertain=buildFieldStates(input(r.uncertain,r.lang));assert.notEqual(uncertain.field_states.server.state,'supplied');});
 test(`F9 ${r.lang}: bare in-game actor belongs to reported role, not own account role`,()=>{const raw=input(r.actor,r.lang),s=buildFieldStates(raw,{participantRole:'reported'});assert.equal(rawFact(s,'participant',raw).value,r.nick);assert.equal(fact(s,'participant').provenance.subject_role,'reported');assert.notEqual(buildFieldStates(raw,{participantRole:'self'}).field_states.participant.state,'supplied');});
 test(`F9 ${r.lang}: actual gerund/infinitive action plus observed outcome, not hypothetical steps`,()=>{const raw=input(r.steps,r.lang),s=buildFieldStates(raw);rawFact(s,'reproduction_steps',raw);assert.notEqual(buildFieldStates(input(r.hypo,r.lang)).field_states.reproduction_steps.state,'supplied');});
 test(`F9 ${r.lang}: inflected named date and clock remain one exact incident-time span`,()=>{const raw=input(r.date,r.lang),s=buildFieldStates(raw);assert.equal(rawFact(s,'event_time',raw).value,r.dateValue);assert.equal(s.field_states.payment_date.state,'absent');});
 // F11 corrects the former expectation: a raw merchant reference cannot be
 // displayed under the byte-held payment-transaction label, even with subtype.
 test(`F9 ${r.lang}: exact currency is supplied while non-bank order reference remains a neutral known mention`,()=>{const raw=input(r.purchase+' '+r.ref,r.lang),s=buildFieldStates(raw);assert.equal(rawFact(s,'amount',raw).value,r.amount);assert.equal(fact(s,'transaction_id'),undefined);assert.equal(s.field_states.transaction_id.state,'mentioned_uncertain');assert(s.field_states.transaction_id.provenance.some(p=>p.reference_type==='order'));const c=buildGenerationInput(raw,{lang:r.lang,category:'report.payment',needs_human:true,citations:[]},[],{proposedFocus:'payment',focusOrigin:'authored_test'}),plan={schema_version:c.schema_version,focus:'payment',fact_ids:c.facts.map(f=>f.id),request_fields:[],source_ids:[],needs_human:true};assert(!c.missing_fields.includes('transaction_id'));assert(!renderPlan(plan,c).text.includes('OR-5842'));});
}

test('F9: repeated conditional with observed failure is a reproduction, counterfactual/question/instruction is not',()=>{
 for(const text of ['Every time I open the menu and click Use, the game freezes.','If I open the menu then click Use, the game freezes every time.','To reproduce the crash: open the menu then click Use.'])rawFact(buildFieldStates(input(text)),'reproduction_steps',input(text));
 for(const text of ['What if I open the menu and the game would freeze every time?','Should I open the menu then click Use?','How do I open the menu and select a tool?','Someone said \'After opening the menu the game freezes\'.'])assert.notEqual(buildFieldStates(input(text)).field_states.reproduction_steps.state,'supplied',text);
});
test('F9: server predicates, uncertain hints, contact addresses and unrelated real people do not become safe facts',()=>{
 for(const text of ['The server is offline.','Server time is unknown.','My server is Loading.','I play on server silver.moth@example.invalid.','Someone said \'I play on server Amber Meadow\'.'])assert.notEqual(buildFieldStates(input(text)).field_states.server.state,'supplied',text);
 for(const text of ['My neighbour Elena insulted me.','drift.heron@example.invalid insulted me.','What if DriftHeron insulted me in the game?','Someone wrote \'In the game DriftHeron insulted me\'.'])assert.notEqual(buildFieldStates(input(text)).field_states.participant.state,'supplied',text);
});
test('F9: references are not invented from bank/receipt absence, examples, contacts or admin',()=>{
 for(const text of ['I paid for a bundle. Order reference is unknown.','I paid for a bundle. Receipt number is drift.heron@example.invalid.','What if order reference was OR-5842?'])assert.notEqual(buildFieldStates(input(text)).field_states.transaction_id.state,'supplied',text);
 const raw=input('I paid for a bundle. Receipt number: RC-9157.'),s=buildFieldStates(raw);assert.equal(fact(s,'transaction_id'),undefined);assert.equal(s.field_states.transaction_id.state,'mentioned_uncertain');assert(s.field_states.transaction_id.provenance.some(p=>p.reference_type==='receipt'));
 const tx=input('I paid for a bundle. Transaction ID: TX-9157.'),t=buildFieldStates(tx);assert.equal(rawFact(t,'transaction_id',tx).value,'TX-9157');
});
test('F9: wallet/quantity/date-of-filing and denied actions retain their semantic roles',()=>{
 assert.notEqual(buildFieldStates(input('My wallet balance is R$ 47,90.')).field_states.amount.state,'supplied');
 assert.notEqual(buildFieldStates(input('I sent this ticket on September 14th, 2026 at 08:17.')).field_states.event_time.state,'supplied');
 assert.notEqual(buildFieldStates(input('I did not open the menu or select a tool.')).field_states.reproduction_steps.state,'supplied');
 const raw=input('My server is Amber Meadow. Correction: my server is Copper Valley.'),s=buildFieldStates(raw);assert.equal(s.field_states.server.state,'supplied');assert.equal(fact(s,'server').value,'Copper Valley');
});

test('F9: nonfinite advice is not an observed action sequence; future dates stay hypothetical',()=>{
 for(const text of ['You should open the menu then click Use.','Open the menu then select a tool.','Please try opening the menu and clicking Use.'])assert.notEqual(buildFieldStates(input(text)).field_states.reproduction_steps.state,'supplied',text);
 for(const text of ['If an incident happened on September 14th, 2026 at 08:17, where would I ask?','Someone wrote \'The crash happened September 14th, 2026 at 08:17\'.'])assert.notEqual(buildFieldStates(input(text)).field_states.event_time.state,'supplied',text);
 assert.equal(buildFieldStates(input('I paid for a bundle. Order reference is unknown.')).field_states.transaction_id.state,'unavailable');
 assert.equal(buildFieldStates(input('I paid for a bundle. Receipt number is unavailable.')).field_states.transaction_id.state,'unavailable');
});

test('F9: negated named dates and nonperformed gerund actions are not material facts',()=>{
 for(const text of ['The crash was not on September 14th, 2026 at 08:17.','Сбой был не 14-го сентября 2026 года в 08:17.'])assert.notEqual(buildFieldStates(input(text)).field_states.event_time.state,'supplied',text);
 for(const text of ['After not opening the menu, the game freezes.','Without opening the menu and selecting a tool, the game freezes.','Без открытия меню клиент зависает.'])assert.notEqual(buildFieldStates(input(text)).field_states.reproduction_steps.state,'supplied',text);
});

const nonGamePeople=[
 ['en','My colleague VioletRook insulted me in our workplace.','In the game VioletRook insulted me.'],
 ['ru','Мой коллега ЯсныйСокол оскорбил меня в офисе.','В игре ЯсныйСокол оскорбил меня.'],
 ['kk','Менің әріптесім АлтынҚұс мені қорлады.','Ойында АлтынҚұс мені қорлады.'],
 ['uz','Mening hamkasbim KumushLochin meni haqorat qildi.',"O'yinda KumushLochin meni haqorat qildi."],
 ['es','Mi compañero de trabajo HalconClaro me insultó.','En el juego HalconClaro me insultó.'],
 ['pt','Minha colega de trabalho FalcaoClaro me insultou.','No jogo FalcaoClaro me insultou.']
];
for(const[lang,nonGame,inGame]of nonGamePeople)test(`F9 guards ${lang}: handle shape cannot override an explicit real-person role`,()=>{assert.notEqual(buildFieldStates(input(nonGame,lang)).field_states.participant.state,'supplied');const raw=input(inGame,lang);rawFact(buildFieldStates(raw),'participant',raw);});
const futureActions=[
 ['en',"Next week I'll open the toolbar and select a tool, then the client will freeze. I have not attempted these steps."],
 ['ru','Завтра планирую открыть панель, затем выбрать инструмент, и клиент зависнет. Это лишь прогноз.'],
 ['kk','Ертең мәзірді ашып, құралды таңдағаннан кейін ойын қатып қалады.'],
 ['uz',"Ertaga menyuni ochib, asbobni tanlagandan keyin o'yin qotib qoladi."],
 ['es','Mañana voy a abrir el menú y seleccionar una herramienta, y el juego se bloquea.'],
 ['pt','Amanhã vou abrir o menu e selecionar uma ferramenta, e o jogo trava.']
];
for(const[lang,text]of futureActions)test(`F9 guards ${lang}: planned future actions are not supplied performed reproduction`,()=>assert.notEqual(buildFieldStates(input(text,lang)).field_states.reproduction_steps.state,'supplied'));
test('F9 guards: prediction/retraction is not observation; actual prior actions and failed startup remain material',()=>{
 for(const text of ['I may open the toolbar and select a tool, and the client might freeze.','Opening the toolbar and selecting a tool makes the game freeze. I have not tested this sequence.','Opening the toolbar and selecting a tool makes the game freeze. This is only a prediction.'])assert.notEqual(buildFieldStates(input(text)).field_states.reproduction_steps.state,'supplied',text);
 for(const text of ['I opened the menu and clicked Use, but the game will not start.','I opened the menu then clicked Use and the game froze. Tomorrow I will try restarting.'])rawFact(buildFieldStates(input(text)),'reproduction_steps',input(text));
});
test('F9 guards: internal Uzbek apostrophes are raw name characters, not assertion quotes',()=>{
 for(const text of ["Men Qo'rg'on Hovli serverida o'ynayman.",'Men Qo‘rg‘on Hovli serverida o‘ynayman.']){const raw=input(text,'uz');const f=rawFact(buildFieldStates(raw),'server',raw);assert.equal(f.value,text.includes('‘')?'Qo‘rg‘on Hovli':"Qo'rg'on Hovli");}
 for(const text of ["Balki Qo'rg'on Hovli serverida o'ynayman.","Someone said 'Men Qo‘rg‘on Hovli serverida o‘ynayman'."])assert.notEqual(buildFieldStates(input(text,'uz')).field_states.server.state,'supplied');
});

test('F9 guards: an actual morning or quoted temporal menu name is not a future intention',()=>{
 for(const text of ['Ayer por la mañana abrí el menú y luego pulsé Usar, y el juego se bloqueó.','I opened the "Tomorrow" menu then selected Use, and the game froze.'])rawFact(buildFieldStates(input(text)),'reproduction_steps',input(text));
});

const inferredSteps=[
 ['en','I suspect opening the bag and selecting a tool could crash the client. This is a guess.'],
 ['ru','Думаю, что после открытия сумки и выбора инструмента клиент может вылететь. Я этого не проверял.'],
 ['kk','Мәзірді ашып, құралды таңдағаннан кейін ойын жабылуы мүмкін деп ойлаймын.'],
 ['uz',"Menyuni ochib, asbobni bossam, o'yin yopilishi mumkin deb o'ylayman. Buni kuzatmadim."],
 ['es','Imagino que al abrir la bolsa y seleccionar una herramienta el cliente podría cerrarse. No lo he observado.'],
 ['pt','Suponho que abrir a bolsa e selecionar uma ferramenta poderia fechar o cliente. Não vi isso acontecer.']
];
for(const[lang,text]of inferredSteps)test(`F9 assertion ${lang}: inferred/unobserved outcomes are not performed reproduction`,()=>assert.notEqual(buildFieldStates(input(text,lang)).field_states.reproduction_steps.state,'supplied'));
const relatives=[
 ['en','My aunt DaisyWren insulted me at a family dinner.','In the game my aunt DaisyWren insulted me.'],
 ['ru','Моя сестра ИскраЛада оскорбила меня дома.','В игре моя сестра ИскраЛада оскорбила меня.'],
 ['kk','Менің әпкем КөкҚұс мені қорлады.','Ойында менің әпкем КөкҚұс мені қорлады.'],
 ['uz','Mening opam MoviyQush meni haqorat qildi.',"O'yinda mening opam MoviyQush meni haqorat qildi."],
 ['es','Mi hermana BrisaClara me insultó durante la cena familiar.','En el juego mi hermana BrisaClara me insultó.'],
 ['pt','Minha irmã BrisaClara me insultou durante o jantar familiar.','No jogo minha irmã BrisaClara me insultou.']
];
for(const[lang,real,game]of relatives)test(`F9 assertion ${lang}: family role needs an explicit game frame for bare handle inference`,()=>{assert.notEqual(buildFieldStates(input(real,lang)).field_states.participant.state,'supplied');const raw=input(game,lang);rawFact(buildFieldStates(raw),'participant',raw);});
test('F9 assertion: reported whole quotations differ from quoted server values',()=>{
 for(const text of ['Ustozim misol keltirdi: «Men Sokin Vodiy serverida o‘ynayman.»','Друг привёл пример: «Я играю на сервере Тихий Берег».','Un amigo citó un ejemplo: «Juego en el servidor Valle Claro».'])assert.notEqual(buildFieldStates(input(text)).field_states.server.state,'supplied',text);
 for(const text of ['My server is «Frost Haven».','Сервер «Тихая Роща».']){const raw=input(text);rawFact(buildFieldStates(raw),'server',raw);}
});
test('F9 assertion: implicit Russian first-person reproduction and bounded KK/UZ locative adjuncts remain exact',()=>{
 const repeated=input('Постоянно открываю сумку, затем нажимаю кнопку — игра вылетает.');rawFact(buildFieldStates(repeated),'reproduction_steps',repeated);
 for(const[lang,text,nick]of [['kk','Ойында КөкБүркіт мені көпір қасында қорлады.','КөкБүркіт'],['uz',"O'yinda MoviyLochin meni ko'prik yonida haqorat qildi.",'MoviyLochin']]){const raw=input(text,lang);assert.equal(rawFact(buildFieldStates(raw),'participant',raw).value,nick);}
 for(const[lang,text]of [['kk','Егер ойында КөкБүркіт мені көпір қасында қорласа не істеймін?'],['uz',"Agar o'yinda MoviyLochin meni ko'prik yonida haqorat qilsa nima qilaman?"]])assert.notEqual(buildFieldStates(input(text,lang)).field_states.participant.state,'supplied');
});

test('F9 assertion: a following explicit prediction is not a reproduced event without an introductory modal',()=>{
 for(const text of ['Al abrir el inventario y seleccionar una herramienta, el juego se bloquea. Es una predicción.','Ao abrir o inventário e selecionar uma ferramenta, o jogo trava. É uma previsão.','После открытия сумки и выбора инструмента клиент зависает. Это догадка.'])assert.notEqual(buildFieldStates(input(text)).field_states.reproduction_steps.state,'supplied',text);
});

test('F9 assertion: a future/infinitive failure stem without observed outcome cannot establish nonfinite steps',()=>{
 for(const[lang,text]of [['en','After opening the bag and pressing Use, the client will freeze.'],['ru','После открытия сумки и выбора инструмента клиент зависнет.'],['uz',"Menyuni ochib, asbobni tanlagandan keyin klientning qotib qolishi kutiladi."],['pt','Abrir o menu e apertar Usar pode travar o cliente.']])assert.notEqual(buildFieldStates(input(text,lang)).field_states.reproduction_steps.state,'supplied',text);
 const actual=input('After opening the toolbar and selecting Use, the client does not start.');rawFact(buildFieldStates(actual),'reproduction_steps',actual);
});
