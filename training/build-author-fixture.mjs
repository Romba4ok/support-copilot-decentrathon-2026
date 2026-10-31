import { writeFileSync } from 'node:fs';

// All messages and guidance below are newly authored synthetic examples.
// Group IDs deliberately keep translations/paraphrases of one scenario together.
const scenarios = [
  ['payment-missing', 'A missing purchase needs human review. Ask for purchase time, platform and transaction identifier; never request card details or promise a refund.', [
    ['ru', 'Оплатил донат, но покупка не появилась.', 'Для проверки покупки нужен сотрудник. Уточните время оплаты, платформу и идентификатор операции. Не отправляйте реквизиты карты или коды.', true],
    ['en', 'My payment went through but the purchase is missing.', 'A staff member needs to review the missing purchase. Please provide the purchase time, platform and transaction identifier. Do not send card details or security codes.', true],
  ]],
  ['account-access', 'Loss of account access needs human review. Ask when access was lost and what error appeared. Never request passwords or promise recovery.', [
    ['pt', 'Minha conta foi invadida e perdi o acesso.', 'A perda de acesso precisa da análise de um responsável. Informe quando aconteceu e qual erro aparece. Não envie senhas nem códigos de acesso.', true],
    ['es', 'Alguien entró en mi cuenta y ya no puedo acceder.', 'La pérdida de acceso requiere revisión de una persona. Indica cuándo ocurrió y qué error aparece. No envíes contraseñas ni códigos.', true],
  ]],
  ['admin-appeal', 'An appeal requires human review. Ask for server, date and stated reason. Do not decide guilt or promise reversal.', [
    ['kk', 'Маған себепсіз жаза берілді, тексеруді сұраймын.', 'Жазаға қатысты өтінішті қызметкер тексеруі керек. Серверді, күнін және көрсетілген себебін жазыңыз. Шешім тексеруден кейін қабылданады.', true],
    ['uz', 'Menga sababsiz jazo berildi, qayta tekshirishni so‘rayman.', 'Jazo bo‘yicha murojaatni xodim tekshirishi kerak. Server, sana va ko‘rsatilgan sababni yozing. Qaror tekshiruvdan keyin qabul qilinadi.', true],
  ]],
  ['real-threat', 'A threat outside the game requires urgent human review. Ask for event time and the available report materials. Claims are unverified.', [
    ['ru', 'Игрок угрожает найти мой адрес и семью в реальной жизни.', 'Угроза вне игры требует срочной проверки человеком. Укажите время события и какие материалы вы можете предоставить. Содержание угроз ещё не проверено.', true],
    ['en', 'Another player threatened to find my family outside the game.', 'A threat outside the game needs urgent human review. Please provide the event time and describe the materials you can provide. The allegation has not been verified.', true],
  ]],
  ['chat-insult', 'A chat insult allegation requires human review. Ask for server, time and participants. Do not confirm a violation or claim to have watched evidence.', [
    ['kk', 'Мені чатта балағаттады, шағымымды қараңыз.', 'Чаттағы оқиғаны қызметкер тексеруі керек. Серверді, уақытын және қатысушыларды көрсетіңіз. Хабарламаңыздағы мәлімдеме әзірге тексерілмеген.', true],
    ['uz', 'Meni chatda haqorat qilishdi, shikoyatimni ko‘ring.', 'Chatdagi voqeani xodim tekshirishi kerak. Server, vaqt va ishtirokchilarni ko‘rsating. Xabaringizdagi da’vo hali tekshirilmagan.', true],
  ]],
  ['property-scam', 'A property scam allegation requires human review. Ask for agreed terms, time and participants without confirming fraud.', [
    ['es', 'Entregué el dinero por un coche y la otra persona no lo entregó.', 'La situación necesita revisión de una persona. Describe lo acordado, el momento y los participantes. El relato no confirma por sí solo una infracción.', true],
    ['pt', 'Paguei pelo carro e a outra pessoa não entregou o veículo.', 'A situação precisa de análise por uma pessoa. Descreva o acordo, o horário e os participantes. O relato sozinho não confirma uma infração.', true],
  ]],
  ['stuck-location', 'A technical stuck-location report needs a location, server, time and reproduction steps. Do not invent commands or promise teleportation.', [
    ['ru', 'После входа застрял под текстурами у гаража.', 'Уточните сервер, время и точное место у гаража. Опишите действия перед появлением проблемы. Для проверки и дальнейшей помощи нужен сотрудник.', true],
    ['en', 'After joining I became stuck under the map near a garage.', 'Please provide the server, time and exact garage location. Describe the steps before the problem appeared. A staff member needs to review the issue and next steps.', true],
  ]],
  ['crash-reproduction', 'A repeated crash needs device/platform, game version, server and reproduction steps. No diagnosis is confirmed.', [
    ['kk', 'Ойынға кірген сайын қосымша жабылып қалады.', 'Құрылғыны, платформаны, ойын нұсқасын және серверді жазыңыз. Қосымша жабылар алдындағы қадамдарды сипаттаңыз. Себебін қызметкер тексеруі керек.', true],
    ['uz', 'O‘yinga har kirganimda ilova yopilib qoladi.', 'Qurilma, platforma, o‘yin versiyasi va serverni yozing. Ilova yopilishidan oldingi qadamlarni tasvirlang. Sababni xodim tekshirishi kerak.', true],
  ]],
  ['cheat-allegation', 'An allegation of cheating requires human review. Ask for server, event time and observed behavior. Do not equate an allegation or attachment count with proof.', [
    ['es', 'Creo que otro jugador dispara a través de las paredes.', 'Lo que describes necesita revisión de una persona. Indica el servidor, la hora y el comportamiento observado. La sospecha por sí sola no demuestra una infracción.', true],
    ['pt', 'Suspeito que um jogador atira através das paredes.', 'O comportamento descrito precisa de análise por uma pessoa. Informe o servidor, o horário e o que observou. A suspeita por si só não comprova uma infração.', true],
  ]],
  ['missing-item', 'A missing item requires human review. Ask when it was last seen, server and event sequence. Do not promise restoration.', [
    ['ru', 'После перезахода из аккаунта исчезла машина.', 'Для проверки пропажи нужен сотрудник. Укажите сервер, когда машину видели в последний раз и что произошло перед перезаходом.', true],
    ['en', 'My vehicle disappeared from the account after reconnecting.', 'A staff member needs to review the missing vehicle. Please provide the server, when it was last visible and the steps before reconnecting.', true],
  ]],
  ['unverified-attachments', 'Attached material metadata is not evidence review. Ask what the material shows and the time, and keep human review.', [
    ['kk', 'Бейне тіркелген, ойыншы мені себепсіз өлтірді.', 'Оқиғаны қызметкер тексеруі керек. Бейнеде не көрсетілгенін, серверді және уақытын жазыңыз. Қосымшаның болуы оның мазмұны тексерілді дегенді білдірмейді.', true],
    ['uz', 'Video ilova qilingan, o‘yinchi meni sababsiz o‘ldirdi.', 'Voqeani xodim tekshirishi kerak. Videoda nima ko‘rsatilganini, server va vaqtni yozing. Ilova borligi uning mazmuni tekshirilganini anglatmaydi.', true],
  ]],
  ['greeting-clarification', 'A plain greeting can receive a short safe clarification. Ask what help is needed; no decision about an incident is made.', [
    ['ru', 'Здравствуйте!', 'Здравствуйте! Опишите, какая помощь нужна, и укажите сервер, если вопрос связан с конкретной ситуацией.', false],
    ['en', 'Hello!', 'Hello! Please describe what you need help with and include the server if your question concerns a particular situation.', false],
  ]],
];
const rows = scenarios.flatMap(([group_id, guidance, variants]) => variants.map(([lang, message, reply, needs_human], index) => ({ id: `${group_id}-${index + 1}`, group_id, provenance: { type: 'authored_synthetic', author: 'Support Copilot project synthetic examples, authored with AI assistance', human_reviewed: false, contains_private_data: false, cloud_eligible: true }, input: { kind: 'report', lang, messages: [{ role: 'player', text: message }] }, guidance, target: { reply, source_ids: [], needs_human } })));
writeFileSync(new URL('../fixtures/training-author-synthetic.jsonl', import.meta.url), rows.map(row => JSON.stringify(row)).join('\n') + '\n', 'utf8');
console.log(`Wrote ${rows.length} authored synthetic examples in ${scenarios.length} scenario groups.`);
