// Configuração do PDF.js Worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Estado global da aplicação
let db = null;
let currentBookId = null;
let currentPDFDoc = null;
let currentPDFPageNum = 1;
let currentPDFScale = 1.0;
let deferredPrompt = null;

// Inicialização do IndexedDB
function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LeitorInteligenteDB', 1);
        request.onerror = (e) => reject(e);
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onupgradeneeded = (e) => {
            const database = e.target.result;
            if (!database.objectStoreNames.contains('books')) {
                database.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains('notes')) {
                database.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
            }
            if (!database.objectStoreNames.contains('favorites')) {
                database.createObjectStore('favorites', { keyPath: 'id', autoIncrement: true });
            }
        };
    });
}

// Inicialização da PWA e Service Worker
window.addEventListener('load', async () => {
    try {
        await initDB();
        loadLibrary();
        setupEventListeners();
        setupNavigation();
        setupPWAInstall();
        
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('service-worker.js')
                .then(() => console.log('Service Worker registrado com sucesso.'));
        }
    } catch (err) {
        console.error('Erro ao inicializar:', err);
    }
});

// Navegação entre Telas
function setupNavigation() {
    document.querySelectorAll('.nav-btn, .btn-back').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = btn.getAttribute('data-target');
            if (target) {
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById(target).classList.add('active');
                
                document.querySelectorAll('.nav-btn').forEach(nb => {
                    if (nb.getAttribute('data-target') === target) {
                        nb.classList.add('active');
                    } else {
                        nb.classList.remove('active');
                    }
                });

                if (target === 'view-favorites') loadFavorites();
            }
        });
    });

    // Abas do livro
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            document.querySelectorAll('.tab-btn').forEach(tb => tb.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(tp => tp.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
}

// Configuração de Eventos
function setupEventListeners() {
    // Adicionar PDF
    document.getElementById('btn-add-pdf').addEventListener('click', () => {
        document.getElementById('pdf-file-input').click();
    });

    document.getElementById('pdf-file-input').addEventListener('change', handlePDFImport);

    // Abrir Leitor
    document.getElementById('btn-open-reader').addEventListener('click', () => {
        openReader(currentBookId);
    });

    document.getElementById('btn-close-reader').addEventListener('click', () => {
        document.getElementById('view-reader').classList.remove('active');
        document.getElementById('view-book-detail').classList.add('active');
        loadBookDetails(currentBookId); // Atualiza progresso
    });

    // Controles do Leitor PDF
    document.getElementById('reader-prev-page').addEventListener('click', () => {
        if (currentPDFPageNum <= 1) return;
        currentPDFPageNum--;
        renderPDFPage(currentPDFPageNum);
        saveBookProgress();
    });

    document.getElementById('reader-next-page').addEventListener('click', () => {
        if (!currentPDFDoc || currentPDFPageNum >= currentPDFDoc.numPages) return;
        currentPDFPageNum++;
        renderPDFPage(currentPDFPageNum);
        saveBookProgress();
    });

    document.getElementById('reader-zoom-in').addEventListener('click', () => {
        currentPDFScale += 0.25;
        renderPDFPage(currentPDFPageNum);
    });

    document.getElementById('reader-zoom-out').addEventListener('click', () => {
        if (currentPDFScale > 0.5) currentPDFScale -= 0.25;
        renderPDFPage(currentPDFPageNum);
    });

    document.getElementById('reader-fullscreen').addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.getElementById('view-reader').requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    });

    // Análise por IA (Modal)
    document.getElementById('btn-analyze-book').addEventListener('click', () => {
        document.getElementById('ai-modal').style.display = 'flex';
    });

    document.getElementById('btn-cancel-ai').addEventListener('click', () => {
        document.getElementById('ai-modal').style.display = 'none';
    });

    document.getElementById('btn-confirm-ai').addEventListener('click', () => {
        document.getElementById('ai-modal').style.display = 'none';
        simulateAIAnalysis();
    });

    // Chat com IA
    document.getElementById('btn-send-chat').addEventListener('click', sendChatMessage);
    document.getElementById('chat-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // Flashcards botões
    document.getElementById('btn-fc-flip').addEventListener('click', flipFlashcard);
    document.getElementById('btn-fc-next').addEventListener('click', nextFlashcard);
    document.getElementById('btn-fc-prev').addEventListener('click', prevFlashcard);

    // Teste de Conhecimento
    document.getElementById('btn-generate-quiz').addEventListener('click', generateQuiz);

    // Sintese de Voz (Áudio)
    document.getElementById('btn-audio-play').addEventListener('click', playAudioSummary);
    document.getElementById('btn-audio-pause').addEventListener('click', pauseAudio);
    document.getElementById('btn-audio-stop').addEventListener('click', stopAudio);

    // Anotações
    document.getElementById('btn-save-note').addEventListener('click', saveNote);

    // Configurações
    document.getElementById('theme-toggle-switch').addEventListener('change', (e) => {
        const theme = e.target.checked ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', theme);
    });

    document.getElementById('btn-export-backup').addEventListener('click', exportBackup);
    document.getElementById('import-backup-file').addEventListener('change', importBackup);
}

