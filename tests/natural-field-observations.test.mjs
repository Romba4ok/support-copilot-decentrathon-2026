import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGenerationInput, buildPlanMessages, buildPlanSchema, validatePlan,
} from '../src/intelligence/generation-contract.mjs';

// Independently authored before observing the natural-field implementation.
// These are regression examples, not expert labels, controls or quality scores.
const authored = [
  {
    lang: 'ru', self: 'Мой игровой ник — Cedar_Moth.', other: 'Игрок с ником Bronze_Finch оскорбил меня.',
    account: 'Я потерял доступ к своему аккаунту.', appeal: 'Прошу пересмотреть блокировку моего аккаунта.',
    time: 'Сбой произошёл вчера вечером.', timeAnchor: 'вчера вечером',
    steps: 'Я открыл инвентарь, выбрал фонарь, затем нажал кнопку использования.', stepAnchor: 'открыл инвентарь',
    stepQuestion: 'Нужно ли открыть инвентарь и нажать кнопку использования?',
    device: 'Игра зависает на моём MacBook.', deviceAnchor: 'MacBook',
    deviceName: 'Игрок с ником Mac написал мне в чат.',
    purchase: 'Я заплатил 73 рубля за игровой набор, но набор не появился.',
    balance: 'У меня в кошельке 73 рубля, а в рюкзаке 8 предметов.',
    evidence: 'К обращению приложен скриншот.', evidenceAnchor: 'скриншот',
    unrelated: 'После ограничения движение персонажа не восстановилось.',
    denied: 'Скриншота у меня нет.', unavailable: 'Не помню, когда произошёл сбой.',
    hypothetical: 'Если бы сбой произошёл вчера вечером, что следовало бы сделать?',
  },
  {
    lang: 'en', self: 'My in-game nickname is Cedar_Moth.', other: 'The player named Bronze_Finch insulted me.',
    account: 'I lost access to my account.', appeal: 'Please review the suspension of my own account.',
    time: 'The crash happened last Monday afternoon.', timeAnchor: 'last Monday afternoon',
    steps: 'I opened the inventory, selected the lantern, then pressed Use.', stepAnchor: 'opened the inventory',
    stepQuestion: 'Should I open the inventory and press Use?',
    device: 'The game freezes on my MacBook.', deviceAnchor: 'MacBook',
    deviceName: 'A player with the nickname Mac sent me a message.',
    purchase: 'I paid 73 dollars for a game bundle, but it never arrived.',
    balance: 'My wallet balance is 73 dollars and my bag contains 8 items.',
    evidence: 'I attached screenshots to this report.', evidenceAnchor: 'screenshots',
    unrelated: 'The checkered jacket remains visible after the restriction.',
    denied: 'I do not have screenshots.', unavailable: 'I cannot remember when the crash happened.',
    hypothetical: 'If the crash happened last Monday afternoon, what should I do?',
  },
  {
    lang: 'kk', self: 'Менің ойындағы никім — Cedar_Moth.', other: 'Bronze_Finch деген ойыншы мені балағаттады.',
    account: 'Өз аккаунтыма кіру мүмкіндігін жоғалттым.', appeal: 'Өз аккаунтыма қойылған бұғаттауды қайта қарауды сұраймын.',
    time: 'Ақау кеше кешке болды.', timeAnchor: 'кеше кешке',
    steps: 'Мен түгендеуді аштым, шамды таңдадым, содан кейін қолдану батырмасын бастым.', stepAnchor: 'түгендеуді аштым',
    stepQuestion: 'Түгендеуді ашып, қолдану батырмасын басу керек пе?',
    device: 'Ойын менің PlayStation 5 құрылғымда қатып қалады.', deviceAnchor: 'PlayStation 5',
    deviceName: 'Mac деген ойыншы маған хабарлама жіберді.',
    purchase: 'Ойын жиынтығына 73 теңге төледім, бірақ жиынтық келмеді.',
    balance: 'Әмиянымда 73 теңге, ал сөмкемде 8 зат бар.',
    evidence: 'Өтінішке скриншоттарды тіркедім.', evidenceAnchor: 'скриншоттарды',
    unrelated: 'Кейіпкердің шектеулі қозғалысы өзгермеді.',
    denied: 'Менде скриншоттар жоқ.', unavailable: 'Ақаудың қашан болғаны есімде жоқ.',
    hypothetical: 'Егер ақау кеше кешке болса, не істеу керек?',
  },
  {
    lang: 'uz', self: 'O‘yindagi nikim Cedar_Moth.', other: 'Bronze_Finch ismli o‘yinchi meni haqorat qildi.',
    account: 'O‘z akkauntimga kira olmay qoldim.', appeal: 'O‘z akkauntimning bloklanishini qayta ko‘rib chiqishingizni so‘rayman.',
    time: 'Nosozlik kecha kechqurun yuz berdi.', timeAnchor: 'kecha kechqurun',
    steps: 'Inventarni ochdim, chiroqni tanladim, keyin ishlatish tugmasini bosdim.', stepAnchor: 'Inventarni ochdim',
    stepQuestion: 'Inventarni ochib, ishlatish tugmasini bosishim kerakmi?',
    device: 'O‘yin mening Xbox Series S qurilmamda qotib qoladi.', deviceAnchor: 'Xbox Series S',
    deviceName: 'Mac ismli o‘yinchi menga xabar yubordi.',
    purchase: 'O‘yin to‘plami uchun 73 so‘m to‘ladim, lekin to‘plam kelmadi.',
    balance: 'Hamyonimda 73 so‘m va sumkamda 8 ta buyum bor.',
    evidence: 'Murojaatga skrinshotlarni biriktirdim.', evidenceAnchor: 'skrinshotlarni',
    unrelated: 'Cheklangan harakat hali ham tiklanmadi.',
    denied: 'Menda skrinshotlar yo‘q.', unavailable: 'Nosozlik qachon bo‘lganini eslay olmayman.',
    hypothetical: 'Agar nosozlik kecha kechqurun bo‘lgan bo‘lsa, nima qilish kerak?',
  },
  {
    lang: 'es', self: 'Mi nick en el juego es Cedar_Moth.', other: 'El jugador llamado Bronze_Finch me insultó.',
    account: 'Perdí el acceso a mi cuenta.', appeal: 'Solicito revisar la suspensión de mi propia cuenta.',
    time: 'El fallo ocurrió ayer por la tarde.', timeAnchor: 'ayer por la tarde',
    steps: 'Abrí el inventario, elegí la linterna y después pulsé Usar.', stepAnchor: 'Abrí el inventario',
    stepQuestion: '¿Debo abrir el inventario y pulsar Usar?',
    device: 'El juego se bloquea en mi MacBook.', deviceAnchor: 'MacBook',
    deviceName: 'Un jugador con el nick Mac me envió un mensaje.',
    purchase: 'Pagué 73 euros por un paquete del juego, pero no llegó.',
    balance: 'Tengo 73 euros en la cartera y 8 objetos en la mochila.',
    evidence: 'Adjunté capturas a esta reclamación.', evidenceAnchor: 'capturas',
    unrelated: 'La restricción del movimiento sigue igual.',
    denied: 'No tengo capturas.', unavailable: 'No recuerdo cuándo ocurrió el fallo.',
    hypothetical: 'Si el fallo ocurriera ayer por la tarde, ¿qué debería hacer?',
  },
  {
    lang: 'pt', self: 'Meu nick no jogo é Cedar_Moth.', other: 'O jogador chamado Bronze_Finch me insultou.',
    account: 'Perdi o acesso à minha conta.', appeal: 'Peço a revisão da suspensão da minha própria conta.',
    time: 'A falha aconteceu ontem à noite.', timeAnchor: 'ontem à noite',
    steps: 'Abri o inventário, selecionei a lanterna e depois pressionei Usar.', stepAnchor: 'Abri o inventário',
    stepQuestion: 'Devo abrir o inventário e pressionar Usar?',
    device: 'O jogo trava no meu Nintendo Switch.', deviceAnchor: 'Nintendo Switch',
    deviceName: 'Um jogador com o nick Mac me mandou uma mensagem.',
    purchase: 'Paguei 73 reais por um pacote do jogo, mas ele não chegou.',
    balance: 'Tenho 73 reais na carteira e 8 itens na mochila.',
    evidence: 'Anexei comprovantes à solicitação.', evidenceAnchor: 'comprovantes',
    unrelated: 'O personagem permanece restrito ao mesmo movimento.',
    denied: 'Não tenho comprovantes.', unavailable: 'Não lembro quando a falha aconteceu.',
    hypothetical: 'Se a falha acontecesse ontem à noite, o que eu deveria fazer?',
  },
];

