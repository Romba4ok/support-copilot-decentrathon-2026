> Исторический документ. Текущие проверки и ограничения кандидата 0.3.0 перечислены в [checkpoint-status](checkpoint-status.md); прежние числа не заменяют итоговую проверку.

# Фактическая оценка Support Copilot

Запуск: 2026-10-30 12:33:37 (Asia/Qyzylorda); UTC: 2026-10-30T07:33:37.028Z.

Среда: Node v22.21.0; win32 10.0.26300 x64; CPU AMD Ryzen 5 4500U with Radeon Graphics         , логических процессоров: 6. Режим: local-retrieval-templates; источников правил: 280.

## Предоставленная validation

Обработано 1000 записей. Разметка category: 0; priority: 0. Accuracy и macro-F1 на этой выборке не заявляются: поля исхода из административного ответа не заменяют такую разметку. Исторический lang — эвристика и не используется как языковой gold standard.

Административные сообщения и поля исхода исключены allowlist перед inference. История: только уже обработанные записи того же автора в порядке файла; 161 записей имели предыдущую историю и время. Оценка не использует train, в котором возможны пересечения с valid.

Эскалация: 997/1000 (99.70%). Правила процитированы: 844/1000 (84.40%); точная целостность цитат: 941/941 (100.00%). Ошибок схемы: 0; обращений с ошибками цитат: 0; нарушений обязательной эскалации по таксономии: 0. Проверка цитат проверяет существование, точный текст, namespace раздела и связь cited с черновиком; семантическая релевантность автоматически не измерена.

### Предсказанные категории

| Значение | Количество |
|---|---:|
| complaint.admin | 96 |
| complaint.cheat | 36 |
| complaint.dm | 89 |
| complaint.insult | 202 |
| complaint.invalid | 58 |
| complaint.other | 311 |
| complaint.rmt_ads | 2 |
| complaint.scam | 23 |
| report.complaint | 29 |
| report.help | 22 |
| report.offtopic | 127 |
| report.question | 5 |

### Предсказанные приоритеты

| Значение | Количество |
|---|---:|
| p0 | 4 |
| p1 | 141 |
| p2 | 350 |
| p3 | 505 |

### Предсказанные языки

| Значение | Количество |
|---|---:|
| en | 4 |
| es | 2 |
| kk | 16 |
| pt | 2 |
| ru | 844 |
| uz | 132 |

## Латентность и стоимость

Один процесс; операции последовательные. Инициализация корпуса: 16.969 мс; первый inference до прогрева: 5.659 мс. Затем исключены 20 прогревающих вызовов. Измеренные core-вызовы: 1000; p50 0.082 мс, p95 0.217 мс, max 1.808 мс. Парсинг JSONL, запись отчёта и sanitize вне core-замера, но ядро повторно применяет allowlist. Это локальные измерения, не производственный SLA.

Реальный HTTP POST /triage на ephemeral loopback-порту: concurrency=1, seed=false. Запуск HTTP-сервера 24.964 мс, первый запрос 36.498 мс; 10 прогревающих запросов исключены. Измерены 100 запросов по первым 100 validation-записям в порядке файла, без сохраняемой межзапросной истории. Включены сериализация входа, HTTP и чтение/парсинг ответа. p50 1.704 мс, p95 2.710 мс, max 3.242 мс. HTTP ошибок схемы: 0; ошибок целостности цитат: 0.

Внешних API-вызовов: 0. Стоимость внешних API на обращение: $0.000000. Стоимость локального оборудования, электричества и работы оператора не оценивалась. Порог p95<=5с выполнен в этом последовательном локальном замере.

## Авторский синтетический smoke-набор

35 вручную написанных сценариев; это не экспертная разметка Grand Mobile и не репрезентативная оценка на скрытом тесте. Набор покрывает все 14 категорий, 6 языков, cp1251, угрозы, платежи, взлом, апелляции, FAQ с риском, ложный пункт, injection, отсутствие доказательств и границы дедупликации. Ожидания заданы до запуска; пропущенные поля не входят в знаменатель. Macro-F1 — среднее по объединению ожидаемых и предсказанных классов среди размеченных строк.