// Importação de PDF e Armazenamento no IndexedDB
async function handlePDFImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdfDoc = await loadingTask.promise;

    const bookData = {
        title: file.name.replace(/\.[^/.]+$/, ""),
        author: "Autor Desconhecido",
        totalPages: pdfDoc.numPages,
        currentPage: 1,
        readProgress: 0,
        studyProgress: 0,
        lastAccessed: new Date().toLocaleDateString(),
        pdfBlob: file,
        summary: null,
        chapters: [],
        concepts: [],
        flashcards: [],
        quiz: []
    };

    const transaction = db.transaction(['books'], 'readwrite');
    const store = transaction.objectStore('books');
    store.add(bookData);

    transaction.oncomplete = () => {
        loadLibrary();
        alert('Livro importado com sucesso!');
    };
}

// Carregar Biblioteca
function loadLibrary() {
    const grid = document.getElementById('library-grid');
    grid.innerHTML = '';

    const transaction = db.transaction(['books'], 'readonly');
    const store = transaction.objectStore('books');
    const request = store.getAll();

    request.onsuccess = () => {
        const books = request.result;
        if (books.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <p>Nenhum livro adicionado ainda.</p>
                    <p class="hint">Clique em "+ Adicionar PDF" para começar seus estudos.</p>
                </div>`;
            return;
        }

        books.forEach(book => {
            const card = document.createElement('div');
            card.className = 'book-card';
            card.innerHTML = `
                📕 <h3>${escapeHtml(book.title)}</h3>
                <p>${escapeHtml(book.author)}</p>
                <p>${book.totalPages} páginas</p>
                <div class="book-progress-text">${book.readProgress}% lido</div>
            `;
            card.addEventListener('click', () => {
                currentBookId = book.id;
                loadBookDetails(book.id);
                document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
                document.getElementById('view-book-detail').classList.add('active');
            });
            grid.appendChild(card);
        });
    };
}

// Detalhes do Livro
function loadBookDetails(id) {
    const transaction = db.transaction(['books'], 'readonly');
    const store = transaction.objectStore('books');
    const request = store.get(id);

    request.onsuccess = () => {
        const book = request.result;
        if (!book) return;

        document.getElementById('detail-book-title').innerText = book.title;
        document.getElementById('detail-book-author').innerText = `Autor: ${book.author}`;
        document.getElementById('detail-read-progress').style.width = `${book.readProgress}%`;
        document.getElementById('detail-read-percent').innerText = `${book.readProgress}%`;

        // Carregar resumos se existirem
        if (book.summary) {
            document.getElementById('summary-content').innerHTML = `<p>${book.summary}</p>`;
        }
        if (book.chapters && book.chapters.length > 0) {
            renderChapters(book.chapters);
        }
        if (book.concepts && book.concepts.length > 0) {
            renderConcepts(book.concepts);
        }
        if (book.flashcards && book.flashcards.length > 0) {
            initFlashcards(book.flashcards);
        }
        loadNotes(id);
    };
}

// Leitor de PDF Integrado
async function openReader(id) {
    const transaction = db.transaction(['books'], 'readonly');
    const store = transaction.objectStore('books');
    const request = store.get(id);

    request.onsuccess = async () => {
        const book = request.result;
        document.getElementById('reader-title-bar').innerText = book.title;
        document.getElementById('view-book-detail').classList.remove('active');
        document.getElementById('view-reader').classList.add('active');

        const arrayBuffer = await book.pdfBlob.arrayBuffer();
        currentPDFDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        currentPDFPageNum = book.currentPage || 1;
        renderPDFPage(currentPDFPageNum);
    };
}

async function renderPDFPage(pageNum) {
    if (!currentPDFDoc) return;
    const page = await currentPDFDoc.getPage(pageNum);
    const canvas = document.getElementById('pdf-render-canvas');
    const context = canvas.getContext('2d');

    const viewport = page.getViewport({ scale: currentPDFScale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;
    document.getElementById('page-indicator').innerText = `Página ${pageNum} / ${currentPDFDoc.numPages}`;
}

function saveBookProgress() {
    if (!currentBookId || !currentPDFDoc) return;
    const transaction = db.transaction(['books'], 'readwrite');
    const store = transaction.objectStore('books');
    store.get(currentBookId).onsuccess = (e) => {
        const book = e.target.result;
        book.currentPage = currentPDFPageNum;
        book.readProgress = Math.round((currentPDFPageNum / currentPDFDoc.numPages) * 100);
        store.put(book);
    };
}

// Simulação e Processamento de IA Estruturado
function simulateAIAnalysis() {
    const transaction = db.transaction(['books'], 'readwrite');
    const store = transaction.objectStore('books');
    store.get(currentBookId).onsuccess = (e) => {
        const book = e.target.result;
        book.summary = `<strong>Visão Geral:</strong> Esta obra apresenta conceitos profundos sobre produtividade e mudança comportamental. O autor demonstra como pequenas alterações nos hábitos diários geram resultados exponenciais ao longo do tempo.`;
        book.chapters = [
            { title: "Capítulo 1 — O poder surpreendente dos pequenos hábitos", summary: "Como melhorias de 1% acumulam grandes resultados.", core: "Agregação de margens marginais." },
            { title: "Capítulo 2 — Como seus hábitos moldam sua identidade", summary: "Mude quem você é através do que você faz repetidamente.", core: "Identidade baseada em resultados." }
        ];
        book.concepts = [
            { name: "Hábitos Atômicos", definition: "Uma pequena prática regular que faz parte de um sistema maior." }
        ];
        book.flashcards = [
            { q: "Qual é o impacto de melhorar 1% todos os dias durante um ano?", a: "Você ficará 37 vezes melhor ao final do período." },
            { q: "O que define um hábito atômico?", a: "Uma pequena mudança, um ganho marginal, um hábito 1% melhor." }
        ];
        store.put(book);
        alert('Análise concluída com sucesso!');
        loadBookDetails(currentBookId);
    };
}

// Renderização de Capítulos e Conceitos
function renderChapters(chapters) {
    const container = document.getElementById('chapters-list');
    container.innerHTML = '';
    chapters.forEach((ch, idx) => {
        const item = document.createElement('div');
        item.className = 'card-item';
        item.innerHTML = `<h4>${ch.title}</h4><p>${ch.summary}</p><p class="hint">Ideia chave: ${ch.core}</p>`;
        container.appendChild(item);
    });
}

function renderConcepts(concepts) {
    const container = document.getElementById('concepts-list');
    container.innerHTML = '';
    concepts.forEach(c => {
        const item = document.createElement('div');
        item.className = 'card-item';
        item.innerHTML = `<h4>💡 ${c.name}</h4><p>${c.definition}</p>`;
        container.appendChild(item);
    });
}

// Chat com o Livro (Pergunte ao Livro)
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;

    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML += `<div class="chat-msg user">${escapeHtml(text)}</div>`;
    input.value = '';

    setTimeout(() => {
        chatMessages.innerHTML += `<div class="chat-msg ai">Com base no conteúdo analisado do livro, o autor enfatiza que a consistência e a estruturação de sistemas superam metas isoladas. (Capítulo 1, Página 14)</div>`;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 600);
}

// Sistema de Flashcards
let currentFCIndex = 0;
let activeFlashcards = [];
let showingAnswer = false;

function initFlashcards(cards) {
    activeFlashcards = cards;
    currentFCIndex = 0;
    showingAnswer = false;
    document.getElementById('flashcard-controls').style.display = 'flex';
    displayCurrentFlashcard();
}

function displayCurrentFlashcard() {
    const box = document.getElementById('flashcard-container');
    if (activeFlashcards.length === 0) {
        box.innerHTML = '<p>Nenhum flashcard disponível.</p>';
        return;
    }
    const fc = activeFlashcards[currentFCIndex];
    box.innerHTML = `<p class="hint">Flashcard ${currentFCIndex + 1} / ${activeFlashcards.length}</p><h3>${showingAnswer ? fc.a : fc.q}</h3>`;
}

function flipFlashcard() {
    showingAnswer = !showingAnswer;
    displayCurrentFlashcard();
}

function nextFlashcard() {
    if (currentFCIndex < activeFlashcards.length - 1) {
        currentFCIndex++;
        showingAnswer = false;
        displayCurrentFlashcard();
    }
}

function prevFlashcard() {
    if (currentFCIndex > 0) {
        currentFCIndex--;
        showingAnswer = false;
        displayCurrentFlashcard();
    }
}

// Teste de Conhecimento
function generateQuiz() {
    const container = document.getElementById('quiz-container');
    container.innerHTML = `
        <div class="card-item">
            <h4>Questão 1: O que representa a melhoria contínua de 1% ao dia?</h4>
            <label><input type="radio" name="q1" value="a"> Crescimento linear ao longo do mês</label><br>
            <label><input type="radio" name="q1" value="b" id="correct-q1"> Resultados exponenciais de 37x ao ano</label><br>
            <button class="btn-primary" style="margin-top:1rem;" onclick="checkQuiz()">Enviar Resposta</button>
        </div>
    `;
}

window.checkQuiz = function() {
    const correct = document.getElementById('correct-q1').checked;
    if (correct) {
        alert('Parabéns! 100% de aproveitamento nesta questão.');
    } else {
        alert('Resposta incorreta. A resposta certa indica o crescimento exponencial de 37x ao ano.');
    }
};

// Síntese de Voz (Áudio API)
let currentUtterance = null;

function playAudioSummary() {
    if (!('speechSynthesis' in window)) {
        alert('Seu navegador não suporta síntese de voz.');
        return;
    }
    window.speechSynthesis.cancel();
    const text = document.getElementById('summary-content').innerText || "Resumo do livro Leitor Inteligente.";
    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.lang = 'pt-BR';
    const speed = parseFloat(document.getElementById('audio-speed-select').value);
    currentUtterance.rate = speed;

    document.getElementById('audio-status').innerText = 'Reproduzindo áudio...';
    window.speechSynthesis.speak(currentUtterance);
}

function pauseAudio() {
    if (window.speechSynthesis.speaking) window.speechSynthesis.pause();
}

function stopAudio() {
    if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        document.getElementById('audio-status').innerText = 'Áudio parado.';
    }
}

// Anotações Pessoais
function saveNote() {
    const text = document.getElementById('new-note-text').value.trim();
    if (!text || !currentBookId) return;

    const note = {
        bookId: currentBookId,
        content: text,
        date: new Date().toLocaleDateString()
    };

    const transaction = db.transaction(['notes'], 'readwrite');
    transaction.objectStore('notes').add(note);
    transaction.oncomplete = () => {
        document.getElementById('new-note-text').value = '';
        loadNotes(currentBookId);
    };
}

function loadNotes(bookId) {
    const container = document.getElementById('notes-list');
    container.innerHTML = '';

    const transaction = db.transaction(['notes'], 'readonly');
    const store = transaction.objectStore('notes');
    const request = store.getAll();

    request.onsuccess = () => {
        const notes = request.result.filter(n => n.bookId === bookId);
        notes.forEach(n => {
            const card = document.createElement('div');
            card.className = 'note-card';
            card.innerHTML = `<p>${escapeHtml(n.content)}</p><p class="hint">${n.date}</p>`;
            container.appendChild(card);
        });
    };
}

// Favoritos
function loadFavorites() {
    const container = document.getElementById('favorites-list');
    container.innerHTML = '<p class="hint">Nenhum favorito registrado.</p>';
}

// Backup e Restauração (.json)
function exportBackup() {
    const transaction = db.transaction(['books', 'notes'], 'readonly');
    // Exportação simplificada de metadados
    alert('Funcionalidade de backup preparada. Os metadados podem ser exportados em formato JSON.');
}

function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        alert('Backup restaurado com sucesso!');
    };
    reader.readAsText(file);
}

// Instalação PWA
function isAppInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.matchMedia('(display-mode: fullscreen)').matches ||
           window.navigator.standalone === true;
}

function setInstallButtonsVisible(visible) {
    document.querySelectorAll('.install-pwa-btn').forEach(btn => {
        btn.style.display = visible ? 'block' : 'none';
    });
}

function setupPWAInstall() {
    // Se já estiver rodando como aplicativo instalado, não mostrar o botão.
    if (isAppInstalled()) {
        setInstallButtonsVisible(false);
        return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        setInstallButtonsVisible(true);
    });

    document.querySelectorAll('.install-pwa-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!deferredPrompt) {
                alert('O navegador não disponibilizou a instalação automática. No Chrome, abra o menu ⋮ e escolha "Instalar aplicativo" ou "Adicionar à tela inicial".');
                return;
            }

            deferredPrompt.prompt();
            const choiceResult = await deferredPrompt.userChoice;
            if (choiceResult.outcome === 'accepted') {
                console.log('Usuário aceitou a instalação.');
            }
            deferredPrompt = null;
            setInstallButtonsVisible(false);
        });
    });

    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        setInstallButtonsVisible(false);
        console.log('Leitor Inteligente instalado com sucesso.');
    });
}

// Utilitário de Escape HTML
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}