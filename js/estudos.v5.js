/* ─── js/estudos.js — Módulo de Estudos para Concursos ─── */

/* =============================================
   CONFIGURAÇÃO
============================================= */
const EST_CONFIG = {
  storageKey: 'est_study_data',
  targetDateKey: 'est_target_date',
  defaultTargetDate: '2026-12-15',
  disciplines: [
    'Língua Portuguesa',
    'Competências Digitais e Informática Aplicada',
    'Raciocínio Lógico',
    'Direito Administrativo',
    'Direito Constitucional',
    'Controle Externo',
    'Legislação Específica',
    'História do Estado do Maranhão',
    'Geografia do Estado do Maranhão',
    'Noções de Direitos Humanos',
    'Obras - Planejamento, Normas, Fiscalização e Legislação',
    'Obras de Edificações',
    'Obras Hídricas',
    'Obras Rodoviárias',
    'Auditoria do Setor Público'
  ],
  chartColors: [
    '#60a5fa', '#4ade80', '#fbbf24', '#f87171',
    '#a78bfa', '#22d3ee', '#f472b6', '#fb923c',
    '#818cf8', '#34d399', '#facc15', '#f97316',
    '#e879f9', '#2dd4bf', '#94a3b8', '#c084fc',
    '#38bdf8'
  ]
};

/* =============================================
   ESTADO
============================================= */
let studyData = [];
let currentSection = localStorage.getItem('est_last_section') || 'inicio';
// Seções antigas que viraram o "Planejamento Semanal"
if (currentSection === 'ciclo' || currentSection === 'revisoes') currentSection = 'metas';

/* =============================================
   INICIALIZAÇÃO
============================================= */
document.addEventListener('DOMContentLoaded', async () => {
  loadData();
  await migrateToSupabaseIfNeeded();
  await loadEditais();
  await window.estPlano.init(); // estudos.plano.js: sessões, metas e revisões
  renderDashboard();
  initSidebar();
  initModal();
  initCountdown();
  initEditalUI();
  initRevisaoUI();
  updateGreeting();
  navigateTo(currentSection);
  
  // Remove as classes de animação após 1 segundo para evitar que fiquem piscando ao alternar abas
  setTimeout(() => {
    document.querySelectorAll('.est-animate-in').forEach(el => {
      el.classList.remove('est-animate-in');
    });
  }, 1000);
});

/* =============================================
   PERSISTÊNCIA (localStorage)
============================================= */
function loadData() {
  try {
    const raw = localStorage.getItem(EST_CONFIG.storageKey);
    studyData = raw ? JSON.parse(raw) : [];
  } catch {
    studyData = [];
  }
}

function saveData() {
  localStorage.setItem(EST_CONFIG.storageKey, JSON.stringify(studyData));
}

function getTargetDate() {
  return localStorage.getItem(EST_CONFIG.targetDateKey) || EST_CONFIG.defaultTargetDate;
}

function setTargetDate(dateStr) {
  localStorage.setItem(EST_CONFIG.targetDateKey, dateStr);
}

/* =============================================
   SAUDAÇÃO DINÂMICA
============================================= */
function updateGreeting() {
  const el = document.getElementById('est-greeting-text');
  if (!el) return;
  const hour = new Date().getHours();
  let greeting;
  if (hour < 12) greeting = 'Bom dia';
  else if (hour < 18) greeting = 'Boa tarde';
  else greeting = 'Boa noite';
  el.textContent = `${greeting}, Eu!`;

  // Data atual
  const dateEl = document.getElementById('est-current-date');
  if (dateEl) {
    const now = new Date();
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    let formatted = now.toLocaleDateString('pt-BR', options);
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    dateEl.textContent = formatted;
  }
}

/* =============================================
   CONTADOR DE DIAS
============================================= */
function initCountdown() {
  updateCountdown();
  const countdownEl = document.getElementById('est-countdown');
  if (countdownEl) {
    countdownEl.addEventListener('click', openDatePicker);
  }
}

function updateCountdown() {
  const el = document.getElementById('est-countdown-text');
  if (!el) return;
  const target = new Date(getTargetDate() + 'T23:59:59');
  const now = new Date();
  const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  if (diff > 0) {
    el.textContent = `${diff} dias para a prova`;
  } else if (diff === 0) {
    el.textContent = 'A prova é hoje!';
  } else {
    el.textContent = 'Prova encerrada';
  }
}

function openDatePicker() {
  const currentDate = getTargetDate();
  const overlay = document.getElementById('est-date-modal');
  const input = document.getElementById('est-target-date-input');
  if (input) input.value = currentDate;
  if (overlay) overlay.classList.add('active');
}

function closeDatePicker() {
  const overlay = document.getElementById('est-date-modal');
  if (overlay) overlay.classList.remove('active');
}

function saveDateTarget() {
  const input = document.getElementById('est-target-date-input');
  if (input && input.value) {
    setTargetDate(input.value);
    updateCountdown();
  }
  closeDatePicker();
}

/* =============================================
   SIDEBAR NAVIGATION
============================================= */
function initSidebar() {
  document.querySelectorAll('.est-sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      const section = item.dataset.section;
      if (section) navigateTo(section);
    });
  });
}

function navigateTo(section) {
  currentSection = section;
  localStorage.setItem('est_last_section', section);

  // Update sidebar active state
  document.querySelectorAll('.est-sidebar-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === section);
  });

  // Show/hide sections
  const dashboard = document.getElementById('est-section-inicio');
  const sections = document.querySelectorAll('.est-placeholder-section, .est-edital-section');

  if (section === 'inicio') {
    if (dashboard) dashboard.classList.add('active');
    sections.forEach(p => p.classList.remove('active'));
  } else {
    if (dashboard) dashboard.classList.remove('active');
    sections.forEach(p => {
      p.classList.toggle('active', p.dataset.section === section);
    });
  }
  
  if (section === 'resumos') {
    renderMeusResumos();
  }

  if (section === 'historico') {
    renderHistorico();
  }

  window.estPlano.renderSecao(section);
}