function context(text, { lang = 'en', focus = 'technical', kind = focus === 'complaint' ? 'complaint' : 'report', human = false, extra = {} } = {}) {
  const input = { kind, lang, messages: [{ role: 'player', text }], ...extra };
  const basis = { category: `report.${focus}`, lang, needs_human: human, citations: [] };
  return { input, value: buildGenerationInput(input, basis, [], { proposedFocus: focus, focusOrigin: 'learned_e5_router' }) };
}
function facts(value, field) { return value.facts.filter(fact => fact.field === field); }
function noAssertedFact(value, field) {
  assert.notEqual(value.field_states[field].state, 'supplied');
  assert.equal(facts(value, field).length, 0, `no asserted ${field} value`);
}
function nonAbsent(value, field) {
  assert.notEqual(value.field_states[field].state, 'absent', field);
  assert.ok(!value.missing_fields.includes(field), `${field} must not be requested again`);
}
function rawFact({ input, value }, field, anchor) {
  const found = facts(value, field);
  assert.ok(found.length > 0, `grounded ${field} fact`);
  for (const fact of found) {
    const p = fact.provenance;
    assert.equal(p.role, 'player');
    assert.ok(Number.isInteger(p.message_index) && p.message_index >= 0);
    const message = input.messages[p.message_index];
    assert.equal(message.role, 'player');
    assert.ok(Number.isInteger(p.start) && Number.isInteger(p.end));
    assert.ok(p.start >= 0 && p.end > p.start && p.end <= message.text.length);
    const original = message.text.slice(p.start, p.end);
    assert.ok(original.includes(anchor), `original raw span must include ${anchor}`);
    if (field !== 'evidence') assert.equal(fact.value, original, 'non-semantic player fact value must equal its original raw span');
  }
  nonAbsent(value, field);
  return found;
}

