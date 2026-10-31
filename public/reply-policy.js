"use strict";

const responsePolicyState = { mode: null, revision: null, loading: false, saving: false, sequence: 0, replies: new Map(), timers: new Map() };
const responseDialog = $('#response-policy-dialog');
const responseModeButton = $('#open-response-policy');

function responsePolicyError(message) {
  const element = $('#response-policy-error'); element.textContent = message; element.hidden = !message;
}
function renderResponseMode() {
  const { mode, loading, saving } = responsePolicyState;
  responseModeButton.textContent = loading ? 'Режим ответа…' : mode === 'auto' ? 'Ответы: авто' : mode === 'review' ? 'Ответы: сотрудник' : 'Режим ответа';
  responseModeButton.classList.toggle('response-mode-auto',mode === 'auto');
  responseModeButton.disabled = loading || saving;
  responseModeButton.setAttribute('aria-label',mode === 'auto' ? 'Режим ответа: автоматический. Изменить' : mode === 'review' ? 'Режим ответа: с подтверждением сотрудника. Изменить' : 'Выбрать режим обработки ответов');
  const label = $('#operator-mode-label'); if (label) label.textContent = mode === 'auto' ? 'Автоответ с проверками' : mode === 'review' ? 'Проверка человеком' : 'Режим уточняется';
  $('#response-policy-options').disabled = loading || saving || responsePolicyState.revision === null;
  for (const input of $('#response-policy-form').querySelectorAll('[name="reply_mode"]')) input.checked = input.value === mode;
  $('#save-response-policy').disabled = loading || saving || responsePolicyState.revision === null;
  $('#save-response-policy').textContent = saving ? 'Сохраняем…' : 'Сохранить режим';
  $('#close-response-policy').disabled = saving; $('#cancel-response-policy').disabled = saving;
}
async function loadResponsePolicy({ keepError = false } = {}) {
  const sequence = ++responsePolicyState.sequence;
  responsePolicyState.loading = true; if (!keepError) responsePolicyError('');
  $('#retry-response-policy').hidden = true; $('#response-policy-status').textContent = 'Загружаем настройки…'; renderResponseMode();
  try {
    const data = await request('/api/settings');
    if (sequence !== responsePolicyState.sequence) return false;
    if (!['review','auto'].includes(data.settings?.reply_mode) || !Number.isInteger(data.revision) || data.revision < 0 || data.capabilities?.external_delivery !== false) throw new Error('Не удалось подтвердить настройки режима.');
    responsePolicyState.mode = data.settings.reply_mode; responsePolicyState.revision = data.revision;
    $('#response-policy-status').textContent = data.settings.reply_mode === 'auto' ? 'Автоответ включён для новых обращений. Ручная правка или необходимость человека останавливают автоматическую обработку.' : 'Каждый ответ подтверждает сотрудник.';
    return true;
  } catch (error) {
    if (sequence !== responsePolicyState.sequence) return false;
    responsePolicyError(`Настройки недоступны. ${error.message}`); $('#response-policy-status').textContent = 'Изменение режима не выполнено.'; $('#retry-response-policy').hidden = false;
    return false;
  } finally { if (sequence === responsePolicyState.sequence) { responsePolicyState.loading = false; renderResponseMode(); } }
}
responseModeButton.addEventListener('click',async () => {
  if (!responseDialog.open) responseDialog.showModal();
  if (await loadResponsePolicy()) responseDialog.querySelector('[name="reply_mode"]:checked')?.focus({preventScroll:true});
});
for (const selector of ['#close-response-policy','#cancel-response-policy']) $(selector).addEventListener('click',() => { if (!responsePolicyState.saving) responseDialog.close(); });
responseDialog.addEventListener('cancel',event => { if (responsePolicyState.saving) event.preventDefault(); });
responseDialog.addEventListener('close',() => responseModeButton.focus({preventScroll:true}));
$('#retry-response-policy').addEventListener('click',() => loadResponsePolicy());
$('#response-policy-form').addEventListener('submit',async event => {
  event.preventDefault();
  if (responsePolicyState.loading || responsePolicyState.saving || responsePolicyState.revision === null) return;
  const selected = new FormData(event.currentTarget).get('reply_mode');
  if (!['review','auto'].includes(selected)) { responsePolicyError('Выберите режим ответа.'); return; }
  if (selected === responsePolicyState.mode) { responseDialog.close(); return; }
  responsePolicyState.saving = true; responsePolicyError('');
  // Preserve the chosen value while disabling controls; the server owns truth.
  $('#response-policy-options').disabled = true; $('#save-response-policy').disabled = true; $('#save-response-policy').textContent = 'Сохраняем…'; $('#close-response-policy').disabled = true; $('#cancel-response-policy').disabled = true;
  try {
    const data = await request('/api/settings',{method:'PATCH',body:JSON.stringify({reply_mode:selected,revision:responsePolicyState.revision})});
    if (data.settings?.reply_mode !== selected || !Number.isInteger(data.revision) || data.capabilities?.external_delivery !== false) throw new Error('Сервис не подтвердил изменение режима.');
    responsePolicyState.mode = data.settings.reply_mode; responsePolicyState.revision = data.revision;
    responseDialog.close(); toast(selected === 'auto' ? 'Автоответ включён для новых обращений. Сложные случаи останутся сотруднику.' : 'Новые ответы будут ожидать подтверждения сотрудника.');
  } catch (error) {
    responsePolicyError(`Режим не сохранён. ${error.message}`);
    await loadResponsePolicy({keepError:true});
  } finally { responsePolicyState.saving = false; renderResponseMode(); }
});

