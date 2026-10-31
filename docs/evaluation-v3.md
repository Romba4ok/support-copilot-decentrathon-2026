# Проверка Support Copilot 0.3.0

Source `8b3fe1b413448ab15986ed5365ecd8fa72393d424559983c447b421a01a070d6`; независимая проверка исходников: `7050a024100ad2bbd3a160118145bfc8996759085f4df60ac36eb56c1b3b33f0`. Статус: **VERIFIED_FAST_DELIVERY**. Отчёт отделяет работоспособность протокола, синтетические проверки и качество ответа.

| Проверка | Фактический результат текущего source |
|---|---|
| Обычные тесты | 598 nonheavy PASS,0FAIL;2native SKIP,2realE5 not selected. Отдельно actual extracted public package:598PASS,0FAIL,4modelSKIP;offline npmci PASS;29testfiles/source87 byte exact. |
| HTTP / CLI / GNU Make / local reply workflow | 1217/1217 assertions PASS на14авторских обращениях: actual HTTP,orderedCLI,GNU Make3.81 и R21modelOFF settings/localoutbox/restart. Это не nativeauto-positive и не1000p95 benchmark. |
| Два реальных E5-теста | Actual текущий E5:1000/1000direct и1000/1000HTTP semantic-hybrid;E5worker actualclosed/knownPIDabsent. Два отдельных realE5test на текущем source не запускались; их прежнийPASS не переименован. |
| 1000 paired + 1000 HTTP | 1000 paired+1000HTTP:zeroHTTP/schema/safetyfailures;HTTPp50/p95=17.9522/39.9451ms,max310.0081ms;directp50/p95=15.7979/39.9882ms. |
| Canonical references | 135/135canonicalrefs существуют;121/1000строк с цитатами. Целостность IDs не является relevance/goldquality. |
| Передача человеку | 1000/1000needs_human;mandatory-human violations0. Это консервативная передача, не доказательствоaccuracy илиauto-replycoverage. |
| Recovery | Текущий FAST подтверждает сохранение очереди/правок/feedback/settings приrestart; отдельный forced300+seed recovery выполнен на прежнемeba, не перенесён на текущий source. |
| Docker0.3 | Docker0.3 runtime НЕПРОВЕРЕН:сборка предыдущего кандидата прервана,следующий запуск остановлен RAMpreflight;не заявляетсяcontainerPASS. Dockerfile/локальные команды поставлены отдельно;0.2проверки не перенесены на0.3. |

Последовательный локальный HTTP-замер включает 1000 измеряемых запросов; 20 warmups и первый запрос учитываются отдельно. 20warmups исключены,firstHTTP53.2006ms отдельно;E5initialization11644.9026ms иHTTPstartup43.0761ms отдельно. Script отмечаетexistingindexcache;OSfilecache uncontrolled. Nearest-rankp50/p95 по1000последовательнымизмеряемымзапросам. p50/p95 не являются обещанием под параллельной нагрузкой. Проверка canonical IDs подтверждает существование и целостность ссылок, но сама по себе не оценивает их relevance.

Gold category accuracy / priority macro-F1: **N/A** — N/A: realcategory/prioritygold и экспертные языковые оценки не предоставлены. Нет вымышленных нулевых ошибок классификации или начисленных баллов. Высокий `needs_human` отражает консервативность, а не доказанную точность. Confidence/similarity не калиброваны.

## Полный native-ответ

Статус: **NOT_QUALIFIED**. Восстановленная20-step модель плана сохранена локально. Свежий авторский контроль текущего source:15/24контекстно приемлемых,22/24валидных поschema,6повторныхзапросов сообщённых сведений; порог22/24не достигнут. Grounded fast-черновики на проверяемом детерминированном контексте доступны, но это неLLM output. Routed-модель не включена;operator activation отсутствует,actualR21nativepositive NOTRUN.