/* =============================================
   MODAL DE REGISTRO
============================================= */
function initModal() {
  const editalSelect = document.getElementById('est-edital-select-modal');
  const discSelect = document.getElementById('est-disc-select');
  const topicSelect = document.getElementById('est-topic-select');
  const btnResumo = document.getElementById('est-btn-modal-resumo');
  const btnAddTopic = document.getElementById('est-btn-modal-add-topic');

  if (editalSelect) {
    editalSelect.addEventListener('change', () => {
      const eId = editalSelect.value;
      const edital = editaisData.find(e => e.id === eId);
      discSelect.innerHTML = '<option value="" disabled selected>Selecione a disciplina...</option>';
      topicSelect.innerHTML = '<option value="" selected>Selecione o tópico (opcional)...</option>';
      topicSelect.disabled = true;
      if (btnAddTopic) btnAddTopic.style.display = 'none';
      if (edital) {
        edital.disciplinas.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.nome;
          discSelect.appendChild(opt);
        });
        discSelect.disabled = false;
      } else {
        discSelect.disabled = true;
      }
      if (btnResumo) {
        btnResumo.disabled = true;
        btnResumo.style.opacity = '0.5';
        btnResumo.style.cursor = 'not-allowed';
      }
    });
  }

  if (discSelect) {
    discSelect.addEventListener('change', () => {
      const eId = editalSelect.value;
      const dId = discSelect.value;
      const edital = editaisData.find(e => e.id === eId);
      const disc = edital?.disciplinas.find(d => d.id === dId);
      topicSelect.innerHTML = '<option value="" selected>Selecione o tópico (opcional)...</option>';
      
      if (dId) {
        if (btnAddTopic) btnAddTopic.style.display = 'inline-flex';
      } else {
        if (btnAddTopic) btnAddTopic.style.display = 'none';
      }

      if (disc && disc.topicos.length > 0) {
        disc.topicos.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.nome;
          topicSelect.appendChild(opt);
        });
        topicSelect.disabled = false;
      } else {
        topicSelect.disabled = true;
      }
      if (btnResumo) {
        btnResumo.disabled = true;
        btnResumo.style.opacity = '0.5';
        btnResumo.style.cursor = 'not-allowed';
      }
    });
  }

  if (topicSelect) {
    topicSelect.addEventListener('change', () => {
      if (btnResumo) {
        if (topicSelect.value) {
          btnResumo.disabled = false;
          btnResumo.style.opacity = '1';
          btnResumo.style.cursor = 'pointer';
        } else {
          btnResumo.disabled = true;
          btnResumo.style.opacity = '0.5';
          btnResumo.style.cursor = 'not-allowed';
        }
      }
    });
  }

  if (btnResumo) {
    btnResumo.addEventListener('click', () => {
      const eId = editalSelect.value;
      const dId = discSelect.value;
      const tId = topicSelect.value;
      if (eId && dId && tId) {
        closeModal();
        promptResumo(eId, dId, tId);
      }
    });
  }

  if (btnAddTopic) {
    btnAddTopic.addEventListener('click', async () => {
      const eId = editalSelect.value;
      const dId = discSelect.value;
      if (!eId || !dId) return;

      const edital = editaisData.find(x => x.id === eId);
      const disc = edital?.disciplinas.find(x => x.id === dId);
      if (!disc) return;

      const nome = await customPrompt('Nome do novo tópico:');
      if (nome && nome.trim()) {
        const newTopicId = 't_' + Date.now();
        const newTopic = { id: newTopicId, nome: nome.trim(), estudado: false, questoesFeitas: 0, questoesCertas: 0, tecLink: "", tempoGasto: 0 };
        disc.topicos.push(newTopic);
        saveEditais();
        renderEdital();

        // Salva no Supabase
        try {
          await window.supabaseClient.from('topicos').insert({
            id: newTopic.id,
            disciplina_id: disc.id,
            nome: newTopic.nome,
            estudado: false,
            questoes_feitas: 0,
            questoes_certas: 0,
            tec_link: "",
            tempo_gasto: 0
          });
        } catch (e) {
          console.error("Erro ao salvar novo tópico no Supabase:", e);
        }

        // Atualiza o select
        topicSelect.innerHTML = '<option value="" selected>Selecione o tópico (opcional)...</option>';
        disc.topicos.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.id;
          opt.textContent = t.nome;
          topicSelect.appendChild(opt);
        });
        topicSelect.disabled = false;

        // Auto-seleciona
        topicSelect.value = newTopicId;
        topicSelect.dispatchEvent(new Event('change'));
      }
    });
  }

  // Botão de abrir
  const openBtn = document.getElementById('est-btn-open-modal');
  if (openBtn) openBtn.addEventListener('click', openModal);

  // Botão de fechar
  const closeBtn = document.getElementById('est-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);

  // Overlay click
  const overlay = document.getElementById('est-modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  // Form submit
  const form = document.getElementById('est-session-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submitSession();
    });
  }
}

function openModal() {
  const overlay = document.getElementById('est-modal-overlay');
  
  const editalSelect = document.getElementById('est-edital-select-modal');
  if (editalSelect) {
    editalSelect.innerHTML = '<option value="" disabled selected>Selecione o edital...</option>';
    editaisData.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.titulo;
      editalSelect.appendChild(opt);
    });
    
    // Auto-seleciona o edital ativo
    if (currentEditalId && editaisData.find(e => e.id === currentEditalId)) {
      editalSelect.value = currentEditalId;
      editalSelect.dispatchEvent(new Event('change'));
    }
  }

  if (overlay) overlay.classList.add('active');
}

function closeModal() {
  const overlay = document.getElementById('est-modal-overlay');
  if (overlay) overlay.classList.remove('active');
  // Reset form
  const form = document.getElementById('est-session-form');
  if (form) form.reset();
}

async function submitSession() {
  const eId = document.getElementById('est-edital-select-modal')?.value;
  const dId = document.getElementById('est-disc-select')?.value;
  const tId = document.getElementById('est-topic-select')?.value;
  const hours = parseInt(document.getElementById('est-hours-input')?.value) || 0;
  const minutes = parseInt(document.getElementById('est-minutes-input')?.value) || 0;
  const totalQ = parseInt(document.getElementById('est-questions-total')?.value) || 0;
  const correctQ = parseInt(document.getElementById('est-questions-correct')?.value) || 0;
  const tecLinkInput = document.getElementById('est-session-tec-link')?.value.trim();
  const metaDone = !!document.getElementById('est-meta-check')?.checked;

  if (!eId || !dId) return;

  const totalMinutes = hours * 60 + minutes;
  const edital = editaisData.find(e => e.id === eId);
  const disc = edital?.disciplinas.find(d => d.id === dId);
  
  let topicName = '';
  if (tId && disc) {
    const topic = disc.topicos.find(t => t.id === tId);
    if (topic) {
      topicName = topic.nome;
      // Atualiza os dados no tópico real!
      topic.tempoGasto = (topic.tempoGasto || 0) + totalMinutes;
      topic.questoesFeitas = (topic.questoesFeitas || 0) + totalQ;
      topic.questoesCertas = (topic.questoesCertas || 0) + correctQ;
      if (tecLinkInput) {
        topic.tecLink = tecLinkInput;
      }
      if (metaDone) topic.estudado = true;

      saveEditais();
      renderEdital();

      const updateData = {
        tempo_gasto: topic.tempoGasto,
        questoes_feitas: topic.questoesFeitas,
        questoes_certas: topic.questoesCertas
      };
      if (tecLinkInput) {
        updateData.tec_link = topic.tecLink;
      }
      if (metaDone) updateData.estudado = true;

      await window.supabaseClient.from('topicos').update(updateData).eq('id', topic.id);
    }
  }

  const session = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    date: dataLocal(),
    timestamp: new Date().toISOString(),
    editalId: eId,
    discId: dId,
    topicId: topicName ? tId : null,
    discipline: disc ? disc.nome : '',
    topic: topicName || 'Tópico Geral',
    timeMinutes: totalMinutes,
    questionsTotal: totalQ,
    questionsCorrect: Math.min(correctQ, totalQ),
    tipo: 'estudo',
    metaDone: metaDone && !!topicName
  };

  studyData.push(session);
  saveData();
  window.estPlano.sessaoCriada(session);
  closeModal();
  renderDashboard();

  // Tópico concluído: fecha a meta da semana e agenda a primeira revisão
  if (session.metaDone) {
    window.estPlano.topicoConcluido(tId, totalQ > 0 ? Math.round((session.questionsCorrect / totalQ) * 100) : null);
  }
}

function deleteSession(id) {
  studyData = studyData.filter(s => s.id !== id);
  saveData();
  window.estPlano.sessaoRemovida(id);
  renderDashboard();
}

/* Questões das sessões sem tópico. As com tópico já estão somadas no próprio tópico. */
function questoesAvulsas() {
  const avulsas = studyData.filter(s => !s.topicId && (!s.topic || s.topic === 'Tópico Geral'));
  return {
    total: avulsas.reduce((a, s) => a + (s.questionsTotal || 0), 0),
    certas: avulsas.reduce((a, s) => a + (s.questionsCorrect || 0), 0)
  };
}

/* =============================================
   RENDER DASHBOARD
============================================= */
function renderDashboard() {
  renderCards();
  renderSessions();
  renderCharts();
  window.estPlano.renderHoje();
}