for (const row of authored) {
  test(`authored ${row.lang}: own game identity applies to account/appeal; reported identity applies to complaint`, () => {
    for (const focus of ['account', 'appeal']) {
      const result = context(`${row.self} ${row[focus]}`, { lang: row.lang, focus });
      rawFact(result, 'participant', 'Cedar_Moth');
      assert.ok(facts(result.value, 'participant').every(f => f.value.includes('Cedar_Moth')));
      noAssertedFact(context(`${row.other} ${row[focus]}`, { lang: row.lang, focus }).value, 'participant');
    }
    const complaint = context(row.other, { lang: row.lang, focus: 'complaint' });
    rawFact(complaint, 'participant', 'Bronze_Finch');
    noAssertedFact(context(row.self, { lang: row.lang, focus: 'complaint' }).value, 'participant');
  });

  test(`authored ${row.lang}: natural incident time remains verbatim and hypothetical time is not a fact`, () => {
    const result = context(row.time, { lang: row.lang });
    const found = rawFact(result, 'event_time', row.timeAnchor);
    assert.ok(found.every(f => f.value.includes(row.timeAnchor)));
    assert.ok(found.every(f => !/\b\d{4}-\d{2}-\d{2}\b/u.test(f.value)), 'no invented calendar resolution');
    noAssertedFact(context(row.hypothetical, { lang: row.lang }).value, 'event_time');
    const unavailable = context(row.unavailable, { lang: row.lang }).value;
    nonAbsent(unavailable, 'event_time');
    noAssertedFact(unavailable, 'event_time');
  });

  test(`authored ${row.lang}: completed action sequence is material; a question is not performed actions`, () => {
    rawFact(context(row.steps, { lang: row.lang }), 'reproduction_steps', row.stepAnchor);
    noAssertedFact(context(row.stepQuestion, { lang: row.lang }).value, 'reproduction_steps');
  });

  test(`authored ${row.lang}: explicit device is material; a player called Mac is not a device`, () => {
    rawFact(context(row.device, { lang: row.lang }), 'platform', row.deviceAnchor);
    noAssertedFact(context(row.deviceName, { lang: row.lang }).value, 'platform');
  });

  test(`authored ${row.lang}: paid purchase price is not wallet balance or item quantity`, () => {
    const result = context(row.purchase, { lang: row.lang, focus: 'payment' });
    const found = rawFact(result, 'amount', '73');
    assert.ok(found.every(f => /73/u.test(f.value)));
    noAssertedFact(context(row.balance, { lang: row.lang, focus: 'payment' }).value, 'amount');
  });

  test(`authored ${row.lang}: Unicode material token is neutral and unrelated substrings are not evidence`, () => {
    const result = context(row.evidence, { lang: row.lang, focus: 'complaint' });
    const found = rawFact(result, 'evidence', row.evidenceAnchor);
    assert.equal(result.value.field_states.evidence.state, 'mentioned_uncertain');
    assert.ok(found.every(f => f.value === 'mentioned_unverified'), 'never verify attachment contents');
    assert.equal(facts(context(row.unrelated, { lang: row.lang, focus: 'complaint' }).value, 'evidence').length, 0);
    const denied = context(row.denied, { lang: row.lang, focus: 'complaint' }).value;
    nonAbsent(denied, 'evidence');
    assert.notEqual(denied.field_states.evidence.state, 'supplied');
    assert.ok(facts(denied, 'evidence').every(f => f.value === 'mentioned_unverified'), 'no presence/content inference from a denial');
  });
}