Условие допуска: свежий focus не ниже38/42 и минимум4/6 каждого класса; затем полный план не ниже22/24, ноль hard violations и приемлемость тех же generated-строк в agent review всех24. Недоступные/ошибочные строки остаются в знаменателе. Ручная оценка агента не является экспертной или native-speaker оценкой; `human_reviewed=false`. Operator manifest не создаётся по факту одного запуска модели.

Ранее закрытые source имеют только исторический scope: Eba:584public testsPASS/4modelSKIP;1217fast;2realE5;1000HTTPp50/p95=16.7309/36.7963ms;135canonicalrefs;needs_human1000/1000. PLAN11 automated15/24,agentmanual14/24:FAIL. Только прежний source, не итог текущей квалификации.. Их показатели не приписываются текущему коду, не усредняются с новой проверкой и не являются hidden-test accuracy.

## Обучение, стоимость и языки

E5-эмбеддинги и head на1134 авторских TRAIN-примерах; модель JSON-плана — реально восстановленный20-step Qwen3-0.6B (36 TRAIN /12 holdout). 100-step веса потеряны. Ни TRAIN/CV, ни условный TRAIN-plan smoke не являются gold-проверкой нового полного ответа. Реальные обращения и правила не отправлялись в облачное обучение.

Внешние API $0; стоимость локального CPU/электричества неизвестна. Поддерживаются ru/kk/uz/en/es/pt, но экспертная языковая оценка kk/uz не проведена. Требуемые конкурсом hidden category accuracy, priority macro-F1, blind admin draft rating1–5 и native-speaker kk/uz rating остаются внешней оценкой жюри; здесь баллы не назначаются.

## Авторские примеры черновиков

Ниже — три новых синтетических обращения, созданных авторами проекта, и фактические ответы локального HTTP-сервиса. Это примеры режима fast с E5-поиском и детерминированным составлением текста; они не являются выводом дообученной LLM, слепой оценкой качества или данными Grand Mobile. human_reviewed=false. Ссылки на правила в этих платёжных примерах отсутствуют: проверку операции выполняет сотрудник.

### RU

**Обращение:** На сервере Липовый оплатил 250 рублей 30 октября 2026 года с телефона Android. Оплата прошла, покупка не появилась. Идентификатор операции пока не нашёл.

category=report.payment, priority=p0, needs_human=true.

> Здравствуйте!
>
> Для проверки покупки уточним сведения об операции.
>
> В обращении указаны: сервер — «Липовый»; платформа или устройство — «Android»; дата платежа — «30 октября 2026 года»; сумма платежа — «250 рублей».
>
> Пожалуйста, укажите: идентификатор операции.
>
> Обращение требует проверки сотрудником поддержки. Решение принимается после проверки сведений.

### KK

**Обращение:** Мен Android арқылы 2026 жылғы 30 қазанда 700 теңге төледім. Ақша алынды, бірақ сатып алған затым келмеді. Төлем нөмірін әлі таппадым.

category=report.payment, priority=p0, needs_human=true.

> Сәлеметсіз бе!
>
> Сатып алуды тексеру үшін операция мәліметтерін нақтылайық.
>
> Өтініште көрсетілген: платформа немесе құрылғы — «Android»; төлем күні — «30 қазанда»; төлем сомасы — «700 теңге».
>
> Өтінішті қолдау қызметінің маманы тексеруі қажет. Шешім мәліметтер тексерілгеннен кейін қабылданады.

### UZ

**Обращение:** Android telefonim orqali 2026-yil 30-oktabrda 15000 som toladim. Pul yechildi, lekin xaridim kelmadi. Tranzaksiya raqamini hali topmadim.

category=report.payment, priority=p0, needs_human=true.

> Assalomu alaykum!
>
> Xaridni tekshirish uchun operatsiya ma’lumotlarini aniqlashtiramiz.
>
> Murojaatda ko‘rsatilgan: platforma yoki qurilma — «Android»; to‘lov sanasi — «2026-yil 30-oktabrda»; to‘lov summasi — «15000 som».
>
> Murojaatni qo'llab-quvvatlash xodimi tekshirishi kerak. Qaror ma'lumotlar tekshirilgandan keyin qabul qilinadi.