/* ─── Cards de Performance ─── */
function renderCards() {
  // Metas concluídas (Combina dados do edital)
  let totalMetas = 0;
  let metasDone = 0;
  let editalQuestions = 0;
  let editalCorrect = 0;
  let totalResumos = 0;

  editaisData.forEach(e => {
    e.disciplinas.forEach(d => {
      totalMetas += d.topicos.length;
      metasDone += d.topicos.filter(t => t.estudado).length;
      d.topicos.forEach(t => {
        editalQuestions += (t.questoesFeitas || 0);
        editalCorrect += (t.questoesCertas || 0);
      });
    });
  });

  const metaPercent = totalMetas > 0 ? Math.round((metasDone / totalMetas) * 100) : 0;

  const metaValEl = document.getElementById('est-card-metas-val');
  const metaSubEl = document.getElementById('est-card-metas-sub');
  const metaBarEl = document.getElementById('est-card-metas-bar');
  // Com plano semanal, o card mostra as metas da semana; sem plano, os tópicos do edital
  const semana = window.resumoSemanaPlano();
  if (semana && semana.total > 0) {
    const semanaPercent = Math.round((semana.feitas / semana.total) * 100);
    if (metaValEl) metaValEl.innerHTML = `${semana.feitas} <span>/ ${semana.total}</span>`;
    if (metaBarEl) metaBarEl.style.width = `${semanaPercent}%`;
  } else {
    if (metaValEl) metaValEl.innerHTML = `${metasDone} <span>/ ${totalMetas}</span>`;
    if (metaBarEl) metaBarEl.style.width = `${metaPercent}%`;
  }
  if (metaSubEl) metaSubEl.textContent = `${metaPercent}% do edital concluído`;

  // Questões feitas (edital + sessões sem tópico)
  const avulsas = questoesAvulsas();
  const finalTotalQ = editalQuestions + avulsas.total;
  const finalCorrectQ = editalCorrect + avulsas.certas;
  const acertoPercent = finalTotalQ > 0 ? Math.round((finalCorrectQ / finalTotalQ) * 100) : 0;

  const questValEl = document.getElementById('est-card-quest-val');
  const questSubEl = document.getElementById('est-card-quest-sub');
  const questBarEl = document.getElementById('est-card-quest-bar');
  if (questValEl) questValEl.textContent = finalTotalQ;
  if (questSubEl) questSubEl.textContent = `${acertoPercent}% de acertos`;
  if (questBarEl) questBarEl.style.width = `${acertoPercent}%`;

  // Tempo de estudo
  const totalMinutes = studyData.reduce((a, s) => a + s.timeMinutes, 0);
  const totalHours = Math.floor(totalMinutes / 60);
  const remainMinutes = totalMinutes % 60;

  const timeValEl = document.getElementById('est-card-time-val');
  const timeSubEl = document.getElementById('est-card-time-sub');
  if (timeValEl) timeValEl.innerHTML = `${totalHours}<span>h</span> ${remainMinutes}<span>m</span>`;
  if (timeSubEl) timeSubEl.textContent = `${totalMinutes} minutos acumulados`;

  // Ofensiva (dias consecutivos)
  const streak = calculateStreak();
  const record = calculateRecord();
  const streakValEl = document.getElementById('est-card-streak-val');
  const streakSubEl = document.getElementById('est-card-streak-sub');
  const streakBarEl = document.getElementById('est-card-streak-bar');
  if (streakValEl) streakValEl.innerHTML = `${streak} <span>dias</span>`;
  if (streakSubEl) streakSubEl.textContent = `Recorde: ${record} dias`;
  if (streakBarEl) streakBarEl.style.width = record > 0 ? `${Math.min((streak / record) * 100, 100)}%` : '0%';
}

function calculateStreak() {
  if (studyData.length === 0) return 0;

  const dates = [...new Set(studyData.map(s => s.date))].sort().reverse();
  const today = dataLocal();

  // Se não estudou hoje, verifica se estudou ontem
  let checkDate = today;
  if (!dates.includes(today)) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = dataLocal(yesterday);
    if (!dates.includes(yesterdayStr)) return 0;
    checkDate = yesterdayStr;
  }

  let streak = 0;
  let current = new Date(checkDate + 'T12:00:00');

  while (true) {
    const dateStr = dataLocal(current);
    if (dates.includes(dateStr)) {
      streak++;
      current.setDate(current.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

function calculateRecord() {
  if (studyData.length === 0) return 0;

  const dates = [...new Set(studyData.map(s => s.date))].sort();
  let maxStreak = 1;
  let currentStreak = 1;

  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + 'T12:00:00');
    const curr = new Date(dates[i] + 'T12:00:00');
    const diff = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
    if (diff === 1) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 1;
    }
  }

  return maxStreak;
}

