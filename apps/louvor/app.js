document.addEventListener('DOMContentLoaded', () => {
  // State
  let integrantes = JSON.parse(localStorage.getItem('louvor_integrantes')) || [];
  let eventos = JSON.parse(localStorage.getItem('louvor_eventos')) || [];
  let eventoAtivoId = null;

  // DOM Elements
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');
  
  // Integrantes
  const formIntegrante = document.getElementById('form-integrante');
  const listaIntegrantes = document.getElementById('lista-integrantes');
  
  // Eventos
  const formEvento = document.getElementById('form-evento');
  const listaEventos = document.getElementById('lista-eventos');
  
  // Editor
  const editorEvento = document.getElementById('editor-evento');
  const editorTitulo = document.getElementById('editor-titulo');
  const btnFecharEditor = document.getElementById('btn-fechar-editor');
  const escalaRepertorio = document.getElementById('escala-repertorio');
  const escalaEquipeSelect = document.getElementById('escala-equipe-select');
  
  // Preview
  const renderEventosList = document.getElementById('render-eventos');
  const btnGerarImagem = document.getElementById('btn-gerar-imagem');

  // --- TABS ---
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      
      tab.classList.add('active');
      document.getElementById(tab.dataset.target).classList.add('active');
    });
  });

  // --- UTILS ---
  function formatarData(dataString) {
    if (!dataString) return '';
    const [ano, mes, dia] = dataString.split('-');
    return `${dia}/${mes}`; // Resumo para o banner
  }

  // --- INTEGRANTES ---
  function salvarIntegrantes() {
    localStorage.setItem('louvor_integrantes', JSON.stringify(integrantes));
    renderIntegrantesList();
    if (eventoAtivoId) renderEscalaEquipeSelect();
  }

  formIntegrante.addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = document.getElementById('nome-integrante').value.trim();
    const rolesCheckboxes = document.querySelectorAll('input[name="role"]:checked');
    const roles = Array.from(rolesCheckboxes).map(cb => cb.value);

    if (nome && roles.length > 0) {
      integrantes.push({ id: Date.now().toString(), nome, roles });
      salvarIntegrantes();
      formIntegrante.reset();
    } else {
      alert('Por favor, insira o nome e selecione pelo menos uma função.');
    }
  });

  function renderIntegrantesList() {
    listaIntegrantes.innerHTML = '';
    integrantes.forEach(int => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="item-info">
          <strong>${int.nome}</strong>
          <span>${int.roles.join(', ')}</span>
        </div>
        <button class="btn-delete" data-id="${int.id}" title="Remover">&times;</button>
      `;
      listaIntegrantes.appendChild(li);
    });

    document.querySelectorAll('#lista-integrantes .btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        integrantes = integrantes.filter(i => i.id !== id);
        salvarIntegrantes();
        atualizarPreview();
      });
    });
  }

  // --- EVENTOS (CULTOS) ---
  function salvarEventos() {
    // Sort events by date
    eventos.sort((a, b) => new Date(a.data) - new Date(b.data));
    localStorage.setItem('louvor_eventos', JSON.stringify(eventos));
    renderEventosListView();
    atualizarPreview();
  }

  formEvento.addEventListener('submit', (e) => {
    e.preventDefault();
    const nome = document.getElementById('evento-nome').value.trim();
    const data = document.getElementById('evento-data').value;

    if (nome && data) {
      eventos.push({
        id: Date.now().toString(),
        nome,
        data,
        repertorio: '',
        equipe: [] // Array of { id, nome, funcao }
      });
      salvarEventos();
      formEvento.reset();
    }
  });

  function renderEventosListView() {
    listaEventos.innerHTML = '';
    if (eventos.length === 0) {
      listaEventos.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nenhum culto cadastrado no mês.</p>';
      return;
    }

    eventos.forEach(ev => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="item-info">
          <strong>${ev.nome}</strong>
          <span>${formatarData(ev.data)} • ${ev.equipe.length} escalado(s)</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-edit" data-id="${ev.id}">Editar Equipe</button>
          <button class="btn-delete btn-del-evento" data-id="${ev.id}" title="Remover">&times;</button>
        </div>
      `;
      listaEventos.appendChild(li);
    });

    // Delete Event
    document.querySelectorAll('.btn-del-evento').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        eventos = eventos.filter(ev => ev.id !== id);
        if (eventoAtivoId === id) fecharEditor();
        salvarEventos();
      });
    });

    // Edit Event
    document.querySelectorAll('.btn-edit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        abrirEditor(e.target.dataset.id);
      });
    });
  }

  // --- EDITOR DO EVENTO ATIVO ---
  function abrirEditor(id) {
    eventoAtivoId = id;
    const evento = eventos.find(e => e.id === id);
    if (!evento) return;

    editorTitulo.textContent = `${evento.nome} (${formatarData(evento.data)})`;
    escalaRepertorio.value = evento.repertorio;
    editorEvento.style.display = 'block';
    
    renderEscalaEquipeSelect();
  }

  function fecharEditor() {
    eventoAtivoId = null;
    editorEvento.style.display = 'none';
  }
  btnFecharEditor.addEventListener('click', fecharEditor);

  function renderEscalaEquipeSelect() {
    const evento = eventos.find(e => e.id === eventoAtivoId);
    escalaEquipeSelect.innerHTML = '';
    if (integrantes.length === 0) {
      escalaEquipeSelect.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem">Nenhum integrante cadastrado.</p>';
      return;
    }

    integrantes.forEach(int => {
      // Check if already in event
      const escalado = evento.equipe.find(e => e.id === int.id);
      const isChecked = !!escalado;
      
      const label = document.createElement('label');
      
      // Sempre mostra um select para dar flexibilidade
      const todasFuncoes = ["Vocal", "Violão", "Guitarra", "Baixo", "Bateria", "Teclado", "Saxofone", "Cajon"];
      const selectedRole = escalado ? escalado.funcao : (int.roles[0] || "Vocal");
      
      let roleHtml = `<select class="select-role" data-id="${int.id}">`;
      // Adiciona as funções oficiais se não estiverem na lista padrão, só para garantir
      const funcoesRenderizar = Array.from(new Set([...todasFuncoes, ...int.roles]));
      
      funcoesRenderizar.forEach(r => {
        roleHtml += `<option value="${r}" ${r === selectedRole ? 'selected' : ''}>${r}</option>`;
      });
      roleHtml += `</select>`;

      label.innerHTML = `
        <input type="checkbox" class="equipe-checkbox" value="${int.id}" ${isChecked ? 'checked' : ''}>
        ${int.nome}
        ${roleHtml}
      `;
      escalaEquipeSelect.appendChild(label);
    });

    // Listeners para salvar alterações em tempo real no evento ativo
    document.querySelectorAll('.equipe-checkbox, .select-role').forEach(el => {
      el.addEventListener('change', atualizarEventoAtivo);
    });
  }

  function atualizarEventoAtivo() {
    if (!eventoAtivoId) return;
    const evento = eventos.find(e => e.id === eventoAtivoId);
    
    // Save Repertory
    evento.repertorio = escalaRepertorio.value.trim();

    // Save Equipe
    const selecionados = Array.from(document.querySelectorAll('.equipe-checkbox:checked')).map(cb => {
      const id = cb.value;
      const integrante = integrantes.find(i => i.id === id);
      const roleSelect = document.querySelector(`select.select-role[data-id="${id}"]`);
      const funcao = roleSelect ? roleSelect.value : '';
      
      return { id: integrante.id, nome: integrante.nome, funcao };
    });

    evento.equipe = selecionados;
    
    // Salvar siletemente para não recriar a view do painel enquanto digita, apenas atualiza localstorage e preview
    localStorage.setItem('louvor_eventos', JSON.stringify(eventos));
    renderEventosListView(); // Atualiza contador de escalados na lista principal
    atualizarPreview();
  }

  escalaRepertorio.addEventListener('input', atualizarEventoAtivo);

  // --- PREVIEW DO MÊS ---
  function atualizarPreview() {
    renderEventosList.innerHTML = '';
    const renderTituloMes = document.getElementById('render-titulo-mes');
    
    if (eventos.length === 0) {
      renderEventosList.innerHTML = '<p style="text-align:center; color:var(--text-muted)">Nenhum evento criado.</p>';
      if(renderTituloMes) renderTituloMes.textContent = 'Escala Mensal';
      return;
    }

    // Atualizar Título com o Mês
    if(renderTituloMes) {
      const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
      const dateParts = eventos[0].data.split('-'); // [YYYY, MM, DD]
      if (dateParts.length >= 2) {
        const mesIndex = parseInt(dateParts[1], 10) - 1;
        renderTituloMes.textContent = `Escala de ${meses[mesIndex]}`;
      }
    }

    eventos.forEach(ev => {
      const block = document.createElement('div');
      block.className = 'evento-block';
      
      // Header do Bloco
      let html = `
        <div class="evento-block-title">
          <span>${ev.nome}</span>
          <span class="evento-block-date">${formatarData(ev.data)}</span>
        </div>
      `;

      // Equipe
      html += `<ul class="render-equipe-list">`;
      if (ev.equipe.length === 0) {
        html += `<li style="grid-column: 1 / -1; color:var(--text-muted);">Nenhum escalado.</li>`;
      } else {
        ev.equipe.forEach(eq => {
          html += `<li><span>${eq.nome}</span> <span class="role">${eq.funcao}</span></li>`;
        });
      }
      html += `</ul>`;

      // Repertório (Opcional, só renderiza se tiver algo)
      if (ev.repertorio) {
        html += `<div class="evento-repertorio"><strong>Repertório:</strong>\n${ev.repertorio}</div>`;
      }

      block.innerHTML = html;
      renderEventosList.appendChild(block);
    });
  }

  // --- GERAR IMAGEM ---
  btnGerarImagem.addEventListener('click', () => {
    const captureArea = document.getElementById('capture-area');
    const originalBorder = captureArea.style.border;
    captureArea.style.border = 'none'; // Clean look
    
    html2canvas(captureArea, {
      scale: 2, 
      backgroundColor: '#11121c',
      logging: false,
      useCORS: true
    }).then(canvas => {
      captureArea.style.border = originalBorder;

      const link = document.createElement('a');
      link.download = `Escala_Mensal_Louvor.png`;
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link); // Required for some browsers
      link.click();
      document.body.removeChild(link);
    }).catch(err => {
      console.error("Erro ao gerar imagem:", err);
      alert("Houve um problema ao tentar gerar a imagem. Verifique o console.");
    });
  });

  // Init
  renderIntegrantesList();
  renderEventosListView();
  atualizarPreview();
});