const autoReplyLabels = {pending:'Автоответ в очереди',running:'ИИ готовит автоответ',stored_locally:'Автоответ сохранён локально',staff_review:'Нужна проверка сотрудника',cancelled:'Автоответ остановлен',interrupted:'Обработка прервана — нужна проверка'};
function renderLocalReplies(host,data) {
  clear(host);
  const replies = Array.isArray(data.replies) ? data.replies.filter(reply => reply && typeof reply.text === 'string' && reply.delivery_state === 'stored_locally' && reply.external_sent === false && (reply.kind === 'ai_auto' && reply.confirmed_by === null || reply.kind === 'operator_confirmed' && reply.confirmed_by === 'local_operator')) : [];
  const auto = data.auto_reply || {status:'not_requested'};
  const ordered = [...replies].reverse().sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
  host.hidden = !replies.length && auto.status === 'not_requested'; if (host.hidden) return;
  const confirmed = ordered[0]?.kind === 'operator_confirmed';
  const label = confirmed ? 'Подтверждён сотрудником' : auto.status === 'not_requested' && replies.length ? 'Ответ сохранён локально' : autoReplyLabels[auto.status] || 'Требуется проверка';
  const title = node('div','local-reply-heading'); append(title,node('h3','section-label','Локальный ответ'),badge(label,confirmed || auto.status === 'stored_locally' || auto.status === 'not_requested' && replies.length ? 'badge-green' : 'badge-neutral')); host.append(title);
  if (replies.length) {
    const card = reply => { const section = node('article','local-reply-card'); append(section,node('p','local-reply-origin',reply.kind === 'operator_confirmed' ? 'Подтверждён сотрудником' : 'Автоответ ИИ'),node('pre','local-reply-text',reply.text),node('p','view-note',`${dateText(reply.created_at)} · сохранён здесь, в игру не отправлен`)); return section; };
    host.append(card(ordered[0]));
    if (ordered.length > 1) { const history = node('details','local-reply-history'); history.append(node('summary','',`Предыдущие ответы · ${ordered.length-1}`)); for (const reply of ordered.slice(1)) history.append(card(reply)); host.append(history); }
  } else if (['pending','running'].includes(auto.status)) host.append(node('p','view-note','Обращение сохранено. Готовим ответ и проверяем, можно ли оставить его без подтверждения.'));
  else host.append(node('p','view-note','Автоматический ответ не сохранён. Проверьте сведения и подготовьте ответ сотрудника.'));
}
async function refreshLocalReplies(ticketId,host) {
  if (!host.isConnected || state.selected !== ticketId || state.view !== 'queue') return;
  try {
    const data = await request(`/api/tickets/${encodeURIComponent(ticketId)}/replies`);
    responsePolicyState.replies.set(ticketId,data);
    if (!host.isConnected || state.selected !== ticketId) return;
    renderLocalReplies(host,data);
    if (['pending','running'].includes(data.auto_reply?.status)) {
      clearTimeout(responsePolicyState.timers.get(ticketId));
      responsePolicyState.timers.set(ticketId,setTimeout(()=>refreshLocalReplies(ticketId,host),1500));
    }
  } catch {
    if (!host.isConnected || state.selected !== ticketId) return;
    host.hidden = false; clear(host).append(node('p','view-note','История локальных ответов недоступна. Черновик в редакторе не изменён.'));
    const retry = node('button','text-button','Повторить'); retry.type='button'; retry.addEventListener('click',()=>refreshLocalReplies(ticketId,host)); host.append(retry);
  }
}
function appendResponseDelivery(ticket,parent) {
  clearTimeout(responsePolicyState.timers.get(ticket.id));
  const host = node('section','local-response-section'); host.setAttribute('aria-label','Локальные ответы и автообработка'); host.setAttribute('aria-live','polite');
  const cached = responsePolicyState.replies.get(ticket.id); if (cached) renderLocalReplies(host,cached); else host.hidden = true;
  parent.append(host); queueMicrotask(()=>refreshLocalReplies(ticket.id,host));
}
loadResponsePolicy();