test('authored: quotation, hypothesis and administrative answers cannot supply player facts', () => {
  for (const text of [
    'Someone suggested: "My in-game nickname is Quartz_Heron. The crash happened yesterday evening."',
    'If my in-game nickname were Quartz_Heron, would that change the appeal?',
    'Should I say "I opened the inventory, selected the lamp, then pressed Use"?',
  ]) {
    const result = context(text, { focus: 'account' }).value;
    assert.equal(facts(result, 'participant').length, 0);
    assert.equal(facts(result, 'event_time').length, 0);
    assert.equal(facts(result, 'reproduction_steps').length, 0);
  }
  const result = context('I lost access to my account.', { focus: 'account', extra: {
    messages: [{ role: 'player', text: 'I lost access to my account.' }, { role: 'admin', text: 'My in-game nickname is Quartz_Heron. The crash happened yesterday evening.' }],
    outcome: 'Nickname Quartz_Heron confirmed', admin_reply: 'Nickname Quartz_Heron confirmed',
  } }).value;
  assert.equal(facts(result, 'participant').length, 0);
  assert.equal(facts(result, 'event_time').length, 0);
});

test('authored: contact identifiers and ordinary names are not game identities', () => {
  for (const text of [
    'My name is Talia Marsh. I lost access to my account.',
    'My email is talia@example.invalid. I lost access to my account.',
    'My phone is +1 202 555 0184. I lost access to my account.',
    'I live at 41 Lantern Street. I lost access to my account.',
    'My in-game nickname is talia@example.invalid. I lost access to my account.',
  ]) noAssertedFact(context(text, { focus: 'account' }).value, 'participant');
});

test('authored: message spans refer to original second-message text, not normalized or concatenated text', () => {
  const second = '  Менің ойындағы никім — Cedar_Moth.  ';
  const result = context('unused', { lang: 'kk', focus: 'account', extra: { messages: [
    { role: 'player', text: 'Өз аккаунтыма кіру мүмкіндігін жоғалттым.' },
    { role: 'player', text: second },
  ] } });
  const found = rawFact(result, 'participant', 'Cedar_Moth');
  assert.ok(found.every(f => f.provenance.message_index === 1));
});

test('authored: an admin message before a player does not reindex raw player provenance', () => {
  const result = context('unused', { focus: 'account', extra: { messages: [
    { role: 'admin', text: 'My in-game nickname is Admin_Decoy.' },
    { role: 'player', text: 'My in-game nickname is Cedar_Moth. I lost access to my account.' },
    { role: 'admin', text: 'The player nickname is Final_Decoy.' },
  ] } });
  const found = rawFact(result, 'participant', 'Cedar_Moth');
  assert.ok(found.every(f => f.provenance.message_index === 1), 'index is in original raw messages, not a filtered player array');
  assert.ok(!JSON.stringify(result.value.facts).includes('Decoy'));
});

test('authored: later unavailable declaration prevents reasking without retaining an asserted old value', () => {
  const result = context('unused', { extra: { messages: [
    { role: 'player', text: 'The crash happened yesterday evening.' },
    { role: 'player', text: 'Correction: I cannot remember when the crash happened.' },
  ] } }).value;
  nonAbsent(result, 'event_time');
  noAssertedFact(result, 'event_time');
});

test('authored: material observations preserve human OR, source allowlist and the strict plan contract', () => {
  const { value } = context('My in-game nickname is Cedar_Moth. I lost access to my account yesterday evening.', { focus: 'account', human: true });
  assert.equal(value.needs_human, true);
  assert.deepEqual(value.allowed_sources, []);
  const plan = { schema_version: 'support-plan-v1', focus: value.allowed_focuses[0], fact_ids: value.facts.map(f => f.id), request_fields: [...value.missing_fields], source_ids: [], needs_human: true };
  assert.equal(validatePlan(plan, value).ok, true);
  assert.equal(validatePlan({ ...plan, needs_human: false }, value).ok, false);
  assert.equal(validatePlan({ ...plan, source_ids: ['999:invented'] }, value).ok, false);
  assert.equal(validatePlan({ ...plan, reply: 'uncontracted free prose' }, value).ok, false);
  assert.equal(buildPlanSchema(value).additionalProperties, false);
  assert.ok(buildPlanMessages(value).every(message => typeof message.content === 'string'));
});
