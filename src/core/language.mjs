export const SUPPORTED_LANGUAGES = ['ru', 'kk', 'uz', 'en', 'es', 'pt'];

export function normalizeText(value) {
  const replacements = { 'ќ': 'қ', 'ґ': 'ғ', 'ѕ': 'ң', 'є': 'ә', 'ј': 'ө', 'ў': 'ұ', 'ї': 'ү' };
  return String(value).normalize('NFKC').toLowerCase()
    .replace(/[ќґѕєјўї]/gu, char => replacements[char])
    .replace(/[’‘ʻʼ`]/gu, "'").replace(/\s+/gu, ' ').trim();
}

const languageTerms = {
  ru: ['меня', 'мне', 'помогите', 'игрок', 'оскорб', 'убил', 'застр', 'аккаунт', 'плат', 'деньги', 'не приш', 'без причин', 'жалоб', 'админ', 'забан', 'мут', 'взлом', 'чит', 'правил', 'дм', 'вопрос', 'такое', 'оформ', 'привет', 'спасибо'],
  kk: ['маған', 'мені', 'көмек', 'көмект', 'ойыншы', 'шағым', 'ақша', 'төлем', 'есептік', 'аккаунтым', 'бұз', 'өлтір', 'дәлел', 'қалай', 'себепсіз', 'қайтар', 'келмеді', 'бұғат'],
  uz: ['menga', 'meni', 'yordam', 'iltimos', 'oyinchi', "o'yinchi", 'shikoyat', 'pul', 'tolov', "to'lov", 'sok', "so'k", 'haqorat', 'oldir', "o'ldir", 'sababsiz', 'akkaunt', 'qanday', 'bering', 'keldi', 'kelmadi', 'buzib', 'parol', 'dalil', 'qaytar'],
  en: ['help', 'please', 'player', 'account', 'payment', 'paid', 'money', 'refund', 'hacked', 'cheat', 'insult', 'killed', 'stuck', 'without reason', 'how', 'where', 'banned', 'appeal', 'received', 'administrator', 'threat'],
  es: ['ayuda', 'jugador', 'cuenta', 'pago', 'pagué', 'dinero', 'insult', 'mató', 'mato', 'atascado', 'atrapado', 'sin motivo', 'cómo', 'como', 'dónde', 'donde', 'devuelvan', 'reembolso', 'bane', 'administrador', 'amenaza'],
  pt: ['ajuda', 'jogador', 'conta', 'pagamento', 'paguei', 'dinheiro', 'xing', 'matou', 'preso', 'travado', 'sem motivo', 'como', 'onde', 'reembolso', 'banid', 'administrador', 'ameaça', 'recebi', 'invad'],
};

export function detectLanguage(text, metadata = {}) {
  const clean = text.replace(/<(?:url|email|handle|digits)>/giu, ' ').replace(/https?:\/\/\S+/giu, ' ');
  const scores = Object.fromEntries(SUPPORTED_LANGUAGES.map(lang => [lang, 0]));
  for (const [lang, terms] of Object.entries(languageTerms)) {
    for (const term of terms) if (clean.includes(term)) scores[lang] += term.length > 4 ? 2 : 1;
  }
  if (/[қғңәөұүһ]/u.test(clean)) scores.kk += 7;
  else if (/[а-я]/u.test(clean)) scores.ru += 2;
  if (/[ыэёъщ]/u.test(clean)) scores.ru += 1;
  if (/\b(?:eu|meu|minha|não|voce|você|uma|isso|por favor)\b/u.test(clean)) scores.pt += 5;
  if (/\b(?:ele|ela|insultou|xingou|matou|paguei|recebi|invadiram)\b/u.test(clean) || /\bno chat\b/u.test(clean)) scores.pt += 5;
  if (/\bo que\b|\bquais\b/u.test(clean)) scores.pt += 5;
  if (/\b(?:mi|yo|una|este|estoy|por favor|necesito|robaron)\b/u.test(clean)) scores.es += 3;
  if (/(?:insultó|mató|pagué|ayúd|desbloque|¿|¡|qué)/u.test(clean) || /\ben el chat\b|\bque es\b/u.test(clean)) scores.es += 5;
  if (/\b(?:i|my|the|is|was|someone|cannot|did|not|what|how)\b/u.test(clean)) scores.en += 3;
  if (/\b(?:men|siz|va|uchun|qildi|yoq|yo'q|mashina|berdi|iltimos|nima)\b/u.test(clean)) scores.uz += 4;
  if (/деген|нені білдіреді/u.test(clean)) scores.kk += 5;
  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [best, score] = ordered[0];
  const fallback = SUPPORTED_LANGUAGES.includes(metadata.lang) ? metadata.lang
    : SUPPORTED_LANGUAGES.includes(metadata.server_lang) ? metadata.server_lang : /[а-я]/u.test(clean) ? 'ru' : 'en';
  return { lang: score > 0 ? best : fallback, uncertain: score < 2 || (ordered[1][1] > 0 && ordered[1][1] >= score - 1), scores };
}

export const replies = {
  ru: {
    greeting: 'Здравствуйте!', received: 'Вы сообщаете о ситуации, которую требуется уточнить.',
    request: 'Укажите, что произошло, ник участника, сервер и время события. Если есть материалы, приложите полную запись или скриншоты.',
    materials: 'Наличие материалов указано в обращении; их содержимое сервис не проверял.',
    human: 'Обращение требует проверки сотрудником поддержки. Решение принимается после проверки сведений.',
    rule: 'К описанной ситуации может относиться', conditional: 'Применимость правила и обстоятельства должен проверить администратор.',
    duplicate: 'Похоже, это повтор вашего недавнего обращения об этой же ситуации. Связанные обращения отмечены для совместного рассмотрения.',
    payment: 'Уточните дату платежа, платформу, сумму и идентификатор операции без платежных реквизитов. Не присылайте номер карты, пароль или одноразовые коды.',
    account: 'Опишите проблему с доступом или имуществом и когда вы ее заметили. Не сообщайте пароль и одноразовые коды.',
    appeal: 'Укажите ник, сервер, дату и причину наказания, а также имеющиеся материалы для проверки.',
    help: 'Опишите, где и при каких действиях возникает проблема, укажите сервер и время. Это поможет сотруднику выбрать следующий шаг.',
    question: 'Уточните ваш вопрос и действие, которое вы пытаетесь выполнить. В имеющихся источниках может не быть точной инструкции.',
  },
  kk: {
    greeting: 'Сәлеметсіз бе!', received: 'Сіз сипаттаған жағдайды нақтылау қажет.',
    request: 'Не болғанын, қатысушының лақап атын, серверді және оқиға уақытын жазыңыз. Бар болса, толық бейнежазбаны немесе скриншоттарды тіркеңіз.',
    materials: 'Өтініште материалдар бар екені көрсетілген; сервис олардың мазмұнын тексерген жоқ.',
    human: 'Өтінішті қолдау қызметінің маманы тексеруі қажет. Шешім мәліметтер тексерілгеннен кейін қабылданады.',
    rule: 'Сипатталған жағдайға мына тармақ қатысты болуы мүмкін:', conditional: 'Ереженің қолданылуын және жағдайды әкімші тексеруі керек.',
    duplicate: 'Бұл сол жағдай туралы жақында жіберген өтінішіңіздің қайталануы болуы мүмкін. Өтініштер бірге қарау үшін байланыстырылды.',
    payment: 'Төлем күнін, платформаны, соманы және операция нөмірін жазыңыз. Карта нөмірін, құпиясөзді немесе бір реттік кодтарды жібермеңіз.',
    account: 'Аккаунтқа кіру немесе мүлік мәселесін және оны қашан байқағаныңызды сипаттаңыз. Құпиясөз бен бір реттік кодтарды жібермеңіз.',
    appeal: 'Лақап атыңызды, серверді, жаза күнін және себебін көрсетіп, тексеруге арналған материалдарды тіркеңіз.',
    help: 'Мәселе қай жерде және қандай әрекет кезінде туындайтынын, серверді және уақытты жазыңыз.',
    question: 'Сұрағыңызды және қандай әрекет жасағыңыз келетінін нақтылаңыз. Қолда бар дереккөздерде нақты нұсқаулық болмауы мүмкін.',
  },
  uz: {
    greeting: 'Assalomu alaykum!', received: 'Siz tasvirlagan holatni aniqlashtirish kerak.',
    request: "Nima bo'lganini, ishtirokchi taxallusini, serverni va hodisa vaqtini yozing. Mavjud bo'lsa, to'liq video yoki skrinshotlarni ilova qiling.",
    materials: "Murojaatda materiallar borligi ko'rsatilgan; xizmat ularning mazmunini tekshirmagan.",
    human: "Murojaatni qo'llab-quvvatlash xodimi tekshirishi kerak. Qaror ma'lumotlar tekshirilgandan keyin qabul qilinadi.",
    rule: "Tasvirlangan vaziyatga quyidagi qoida tegishli bo'lishi mumkin:", conditional: "Qoidaning qo'llanishi va holatni administrator tekshirishi kerak.",
    duplicate: "Bu yaqinda shu holat bo'yicha yuborgan murojaatingizning takrori bo'lishi mumkin. Murojaatlar birgalikda ko'rib chiqish uchun bog'landi.",
    payment: "To'lov sanasi, platforma, summa va operatsiya raqamini yozing. Karta raqami, parol yoki bir martalik kodlarni yubormang.",
    account: "Akkauntga kirish yoki mulk muammosini va uni qachon sezganingizni yozing. Parol yoki bir martalik kodlarni yubormang.",
    appeal: "Taxallus, server, jazo sanasi va sababini yozing, tekshirish uchun mavjud materiallarni ilova qiling.",
    help: "Muammo qayerda va qaysi harakatda yuz berishini, server va vaqtni yozing.",
    question: "Savolingizni va nima qilmoqchi ekaningizni aniqlashtiring. Mavjud manbalarda aniq yo'riqnoma bo'lmasligi mumkin.",
  },
  en: {
    greeting: 'Hello!', received: 'The situation you describe needs clarification.',
    request: 'Describe what happened, the participant nickname, server and event time. Attach a complete recording or screenshots if available.',
    materials: 'The ticket indicates that materials exist; this service has not inspected their contents.',
    human: 'A support staff member needs to review this ticket. A decision can be made after checking the information.',
    rule: 'The following rule may apply to the described situation:', conditional: 'An administrator must verify its applicability and the circumstances.',
    duplicate: 'This appears to repeat your recent ticket about the same situation. The tickets have been linked for review.',
    payment: 'Provide the payment date, platform, amount and transaction identifier without payment credentials. Do not share card numbers, passwords or one-time codes.',
    account: 'Describe the access or property issue and when you noticed it. Do not share passwords or one-time codes.',
    appeal: 'Provide your nickname, server, punishment date and stated reason, with any materials available for review.',
    help: 'Describe where and during which action the problem occurs, including the server and time.',
    question: 'Please clarify your question and what you are trying to do. The available sources may not contain an exact instruction.',
  },
  es: {
    greeting: '¡Hola!', received: 'La situación que describes necesita aclaración.',
    request: 'Describe lo ocurrido, el apodo del participante, el servidor y la hora. Adjunta una grabación completa o capturas si las tienes.',
    materials: 'El mensaje indica que hay materiales; este servicio no ha revisado su contenido.',
    human: 'Un miembro del equipo de soporte debe revisar esta solicitud. La decisión se tomará tras comprobar la información.',
    rule: 'La siguiente norma podría ser pertinente para la situación descrita:', conditional: 'Un administrador debe comprobar su aplicación y las circunstancias.',
    duplicate: 'Parece una repetición de tu solicitud reciente sobre el mismo incidente. Las solicitudes se han vinculado para su revisión.',
    payment: 'Indica la fecha del pago, la plataforma, el importe y el identificador de la operación. No envíes números de tarjeta, contraseñas ni códigos de un solo uso.',
    account: 'Describe el problema de acceso o de bienes y cuándo lo detectaste. No envíes contraseñas ni códigos de un solo uso.',
    appeal: 'Indica tu apodo, servidor, fecha y motivo de la sanción, junto con los materiales disponibles.',
    help: 'Describe dónde y durante qué acción ocurre el problema, con el servidor y la hora.',
    question: 'Aclara tu pregunta y qué intentas hacer. Las fuentes disponibles pueden no contener una instrucción exacta.',
  },
  pt: {
    greeting: 'Olá!', received: 'A situação descrita precisa de esclarecimento.',
    request: 'Descreva o ocorrido, o apelido do participante, o servidor e o horário. Anexe uma gravação completa ou capturas de tela, se disponíveis.',
    materials: 'O chamado indica a existência de materiais; este serviço não verificou o conteúdo.',
    human: 'Um membro da equipe de suporte precisa analisar este chamado. A decisão será tomada após a verificação das informações.',
    rule: 'A seguinte regra pode ser pertinente à situação descrita:', conditional: 'Um administrador deve verificar a aplicação da regra e as circunstâncias.',
    duplicate: 'Este chamado parece repetir um chamado recente seu sobre a mesma situação. Os chamados foram vinculados para análise.',
    payment: 'Informe a data do pagamento, a plataforma, o valor e o identificador da transação. Não envie números de cartão, senhas ou códigos de uso único.',
    account: 'Descreva o problema de acesso ou de bens e quando o percebeu. Não envie senhas ou códigos de uso único.',
    appeal: 'Informe seu apelido, servidor, data e motivo da punição, com os materiais disponíveis para análise.',
    help: 'Descreva onde e durante qual ação o problema ocorre, incluindo o servidor e o horário.',
    question: 'Esclareça sua pergunta e o que está tentando fazer. As fontes disponíveis podem não conter uma instrução exata.',
  },
};

export const informationalReplies = {
  ru: {
    notice: 'Это справочная информация или уточнение; решение по нарушению не принималось.',
    glossaryDM: 'DM (DeathMatch) — убийство или попытка убийства без основательной для этого RP-причины.',
    glossaryRP: 'RP (RolePlay) — игра по ролям: игрок действует в роли своего персонажа.',
    filing: 'Для жалобы нужны понятное описание события, корректный ник участника и полные доказательства. Если выдано наказание, приложите его скриншот. На каждого участника оформляется отдельная жалоба.',
    evidence: 'Материалы должны ясно показывать событие и участников. На видео должны читаться интерфейс и текст, а звук должен быть разборчивым. Сервис не оценивает содержимое вложений.',
    source: 'Основание в правилах:',
    greeting: 'Уточните, пожалуйста, с каким вопросом или ситуацией вы обращаетесь.',
  },
  kk: {
    notice: 'Бұл анықтамалық ақпарат немесе нақтылау; бұзушылық бойынша шешім қабылданған жоқ.',
    glossaryDM: 'DM (DeathMatch) — негізді RP-себепсіз ойыншыны өлтіру немесе өлтіруге әрекет жасау.',
    glossaryRP: 'RP (RolePlay) — ойыншы өз кейіпкерінің рөлін ойнайтын ойын тәртібі.',
    filing: 'Шағымда оқиғаның түсінікті сипаттамасы, қатысушының дұрыс лақап аты және толық дәлелдер болуы керек. Жаза берілсе, оның скриншотын тіркеңіз. Әр қатысушыға бөлек шағым беріледі.',
    evidence: 'Материалдар оқиғаны және қатысушыларды анық көрсетуі керек. Бейнеде интерфейс пен мәтін оқылуы, дыбыс анық естілуі қажет. Сервис тіркемелердің мазмұнын бағаламайды.',
    source: 'Ережелердегі негіз:', greeting: 'Қандай сұрақпен немесе жағдаймен хабарласқаныңызды нақтылаңыз.',
  },
  uz: {
    notice: "Bu ma'lumot yoki aniqlashtirish; qoidabuzarlik bo'yicha qaror qabul qilinmagan.",
    glossaryDM: "DM (DeathMatch) — asosli RP-sababsiz o'yinchini o'ldirish yoki o'ldirishga urinish.",
    glossaryRP: "RP (RolePlay) — har bir o'yinchi o'z personaji rolini ijro etadigan o'yin tartibi.",
    filing: "Shikoyatda voqeaning tushunarli tavsifi, ishtirokchining to'g'ri taxallusi va to'liq dalillar bo'lishi kerak. Jazo berilgan bo'lsa, uning skrinshotini ilova qiling. Har bir ishtirokchi uchun alohida shikoyat yuboriladi.",
    evidence: "Materiallarda voqea va ishtirokchilar aniq ko'rinishi kerak. Videoda interfeys va matn o'qilishi, ovoz tushunarli bo'lishi kerak. Xizmat ilovalar mazmunini baholamaydi.",
    source: 'Qoidalardagi asos:', greeting: 'Qaysi savol yoki vaziyat yuzasidan murojaat qilayotganingizni aniqlashtiring.',
  },
  en: {
    notice: 'This is information or a clarification; no decision about a violation has been made.',
    glossaryDM: 'DM (DeathMatch) means killing or attempting to kill a player without a substantial RP reason.',
    glossaryRP: 'RP (RolePlay) is a mode in which each player acts in the role of their character.',
    filing: 'A complaint needs a clear account of the event, the correct participant nickname and complete evidence. Include a screenshot of a punishment if one was issued. File a separate complaint for each participant.',
    evidence: 'Materials must clearly show the event and participants. Video interfaces and text must be readable, with intelligible sound. This service does not assess attachment contents.',
    source: 'Rule sources:', greeting: 'Please clarify your question or describe the situation you need help with.',
  },
  es: {
    notice: 'Esto es información o una aclaración; no se ha tomado ninguna decisión sobre una infracción.',
    glossaryDM: 'DM (DeathMatch) significa matar o intentar matar a un jugador sin un motivo RP justificado.',
    glossaryRP: 'RP (RolePlay) es un modo en el que cada jugador interpreta el papel de su personaje.',
    filing: 'La queja necesita una descripción clara del suceso, el apodo correcto del participante y pruebas completas. Si hubo una sanción, adjunta una captura. Presenta una queja separada por cada participante.',
    evidence: 'Los materiales deben mostrar claramente el suceso y los participantes. La interfaz y el texto del vídeo deben ser legibles y el sonido comprensible. Este servicio no evalúa el contenido de los archivos adjuntos.',
    source: 'Fuentes de las normas:', greeting: 'Aclara tu pregunta o describe la situación para la que necesitas ayuda.',
  },
  pt: {
    notice: 'Esta é uma informação ou um esclarecimento; nenhuma decisão sobre uma infração foi tomada.',
    glossaryDM: 'DM (DeathMatch) significa matar ou tentar matar um jogador sem uma razão RP fundamentada.',
    glossaryRP: 'RP (RolePlay) é um modo em que cada jogador interpreta o papel do seu personagem.',
    filing: 'A reclamação precisa de uma descrição clara do ocorrido, do apelido correto do participante e de provas completas. Se houve punição, anexe uma captura. Envie uma reclamação separada para cada participante.',
    evidence: 'Os materiais devem mostrar claramente o ocorrido e os participantes. A interface e o texto do vídeo devem ser legíveis, com som compreensível. Este serviço não avalia o conteúdo dos anexos.',
    source: 'Fontes das regras:', greeting: 'Esclareça sua pergunta ou descreva a situação para a qual precisa de ajuda.',
  },
};