| Проверка | Размечено | Результат |
|---|---:|---:|
| Category accuracy | 31 | 100.00% |
| Priority macro-F1 | 27 | 100.00% |
| Язык accuracy | 30 | 100.00% |
| Needs human accuracy | 32 | 100.00% |
| Сценарии со всеми ожиданиями | 35 | 35 |

Все заданные ожидания авторского набора выполнены.

Согласованная политика срочности опирается на содержание и риски. Число вложений и заявление о доказательствах не устанавливают нарушение и сами по себе не повышают приоритет. Это явно выбранное разрешение противоречия taxonomy (жалоба с доказательствами p1) и примера задания (оскорбление с вложениями p2).

## Примеры черновиков — только синтетические

### Синтетический пример ru-insult

Авторский вход: Igor_Smirnov оскорбил меня в чате.

Черновик (ru; needs_human=true):

> Здравствуйте!
>
> Вы сообщаете о ситуации, которую требуется уточнить.
>
> К описанной ситуации может относиться ОП 2.1. Применимость правила и обстоятельства должен проверить администратор.
>
> Укажите, что произошло, ник участника, сервер и время события. Если есть материалы, приложите полную запись или скриншоты.
>
> Обращение требует проверки сотрудником поддержки. Решение принимается после проверки сведений.

### Синтетический пример kk-payment

Авторский вход: Төлем жасадым, бірақ ақша келмеді. Көмектесіңізші.

Черновик (kk; needs_human=true):

> Сәлеметсіз бе!
>
> Сіз сипаттаған жағдайды нақтылау қажет.
>
> Төлем күнін, платформаны, соманы және операция нөмірін жазыңыз. Карта нөмірін, құпиясөзді немесе бір реттік кодтарды жібермеңіз.
>
> Өтінішті қолдау қызметінің маманы тексеруі қажет. Шешім мәліметтер тексерілгеннен кейін қабылданады.

### Синтетический пример uz-insult

Авторский вход: O'yinchi meni haqorat qildi, shikoyatimni tekshirib bering.

Черновик (uz; needs_human=true):

> Assalomu alaykum!
>
> Siz tasvirlagan holatni aniqlashtirish kerak.
>
> Tasvirlangan vaziyatga quyidagi qoida tegishli bo'lishi mumkin: ОП 2.1. Qoidaning qo'llanishi va holatni administrator tekshirishi kerak.
>
> Nima bo'lganini, ishtirokchi taxallusini, serverni va hodisa vaqtini yozing. Mavjud bo'lsa, to'liq video yoki skrinshotlarni ilova qiling.
>
> Murojaatni qo'llab-quvvatlash xodimi tekshirishi kerak. Qaror ma'lumotlar tekshirilgandan keyin qabul qilinadi.

## Ограничения и воспроизведение

- Citation checks verify source existence, exact text, section namespace and labels; they do not establish semantic relevance.
- No independent expert category/priority labels, administrator blind review or kk/uz native-speaker review are available.
- Synthetic author labels check selected examples only; they are not a held-out representative quality estimate.
- Confidence is heuristic, not a calibrated probability.
- Cold engine initialization, first inference and warmed core timings are separate; HTTP measures sequential loopback on this machine, without production concurrency or network.
- Priority follows approved content-risk policy: attachment count and claimed evidence alone do not prove violation or increase urgency. This resolves the source taxonomy/example inconsistency.

Запуск: npm run evaluate. Данные читаются из ../handout/tickets_valid.jsonl; DATA_DIR задаёт каталог rules.json/taxonomy.json. Необязательный --input задаёт другой приватный JSONL. В консоль и этот документ попадают только агрегаты и авторские синтетические примеры. Полные предсказания и JSON-метрики сохраняются только в исключённом artifacts/private/. Временный HTTP runtime удаляется после измерения.

Exit code 1 означает ошибку схемы/целостности цитат/обязательной эскалации; классификационные и языковые расхождения сообщаются отдельно без сокрытия. Не выполнены экспертная слепая оценка черновиков, оценка носителями kk/uz и нагрузочное тестирование с параллельными клиентами.
