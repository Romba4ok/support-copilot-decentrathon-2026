import { writeFileSync } from 'node:fs';
const langs = ['ru', 'en', 'kk', 'uz', 'es', 'pt'];
const scenarios = [
  ['purchase-arrival', true, 'payment', ['payment_date', 'platform', 'transaction_id', 'amount'], [
    'Оплатил покупку, но ничего не получил. Сервер 77.', 'I paid for a purchase but received nothing. Server 77.', 'Төлем жасадым, бірақ сатып алғаным келмеді. Сервер 77.', "To‘lov qildim, ammo xarid kelmadi. Server 77.", 'Pagué una compra pero no recibí nada. Servidor 77.', 'Paguei uma compra mas não recebi nada. Servidor 77.',
  ]],
  ['lost-access', true, 'account', ['event_time', 'platform'], [
    'Аккаунт взломали, я потерял доступ. Сервер 77.', 'My account was hacked and I lost access. Server 77.', 'Аккаунтым бұзылды, енді кіре алмаймын. Сервер 77.', "Akkauntim buzib kirildi, endi kira olmayman. Server 77.", 'Mi cuenta fue robada y no puedo entrar. Servidor 77.', 'Minha conta foi invadida e perdi o acesso. Servidor 77.',
  ]],
  ['hostile-chat', true, 'complaint', ['participant', 'event_time', 'evidence'], [
    'Другой игрок оскорблял меня в чате. Сервер 77.', 'Another player insulted me in chat. Server 77.', 'Басқа ойыншы мені чатта балағаттады. Сервер 77.', "Boshqa o‘yinchi meni chatda haqorat qildi. Server 77.", 'Otro jugador me insultó en el chat. Servidor 77.', 'Outro jogador me ofendeu no chat. Servidor 77.',
  ]],
  ['garage-stuck', true, 'technical', ['location', 'event_time', 'reproduction_steps'], [
    'Застрял под текстурами около гаража. Сервер 77.', 'I am stuck under the map near a garage. Server 77.', 'Гараж жанында тұрып қалдым, қозғала алмаймын. Сервер 77.', "Garaj yonida qotib qoldim, qimirlolmayman. Server 77.", 'Estoy atascado debajo del mapa cerca de un garaje. Servidor 77.', 'Estou preso debaixo do mapa perto de uma garagem. Servidor 77.',
  ]],
  ['hello-help', false, 'clarification', ['server'], ['Здравствуйте!', 'Hello!', 'Сәлем!', 'Salom!', 'Hola!', 'Olá!']],
  ['gratitude-only', false, 'clarification', [], ['Спасибо!', 'Thanks!', 'Рақмет!', 'Rahmat!', 'Gracias!', 'Obrigado!']],
  ['initial-clarification', true, 'clarification', ['problem_description'], [
    'Мне нужна помощь, подскажите, пожалуйста.', 'I need some help, please.', 'Маған көмек керек, өтінемін.', 'Menga yordam kerak, iltimos.', 'Necesito ayuda, por favor.', 'Preciso de ajuda, por favor.',
  ]],
  ['dm-meaning', false, 'question', ['server'], ['Что такое DM?', 'What is DM?', 'DM деген не?', 'DM nima?', '¿Qué es DM?', 'O que é DM?']],
  ['rp-meaning', false, 'question', ['server'], ['Что такое RP?', 'What is RP?', 'RP деген не?', 'RP nima?', '¿Qué es RP?', 'O que é RP?']],
  ['filing-howto', false, 'question', ['server'], [
    'Как правильно оформить жалобу и какие сведения нужны?', 'How do I submit a complaint and what information is needed?', 'Шағым беру үшін қандай ақпарат керек?', 'Shikoyat yuborish uchun qanday ma’lumot kerak?', '¿Cómo presentar una queja y qué información necesito?', 'Como enviar uma reclamação e quais informações são necessárias?',
  ]],
];
const rows = scenarios.flatMap(([group_id, expected_needs_human, focus, request_fields, messages]) => {
  const incident = expected_needs_human && group_id !== 'initial-clarification';
  return messages.map((text, i) => ({ id: `${group_id}-${langs[i]}`, group_id, provenance: { type: 'authored_synthetic', author: 'Support Copilot project, newly authored with AI assistance', human_reviewed: false, contains_private_data: false, cloud_eligible: true }, input: { kind: 'report', lang: langs[i], ...(incident ? { server: '77' } : {}), messages: [{ role: 'player', text }] }, expected_needs_human, intent: { focus, fact_fields: incident ? ['server'] : [], request_fields } }));
});
writeFileSync(new URL('../fixtures/training-plan-author-synthetic.jsonl', import.meta.url), rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
console.log(JSON.stringify({ examples: rows.length, scenario_groups: scenarios.length, provenance: 'authored_synthetic', human_reviewed: false }));