/* ─── Lista de Sessões ─── */
function renderSessions() {
  const container = document.getElementById('est-sessions-container');
  if (!container) return;

  const today = dataLocal();
  const todaySessions = studyData
    .filter(s => s.date === today)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (todaySessions.length === 0) {
    container.innerHTML = `
      <div class="est-sessions-empty">
        <span class="est-sessions-empty-icon">📖</span>
        <p>Nenhuma sessão registrada hoje.<br/>Clique em "Registrar Sessão" para começar.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = todaySessions.map(s => {
    const timeH = Math.floor(s.timeMinutes / 60);
    const timeM = s.timeMinutes % 60;
    const timeStr = timeH > 0 ? `${timeH}h${timeM > 0 ? timeM + 'm' : ''}` : `${timeM}m`;

    return `
      <div class="est-session-item est-animate-in">
        <div class="est-session-status ${s.metaDone ? 'done' : 'pending'}">
          ${s.metaDone ? '✓' : '○'}
        </div>
        <div class="est-session-disc">
          <span class="est-session-disc-name">${escapeHtml(s.discipline)}</span>
          ${s.topic ? `<span class="est-session-disc-topic">${escapeHtml(s.topic)}</span>` : ''}
        </div>
        <div class="est-session-time">
          <span class="est-session-time-icon">⏱</span> ${timeStr}
        </div>
        <div class="est-session-questions">
          ${s.questionsTotal > 0
            ? `<span class="est-q-total">${s.questionsTotal}f</span> — <span class="est-q-correct">${s.questionsCorrect}c</span>`
            : '<span style="opacity:0.4">—</span>'
          }
        </div>
        <button class="est-session-delete" onclick="deleteSession('${s.id}')" title="Remover sessão" aria-label="Remover sessão">✕</button>
      </div>
    `;
  }).join('');
}

/* =============================================
   GRÁFICOS SVG
============================================= */
function renderCharts() {
  renderTimeChart();
  renderQuestionsChart();
}

/* ─── Gráfico de Rosca: Tempo por Disciplina ─── */
function renderTimeChart() {
  const container = document.getElementById('est-chart-time');
  const legendContainer = document.getElementById('est-chart-time-legend');
  if (!container || !legendContainer) return;

  // Agrupa tempo por disciplina
  const timeByDisc = {};
  studyData.forEach(s => {
    if (s.timeMinutes > 0) {
      timeByDisc[s.discipline] = (timeByDisc[s.discipline] || 0) + s.timeMinutes;
    }
  });

  const entries = Object.entries(timeByDisc).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = '<p class="est-chart-empty">Registre sessões para ver o gráfico</p>';
    legendContainer.innerHTML = '';
    return;
  }

  const total = entries.reduce((a, [, v]) => a + v, 0);
  container.innerHTML = buildDonutSVG(entries, total, EST_CONFIG.chartColors);

  legendContainer.innerHTML = entries.map(([disc, mins], i) => {
    const color = EST_CONFIG.chartColors[i % EST_CONFIG.chartColors.length];
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const timeStr = h > 0 ? `${h}h${m > 0 ? m + 'm' : ''}` : `${m}m`;
    const shortDisc = disc.length > 22 ? disc.slice(0, 20) + '…' : disc;
    return `
      <div class="est-legend-item">
        <span class="est-legend-dot" style="background: ${color}"></span>
        ${escapeHtml(shortDisc)} (${timeStr})
      </div>
    `;
  }).join('');
}

/* ─── Gráfico de Rosca: Questões Certas vs Erradas ─── */
function renderQuestionsChart() {
  const container = document.getElementById('est-chart-questions');
  const legendContainer = document.getElementById('est-chart-questions-legend');
  if (!container || !legendContainer) return;

  const avulsas = questoesAvulsas();
  let totalQ = avulsas.total;
  let correctQ = avulsas.certas;

  editaisData.forEach(e => {
    e.disciplinas.forEach(d => {
      d.topicos.forEach(t => {
        totalQ += (t.questoesFeitas || 0);
        correctQ += (t.questoesCertas || 0);
      });
    });
  });

  const wrongQ = totalQ - correctQ;

  if (totalQ === 0) {
    container.innerHTML = '<p class="est-chart-empty">Registre questões para ver o gráfico</p>';
    legendContainer.innerHTML = '';
    return;
  }

  const entries = [
    ['Certas', correctQ],
    ['Erradas', wrongQ]
  ];
  const colors = ['#4ade80', '#f87171'];

  container.innerHTML = buildDonutSVG(entries, totalQ, colors, true);

  legendContainer.innerHTML = entries.map(([label, val], i) => {
    const pct = Math.round((val / totalQ) * 100);
    return `
      <div class="est-legend-item">
        <span class="est-legend-dot" style="background: ${colors[i]}"></span>
        ${label}: ${val} (${pct}%)
      </div>
    `;
  }).join('');

  renderCadernosList();
}

// ─── Renderiza a lista de cadernos no Dashboard ───
function renderCadernosList() {
  const container = document.getElementById('est-cadernos-list');
  if (!container) return;

  let cadernos = [];
  
  editaisData.forEach(edital => {
    edital.disciplinas.forEach(disc => {
      disc.topicos.forEach(topic => {
        if (topic.questoesFeitas > 0) {
          cadernos.push({
            editalId: edital.id,
            discId: disc.id,
            topicId: topic.id,
            nome: topic.nome,
            feitas: topic.questoesFeitas,
            certas: topic.questoesCertas,
            tecLink: topic.tecLink
          });
        }
      });
    });
  });

  if (cadernos.length === 0) {
    container.innerHTML = '<div style="color: var(--est-accent-muted); font-size: 0.85rem; padding: 10px;">Nenhum caderno resolvido ainda.</div>';
    return;
  }

  container.innerHTML = cadernos.map(c => `
    <div class="est-caderno-item" onclick="openCadernoDetalhe('${c.editalId}', '${c.discId}', '${c.topicId}')" title="Ver Detalhes">
      <div class="est-caderno-nome">${escapeHtml(c.nome)}</div>
      <div class="est-caderno-stats">
        <span class="total">${c.feitas}</span> / <span class="certas">${c.certas}</span>
      </div>
    </div>
  `).join('');
}

// ─── Abre o Modal de Detalhe de um Caderno ───
window.openCadernoDetalhe = function(eId, dId, tId) {
  const edital = editaisData.find(ed => ed.id === eId);
  const disc = edital?.disciplinas.find(d => d.id === dId);
  const topic = disc?.topicos.find(t => t.id === tId);
  
  if (!topic) return;

  const modal = document.getElementById('est-modal-detalhe-caderno');
  document.getElementById('est-modal-detalhe-title').textContent = topic.nome;

  const erradas = topic.questoesFeitas - topic.questoesCertas;
  const data = [
    { label: 'Certas', value: topic.questoesCertas, color: '#4ade80' },
    { label: 'Erradas', value: erradas > 0 ? erradas : 0, color: '#f87171' }
  ];

  const svgStr = buildDonutSVG(data.map(d => [d.label, d.value]), topic.questoesFeitas, data.map(d => d.color), true);
  document.getElementById('est-chart-detalhe-caderno').innerHTML = svgStr;

  const legendContainer = document.getElementById('est-chart-detalhe-legend');
  legendContainer.innerHTML = data.map(d => {
    let pct = topic.questoesFeitas > 0 ? Math.round((d.value / topic.questoesFeitas) * 100) : 0;
    return `
      <div class="est-legend-item">
        <span class="est-legend-color" style="background:${d.color};"></span>
        <span class="est-legend-label">${d.label}: ${d.value} (${pct}%)</span>
      </div>
    `;
  }).join('');

  const btnAcessar = document.getElementById('est-btn-acessar-caderno');
  if (topic.tecLink) {
    btnAcessar.style.display = 'block';
    btnAcessar.onclick = () => window.open(topic.tecLink, '_blank');
  } else {
    btnAcessar.style.display = 'none';
  }

  modal.classList.add('active');
};

/* ─── Build Donut SVG ─── */
function buildDonutSVG(entries, total, colors, showCenter = false) {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 60;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * radius;

  let paths = '';
  let offset = 0;

  entries.forEach(([label, value], i) => {
    const pct = total > 0 ? value / total : 0;
    const dashLength = pct * circumference;
    const dashGap = circumference - dashLength;
    const color = colors[i % colors.length];
    const rotation = (offset / total) * 360 - 90;

    paths += `
      <circle
        cx="${cx}" cy="${cy}" r="${radius}"
        fill="none"
        stroke="${color}"
        stroke-width="${strokeWidth}"
        stroke-dasharray="${dashLength} ${dashGap}"
        transform="rotate(${rotation} ${cx} ${cy})"
        style="transition: stroke-dasharray 0.6s ease;"
      />
    `;
    offset += value;
  });

  let centerText = '';
  if (showCenter) {
    const pct = entries.length > 0 && total > 0 ? Math.round((entries[0][1] / total) * 100) : 0;
    centerText = `
      <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="#e8eaed"
        font-family="'Cormorant Garamond', serif" font-size="22" font-weight="700">${pct}%</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" fill="#8892a4"
        font-family="'Outfit', sans-serif" font-size="10">acertos</text>
    `;
  }

  return `
    <svg class="est-chart-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="rgba(200,204,212,0.08)" stroke-width="${strokeWidth}" />
      ${paths}
      ${centerText}
    </svg>
  `;
}


/* =============================================
   UTILITÁRIOS
============================================= */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* Data no fuso do navegador (AAAA-MM-DD). toISOString() usa UTC e, depois
   das 21h no Brasil, já devolve o dia seguinte. */
function dataLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* =============================================
   MÓDULO: EDITAL VERTICALIZADO
============================================= */
let editaisData = [];
let currentEditalId = null;

/* Mapa de resumos independente de edital: chave = "discNome|||topicNome" */
let resumosMap = {};

async function migrateToSupabaseIfNeeded() {
  const localData = localStorage.getItem('est_editais');
  if (!localData) return;
  const parsed = JSON.parse(localData);
  if (parsed.length === 0) return;

  try {
    const { data: existingEditais, error } = await window.supabaseClient.from('editais').select('id').limit(1);
    if (error) { console.error("Supabase Error:", error); return; }
    if (existingEditais && existingEditais.length > 0) return; // Already migrated

    console.log("Iniciando migração do localStorage para Supabase...");
    for (const e of parsed) {
      const { error: eErr } = await window.supabaseClient.from('editais').insert({ id: e.id, cargo: e.titulo || 'Meu Edital', orgao: 'N/A', status: e.status || 'aberto' });
      if (eErr) console.error("Migration Editais Error:", eErr);

      for (const d of e.disciplinas) {
        const { error: dErr } = await window.supabaseClient.from('disciplinas').insert({ id: d.id, edital_id: e.id, nome: d.nome });
        if (dErr) console.error("Migration Disc Error:", dErr);

        for (const t of d.topicos) {
          const { error: tErr } = await window.supabaseClient.from('topicos').insert({
            id: t.id, disciplina_id: d.id, nome: t.nome, estudado: t.estudado || false, 
            questoes_feitas: t.questoesFeitas || 0, questoes_certas: t.questoesCertas || 0,
            tec_link: t.tecLink || '', tempo_gasto: t.tempoGasto || 0
          });
          if (tErr) console.error("Migration Topic Error:", tErr);
        }
      }
    }
    console.log("Migração concluída!");
  } catch(e) {
    console.error("Erro na migração:", e);
  }
}

async function loadEditais() {
  try {
    // As quatro consultas saem juntas, em vez de uma depois da outra
    const sb = window.supabaseClient;
    const [rE, rD, rT] = await Promise.all([
      sb.from('editais').select('*').order('id'),
      sb.from('disciplinas').select('*'),
      sb.from('topicos').select('*'),
      loadResumosMap() // resumos indexados por nome (independente de edital)
    ]);
    if (rE.error) throw rE.error;
    if (rD.error) throw rD.error;
    if (rT.error) throw rT.error;
    const editais = rE.data, disciplinas = rD.data, topicos = rT.data;

    editaisData = editais.map(e => {
      let edDisciplinas = disciplinas.filter(d => d.edital_id === e.id).map(d => {
        let edTopicos = topicos.filter(t => t.disciplina_id === d.id).map(t => {
          return {
            id: t.id, nome: t.nome, estudado: t.estudado,
            questoesFeitas: t.questoes_feitas, questoesCertas: t.questoes_certas,
            tecLink: t.tec_link, tempoGasto: t.tempo_gasto || 0
          };
        });
        edTopicos.sort((a, b) => a.id.localeCompare(b.id));
        return {
          id: d.id, nome: d.nome, ordem: Number.isInteger(d.ordem) ? d.ordem : null,
          topicos: edTopicos
        };
      });

      // Ordem salva no Supabase (coluna disciplinas.ordem); sem ela, a deste navegador
      if (edDisciplinas.length && edDisciplinas.every(d => d.ordem !== null)) {
        edDisciplinas.sort((a, b) => a.ordem - b.ordem);
      } else try {
        const savedOrder = JSON.parse(localStorage.getItem('disc_order_' + e.id));
        if (savedOrder && Array.isArray(savedOrder)) {
          edDisciplinas.sort((a, b) => {
            let idxA = savedOrder.indexOf(a.id);
            let idxB = savedOrder.indexOf(b.id);
            if (idxA === -1) idxA = 999999;
            if (idxB === -1) idxB = 999999;
            return idxA - idxB;
          });
        } else {
          edDisciplinas.sort((a, b) => a.id.localeCompare(b.id));
        }
      } catch(err) {
        edDisciplinas.sort((a, b) => a.id.localeCompare(b.id));
      }

      return {
        id: e.id, titulo: e.cargo, status: e.status,
        disciplinas: edDisciplinas
      };
    });
  } catch (error) {
    console.error("Erro ao carregar do Supabase:", error);
    const data = localStorage.getItem('est_editais');
    if (data) editaisData = JSON.parse(data);
    else editaisData = [];
  }
}

/* Carrega todos os resumos no mapa global (chave = "discNome|||topicNome") */
async function loadResumosMap() {
  resumosMap = {};
  try {
    // Tenta buscar da nova tabela com colunas de nome
    const { data, error } = await window.supabaseClient
      .from('resumos')
      .select('id, disciplina_nome, topico_nome, conteudo, updated_at');
    if (error) throw error;
    (data || []).forEach(r => {
      if (r.disciplina_nome && r.topico_nome) {
        const key = makeResumoKey(r.disciplina_nome, r.topico_nome);
        resumosMap[key] = { id: r.id, conteudo: r.conteudo, disciplina_nome: r.disciplina_nome, topico_nome: r.topico_nome };
      }
    });
  } catch (err) {
    console.warn('Erro ao carregar resumos do Supabase (tabela pode estar desatualizada):', err);
  }
  // Mescla com backup local
  try {
    const rawBackups = localStorage.getItem('est_resumos_backup');
    if (rawBackups) {
      const backups = JSON.parse(rawBackups);
      Object.entries(backups).forEach(([key, conteudo]) => {
        if (!resumosMap[key]) {
          resumosMap[key] = { id: null, conteudo };
        }
      });
    }
  } catch (e) {
    console.error('Erro ao mesclar backup de resumos:', e);
  }
}

function makeResumoKey(discNome, topicNome) {
  return `${(discNome || '').trim().toLowerCase()}|||${(topicNome || '').trim().toLowerCase()}`;
}

function saveEditais() {
  try {
    localStorage.setItem('est_editais', JSON.stringify(editaisData));
  } catch(e) {
    console.warn("Storage is full, couldn't save to localStorage fallback", e);
  }
}

function initEditalUI() {
  const btnNew = document.getElementById('est-btn-new-edital');
  const modalClose = document.getElementById('est-modal-edital-close');
  const overlay = document.getElementById('est-modal-edital');
  const form = document.getElementById('est-edital-form');
  const select = document.getElementById('est-edital-select');
  const btnDelete = document.getElementById('est-btn-delete-edital');

  if (btnNew) btnNew.addEventListener('click', () => overlay.classList.add('active'));
  if (modalClose) modalClose.addEventListener('click', () => overlay.classList.remove('active'));
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('est-edital-title').value.trim();
      const text = document.getElementById('est-edital-text').value;
      // Com texto, abre a tela de revisão (js/estudos.importar.js) antes de criar
      if (text.trim()) { window.estImportar.analisar(title, text); return; }
      if (!title) return;
      importEdital(title, text);
      form.reset();
      overlay.classList.remove('active');
    });
  }

  if (select) {
    select.addEventListener('change', (e) => {
      currentEditalId = e.target.value;
      renderEdital();
      window.estPlano.editalTrocado();
    });
  }

  if (btnDelete) {
    document.getElementById('est-btn-delete-edital').onclick = async () => {
      if (await customConfirm('Tem certeza que deseja excluir este edital?')) {
        const idToDelete = currentEditalId;
        editaisData = editaisData.filter(e => e.id !== currentEditalId);
        currentEditalId = editaisData.length > 0 ? editaisData[0].id : null;
        saveEditais();
        renderEditalSelect();
        renderEdital();
        await window.supabaseClient.from('editais').delete().eq('id', idToDelete);
      }
    };
  }

  // Initial render
  if (editaisData.length > 0) {
    currentEditalId = editaisData[0].id;
  }
  renderEditalSelect();
  renderEdital();
}

function formatName(str) {
  if (!str) return '';
  str = str.replace(/\s+/g, ' ').trim();
  const lowerWords = ['da', 'de', 'do', 'das', 'dos', 'e', 'ou', 'em', 'para', 'com', 'por', 'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas'];
  return str.split(' ').map((word, i) => {
    word = word.toLowerCase();
    if (i === 0 || !lowerWords.includes(word)) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }).join(' ');
}

function parseEditalText(text) {
  let disciplinas = [];
  let currentDisc = null;
  const lines = text.split('\n');
  let discCounter = 0;
  let topicCounter = 0;
  const timestamp = Date.now();
  
  lines.forEach(line => {
    line = line.trim();
    if (!line) return;
    
    // Pattern: "DISCIPLINA: 1. topico 2. topico"
    if (line.includes(':') && line.split(':')[0] === line.split(':')[0].toUpperCase()) {
      let parts = line.split(':');
      let discName = formatName(parts[0].trim());
      let topicsText = parts.slice(1).join(':').trim();
      currentDisc = { id: 'd_' + timestamp + '_' + String(discCounter++).padStart(4, '0'), nome: discName, topicos: [] };
      disciplinas.push(currentDisc);
      
      let topics = topicsText.split(/(?=(?<!\.)\b\d+(?:\.\d+)*\.?\s)/).map(t => formatName(t.trim())).filter(t => t);
      topics.forEach(t => {
        currentDisc.topicos.push({ id: 't_' + timestamp + '_' + String(topicCounter++).padStart(4, '0'), nome: t, estudado: false, questoesFeitas: 0, questoesCertas: 0, tecLink: "" });
      });
    } 
    // Pattern: ALL CAPS line
    else if (line === line.toUpperCase() && line.length > 3 && !/^\d/.test(line)) {
      currentDisc = { id: 'd_' + timestamp + '_' + String(discCounter++).padStart(4, '0'), nome: formatName(line), topicos: [] };
      disciplinas.push(currentDisc);
    } 
    // Topics
    else {
      if (!currentDisc) {
        currentDisc = { id: 'd_' + timestamp + '_' + String(discCounter++).padStart(4, '0'), nome: 'Conhecimentos Gerais', topicos: [] };
        disciplinas.push(currentDisc);
      }
      if (line.match(/(?=(?<!\.)\b\d+(?:\.\d+)*\.?\s)/)) {
        let topics = line.split(/(?=(?<!\.)\b\d+(?:\.\d+)*\.?\s)/).map(t => formatName(t.trim())).filter(t => t);
        topics.forEach(t => {
          currentDisc.topicos.push({ id: 't_' + timestamp + '_' + String(topicCounter++).padStart(4, '0'), nome: t, estudado: false, questoesFeitas: 0, questoesCertas: 0, tecLink: "" });
        });
      } else {
        currentDisc.topicos.push({ id: 't_' + timestamp + '_' + String(topicCounter++).padStart(4, '0'), nome: formatName(line), estudado: false, questoesFeitas: 0, questoesCertas: 0, tecLink: "" });
      }
    }
  });
  return disciplinas;
}

async function importEdital(title, text) {
  const newEdital = {
    id: 'e_' + Date.now().toString(36),
    titulo: title,
    disciplinas: text.trim() ? parseEditalText(text) : []
  };
  editaisData.push(newEdital);
  currentEditalId = newEdital.id;
  saveEditais();
  renderEditalSelect();
  renderEdital();

  // Salvar no Supabase
  await window.supabaseClient.from('editais').insert({ id: newEdital.id, cargo: title, orgao: 'Importado', status: 'aberto' });
  for (const d of newEdital.disciplinas) {
    await window.supabaseClient.from('disciplinas').insert({ id: d.id, edital_id: newEdital.id, nome: d.nome });
    for (const t of d.topicos) {
      await window.supabaseClient.from('topicos').insert({
        id: t.id, disciplina_id: d.id, nome: t.nome, estudado: t.estudado, 
        questoes_feitas: t.questoesFeitas, questoes_certas: t.questoesCertas, tec_link: t.tecLink,
        tempo_gasto: t.tempoGasto || 0
      });
    }
  }
}

function renderEditalSelect() {
  const select = document.getElementById('est-edital-select');
  if (!select) return;
  select.innerHTML = '';
  
  if (editaisData.length === 0) {
    select.innerHTML = '<option value="" disabled selected>Nenhum edital cadastrado</option>';
    return;
  }
  
  editaisData.forEach(ed => {
    const opt = document.createElement('option');
    opt.value = ed.id;
    opt.textContent = ed.titulo;
    if (ed.id === currentEditalId) opt.selected = true;
    select.appendChild(opt);
  });
}

/* A aba é desenhada pelo estudos.edital.js */
function renderEdital() {
  if (window.estEdital) window.estEdital.render();
}

function getTopicParams(eId, dId, tId) {
  const e = editaisData.find(x => x.id === eId);
  const d = e.disciplinas.find(x => x.id === dId);
  const t = d.topicos.find(x => x.id === tId);
  return {e, d, t};
}

async function toggleTopic(eId, dId, tId, checked) {
  const {t} = getTopicParams(eId, dId, tId);
  t.estudado = checked;
  saveEditais();
  renderEdital();
  renderCards();

  await window.supabaseClient.from('topicos').update({ estudado: checked }).eq('id', tId);

  // Tópico concluído: fecha a meta da semana e agenda a primeira revisão
  if (checked) {
    await window.estPlano.topicoConcluido(tId);
    renderEdital(); // mostra a revisão recém-agendada
  }
}

async function updateTopicName(eId, dId, tId, newName) {
  const {t} = getTopicParams(eId, dId, tId);
  if(newName.trim()) {
    t.nome = newName.trim();
    saveEditais();
    await window.supabaseClient.from('topicos').update({ nome: t.nome }).eq('id', tId);
  }
}

async function updateDiscName(eId, dId, newName) {
  const e = editaisData.find(x => x.id === eId);
  const d = e.disciplinas.find(x => x.id === dId);
  if(newName.trim()) {
    d.nome = newName.trim();
    saveEditais();
    await window.supabaseClient.from('disciplinas').update({ nome: d.nome }).eq('id', dId);
  }
}

window.promptTecLink = async function(eId, dId, tId) {
  const edital = editaisData.find(x => x.id === eId);
  const disc = edital.disciplinas.find(x => x.id === dId);
  const topic = disc.topicos.find(x => x.id === tId);

  if (topic.tecLink) {
    window.open(topic.tecLink, '_blank');
    setTimeout(async () => {
      const newL = await customPrompt('Para alterar o link do TEC, cole a nova URL abaixo:', topic.tecLink);
      if (newL !== null) { 
        topic.tecLink = newL.trim(); 
        saveEditais(); 
        renderEdital();
        await window.supabaseClient.from('topicos').update({ tec_link: topic.tecLink }).eq('id', tId);
      }
    }, 500);
  } else {
    const newL = await customPrompt('Cole a URL do caderno do TEC Concursos para este assunto:');
    if (newL !== null && newL.trim() !== '') {
      topic.tecLink = newL.trim();
      saveEditais();
      renderEdital();
      await window.supabaseClient.from('topicos').update({ tec_link: topic.tecLink }).eq('id', tId);
    }
  }
}

async function deleteTopic(eId, dId, tId) {
  if(!(await customConfirm('Excluir este tópico?'))) return;
  const e = editaisData.find(x => x.id === eId);
  const d = e.disciplinas.find(x => x.id === dId);
  d.topicos = d.topicos.filter(x => x.id !== tId);
  saveEditais();
  renderEdital();
  await window.supabaseClient.from('topicos').delete().eq('id', tId);
}

window.addTopic = async function(eId, dId) {
  const e = editaisData.find(x => x.id === eId);
  const d = e.disciplinas.find(x => x.id === dId);
  const nome = await customPrompt('Nome do novo tópico:');
  if (nome && nome.trim()) {
    const newTopic = { id: 't_' + Date.now(), nome: nome.trim(), estudado: false, questoesFeitas: 0, questoesCertas: 0, tecLink: "", tempoGasto: 0 };
    d.topicos.push(newTopic);
    saveEditais();
    renderEdital();
    await window.supabaseClient.from('topicos').insert({ id: newTopic.id, disciplina_id: d.id, nome: newTopic.nome, estudado: false, questoes_feitas: 0, questoes_certas: 0, tec_link: "", tempo_gasto: 0 });
  }
}

window.addDisc = async function(eId) {
  const e = editaisData.find(x => x.id === eId);
  const nome = await customPrompt('Nome da nova disciplina:');
  if (nome && nome.trim()) {
    const newDisc = { id: 'd_' + Date.now(), nome: nome.trim(), topicos: [] };
    e.disciplinas.push(newDisc);
    saveEditais();
    renderEdital();
    await window.supabaseClient.from('disciplinas').insert({ id: newDisc.id, edital_id: e.id, nome: newDisc.nome });
  }
}

/* =============================================
   MÓDULO: REVISÃO DE TÓPICO
============================================= */
function initRevisaoUI() {
  const overlay = document.getElementById('est-modal-revisao');
  const closeBtn = document.getElementById('est-modal-revisao-close');
  const revForm = document.getElementById('est-revisao-form');

  if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
  if (overlay) overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.remove('active'); });

  const detalheOverlay = document.getElementById('est-modal-detalhe-caderno');
  const detalheCloseBtn = document.getElementById('est-modal-detalhe-close');
  if (detalheCloseBtn) detalheCloseBtn.addEventListener('click', () => detalheOverlay.classList.remove('active'));
  if (detalheOverlay) detalheOverlay.addEventListener('click', (e) => { if (e.target === detalheOverlay) detalheOverlay.classList.remove('active'); });

  const refazerOverlay = document.getElementById('est-modal-refazer');
  const refazerCloseBtn = document.getElementById('est-modal-refazer-close');
  const refazerForm = document.getElementById('est-refazer-form');
  if (refazerCloseBtn) refazerCloseBtn.addEventListener('click', () => refazerOverlay.classList.remove('active'));
  if (refazerOverlay) refazerOverlay.addEventListener('click', (e) => { if (e.target === refazerOverlay) refazerOverlay.classList.remove('active'); });

  const tempoOverlay = document.getElementById('est-modal-tempo');
  const tempoCloseBtn = document.getElementById('est-modal-tempo-close');
  const tempoForm = document.getElementById('est-tempo-form');
  if (tempoCloseBtn) tempoCloseBtn.addEventListener('click', () => tempoOverlay.classList.remove('active'));
  if (tempoOverlay) tempoOverlay.addEventListener('click', (e) => { if (e.target === tempoOverlay) tempoOverlay.classList.remove('active'); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.est-modal-overlay.active').forEach(modal => {
        modal.classList.remove('active');
      });
    }
  });

  if (revForm) {
    revForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentRevContext) return;
      
      const edital = editaisData.find(ed => ed.id === currentRevContext.editalId);
      if (!edital) return;
      const disc = edital.disciplinas.find(d => d.id === currentRevContext.discId);
      if (!disc) return;
      const topic = disc.topicos.find(t => t.id === currentRevContext.topicId);
      if (!topic) return;
      
      const novasFeitas = parseInt(document.getElementById('est-rev-q-feitas').value) || 0;
      const novasCertas = parseInt(document.getElementById('est-rev-q-certas').value) || 0;
      
      topic.questoesFeitas = novasFeitas;
      topic.questoesCertas = novasCertas;
      
      saveEditais();
      renderEdital();
      renderCards();
      renderQuestionsChart();
      
      overlay.classList.remove('active');
      await window.supabaseClient.from('topicos').update({ questoes_feitas: topic.questoesFeitas, questoes_certas: topic.questoesCertas }).eq('id', topic.id);
    });
  }

  if (tempoForm) {
    tempoForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentRevContext) return;
      
      const edital = editaisData.find(ed => ed.id === currentRevContext.editalId);
      if (!edital) return;
      const disc = edital.disciplinas.find(d => d.id === currentRevContext.discId);
      if (!disc) return;
      const topic = disc.topicos.find(t => t.id === currentRevContext.topicId);
      if (!topic) return;

      const horas = parseInt(document.getElementById('est-tempo-h').value) || 0;
      const minutos = parseInt(document.getElementById('est-tempo-m').value) || 0;
      
      topic.tempoGasto = (topic.tempoGasto || 0) + (horas * 60) + minutos;
      
      saveEditais();
      renderEdital();
      renderCards();
      
      tempoOverlay.classList.remove('active');
      await window.supabaseClient.from('topicos').update({ tempo_gasto: topic.tempoGasto }).eq('id', topic.id);
    });
  }

  if (refazerForm) {
    refazerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentRevContext) return;
      
      const edital = editaisData.find(ed => ed.id === currentRevContext.editalId);
      if (!edital) return;
      const disc = edital.disciplinas.find(d => d.id === currentRevContext.discId);
      if (!disc) return;
      const topic = disc.topicos.find(t => t.id === currentRevContext.topicId);
      if (!topic) return;
      
      const newTecLink = document.getElementById('est-refazer-tec').value.trim();
      const novasFeitas = parseInt(document.getElementById('est-refazer-q-feitas').value) || 0;
      const novasCertas = parseInt(document.getElementById('est-refazer-q-certas').value) || 0;
      
      if (newTecLink) {
        topic.tecLink = newTecLink;
      }
      
      topic.questoesFeitas = (topic.questoesFeitas || 0) + novasFeitas;
      topic.questoesCertas = (topic.questoesCertas || 0) + novasCertas;
      
      saveEditais();
      renderEdital();
      renderCards();
      renderQuestionsChart();
      
      refazerOverlay.classList.remove('active');
      await window.supabaseClient.from('topicos').update({ questoes_feitas: topic.questoesFeitas, questoes_certas: topic.questoesCertas, tec_link: topic.tecLink }).eq('id', topic.id);
    });
  }
}

window.promptRevisao = function(editalId, discId, topicId) {
  const edital = editaisData.find(ed => ed.id === editalId);
  const disc = edital.disciplinas.find(d => d.id === discId);
  const topic = disc.topicos.find(t => t.id === topicId);
  
  if (!topic) return;
  
  currentRevContext = { editalId, discId, topicId };
  
  document.getElementById('est-rev-topic-name').textContent = topic.nome;
  document.getElementById('est-rev-q-feitas').value = topic.questoesFeitas || 0;
  document.getElementById('est-rev-q-certas').value = topic.questoesCertas || 0;
  
  document.getElementById('est-modal-revisao').classList.add('active');
};

window.promptRefazer = function(editalId, discId, topicId) {
  const edital = editaisData.find(ed => ed.id === editalId);
  const disc = edital.disciplinas.find(d => d.id === discId);
  const topic = disc.topicos.find(t => t.id === topicId);
  
  if (!topic) return;
  
  currentRevContext = { editalId, discId, topicId };
  
  document.getElementById('est-refazer-topic-name').textContent = topic.nome;
  document.getElementById('est-refazer-tec').value = topic.tecLink || '';
  document.getElementById('est-refazer-q-feitas').value = '';
  document.getElementById('est-refazer-q-certas').value = '';
  
  document.getElementById('est-modal-refazer').classList.add('active');
};

window.promptTempo = function(editalId, discId, topicId) {
  const edital = editaisData.find(ed => ed.id === editalId);
  const disc = edital.disciplinas.find(d => d.id === discId);
  const topic = disc.topicos.find(t => t.id === topicId);
  
  if (!topic) return;
  
  currentRevContext = { editalId, discId, topicId };
  
  document.getElementById('est-tempo-topic-name').textContent = topic.nome;
  document.getElementById('est-tempo-h').value = '';
  document.getElementById('est-tempo-m').value = '';
  
  document.getElementById('est-modal-tempo').classList.add('active');
};

window.customPrompt = function(message, defaultValue = '') {
  return new Promise((resolve) => {
    const modal = document.getElementById('est-modal-prompt');
    const titleEl = document.getElementById('est-modal-prompt-title');
    const inputEl = document.getElementById('est-prompt-input');
    const formEl = document.getElementById('est-prompt-form');
    const closeBtn = document.getElementById('est-modal-prompt-close');
    const cancelBtn = document.getElementById('est-modal-prompt-cancel');
    
    titleEl.textContent = message;
    inputEl.value = defaultValue;
    modal.classList.add('active');
    inputEl.focus();

    function cleanup() {
      modal.classList.remove('active');
      formEl.onsubmit = null;
      closeBtn.onclick = null;
      cancelBtn.onclick = null;
    }

    formEl.onsubmit = (e) => {
      e.preventDefault();
      const val = inputEl.value;
      cleanup();
      resolve(val);
    };

    closeBtn.onclick = cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };
  });
};

window.customConfirm = function(message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('est-modal-confirm');
    const msgEl = document.getElementById('est-modal-confirm-msg');
    const closeBtn = document.getElementById('est-modal-confirm-close');
    const cancelBtn = document.getElementById('est-modal-confirm-cancel');
    const okBtn = document.getElementById('est-modal-confirm-ok');
    
    msgEl.textContent = message;
    modal.classList.add('active');

    function cleanup() {
      modal.classList.remove('active');
      okBtn.onclick = null;
      closeBtn.onclick = null;
      cancelBtn.onclick = null;
    }

    okBtn.onclick = () => {
      cleanup();
      resolve(true);
    };

    closeBtn.onclick = cancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
};

/* =============================================
   RESUMOS
============================================= */
/* Grava o resumo de um tópico (backup local + Supabase). Usado pela janela de resumo (estudos.sessao.js). */
async function salvarResumo(discNome, topicNome, htmlContent, quiet = false) {
  const isVazio = !htmlContent || htmlContent.trim() === '' || htmlContent === '<p><br></p>';
  const key = makeResumoKey(discNome, topicNome);

  // Atualiza mapa em memória
  if (isVazio) {
    delete resumosMap[key];
  } else {
    if (!resumosMap[key]) resumosMap[key] = { id: null, conteudo: '', disciplina_nome: discNome.trim(), topico_nome: topicNome.trim() };
    resumosMap[key].conteudo = htmlContent;
  }

  // Salva no backup local
  try {
    let backups = {};
    const rawBackups = localStorage.getItem('est_resumos_backup');
    if (rawBackups) backups = JSON.parse(rawBackups);
    if (isVazio) {
      delete backups[key];
    } else {
      backups[key] = htmlContent;
    }
    localStorage.setItem('est_resumos_backup', JSON.stringify(backups));
  } catch (backupErr) {
    console.error('Erro ao salvar backup local do resumo:', backupErr);
  }

  // Sincroniza com Supabase usando disciplina_nome + topico_nome
  try {
    const existingId = resumosMap[key]?.id || null;
    if (existingId) {
      const { error: updErr } = await window.supabaseClient
        .from('resumos')
        .update({ conteudo: htmlContent, updated_at: new Date().toISOString() })
        .eq('id', existingId);
      if (updErr) throw updErr;
    } else if (!isVazio) {
      // Verifica se já existe por nome antes de inserir
      const { data: existing, error: selErr } = await window.supabaseClient
        .from('resumos')
        .select('id')
        .eq('disciplina_nome', discNome.trim())
        .eq('topico_nome', topicNome.trim())
        .maybeSingle();
      if (selErr) throw selErr;
      if (existing) {
        resumosMap[key].id = existing.id;
        const { error: updErr2 } = await window.supabaseClient
          .from('resumos')
          .update({ conteudo: htmlContent, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        if (updErr2) throw updErr2;
      } else {
        const newId = 'r_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        const { error: insErr } = await window.supabaseClient
          .from('resumos')
          .insert({
            id: newId,
            disciplina_nome: discNome.trim(),
            topico_nome: topicNome.trim(),
            conteudo: htmlContent
          });
        if (insErr) throw insErr;
        resumosMap[key].id = newId;
      }
    }
    renderMeusResumos();
  } catch (err) {
    console.error('Erro ao salvar resumo no Supabase:', err);
    if (!quiet) {
      alert('Aviso: O resumo foi salvo localmente, mas houve erro ao sincronizar com a nuvem.');
    }
    renderMeusResumos();
  }
}

/* O resumo abre na janela com páginas (estudos.sessao.js) e a seção "Meus Resumos"
   monta o resumo geral de cada matéria (estudos.resumos.js). */
window.promptResumo = function(editalId, discId, topicId) {
  const edital = editaisData.find(ed => ed.id === editalId);
  if (!edital) return;
  const disc = edital.disciplinas.find(d => d.id === discId);
  if (!disc) return;
  const topic = disc.topicos.find(t => t.id === topicId);
  if (!topic) return;
  promptResumoByName(disc.nome, topic.nome);
};

window.promptResumoByName = function(discNome, topicNome) {
  if (window.estSessao) window.estSessao.abrirResumo(discNome, topicNome);
};

function renderMeusResumos() {
  if (window.estResumos) window.estResumos.render();
}

window.reorderDisc = function(eId, dId, direction) {
  const edital = editaisData.find(e => e.id === eId);
  if (!edital) return;
  const idx = edital.disciplinas.findIndex(d => d.id === dId);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= edital.disciplinas.length) return;
  const temp = edital.disciplinas[idx];
  edital.disciplinas[idx] = edital.disciplinas[newIdx];
  edital.disciplinas[newIdx] = temp;
  localStorage.setItem('disc_order_' + eId, JSON.stringify(edital.disciplinas.map(d => d.id)));
  edital.disciplinas.forEach((d, i) => { d.ordem = i; });
  saveEditais();
  renderEdital();
  renderCards();
  // Sem a coluna "ordem" (supabase/estudos-plano.sql), fica só a ordem deste navegador
  Promise.all(edital.disciplinas.map(d =>
    window.supabaseClient.from('disciplinas').update({ ordem: d.ordem }).eq('id', d.id)
  )).then(rs => {
    const erro = rs.find(r => r.error);
    if (erro) console.warn('Ordem das disciplinas não foi salva no Supabase:', erro.error.message);
  });
};

/* =============================================
   MÓDULO: HISTÓRICO DE SESSÕES
============================================= */
function renderHistorico() {
  const container = document.getElementById('est-historico-container');
  if (!container) return;
  
  if (studyData.length === 0) {
    container.innerHTML = `
      <div class="est-sessions-empty" style="padding: 60px 20px;">
        <span class="est-sessions-empty-icon">⏳</span>
        <p>Nenhuma sessão de estudo registrada no histórico ainda.<br/>Suas sessões aparecerão aqui agrupadas por data.</p>
      </div>
    `;
    return;
  }
  
  // Agrupa sessões por data
  const grouped = {};
  studyData.forEach(s => {
    const d = s.date;
    if (!grouped[d]) grouped[d] = [];
    grouped[d].push(s);
  });
  
  // Ordena datas em ordem decrescente
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  
  let html = '';
  
  sortedDates.forEach(dateStr => {
    const sessions = grouped[dateStr];
    // Ordena sessões do dia por timestamp decrescente
    sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    
    // Totais diários
    const totalMinutes = sessions.reduce((acc, curr) => acc + curr.timeMinutes, 0);
    const totalFeitas = sessions.reduce((acc, curr) => acc + curr.questionsTotal, 0);
    const totalCertas = sessions.reduce((acc, curr) => acc + curr.questionsCorrect, 0);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    const timeStr = hours > 0 ? `${hours}h${mins > 0 ? mins + 'm' : ''}` : `${mins}m`;
    
    // Formatação da data
    const dateObj = new Date(dateStr + 'T12:00:00');
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    let formattedDate = dateObj.toLocaleDateString('pt-BR', options);
    formattedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
    
    html += `
      <div class="est-historico-day" style="background: var(--est-bg-card); border: 1px solid var(--est-border); border-radius: 12px; padding: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.15); margin-bottom: 16px; text-align: left;">
        <div class="est-historico-day-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--est-border); padding-bottom: 12px; margin-bottom: 14px; flex-wrap: wrap; gap: 10px;">
          <h4 style="font-size: 1.05rem; color: #fff; font-weight: 600; font-family: var(--est-font-display);">${formattedDate}</h4>
          <div style="display: flex; gap: 16px; font-size: 0.8rem; color: var(--est-accent);">
            <span>⏱ Total: <strong>${timeStr}</strong></span>
            ${totalFeitas > 0 ? `<span>📝 Questões: <strong>${totalFeitas}f</strong> / <strong style="color:var(--est-green);">${totalCertas}c</strong></span>` : ''}
          </div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${sessions.map(s => {
            const sH = Math.floor(s.timeMinutes / 60);
            const sM = s.timeMinutes % 60;
            const sTimeStr = sH > 0 ? `${sH}h${sM > 0 ? sM + 'm' : ''}` : `${sM}m`;
            
            return `
              <div class="est-session-item" style="border-color: rgba(255,255,255,0.03); background: rgba(20, 22, 36, 0.4); display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 12px; align-items: center; padding: 14px 16px; border-radius: 8px;">
                <div class="est-session-status ${s.metaDone ? 'done' : 'pending'}">
                  ${s.metaDone ? '✓' : '○'}
                </div>
                <div class="est-session-disc">
                  <span class="est-session-disc-name">${escapeHtml(s.discipline)}</span>
                  ${s.topic ? `<span class="est-session-disc-topic">${escapeHtml(s.topic)}</span>` : ''}
                </div>
                <div class="est-session-time">
                  <span class="est-session-time-icon">⏱</span> ${sTimeStr}
                </div>
                <div class="est-session-questions">
                  ${s.questionsTotal > 0
                    ? `<span class="est-q-total">${s.questionsTotal}f</span> — <span class="est-q-correct">${s.questionsCorrect}c</span>`
                    : '<span style="opacity:0.4">—</span>'
                  }
                </div>
                <button class="est-session-delete" onclick="deleteSessionFromHistory('${s.id}')" title="Remover sessão" aria-label="Remover sessão">✕</button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
}

window.deleteSessionFromHistory = function(id) {
  if (confirm('Deseja excluir esta sessão de estudo do histórico?')) {
    deleteSession(id);
    renderHistorico();
  }
}