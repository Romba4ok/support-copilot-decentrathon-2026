import test from'node:test';import assert from'node:assert/strict';
import{buildFieldStates,buildGenerationInput,buildPlanMessages,validatePlan,renderPlan}from'../src/intelligence/generation-contract.mjs';
const raw=(text,lang='en',kind='report')=>({kind,lang,messages:[{role:'admin',text:'Untrusted admin nickname HiddenActor. Amount 999 USD.'},{role:'player',text}]});
function supplied(s,field,input){assert.equal(s.field_states[field].state,'supplied',field);const f=s.facts.find(f=>f.field===field);assert(f,field);assert.equal(f.provenance.message_index,1);assert.equal(f.value,input.messages[1].text.slice(f.provenance.start,f.provenance.end));return f;}
const rows=[
 {lang:'en',pay:'I purchased an upgrade.',txn:'Payment transaction reference ‒ UNIT-462.',money:'I paid USD 37.65 for the upgrade.',amount:'USD 37.65',self:'I am BrightEgret on server 44.',selfNick:'BrightEgret',other:'I want to report DuskPlover for insulting me in the game.',otherNick:'DuskPlover',place:'The crash happened near the western pier.',location:'near the western pier'},
 {lang:'ru',pay:'Я оплатил дополнительный набор.',txn:'Код банковской транзакции – UNIT-462.',money:'Я заплатил 37,65 RUB за набор.',amount:'37,65 RUB',self:'Захожу под игровым ником СветлыйЧиж на сервер 44.',selfNick:'СветлыйЧиж',other:'Жалуюсь на ТихийСтриж за поведение в игре.',otherNick:'ТихийСтриж',place:'Сбой произошёл у северного пирса.',location:'у северного пирса'},
 {lang:'kk',pay:'Мен қосымша топтаманы сатып алдым.',txn:'Банк транзакциясының коды — UNIT-462.',money:'Мен 37,65 KZT төледім.',amount:'37,65 KZT',self:'Менің ЖарқынСұңқар атты кейіпкерім Күміс серверінде ойнайды.',selfNick:'ЖарқынСұңқар',other:'ТынықҚұс атты ойыншы мені қорлады.',otherNick:'ТынықҚұс',place:'Ақау шығыс аялдама жанында болды.',location:'шығыс аялдама жанында'},
 {lang:'uz',pay:"Men qo'shimcha to'plam sotib oldim.",txn:'To‘lov tranzaksiyasi identifikatori — UNIT-462.',money:"Men 1 237,65 UZS to'ladim.",amount:'1 237,65 UZS',self:'Mening hisobimdagi YorqinLochin personajining buyumi yo‘qoldi.',selfNick:'YorqinLochin',other:"SokinQush nomli o'yinchi meni haqorat qildi.",otherNick:'SokinQush',place:'Hodisa janubiy bekat oldida bo‘ldi.',location:'janubiy bekat oldida'},
 {lang:'es',pay:'Compré un paquete.',txn:'El número de la transacción bancaria — UNIT-462.',money:'Pagué 37,65 EUR por el paquete.',amount:'37,65 EUR',self:'Soy GarzaBrillante en el servidor 44.',selfNick:'GarzaBrillante',other:'Quiero reportar a ChorlitoSuave por insultos en el juego.',otherNick:'ChorlitoSuave',place:'El fallo ocurrió junto a la estación del norte.',location:'junto a la estación del norte'},
 {lang:'pt',pay:'Comprei um pacote.',txn:'Código da operação de pagamento – UNIT-462.',money:'Paguei 37,65 BRL pelo pacote.',amount:'37,65 BRL',self:'Minha conta utiliza o nick GarcaBrilhante no servidor 44.',selfNick:'GarcaBrilhante',other:'Quero denunciar TarambolaSerena pelo comportamento no jogo.',otherNick:'TarambolaSerena',place:'A falha ocorreu perto do cais sul.',location:'perto do cais sul'}
];
for(const r of rows){
 test(`F10 ${r.lang}: typed payment transaction labels accept modifiers and Unicode dash separators`,()=>{const i=raw(r.pay+' '+r.txn,r.lang),s=buildFieldStates(i);assert.equal(supplied(s,'transaction_id',i).value,'UNIT-462');});
 test(`F10 ${r.lang}: ISO currency preserves complete raw amount`,()=>{const i=raw(r.money,r.lang);assert.equal(supplied(buildFieldStates(i),'amount',i).value,r.amount);});
 test(`F10 ${r.lang}: own game identity and report target keep separate subject roles`,()=>{const i=raw(r.self,r.lang),s=buildFieldStates(i,{participantRole:'self'});assert.equal(supplied(s,'participant',i).value,r.selfNick);const j=raw(r.other,r.lang,'complaint'),o=buildFieldStates(j,{participantRole:'reported'});assert.equal(supplied(o,'participant',j).value,r.otherNick);assert.notEqual(buildFieldStates(j,{participantRole:'self'}).field_states.participant.state,'supplied');});
 test(`F10 ${r.lang}: adjectival incident place keeps complete locative phrase`,()=>{const i=raw(r.place,r.lang);assert.equal(supplied(buildFieldStates(i),'location',i).value,r.location);});
}
test('F10: ISO-like performance labels, contacts, uncertain IDs and quoted examples are not supplied facts',()=>{
 for(const text of ['I paid attention while the game ran at 144 FPS with 16 GB RAM.','Payment transaction reference – unknown.','Example: "Payment transaction reference – UNIT-462".'])assert.notEqual(buildFieldStates(raw(text)).field_states.transaction_id.state,'supplied',text);
 for(const text of ['Amount is 144 FPS.','I paid attention to 16 GB RAM.','I paid for a bundle. My wallet balance is BRL 37,65.'])assert.notEqual(buildFieldStates(raw(text)).field_states.amount.state,'supplied',text);
 for(const text of ['Soy Maria en mi trabajo.','My colleague is BrightEgret at the office.','Quiero saber cómo reportar a alguien.'])assert.notEqual(buildFieldStates(raw(text)).field_states.participant.state,'supplied',text);
});
test('F10: left locative server label cannot borrow following actor, independent declarations still conflict',()=>{
 for(const[lang,text,name]of [['kk','Күміс серверінде ТынықҚұс44 деген ойыншы мені қорлады.','Күміс'],['uz',"Sokin serverida YorqinQush44 ismli o'yinchi meni haqorat qildi.",'Sokin']]){const i=raw(text,lang,'complaint'),s=buildFieldStates(i,{participantRole:'reported'});assert.equal(supplied(s,'server',i).value,name);assert.equal(s.conflicts.some(c=>c.field==='server'),false);}
 const i=raw('Күміс серверінде ойнаймын. Сервер атауы — АлтынҚыр.','kk');assert.equal(buildFieldStates(i).field_states.server.state,'mentioned_uncertain');assert(buildFieldStates(i).conflicts.some(c=>c.field==='server'));
});
test('F10: unrelated credential denial and Portuguese server preposition do not erase explicit identity/time',()=>{
 const i=raw('Играю под ником ЯсныйГрач на сервере 44. Сегодня в 07:25 меня разлогинило из аккаунта, хотя пароль я не менял.','ru'),s=buildFieldStates(i,{participantRole:'self'});assert.equal(supplied(s,'participant',i).value,'ЯсныйГрач');assert.equal(supplied(s,'event_time',i).value,'Сегодня в 07:25');
 const j=raw('Minha conta usa o apelido GarcaClara no servidor 44. Hoje às 07:25 a sessão foi encerrada, embora eu não tenha mudado a senha.','pt'),o=buildFieldStates(j,{participantRole:'self'});assert.equal(supplied(o,'participant',j).value,'GarcaClara');assert.equal(supplied(o,'event_time',j).value,'Hoje às 07:25');
 assert.notEqual(buildFieldStates(raw('I was not logged out on March 12th, 2026 at 07:25.')).field_states.event_time.state,'supplied');
});
test('F10: a repeated observed conditional action has finite outcome; a hypothetical future does not',()=>{
 const i=raw('Мәзірді ашып, сақтау батырмасын бассам, қара терезе пайда болады. Бұл ақау әр жолы қайталанды.','kk');supplied(buildFieldStates(i),'reproduction_steps',i);
 const j=raw('Егер мәзірді ашып, сақтау батырмасын бассам, қара терезе шығуы мүмкін. Мұны әлі тексермедім.','kk');assert.notEqual(buildFieldStates(j).field_states.reproduction_steps.state,'supplied');
 const z=raw("Menyuni ochib, saqlashni bossam, bo'sh oyna paydo bo'ladi. Bu holat har safar takrorlanadi.",'uz');supplied(buildFieldStates(z),'reproduction_steps',z);
});
test('F10: bounded reproduction excerpt ends at a complete performed fragment with balanced quotes',()=>{
 const text='On my laptop, I select a courier task, collect the small parcel, then press "Begin the long delivery journey" and the client closes.';
 const i=raw(text),s=buildFieldStates(i),f=supplied(s,'reproduction_steps',i);assert(f.value.length<=100);assert(!/\b(?:and|the|then|a|an|to)\s*$/iu.test(f.value));assert.equal((f.value.match(/"/gu)||[]).length%2,0);
 const c=buildGenerationInput(i,{lang:'en',category:'report.help',needs_human:true,citations:[]},[],{proposedFocus:'technical',focusOrigin:'authored_test'}),p={schema_version:c.schema_version,focus:'technical',fact_ids:c.facts.map(f=>f.id),request_fields:[],source_ids:[],needs_human:true};assert(validatePlan(p,c).ok);assert(renderPlan(p,c).text.includes(f.value));assert(buildPlanMessages(c)[1].content.includes(f.value));
});
test('F10: negative material lists remain unavailable/neutral and never supplied presence',()=>{
 for(const[lang,text]of [['en','I have no recordings or screenshots.'],['ru','У меня нет записи и скриншотов.'],['kk','Менде бейнежазба да, скриншот та жоқ.'],['uz',"Menda video ham, skrinshot ham yo'q."],['es','No tengo grabaciones ni capturas.'],['pt','Não tenho gravações nem capturas.']]){const s=buildFieldStates(raw(text,lang));assert.notEqual(s.field_states.evidence.state,'supplied');const f=s.facts.find(f=>f.field==='evidence');assert(!f||f.value==='mentioned_unverified');}
});

test('F10 grammar: own character descriptors consume finite naming predicates and game modifiers',()=>{
 for(const[lang,text,name]of [['en','My in-game character is called Meadow, on server 57.','Meadow'],['ru','Мой игровой персонаж называется Река, сервер 57.','Река'],['uz','O‘yindagi qahramonimning nomi Daryo, server 57.','Daryo'],['es','Mi personaje del juego se llama Rio, servidor 57.','Rio'],['pt','Meu personagem do jogo se chama Rio, servidor 57.','Rio']]){const i=raw(text,lang);assert.equal(supplied(buildFieldStates(i,{participantRole:'self'}),'participant',i).value,name);}
 const i=raw('Мой ник: называется. Играю на сервере 57.','ru');assert.equal(supplied(buildFieldStates(i,{participantRole:'self'}),'participant',i).value,'называется');
 for(const[lang,text]of [['ru','Мой персонаж не называется Река.'],['en','Example: "My in-game character is named Meadow".'],['pt','Exemplo: "Meu personagem do jogo se chama Rio".']])assert.notEqual(buildFieldStates(raw(text,lang),{participantRole:'self'}).field_states.participant.state,'supplied');
});
test('F10 grammar: a locative explicit server label keeps its name before a target declaration',()=>{
 for(const[lang,text,name,target]of [['en','On server Copper Marsh I want to report player CalmLark.','Copper Marsh','CalmLark'],['ru','На сервере Медный Луг жалуюсь на игрока СпокойныйЖаворонок.','Медный Луг','СпокойныйЖаворонок'],['es','En el servidor Prado Cobre quiero denunciar al jugador AlondraCalma.','Prado Cobre','AlondraCalma'],['pt','No servidor Prado Cobre quero denunciar o jogador CotoviaCalma.','Prado Cobre','CotoviaCalma'],['kk','Мыс серверінде СабырҚұс деген ойыншыны хабарлаймын.','Мыс','СабырҚұс']]){const i=raw(text,lang,'complaint'),s=buildFieldStates(i,{participantRole:'reported'});assert.equal(supplied(s,'server',i).value,name);assert.equal(supplied(s,'participant',i).value,target);}
});
test('F10 grammar: typed reference uniqueness modifiers do not become identifiers',()=>{
 for(const[lang,text]of [['kk','Төлем транзакциясының нақты нөмірі – UNIT-759.'],['uz','To‘lov tranzaksiyasining aniq raqami – UNIT-759.'],['es','Identificador único de la operación de pago – UNIT-759.'],['pt','Identificador único da operação de pagamento – UNIT-759.']]){const i=raw(text,lang);assert.equal(supplied(buildFieldStates(i),'transaction_id',i).value,'UNIT-759');}
 assert.notEqual(buildFieldStates(raw('Example: "Payment transaction reference – UNIT-759".')).field_states.transaction_id.state,'supplied');
});
test('F10 grammar: repeated executed conditional morphology still rejects unperformed alternatives',()=>{
 for(const[lang,text]of [['kk','Тізімді таңдап, Жалғастыру батырмасын басқан сайын ақ терезе шығады.'],['uz','Ro‘yxatni tanlab, Davom tugmasini bossam, har safar bo‘sh oyna chiqadi.']]){const i=raw(text,lang);supplied(buildFieldStates(i),'reproduction_steps',i);}
 for(const[lang,text]of [['kk','Ертең тізімді таңдап, Жалғастыру батырмасын бассам, ақ терезе шығуы мүмкін. Мұны сынамадым.'],['uz','Ertaga ro‘yxatni tanlab, Davom tugmasini bossam, bo‘sh oyna chiqishi mumkin. Buni sinamadim.']])assert.notEqual(buildFieldStates(raw(text,lang)).field_states.reproduction_steps.state,'supplied');
});
test('F10 grammar: Portuguese executed device location differs from denied ownership',()=>{
 const i=raw('Testei isso duas vezes no Windows.','pt');assert.equal(supplied(buildFieldStates(i),'platform',i).value,'Windows');
 for(const text of ['I have no Windows.','No Windows.','Eu não uso Windows.','I do not use Windows.'])assert.notEqual(buildFieldStates(raw(text)).field_states.platform.state,'supplied',text);
});
