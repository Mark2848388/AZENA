// ==================== STATE & STORAGE ====================
const STORAGE_KEY = 'azena_user';
const CLASSES_KEY = 'azena_classes';
const CALLS_KEY = 'azena_calls_count';

let currentUser = null;
let classes = [];
let currentClassId = null;
let currentLessonId = null;
let peer = null;
let currentCall = null;
let localStream = null;
let dataConnection = null;
let isMicOn = true;
let isCamOn = true;
let isHost = false;
let currentRoomCode = null;

// ==================== THEME ====================
function initTheme() {
  const saved = localStorage.getItem('azena_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('azena_theme', next);
}

// ==================== AUTH & ROLES ====================
function loadUser() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    currentUser = JSON.parse(raw);
    return true;
  }
  return false;
}
function saveUser(user) {
  currentUser = user;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
}
async function logout() {
  try { if(supabaseClient) await supabaseClient.auth.signOut(); } catch(e) { console.warn(e); }
  localStorage.removeItem(STORAGE_KEY);
  if (currentUser?.id) localStorage.removeItem(`${CLASSES_KEY}:${currentUser.id}`);
  localStorage.removeItem(CLASSES_KEY); // clear legacy shared cache to avoid cross-account class leakage
  currentUser = null;
  endCallCleanup(true);
  try { leaveLiveClassroom(); } catch (_) {}
  showScreen('landing');
}
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(name).classList.add('active');
}

function openAuth(mode = 'login') {
  const modal = document.getElementById('auth-modal');
  const title = document.getElementById('auth-title');
  const submit = document.getElementById('auth-submit');
  const switchText = document.getElementById('auth-switch-text');
  const switchLink = document.getElementById('auth-switch-link');
  const nameGroup = document.getElementById('auth-name').closest('.form-group');
  const roleGroup = document.getElementById('role-group');

  modal.classList.remove('hidden');
  document.getElementById('auth-form').dataset.mode = mode;

  if (mode === 'login') {
    title.textContent = 'Войти';
    submit.textContent = 'Войти';
    switchText.textContent = 'Нет аккаунта?';
    switchLink.textContent = 'Зарегистрироваться';
    if (nameGroup) nameGroup.style.display = 'none';
    if (roleGroup) roleGroup.style.display = 'none';
    const an = document.getElementById('auth-name');
    if (an) an.required = false;
  } else {
    title.textContent = 'Регистрация';
    submit.textContent = 'Создать аккаунт';
    switchText.textContent = 'Уже есть аккаунт?';
    switchLink.textContent = 'Войти';
    if (nameGroup) nameGroup.style.display = 'block';
    if (roleGroup) roleGroup.style.display = 'block';
    const an = document.getElementById('auth-name');
    if (an) an.required = true;
  }
}
function closeAuth() {
  document.getElementById('auth-modal').classList.add('hidden');
  document.getElementById('auth-form').reset();
}

async function handleAuth(e) {
  e.preventDefault(); const mode=e.target.dataset.mode, name=document.getElementById('auth-name').value.trim(), email=document.getElementById('auth-email').value.trim(), password=document.getElementById('auth-password').value, role=document.querySelector('input[name="role"]:checked')?.value||'student';
  if(!email||password.length<6) return alert('Укажи email и пароль минимум 6 символов'); if(!supabaseClient) return alert('Supabase недоступен. Обнови страницу.');
  const btn=document.getElementById('auth-submit'); btn.disabled=true;
  try { let result; if(mode==='register'){ if(!name) return alert('Введите имя'); result=await supabaseClient.auth.signUp({email,password,options:{data:{name,role}}}); if(result.error) throw result.error; if(!result.data.session){alert('Подтверди email, затем войди.');closeAuth();return;} currentUser={id:result.data.user.id,name,email,role,createdAt:Date.now()}; await supabaseClient.from('profiles').upsert({id:currentUser.id,name,email,role,updated_at:new Date().toISOString()}); }
  else { result=await supabaseClient.auth.signInWithPassword({email,password}); if(result.error) throw result.error; const u=result.data.user; const prof=await supabaseClient.from('profiles').select('*').eq('id',u.id).maybeSingle(); currentUser={id:u.id,name:prof.data?.name||u.user_metadata?.name||email.split('@')[0],email,role:prof.data?.role||u.user_metadata?.role||'student',bio:prof.data?.bio||''}; if(!prof.data) await supabaseClient.from('profiles').upsert({id:u.id,name:currentUser.name,email,role:currentUser.role,updated_at:new Date().toISOString()}); }
  saveUser(currentUser);closeAuth();await loadCloudClasses();enterApp(); } catch(err){console.error(err);alert(err.message||'Ошибка входа/регистрации');} finally{btn.disabled=false;}
}

function enterApp() {
  if (!currentUser) return;
  showScreen('app');
  document.getElementById('user-greeting').textContent = currentUser.name;
  document.getElementById('profile-name').textContent = currentUser.name;
  document.getElementById('profile-email').textContent = currentUser.email;
  document.getElementById('profile-role').textContent =
    currentUser.role === 'teacher' ? 'Учитель' : 'Ученик';
  const av = document.getElementById('profile-avatar');
  if (currentUser.avatar) {
    av.innerHTML = '<img src="' + currentUser.avatar + '" alt="">';
  } else {
    av.textContent = currentUser.name.charAt(0).toUpperCase();
  }
  document.getElementById('edit-name').value = currentUser.name || '';
  document.getElementById('edit-email').value = currentUser.email || '';
  document.getElementById('edit-bio').value = currentUser.bio || '';

  document.querySelectorAll('.teacher-only').forEach(el => {
    el.style.display = currentUser.role === 'teacher' ? '' : 'none';
  });
  document.querySelectorAll('.student-only').forEach(el => {
    el.style.display = currentUser.role === 'student' ? '' : 'none';
  });

  loadClasses();
  updateStats(); renderCallHistory();
  showPage('home');
  showRandomPhrase();
  try { renderHomeContinue(); } catch (_) {}
}

// ==================== NAVIGATION ====================
function showPage(pageId) {
  if (pageId !== 'view-lesson') document.body.classList.remove('classroom-mode');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById('page-' + pageId);
  if (page) page.classList.add('active');
  document.querySelectorAll(`.nav-item[data-page="${pageId}"]`).forEach(n => n.classList.add('active'));

  if (pageId === 'create-lesson') resetLessonForm();
  if (pageId === 'classes') renderClasses();
  if (pageId === 'home') updateStats();
  if (pageId === 'dictionary') renderPersonalVocab();
}

// ==================== CLASSES ====================
function classCacheKey(){return currentUser?`${CLASSES_KEY}:${currentUser.id}`:CLASSES_KEY;}
function loadClasses() { const raw=localStorage.getItem(classCacheKey()); try{classes=raw?JSON.parse(raw):[];}catch{classes=[];} }
async function loadCloudClasses(){
  if(!supabaseClient||!currentUser)return;
  try{
    const {data,error}=await supabaseClient.rpc('get_my_classes');
    if(error)throw error;
    // Normalize snake_case from Postgres → camelCase used in the app
    classes=(data||[]).filter(Boolean).map(c => ({
      ...c,
      teacherId: c.teacherId || c.teacher_id,
      teacherName: c.teacherName || c.teacher_name,
      students: c.students || c.members || [],
    }));
    localStorage.setItem(classCacheKey(),JSON.stringify(classes));
  }catch(error){
    console.warn('Cloud class load failed; using this account cache',error.message);
    loadClasses();
  }
}
function saveClasses() {
  localStorage.setItem(classCacheKey(), JSON.stringify(classes));
  updateStats();
  classes.forEach(c => supabaseSyncClass(c));
}

function myClasses() {
  if (!currentUser) return [];
  if (currentUser.role === 'teacher') {
    return classes.filter(c => c.teacherId === currentUser.id);
  }
  return classes.filter(c => c.students.some(s => s.id === currentUser.id));
}

function renderClasses() {
  const list = document.getElementById('classes-list');
  const empty = document.getElementById('no-classes');
  list.innerHTML = '';
  const mine = myClasses();

  if (mine.length === 0) {
    empty.classList.remove('hidden');
    empty.innerHTML = currentUser.role === 'teacher'
      ? '<p>Пока нет классов. Создай первый!</p><button class="btn btn-primary" data-goto="create-class">Создать класс</button>'
      : '<p>Ты ещё не вступил ни в один класс.</p><button class="btn btn-primary" data-goto="join-class">Вступить в класс</button>';
    empty.querySelectorAll('[data-goto]').forEach(el => {
      el.addEventListener('click', () => showPage(el.dataset.goto));
    });
    return;
  }
  empty.classList.add('hidden');

  mine.forEach(cls => {
    const card = document.createElement('div');
    card.className = 'class-card';
    card.innerHTML = `
      <div class="class-top">
        <h3>${escapeHtml(cls.name)}</h3>
        <span class="class-code">Код: ${cls.code}</span>
      </div>
      <p class="muted">${cls.lessons.length} уроков · ${cls.students.length} учеников</p>
      <p class="muted">Учитель: ${escapeHtml(cls.teacherName)}</p>
    `;
    card.addEventListener('click', () => openClass(cls.id));
    list.appendChild(card);
  });
}

function createClass(e) {
  e.preventDefault();
  const name = document.getElementById('class-name').value.trim();
  if (!name) return alert('Введи название класса');
  if (currentUser.role !== 'teacher') return alert('Только учитель может создавать классы');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const cls = {
    id: 'c_' + Date.now(),
    name,
    code,
    teacherId: currentUser.id,
    teacherName: currentUser.name,
    students: [],
    lessons: [],
    createdAt: Date.now()
  };
  classes.push(cls);
  saveClasses();
  document.getElementById('class-name').value = '';
  showPage('classes');
  alert('Класс создан! Код для учеников: ' + code);
}

async function joinClass(e) {
  e.preventDefault();
  const code = document.getElementById('join-class-code').value.trim();
  if (!/^\d{4,6}$/.test(code)) return alert('Введи корректный код');

  let cls = classes.find(c => c.code === code);
  if (!cls && supabaseClient) {
    try { const {data,error}=await supabaseClient.rpc('join_class_by_code',{class_code:code}); if(error) throw error; cls=data; if(cls && !classes.some(c=>c.id===cls.id)) classes.push(cls); }
    catch(err){ return alert(err.message || 'Класс не найден в облаке'); }
  }
  if (!cls) return alert('Класс с таким кодом не найден');

  if (cls.students.some(s => s.id === currentUser.id)) {
    alert('Ты уже в этом классе');
    openClass(cls.id);
    return;
  }

  cls.students.push({ id: currentUser.id, name: currentUser.name });
  // join_class_by_code RPC already writes membership server-side; do not duplicate membership insert.
  saveClasses();
  document.getElementById('join-class-code').value = '';
  openClass(cls.id);
}

function openClass(id) {
  currentClassId = id;
  const cls = classes.find(c => c.id === id);
  if (!cls) return;
  if (!cls.vocab) cls.vocab = [];
  if (!cls.pinnedLessonId) cls.pinnedLessonId = null;

  document.getElementById('class-view-name').textContent = cls.name;
  document.getElementById('class-view-code').textContent = cls.code;
  document.getElementById('class-view-teacher').textContent = cls.teacherName;
  document.getElementById('class-view-students').textContent = cls.students.length;

  const isTeacher = currentUser.role === 'teacher' && cls.teacherId === currentUser.id;
  document.getElementById('class-teacher-actions').style.display = isTeacher ? 'flex' : 'none';

  // pinned
  const pinnedBox = document.getElementById('pinned-lesson');
  const pinned = cls.lessons.find(l => l.id === cls.pinnedLessonId);
  if (pinned) {
    pinnedBox.classList.remove('hidden');
    document.getElementById('pinned-title').textContent = pinned.title;
  } else {
    pinnedBox.classList.add('hidden');
  }

  renderClassLessons(cls);
  renderHomework(cls);
  renderStudents(cls);
  renderVocab(cls);
  const notes = document.getElementById('class-board');
  if (notes) notes.value = cls.boardText || '';
  initWhiteboard(cls);
  renderClassChat(cls);
  showPage('class-view');
}

async function renderTeacherSubmissions(cls,container){const {data,error}=await supabaseClient.from('homework_submissions').select('*').eq('class_id',cls.id).order('submitted_at',{ascending:false});if(error){console.warn('Review load error',error.message);return;}if(!data?.length)return;const box=document.createElement('div');box.className='teacher-review-box';box.innerHTML='<h3>Работы учеников · проверка</h3>'+data.map((s,i)=>`<div class="review-item"><p><b>Урок:</b> ${escapeHtml(s.lesson_id)} · <b>ученик:</b> ${escapeHtml(s.student_id)}</p><p>Авто результат: ${escapeHtml(String(s.submission?.score??'—'))}/${escapeHtml(String(s.submission?.total??'—'))}</p><textarea data-review="${s.id}" placeholder="Комментарий учителя">${escapeHtml(s.feedback||'')}</textarea><input type="number" min="0" max="100" data-score="${s.id}" value="${s.score??''}" placeholder="Оценка %"><button class="btn btn-primary btn-sm" data-save-review="${s.id}">Сохранить проверку</button></div>`).join('');box.addEventListener('click',async ev=>{const id=ev.target.dataset.saveReview;if(!id)return;const feedback=box.querySelector(`[data-review="${id}"]`).value,score=box.querySelector(`[data-score="${id}"]`).value;const {error:err}=await supabaseClient.from('homework_submissions').update({feedback,score:score===''?null:Number(score),reviewed_by:currentUser.id,reviewed_at:new Date().toISOString()}).eq('id',id);if(err)alert('Ошибка сохранения: '+err.message);else alert('Проверка сохранена');});container.prepend(box);}

function renderHomework(cls) {
  const list = document.getElementById('homework-list');
  const empty = document.getElementById('no-homework');
  list.innerHTML = '';
  const hw = (cls.lessons || []).filter(l => l.isHomework);
  if (!hw.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  if(currentUser.role==='teacher' && supabaseClient) renderTeacherSubmissions(cls,list);
  hw.forEach(lesson => {
    const card = document.createElement('div');
    card.className = 'lesson-card';
    card.innerHTML = '<span class="level">Домашка ' + (lesson.deadline ? '· до ' + escapeHtml(new Date(lesson.deadline).toLocaleString()) : '') + '</span><h3>' + escapeHtml(lesson.title) + '</h3><p>' + escapeHtml(lesson.description || '') + '</p>'; 
    card.addEventListener('click', () => viewLesson(cls.id, lesson.id));
    list.appendChild(card);
  });
}

function renderStudents(cls) {
  const list = document.getElementById('students-list');
  list.innerHTML = '';
  // teacher first
  const teacherRow = document.createElement('div');
  teacherRow.className = 'student-row';
  teacherRow.innerHTML = '<div class="student-avatar">' + (cls.teacherName||'?')[0] + '</div><div><strong>' + escapeHtml(cls.teacherName) + '</strong><br><span class="muted">Учитель</span></div>';
  list.appendChild(teacherRow);
  (cls.students || []).forEach(s => {
    const row = document.createElement('div');
    row.className = 'student-row';
    row.innerHTML = '<div class="student-avatar">' + (s.name||'?')[0] + '</div><div><strong>' + escapeHtml(s.name) + '</strong><br><span class="muted">Ученик</span></div>';
    list.appendChild(row);
  });
}

function renderVocab(cls) {
  const list = document.getElementById('vocab-list');
  list.innerHTML = '';
  (cls.vocab || []).forEach((v, i) => {
    const item = document.createElement('div');
    item.className = 'vocab-item';
    item.innerHTML = '<div class="word">' + escapeHtml(v.word) + '</div><div class="trans">' + escapeHtml(v.trans) + '</div>';
    list.appendChild(item);
  });
}

function pinLesson(lessonId) {
  const cls = classes.find(c => c.id === currentClassId);
  if (!cls) return;
  cls.pinnedLessonId = lessonId;
  saveClasses();
  localStorage.removeItem('azena_lesson_draft');
  const saveState=document.getElementById('builder-save-state');if(saveState)saveState.textContent='Урок сохранён';
  openClass(currentClassId);
}

function toggleHomework(lessonId) {
  const cls = classes.find(c => c.id === currentClassId);
  if (!cls) return;
  const lesson = cls.lessons.find(l => l.id === lessonId);
  if (!lesson) return;
  lesson.isHomework = !lesson.isHomework;
  saveClasses();
  openClass(currentClassId);
}

function addVocab() {
  const word = document.getElementById('vocab-word').value.trim();
  const trans = document.getElementById('vocab-trans').value.trim();
  if (!word) return;
  const cls = classes.find(c => c.id === currentClassId);
  if (!cls) return;
  if (!cls.vocab) cls.vocab = [];
  cls.vocab.push({ word, trans });
  saveClasses();
  document.getElementById('vocab-word').value = '';
  document.getElementById('vocab-trans').value = '';
  renderVocab(cls);
}

function renderClassLessons(cls) {
  const list = document.getElementById('class-lessons-list');
  list.innerHTML = '';
  if (!cls.lessons.length) {
    list.innerHTML = '<p class="muted">В этом классе пока нет уроков</p>';
    return;
  }
  const isTeacher = currentUser.role === 'teacher' && cls.teacherId === currentUser.id;
  cls.lessons
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach(lesson => {
      const card = document.createElement('div');
      card.className = 'lesson-card';
      let actions = '';
      if (isTeacher) {
        actions = '<div class="lesson-actions" style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap">' +
          '<button class="btn btn-outline btn-sm pin-btn" data-id="' + lesson.id + '">📌 Закрепить</button>' +
          '<button class="btn btn-outline btn-sm hw-btn" data-id="' + lesson.id + '">' + (lesson.isHomework ? '✓ Домашка' : '+ В домашку') + '</button>' +
          '</div>';
      }
      card.innerHTML = `
        <span class="level">${lesson.level} · ${categoryLabel(lesson.category)}${lesson.isHomework ? ' · 📝' : ''}</span>
        <h3>${escapeHtml(lesson.title)}</h3>
        <p>${escapeHtml(lesson.description || 'Без описания')}</p>
        <div class="lesson-meta-row">
          ${lesson.images?.length ? '<span>🖼 ' + lesson.images.length + '</span>' : ''}
          ${lesson.tasks?.length ? '<span>📝 ' + lesson.tasks.length + ' заданий</span>' : ''}
        </div>
        ${actions}
      `;
      card.querySelector('h3').addEventListener('click', () => viewLesson(cls.id, lesson.id));
      card.querySelector('p')?.addEventListener('click', () => viewLesson(cls.id, lesson.id));
      card.querySelector('.pin-btn')?.addEventListener('click', (e) => { e.stopPropagation(); pinLesson(lesson.id); });
      card.querySelector('.hw-btn')?.addEventListener('click', (e) => { e.stopPropagation(); toggleHomework(lesson.id); });
      list.appendChild(card);
    });
}

async function submitHomework(lesson,score,total){const cls=classes.find(c=>c.id===currentClassId),st=cls?.students.find(s=>s.id===currentUser.id);if(!cls||!st)return;st.homeworkSubmitted||=[];st.homeworkSubmitted=st.homeworkSubmitted.filter(x=>x.lessonId!==lesson.id);const sub={lessonId:lesson.id,submittedAt:Date.now(),score,total,status:'submitted'};st.homeworkSubmitted.push(sub);saveClasses();if(supabaseClient){const {error}=await supabaseClient.from('homework_submissions').upsert({class_id:cls.id,lesson_id:lesson.id,student_id:currentUser.id,submission:sub,submitted_at:new Date().toISOString()},{onConflict:'lesson_id,student_id'});if(error)console.warn('Homework sync',error.message);}alert('Домашка отправлена учителю!');}
// ==================== LESSONS ====================
function youtubeId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1);
    return u.searchParams.get('v');
  } catch { return null; }
}

function categoryLabel(cat) {
  const map = {
    grammar: 'Грамматика',
    vocabulary: 'Словарь',
    speaking: 'Разговор',
    listening: 'Аудирование',
    writing: 'Письмо'
  };
  return map[cat] || cat;
}


function resetLessonForm() {
  document.getElementById('lesson-form-title').textContent = 'Новый урок';
  document.getElementById('lesson-id').value = '';
  document.getElementById('lesson-form')?.reset();
  const lvl = document.getElementById('lesson-level');
  if (lvl) lvl.value = 'B1';
  const hw = document.getElementById('lesson-is-homework');
  if (hw) hw.checked = false;
  const canvas = document.getElementById('lesson-canvas');
  if (canvas) {
    canvas.innerHTML = '<div class="canvas-empty" id="canvas-empty"><p>Добавьте блоки справа — текст, видео, задания.</p><p class="muted">Как в Edvibe: собираете урок из упражнений по порядку.</p></div>';
  }
  window._lessonImages = [];
  updateBlocksCount();
}

function uid(prefix) {
  return (prefix || 'b') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const BLOCK_LABELS = {
  text: 'Текст / теория',
  note: 'Заметка',
  video: 'Видео',
  wordlist: 'Список слов',
  open: 'Открытый ответ',
  choice: 'Тест',
  truefalse: 'Верно / неверно',
  fill: 'Пропуски',
  order: 'Порядок слов',
  match: 'Сопоставление',
  divider: 'Разделитель', heading: 'Заголовок', audio: 'Аудио', image: 'Изображение', flashcards: 'Карточки слов'
};

function updateBlocksCount() {
  const n = document.querySelectorAll('#lesson-canvas .lb-block').length;
  const el = document.getElementById('blocks-count');
  if (el) el.textContent = n + ' блок' + (n === 1 ? '' : n < 5 ? 'а' : 'ов');
  const empty = document.getElementById('canvas-empty');
  if (empty) empty.style.display = n ? 'none' : '';
}

function addLessonBlock(type, data = null) {
  const canvas = document.getElementById('lesson-canvas');
  if (!canvas) return;
  document.getElementById('canvas-empty')?.remove();

  const id = data?.id || uid('b');
  const block = document.createElement('article');
  block.className = 'lb-block';
  block.dataset.blockId = id;
  block.dataset.blockType = type;
  block.draggable = true;

  let body = '';
  if (type === 'text') {
    body = `<textarea class="lb-text" rows="4" placeholder="Теория, правило, объяснение…">${escapeHtml(data?.text || data?.content || '')}</textarea>`;
  } else if (type === 'note') {
    body = `<textarea class="lb-text" rows="2" placeholder="Заметка для ученика или себе…">${escapeHtml(data?.text || '')}</textarea>`;
  } else if (type === 'video') {
    body = `<input class="lb-url" type="url" placeholder="https://www.youtube.com/watch?v=…" value="${escapeHtml(data?.url || '')}" />
            <p class="muted lb-hint">Вставьте ссылку YouTube — в уроке появится плеер</p>`;
  } else if (type === 'wordlist') {
    body = `<textarea class="lb-text" rows="3" placeholder="word — перевод (каждый с новой строки)">${escapeHtml(data?.text || data?.words || '')}</textarea>`;
  } else if (type === 'divider' || type === 'heading') {
    body = `<input class="lb-title" type="text" placeholder="${type==='heading'?'Заголовок раздела':'Название секции (необязательно)'}" value="${escapeHtml(data?.title || '')}" />`;
  } else if (type === 'audio' || type === 'image') {
    body = `<input class="lb-url" type="url" placeholder="${type==='audio'?'Ссылка на аудиофайл (mp3, ogg, wav)':'Ссылка на изображение'}" value="${escapeHtml(data?.url || '')}" />`;
    body += `<input class="lb-caption" type="text" placeholder="Подпись (необязательно)" value="${escapeHtml(data?.caption || '')}" />`;
  } else if (type === 'flashcards') {
    body = `<textarea class="lb-text" rows="4" placeholder="hello = привет&#10;world = мир">${escapeHtml(data?.text || '')}</textarea><p class="muted lb-hint">Одна карточка на строку: слово = перевод</p>`;
  } else {
    // exercise types
    body = `<input class="lb-question" type="text" placeholder="Вопрос / формулировка задания" value="${escapeHtml(data?.question || '')}" />`;
    if (type === 'choice') {
      const opts = data?.options || ['', '', '', ''];
      body += `<div class="lb-options">
        ${[0,1,2,3].map(i => `<input class="lb-opt" type="text" placeholder="Вариант ${i+1}" value="${escapeHtml(opts[i] || '')}" />`).join('')}
        <input class="lb-correct" type="text" placeholder="Правильный ответ (точный текст варианта)" value="${escapeHtml(data?.correct || '')}" />
      </div>`;
    } else if (type === 'truefalse') {
      const c = data?.correct === 'false' ? 'false' : 'true';
      body += `<div class="lb-tf">
        <label><input type="radio" name="tf_${id}" value="true" ${c==='true'?'checked':''}/> Верно</label>
        <label><input type="radio" name="tf_${id}" value="false" ${c==='false'?'checked':''}/> Неверно</label>
      </div>`;
    } else if (type === 'fill' || type === 'order') {
      body += `<input class="lb-correct" type="text" placeholder="${type==='order' ? 'Правильная фраза по словам' : 'Правильный ответ в пропуск'}" value="${escapeHtml(data?.correct || '')}" />`;
    } else if (type === 'match') {
      body += `<textarea class="lb-pairs" rows="3" placeholder="cat=кот, dog=собака">${escapeHtml(data?.pairs || '')}</textarea>`;
    } else if (type === 'open') {
      body += `<p class="muted lb-hint">Ученик напишет свободный ответ</p>`;
    }
  }

  block.innerHTML = `
    <div class="lb-head">
      <span class="lb-drag" title="Перетащить">⋮⋮</span>
      <span class="lb-type">${BLOCK_LABELS[type] || type}</span>
      <div class="lb-actions">
        <button type="button" class="btn btn-outline btn-sm lb-up" title="Выше">↑</button>
        <button type="button" class="btn btn-outline btn-sm lb-down" title="Ниже">↓</button>
        <button type="button" class="btn btn-danger btn-sm lb-remove" title="Удалить">×</button>
      </div>
    </div>
    <div class="lb-body">${body}</div>`;

  block.querySelector('.lb-remove').onclick = () => { block.remove(); updateBlocksCount(); scheduleBuilderDraft(); };
  const duplicate = document.createElement('button'); duplicate.type='button'; duplicate.className='btn btn-outline btn-sm lb-duplicate'; duplicate.title='Дублировать'; duplicate.textContent='⧉';
  block.querySelector('.lb-actions').insertBefore(duplicate, block.querySelector('.lb-remove'));
  duplicate.onclick = () => { const copy = collectSingleBlock(block); addLessonBlock(type, {...copy, id:uid('b')}); scheduleBuilderDraft(); };
  block.querySelector('.lb-up').onclick = () => {
    const prev = block.previousElementSibling;
    if (prev && prev.classList.contains('lb-block')) canvas.insertBefore(block, prev);
  };
  block.querySelector('.lb-down').onclick = () => {
    const next = block.nextElementSibling;
    if (next) canvas.insertBefore(next, block);
  };

  // drag reorder
  block.addEventListener('dragstart', (e) => {
    block.classList.add('dragging');
    e.dataTransfer.setData('text/plain', id);
  });
  block.addEventListener('dragend', () => block.classList.remove('dragging'));
  block.addEventListener('dragover', (e) => e.preventDefault());
  block.addEventListener('drop', (e) => {
    e.preventDefault();
    const dragging = canvas.querySelector('.lb-block.dragging');
    if (!dragging || dragging === block) return;
    const rect = block.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    canvas.insertBefore(dragging, before ? block : block.nextSibling);
  });

  canvas.appendChild(block);
  updateBlocksCount();
  scheduleBuilderDraft();
  block.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return block;
}

function collectSingleBlock(el) {
  const type=el.dataset.blockType, id=el.dataset.blockId;
  const tmp=document.createElement('div'); tmp.appendChild(el.cloneNode(true));
  const node=tmp.firstElementChild;
  const value=sel=>node.querySelector(sel)?.value?.trim()||'';
  const b={id,type};
  if(['text','note','wordlist','flashcards'].includes(type)) b.text=value('.lb-text');
  else if(['video','audio','image'].includes(type)){b.url=value('.lb-url');b.caption=value('.lb-caption');}
  else if(['divider','heading'].includes(type)) b.title=value('.lb-title');
  else {b.question=value('.lb-question');b.correct=value('.lb-correct');b.options=[...node.querySelectorAll('.lb-opt')].map(x=>x.value);b.pairs=value('.lb-pairs');}
  return b;
}

function scheduleBuilderDraft(){
  const state=document.getElementById('builder-save-state'); if(state) state.textContent='Есть несохранённые изменения';
  clearTimeout(window._azenaDraftTimer);
  window._azenaDraftTimer=setTimeout(()=>{
    const draft={title:document.getElementById('lesson-title')?.value||'',level:document.getElementById('lesson-level')?.value||'B1',category:document.getElementById('lesson-category')?.value||'grammar',description:document.getElementById('lesson-description')?.value||'',blocks:collectBlocks()};
    try{localStorage.setItem('azena_lesson_draft',JSON.stringify(draft));if(state)state.textContent='Черновик сохранён';}catch(e){if(state)state.textContent='Не удалось сохранить черновик';}
  },650);
}

function restoreBuilderDraft(){
  try{const d=JSON.parse(localStorage.getItem('azena_lesson_draft')||'null');if(!d||document.getElementById('lesson-id')?.value)return;
    if(d.title)document.getElementById('lesson-title').value=d.title;
    if(d.description)document.getElementById('lesson-description').value=d.description;
    if(d.level)document.getElementById('lesson-level').value=d.level;
    if(d.category)document.getElementById('lesson-category').value=d.category;
    (d.blocks||[]).forEach(b=>addLessonBlock(b.type,b));
  }catch(e){console.warn('Draft restore',e);}
}

function collectBlocks() {
  const blocks = [];
  document.querySelectorAll('#lesson-canvas .lb-block').forEach(el => {
    const type = el.dataset.blockType;
    const id = el.dataset.blockId;
    const b = { id, type };
    if (type === 'text' || type === 'note' || type === 'wordlist') {
      b.text = el.querySelector('.lb-text')?.value.trim() || '';
    } else if (type === 'video') {
      b.url = el.querySelector('.lb-url')?.value.trim() || '';
    } else if (type === 'divider' || type === 'heading') {
      b.title = el.querySelector('.lb-title')?.value.trim() || '';
    } else if (type === 'audio' || type === 'image') {
      b.url = el.querySelector('.lb-url')?.value.trim() || '';
      b.caption = el.querySelector('.lb-caption')?.value.trim() || '';
    } else if (type === 'flashcards') {
      b.text = el.querySelector('.lb-text')?.value.trim() || '';
    } else {
      b.question = el.querySelector('.lb-question')?.value.trim() || '';
      if (type === 'choice') {
        b.options = [...el.querySelectorAll('.lb-opt')].map(i => i.value.trim()).filter(Boolean);
        b.correct = el.querySelector('.lb-correct')?.value.trim() || '';
      } else if (type === 'truefalse') {
        b.correct = el.querySelector('input[type=radio]:checked')?.value || 'true';
      } else if (type === 'fill' || type === 'order') {
        b.correct = el.querySelector('.lb-correct')?.value.trim() || '';
      } else if (type === 'match') {
        b.pairs = el.querySelector('.lb-pairs')?.value.trim() || '';
      }
    }
    blocks.push(b);
  });
  return blocks;
}

function blocksToTasks(blocks) {
  return (blocks || [])
    .filter(b => ['open','choice','truefalse','fill','order','match'].includes(b.type))
    .map(b => ({
      id: b.id,
      type: b.type,
      question: b.question || '',
      options: b.options || [],
      correct: b.correct || '',
      pairs: b.pairs || ''
    }));
}

function lessonBlocksFromLegacy(lesson) {
  if (lesson.blocks?.length) return lesson.blocks;
  const blocks = [];
  if (lesson.content) blocks.push({ id: uid('t'), type: 'text', text: lesson.content });
  (lesson.tasks || []).forEach(t => {
    blocks.push({
      id: t.id || uid('x'),
      type: t.type || 'open',
      question: t.question,
      options: t.options,
      correct: t.correct,
      pairs: t.pairs
    });
  });
  return blocks;
}

// keep old name for templates / quick-add compatibility
function addTaskBlock(task = null) {
  const type = task?.type || 'open';
  addLessonBlock(type, task);
}

function collectTasks() {
  return blocksToTasks(collectBlocks());
}

function handleImageUpload(e) {
  const files = Array.from(e.target.files || []);
  if (!window._lessonImages) window._lessonImages = [];
  files.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 1.5 * 1024 * 1024) {
      alert('Картинка слишком большая (макс ~1.5 МБ)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      window._lessonImages.push(reader.result);
      renderImagesPreview();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

function renderImagesPreview() {
  const box = document.getElementById('lesson-images-preview');
  box.innerHTML = '';
  (window._lessonImages || []).forEach((src, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'img-preview';
    wrap.innerHTML = '<img src="' + src + '" alt=""><button type="button" data-i="' + i + '">×</button>';
    wrap.querySelector('button').addEventListener('click', () => {
      window._lessonImages.splice(i, 1);
      renderImagesPreview();
    });
    box.appendChild(wrap);
  });
}

function handleLessonSubmit(e) {
  e.preventDefault();
  if (currentUser.role !== 'teacher') return alert('Только учитель может создавать уроки');

  const cls = classes.find(c => c.id === currentClassId);
  if (!cls) {
    alert('Сначала открой класс, в который добавляешь урок');
    showPage('classes');
    return;
  }

  const id = document.getElementById('lesson-id').value;
  const title = document.getElementById('lesson-title').value.trim();
  const level = document.getElementById('lesson-level').value;
  const category = document.getElementById('lesson-category').value;
  const description = document.getElementById('lesson-description').value.trim();
  const blocks = collectBlocks();
  const tasks = blocksToTasks(blocks);
  const content = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n\n');
  const images = window._lessonImages || [];
  const isHomework = !!document.getElementById('lesson-is-homework')?.checked
    || category === 'homework';

  if (!title) return alert('Укажи название урока');
  if (!blocks.length) return alert('Добавьте хотя бы один блок в урок');

  const lessonData = {
    title, level, category, description, content,
    images, tasks, blocks,
    isHomework,
    deadline: document.getElementById('lesson-deadline')?.value || null,
    updatedAt: Date.now()
  };

  if (id) {
    const idx = cls.lessons.findIndex(l => l.id === id);
    if (idx !== -1) cls.lessons[idx] = { ...cls.lessons[idx], ...lessonData };
  } else {
    cls.lessons.push({
      id: 'l_' + Date.now(),
      ...lessonData,
      createdAt: Date.now()
    });
  }

  saveClasses();
  openClass(currentClassId);
}

function viewLesson(classId, lessonId, classic = false) {
  const cls = classes.find(c => c.id === classId);
  if (!cls) return;
  const lesson = cls.lessons.find(l => l.id === lessonId);
  if (!lesson) return;

  currentClassId = classId;
  currentLessonId = lessonId;

  const isTeacher = currentUser.role === 'teacher' && cls.teacherId === currentUser.id;
  // Default: Edvibe-style full lesson (center exercises + sections)
  if (!classic) {
    const view = document.getElementById('lesson-view');
    if (view) {
      showPage('view-lesson');
      renderEdvibeLesson(lesson, isTeacher);
      const editBtn = document.getElementById('edit-lesson-btn');
      const delBtn = document.getElementById('delete-lesson-btn');
      if (editBtn) editBtn.style.display = isTeacher ? '' : 'none';
      if (delBtn) delBtn.style.display = isTeacher ? '' : 'none';
      return;
    }
  }

  const view = document.getElementById('lesson-view');
  let imagesHtml = '';
  if (lesson.images?.length) {
    imagesHtml = '<div class="lesson-images">' +
      lesson.images.map(src => '<img src="' + src + '" alt="Картинка к уроку">').join('') +
      '</div>';
  }


  // Edvibe-like sequential blocks
  let blocksHtml = '';
  const blocks = lessonBlocksFromLegacy(lesson);
  if (blocks.length) {
    blocksHtml = '<div class="lesson-blocks">' + blocks.map((b, idx) => {
      if (b.type === 'text') return `<section class="lb-view text"><div class="content">${escapeHtml(b.text || '').replace(/\\n/g,'<br>')}</div></section>`;
      if (b.type === 'note') return `<section class="lb-view note"><strong>Заметка</strong><p>${escapeHtml(b.text || '')}</p></section>`;
      if (b.type === 'video') {
        const id = youtubeId(b.url || '');
        return id
          ? `<section class="lb-view video"><div class="yt-wrap"><iframe src="https://www.youtube.com/embed/${id}" allowfullscreen loading="lazy"></iframe></div></section>`
          : `<section class="lb-view video"><a href="${escapeHtml(b.url||'')}" target="_blank" rel="noopener">Открыть видео</a></section>`;
      }
      if (b.type === 'wordlist') {
        const lines = (b.text || '').split('\\n').filter(Boolean);
        return `<section class="lb-view wordlist"><h4>Слова</h4><ul>${lines.map(l=>'<li>'+escapeHtml(l)+'</li>').join('')}</ul>
          <button type="button" class="btn btn-outline btn-sm add-wordlist-btn" data-words="${escapeHtml(b.text||'')}">В мой словарь</button></section>`;
      }
      if (b.type === 'divider') return `<section class="lb-view divider"><h3>${escapeHtml(b.title || '—')}</h3></section>`;
      // task-like blocks rendered in tasks section below for checking
      return '';
    }).join('') + '</div>';
  }

  let tasksHtml = '';
  if (lesson.tasks?.length) {
    tasksHtml = '<div class="lesson-tasks"><h3>Задания</h3>' +
      lesson.tasks.map((t, i) => {
        let body = '<p class="task-q">' + (i + 1) + '. ' + escapeHtml(t.question) + '</p>';
        if (t.type === 'choice' && t.options) {
          body += '<div class="task-choices">' +
            t.options.map(o => '<label class="choice-label"><input type="radio" name="ans_' + t.id + '" value="' + escapeHtml(o) + '"> ' + escapeHtml(o) + '</label>').join('') +
            '</div>';
        } else if (t.type === 'fill') {
          body += '<input class="task-open" placeholder="Вставь пропущенное слово" />';
        } else if (t.type === 'order') {
          const bank=(t.correct||'').split(/\s+/).sort(()=>Math.random()-0.5); body += '<p class="word-bank">' + bank.map(escapeHtml).join(' · ') + '</p><input class="task-open" placeholder="Собери предложение" />';
        } else if (t.type === 'match') {
          const pairs=(t.pairs||'').split(',').map(x=>x.trim().split('=')); body += '<div class="match-task">' + pairs.map(pair=>'<label>' + escapeHtml(pair[0]||'') + ' → <input class="match-answer" placeholder="перевод" data-expected="' + escapeHtml(pair[1]||'') + '" /></label>').join('') + '</div>';
        } else if (t.type === 'truefalse') {
          body += '<div class="task-choices">' +
            '<label class="choice-label"><input type="radio" name="ans_' + t.id + '" value="true"> Верно</label>' +
            '<label class="choice-label"><input type="radio" name="ans_' + t.id + '" value="false"> Неверно</label>' +
            '</div>';
        } else {
          body += '<textarea class="task-open" data-tid="' + t.id + '" rows="2" placeholder="Твой ответ..."></textarea>';
        }
        return '<div class="task-item" data-tid="' + t.id + '" data-type="' + t.type + '" data-correct="' + escapeHtml(t.correct || '') + '">' + body + '</div>';
      }).join('') +
      '<button class="btn btn-primary" id="check-tasks-btn" style="margin-top:1rem">Проверить ответы</button>' +
      '<div id="tasks-result" class="tasks-result"></div></div>';
  }

  view.innerHTML = `
    <div class="meta">
      <span class="badge">${lesson.level}</span>
      <span class="badge">${categoryLabel(lesson.category)}</span>
    </div>
    <h1>${escapeHtml(lesson.title)}</h1>
    <p class="desc">${escapeHtml(lesson.description || '')}</p>
    ${imagesHtml}
    ${blocksHtml || `<div class="content">${escapeHtml(lesson.content || '')}</div>`}
    <div class="lesson-vektor-tools"><button class="btn btn-outline btn-sm" id="lesson-explain-vektor">Объясни это</button><button class="btn btn-outline btn-sm" id="lesson-check-vektor">Проверь мой ответ</button><button class="btn btn-outline btn-sm" id="lesson-prepare-call">Подготовь к звонку</button></div>
    <div class="lesson-word-tools"><input id="lesson-word-input" placeholder="Word" /><input id="lesson-word-translation" placeholder="Перевод" /><button id="lesson-add-word" class="btn btn-outline btn-sm">+ В словарь</button></div>
    ${tasksHtml}
  `;

  document.getElementById('lesson-explain-vektor')?.addEventListener('click',()=>askVektorWithContext('explain'));
  document.getElementById('lesson-check-vektor')?.addEventListener('click',()=>askVektorWithContext('check'));
  document.getElementById('lesson-prepare-call')?.addEventListener('click',vektorPrepareCall);
  document.getElementById('lesson-add-word')?.addEventListener('click',()=>addLessonWord(document.getElementById('lesson-word-input').value.trim(),document.getElementById('lesson-word-translation').value.trim()));
  view.querySelectorAll('.add-wordlist-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      (btn.dataset.words || '').split('\n').forEach(line => {
        const [w, ...rest] = line.split('—');
        const word = (w||'').trim();
        const tr = rest.join('—').trim() || line.split('-').slice(1).join('-').trim();
        if (word) addLessonWord(word, tr);
      });
      alert('Слова добавлены в словарь');
    });
  });

  const checkBtn = document.getElementById('check-tasks-btn');
  if (checkBtn) {
    checkBtn.addEventListener('click', () => checkLessonTasks(lesson));
  }

  document.getElementById('edit-lesson-btn').style.display = isTeacher ? '' : 'none';
  document.getElementById('delete-lesson-btn').style.display = isTeacher ? '' : 'none';

  showPage('view-lesson');
}

function checkLessonTasks(lesson) {
  let correct = 0;
  const total = lesson.tasks.length;
  const resultBox = document.getElementById('tasks-result');

  lesson.tasks.forEach(t => {
    const item = document.querySelector('.task-item[data-tid="' + t.id + '"]');
    if (!item) return;
    if (['open','fill','order'].includes(t.type)) {
      const userAns = item.querySelector('.task-open')?.value.trim() || ''; item.classList.add('answered');
      if(t.type==='open' ? !!userAns : userAns.toLowerCase()===String(t.correct||'').trim().toLowerCase()) correct++;
    } else if(t.type==='match'){const inputs=[...item.querySelectorAll('.match-answer')];const ok=inputs.length>0&&inputs.every(f=>f.value.trim().toLowerCase()===f.dataset.expected.toLowerCase());if(ok){correct++;item.classList.add('correct');}else item.classList.add('wrong');
    } else {
      const checked = item.querySelector('input[type=radio]:checked');
      const userAns = checked ? checked.value : '';
      if (String(userAns) === String(t.correct)) {
        correct++;
        item.classList.add('correct');
        item.classList.remove('wrong');
      } else {
        item.classList.add('wrong');
        item.classList.remove('correct');
      }
    }
  });

  resultBox.innerHTML = '<strong>Результат: ' + correct + ' из ' + total + '</strong>' + (lesson.isHomework && currentUser.role==='student' ? '<button class="btn btn-primary btn-sm" id="submit-homework">Отправить учителю</button>' : '');
  document.getElementById('submit-homework')?.addEventListener('click',()=>submitHomework(lesson,correct,total));
  resultBox.className = 'tasks-result show';
}

function editCurrentLesson() {
  const cls = classes.find(c => c.id === currentClassId);
  const lesson = cls?.lessons.find(l => l.id === currentLessonId);
  if (!lesson) return;

  document.getElementById('lesson-form-title').textContent = 'Редактировать урок';
  document.getElementById('lesson-id').value = lesson.id;
  document.getElementById('lesson-title').value = lesson.title;
  document.getElementById('lesson-level').value = lesson.level;
  document.getElementById('lesson-category').value = lesson.category;
  document.getElementById('lesson-description').value = lesson.description || '';
  document.getElementById('lesson-content').value = lesson.content || '';
  document.getElementById('lesson-deadline').value = lesson.deadline || '';
  window._lessonImages = [...(lesson.images || [])];
  renderImagesPreview();
  const canvas = document.getElementById('lesson-canvas');
  if (canvas) {
    canvas.innerHTML = '';
    lessonBlocksFromLegacy(lesson).forEach(b => addLessonBlock(b.type, b));
    updateBlocksCount();
  }
  const hw = document.getElementById('lesson-is-homework');
  if (hw) hw.checked = !!lesson.isHomework || lesson.category === 'homework';
  showPage('create-lesson');
}


function deleteCurrentLesson() {
  if (!confirm('Удалить этот урок?')) return;
  const cls = classes.find(c => c.id === currentClassId);
  if (!cls) return;
  cls.lessons = cls.lessons.filter(l => l.id !== currentLessonId);
  saveClasses();
  openClass(currentClassId);
}

function updateStats() {
  const mine = myClasses();
  const lessonsCount = mine.reduce((s, c) => s + c.lessons.length, 0);
  const elL = document.getElementById('stat-lessons');
  const elC = document.getElementById('stat-classes');
  const elCalls = document.getElementById('stat-calls');
  if (elL) elL.textContent = lessonsCount;
  if (elC) elC.textContent = mine.length;
  if (elCalls) elCalls.textContent = parseInt(localStorage.getItem(CALLS_KEY) || '0', 10);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==================== VIDEO ====================
// More STUN/TURN → higher chance of P2P through strict NATs / mobile networks
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Open Relay (free public TURN)
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:80?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    // Metered free ice (no account required for public demo endpoints)
    { urls: 'turn:relay.metered.ca:80', username: 'e8dd65cf38c15e20f4775eba', credential: 'u9kP2vYkL9nR8mXq' },
    { urls: 'turn:relay.metered.ca:443', username: 'e8dd65cf38c15e20f4775eba', credential: 'u9kP2vYkL9nR8mXq' },
    { urls: 'turn:relay.metered.ca:443?transport=tcp', username: 'e8dd65cf38c15e20f4775eba', credential: 'u9kP2vYkL9nR8mXq' }
  ],
  iceCandidatePoolSize: 10
};

// Optional: force relay if user enables "Надёжный режим"
let forceRelay = localStorage.getItem('azena_force_relay') === '1';

function getPeerOptions(id) {
  const config = {
    ...ICE_CONFIG,
    iceTransportPolicy: forceRelay ? 'relay' : 'all'
  };
  return {
    debug: 1,
    config,
    // public PeerJS cloud; longer timeouts help on mobile
    host: '0.peerjs.com',
    port: 443,
    path: '/',
    secure: true,
    pingInterval: 5000,
    ...(id ? {} : {})
  };
}

function peerIdFromCode(code) {
  // PeerJS IDs should be safe alphanumeric
  const safe = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return 'azena' + (safe || 'room');
}

function setStatus(text) {
  const el = document.getElementById('call-status');
  if (el) el.textContent = text;
}

function createPeerInstance(id) {
  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch (_) {}
  }
  const opts = getPeerOptions(id);
  peer = id ? new Peer(id, opts) : new Peer(opts);
  // Keepalive / auto-reconnect
  peer.on('open', () => {
    setStatus(isHost ? 'Комната готова. Ждём участника…' : 'Сигнальный сервер: OK');
  });

  peer.on('error', (err) => {
    console.error('Peer error', err);
    if (err.type === 'unavailable-id') {
      // Fixed class peer-id is still held (previous tab / crash). Tell user to wait or reopen.
      setStatus('ID комнаты ещё занят (возможно, старая вкладка). Закрой другие вкладки Azena и подожди 10–20 сек, затем снова «Начать».');
      const pipStatus = document.getElementById('pip-status');
      if (pipStatus) pipStatus.textContent = 'ID занят — подожди';
    } else if (err.type === 'peer-unavailable') {
      setStatus('Комната не найдена: учитель ещё не вошёл или другой код.');
    } else if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') {
      setStatus('Проблема с сетью / сигнальным сервером. Проверь интернет и попробуй снова.');
    } else {
      setStatus('Ошибка: ' + (err.type || err.message));
    }
  });

  peer.on('call', async (call) => {
    try {
      setStatus('Входящий звонок…');
      const stream = await getLocalStream();
      call.answer(stream);
      currentCall = call;
      setupCallHandlers(call);
      showVideoRoom();
      document.getElementById('remote-placeholder')?.classList.add('hidden');
      incrementCalls();
      setStatus('Собеседник подключился!');
    } catch (e) {
      console.error(e);
      alert('Нужен доступ к камере и микрофону');
    }
  });

  peer.on('disconnected', () => {
    setStatus('Сигнал-сервер отключился, переподключаемся…');
    let tries = 0;
    const retry = () => {
      tries++;
      try { peer.reconnect(); } catch(e) { console.warn(e); }
      if (tries < 5 && peer && !peer.destroyed && peer.disconnected) setTimeout(retry, 2000 * tries);
    };
    setTimeout(retry, 1000);
  });
  peer.on('connection', (conn) => {
    dataConnection = conn;
    setupDataConn(conn);
  });

  return peer;
}

function setupDataConn(conn) {
  conn.on('data', (data) => {
    if (data?.type === 'chat') addChatMessage(data.text, false);
  });
  conn.on('close', () => { dataConnection = null; });
}

async function getLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user' },
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
  const v = document.getElementById('local-video');
  if (v) {
    v.srcObject = localStream;
    v.muted = true;
    v.play?.().catch(() => {});
  }
  const pipL = document.getElementById('pip-local');
  if (pipL) {
    pipL.srcObject = localStream;
    pipL.muted = true;
    pipL.play?.().catch(() => {});
  }
  return localStream;
}

/** Attach remote MediaStream to video elements with mobile autoplay-safe play. */
function attachRemoteStream(remoteStream) {
  if (!remoteStream) return;

  // Ensure tracks are live (sometimes arrive muted/disabled after renegotiation)
  try {
    remoteStream.getTracks().forEach((t) => {
      if (t.readyState === 'live' && t.enabled === false) t.enabled = true;
    });
  } catch (_) {}

  const apply = (el) => {
    if (!el) return;
    el.srcObject = remoteStream;
    el.setAttribute('playsinline', '');
    el.setAttribute('autoplay', '');
    // Start muted so browsers allow autoplay, then unmute after play succeeds
    el.muted = true;
    const tryPlay = () => {
      const p = el.play?.();
      if (p && typeof p.then === 'function') {
        p.then(() => {
          el.muted = false;
        }).catch((err) => {
          console.warn('remote video play blocked, will retry on tap', err);
          const unlock = () => {
            el.muted = false;
            el.play?.().catch(() => {});
            document.removeEventListener('pointerdown', unlock);
            document.removeEventListener('touchstart', unlock);
          };
          document.addEventListener('pointerdown', unlock, { once: true });
          document.addEventListener('touchstart', unlock, { once: true });
        });
      } else {
        el.muted = false;
      }
    };
    tryPlay();
  };

  apply(document.getElementById('remote-video'));
  apply(document.getElementById('pip-remote'));

  document.getElementById('remote-placeholder')?.classList.add('hidden');
  document.getElementById('pip-no-remote')?.classList.add('hidden');
  setStatus('Звонок активен ✓');
  showPip();
}

function setupCallHandlers(call) {
  call.on('stream', (remoteStream) => {
    attachRemoteStream(remoteStream);
  });

  // Some PeerJS/WebRTC stacks fire stream once; also watch connection state
  try {
    const pc = call.peerConnection || call._pc || call.pc;
    if (pc) {
      pc.addEventListener('track', (ev) => {
        if (ev.streams?.[0]) attachRemoteStream(ev.streams[0]);
      });
      pc.addEventListener('connectionstatechange', () => {
        const st = pc.connectionState;
        if (st === 'failed' || st === 'disconnected') {
          setStatus('Связь оборвалась (' + st + '). Включи «Надёжный режим» и переподключись.');
        } else if (st === 'connected') {
          setStatus('Звонок активен ✓');
        }
      });
      pc.addEventListener('iceconnectionstatechange', () => {
        const st = pc.iceConnectionState;
        if (st === 'failed') {
          setStatus('ICE failed — включи «Надёжный режим» (TURN) и начни звонок заново.');
        }
      });
    }
  } catch (e) {
    console.warn('pc listeners', e);
  }

  call.on('close', () => endCallCleanup(false));
  call.on('error', (err) => {
    console.error(err);
    setStatus('Ошибка звонка: ' + (err?.type || err?.message || ''));
  });
}

function showVideoRoom() {
  document.getElementById('video-setup').classList.add('hidden');
  document.getElementById('video-room').classList.remove('hidden');
  showPip();
}

function showPip() {
  const pip = document.getElementById('pip-video');
  if (!pip) return;
  pip.classList.remove('hidden');
  // sync local only here; remote is handled by attachRemoteStream to avoid loops
  const local = document.getElementById('local-video');
  const pipL = document.getElementById('pip-local');
  if (local?.srcObject && pipL) {
    pipL.srcObject = local.srcObject;
    pipL.muted = true;
    pipL.play?.().catch(() => {});
  }
  const st = document.getElementById('pip-status');
  if (st) st.textContent = 'Звонок активен';
}

function hidePip() {
  document.getElementById('pip-video')?.classList.add('hidden');
  const pipL = document.getElementById('pip-local');
  const pipR = document.getElementById('pip-remote');
  if (pipL) pipL.srcObject = null;
  if (pipR) pipR.srcObject = null;
  document.getElementById('pip-no-remote')?.classList.remove('hidden');
}

function expandFromPip() {
  showPage('video');
  document.getElementById('video-setup')?.classList.add('hidden');
  document.getElementById('video-room')?.classList.remove('hidden');
}

function startHost(code) {
  isHost = true;
  currentRoomCode = code;
  const roomCodeEl = document.getElementById('room-code');
  if (roomCodeEl) roomCodeEl.textContent = code;
  document.getElementById('room-created')?.classList.remove('hidden');

  const pid = peerIdFromCode(code);
  createPeerInstance(pid);

  const onHostOpen = async () => {
    console.log('Host ready:', peer?.id);
    setStatus('Комната готова. Ждём учеников…');
    const pipStatus = document.getElementById('pip-status');
    if (pipStatus) pipStatus.textContent = 'В эфире · ' + code + ' (хост)';
    try {
      await getLocalStream();
      showVideoRoom();
    } catch (e) {
      console.warn(e);
      alert('Нужен доступ к камере и микрофону');
    }
  };

  // Avoid race: if Peer already opened before listener was attached
  if (peer && peer.open) {
    onHostOpen();
  } else if (peer) {
    peer.on('open', onHostOpen);
  }
}

function createRoom() {
  if(peer || currentCall || localStream) endCallCleanup(false);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  startHost(code);
}

async function joinRoom() {
  if(peer || currentCall || localStream) endCallCleanup(false);
  const code = document.getElementById('join-code').value.trim();
  if (!/^\d{4,6}$/.test(code)) {
    alert('Введи код из 4–6 цифр');
    return;
  }
  isHost = false;
  currentRoomCode = code;

  createPeerInstance();

  peer.on('open', async (myId) => {
    console.log('Guest ready:', myId);
    setStatus('Подключаемся к ' + code + '…');

    try {
      const stream = await getLocalStream();
      showVideoRoom();
      setStatus('Звоним…');

      const hostId = peerIdFromCode(code);
      const call = peer.call(hostId, stream);
      currentCall = call;
      setupCallHandlers(call);

      dataConnection = peer.connect(hostId);
      setupDataConn(dataConnection);

      incrementCalls();

      setTimeout(() => {
        const ph = document.getElementById('remote-placeholder');
        if (ph && !ph.classList.contains('hidden')) {
          setStatus('Пока нет ответа. Проверь, что создатель уже создал комнату и ждёт.');
        }
      }, 9000);
    } catch (e) {
      console.error(e);
      alert('Ошибка камеры/микрофона: ' + e.message);
      endCallCleanup(true);
    }
  });
}

function endCallCleanup(resetSetup = true) {
  if(resetSetup&&(currentCall||localStream)){const note=prompt('Заметка после звонка (необязательно):','')||'';saveCallLog(note);}
  try { currentCall?.close(); } catch (_) {}
  try { dataConnection?.close(); } catch (_) {}
  try { if (peer && !peer.destroyed) peer.destroy(); } catch (_) {}
  currentCall = null;
  dataConnection = null;
  peer = null;

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  const lv = document.getElementById('local-video');
  const rv = document.getElementById('remote-video');
  if (lv) lv.srcObject = null;
  if (rv) rv.srcObject = null;

  document.getElementById('video-room')?.classList.add('hidden');
  hidePip();
  if (resetSetup) {
    document.getElementById('video-setup')?.classList.remove('hidden');
    document.getElementById('room-created')?.classList.add('hidden');
    const jc = document.getElementById('join-code');
    if (jc) jc.value = '';
  }
  document.getElementById('remote-placeholder')?.classList.remove('hidden');
  document.getElementById('chat-panel')?.classList.add('hidden');
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.innerHTML = '';
  setStatus('');

  isMicOn = true;
  isCamOn = true;
  isHost = false;
  currentRoomCode = null;

  const mic = document.getElementById('toggle-mic');
  const cam = document.getElementById('toggle-cam');
  if (mic) { mic.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-mic"></use></svg>'; mic.classList.remove('muted-state'); }
  if (cam) { cam.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-cam"></use></svg>'; cam.classList.remove('muted-state'); }
}

function setIconBtn(btn, iconId) {
  if (!btn) return;
  btn.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#i-${iconId}"></use></svg>`;
}

function toggleMic() {
  if (!localStream) return;
  isMicOn = !isMicOn;
  localStream.getAudioTracks().forEach(t => (t.enabled = isMicOn));
  const btn = document.getElementById('toggle-mic');
  setIconBtn(btn, isMicOn ? 'mic' : 'mic-off');
  btn?.classList.toggle('muted-state', !isMicOn);
  const pip = document.getElementById('pip-mic');
  setIconBtn(pip, isMicOn ? 'mic' : 'mic-off');
  pip?.classList.toggle('muted-state', !isMicOn);
}
function toggleCam() {
  if (!localStream) return;
  isCamOn = !isCamOn;
  localStream.getVideoTracks().forEach(t => (t.enabled = isCamOn));
  const btn = document.getElementById('toggle-cam');
  setIconBtn(btn, isCamOn ? 'cam' : 'cam-off');
  btn?.classList.toggle('muted-state', !isCamOn);
  const pip = document.getElementById('pip-cam');
  setIconBtn(pip, isCamOn ? 'cam' : 'cam-off');
  pip?.classList.toggle('muted-state', !isCamOn);
}
function toggleChatPanel() {
  document.getElementById('chat-panel').classList.toggle('hidden');
}
function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;
  addChatMessage(text, true);
  if (dataConnection?.open) dataConnection.send({ type: 'chat', text });
  input.value = '';
}
function addChatMessage(text, isMe) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'chat-msg ' + (isMe ? 'me' : 'them');
  if(who.includes('bot')&&!who.includes('typing')) div.innerHTML=formatVektor(text); else div.textContent=text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}
function incrementCalls() {
  const n = parseInt(localStorage.getItem(CALLS_KEY) || '0', 10) + 1;
  localStorage.setItem(CALLS_KEY, n);
  updateStats();
}
function copyRoomCode() {
  const code = document.getElementById('room-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.getElementById('copy-room-code');
    btn.textContent = 'Скопировано!';
    setTimeout(() => (btn.textContent = 'Скопировать код'), 1500);
  });
}

const PHRASES = [
  { en: 'How are you doing today?', ru: 'Как у тебя дела сегодня?' },
  { en: 'Could you repeat that, please?', ru: 'Можешь повторить, пожалуйста?' },
  { en: 'What do you think about this?', ru: 'Что ты об этом думаешь?' },
  { en: 'I really enjoy learning English.', ru: 'Мне очень нравится учить английский.' },
  { en: 'Let’s practice speaking together.', ru: 'Давай попрактикуем разговор вместе.' },
  { en: 'That makes perfect sense.', ru: 'Это имеет полный смысл.' },
  { en: 'I’m looking forward to our next call.', ru: 'Жду нашего следующего звонка.' },
  { en: 'Can you explain it in simpler words?', ru: 'Можешь объяснить более простыми словами?' },
  { en: 'That’s an interesting point of view.', ru: 'Это интересная точка зрения.' },
  { en: 'I need to work on my pronunciation.', ru: 'Мне нужно поработать над произношением.' }
];
function showRandomPhrase() {
  const p = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const en = document.getElementById('phrase-en');
  const ru = document.getElementById('phrase-ru');
  if (en) en.textContent = p.en;
  if (ru) ru.textContent = p.ru;
}
function speakPhrase() {
  const text = document.getElementById('phrase-en')?.textContent;
  if (text && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.9;
    speechSynthesis.speak(u);
  }
}


// ==================== SUPABASE ====================
let supabaseClient = null;
async function initSupabase() {
  try {
    if (!window.AZENA_SUPABASE_URL || !window.AZENA_SUPABASE_KEY) return false;
    // dynamic import avoids global name collision
    const mod = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
    supabaseClient = mod.createClient(window.AZENA_SUPABASE_URL, window.AZENA_SUPABASE_KEY);
    console.log('Supabase client ready');
    return true;
  } catch (e) {
    console.warn('Supabase init failed (app works offline)', e.message || e);
    return false;
  }
}

async function supabaseUpsertProfile(user) {
  if (!supabaseClient || !user) return;
  try {
    const {error} = await supabaseClient.from('profiles').upsert({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      bio: user.bio || null,
      avatar_url: user.avatar ? 'local' : null,
      updated_at: new Date().toISOString()
    }); if(error) console.warn('Profile sync error',error.message);
  } catch (e) {
    console.warn('Supabase profile sync skipped', e.message || e);
  }
}

async function supabaseSyncClass(cls) {
  if (!supabaseClient || !cls || !currentUser || cls.teacherId !== currentUser.id) return; // only the owning teacher may write the shared class JSON
  try {
    const {error} = await supabaseClient.from('classes').upsert({
      id: cls.id,
      name: cls.name,
      code: cls.code,
      teacher_id: cls.teacherId,
      teacher_name: cls.teacherName,
      data: {...cls, updatedAt: Date.now()},
      updated_at: new Date().toISOString()
    }); if(error) console.warn('Cloud class write error',error.message);
  } catch (e) {
    console.warn('Supabase class sync skipped', e.message || e);
  }
}

// ==================== VEKTOR MINI ASSISTANT ====================
const VEKTOR_SYSTEM = `Ты Vektor — дружелюбный мини-ассистент в приложении Azena для изучения английского.
Отвечай кратко (2–5 предложений), по делу. Можно на русском, примеры — на английском.
Помогай: объяснить правило, исправить предложение, предложить фразу, перевести, подготовить к разговору.
Не выдумывай длинные лекции. Если вопрос не про язык — вежливо верни к учёбе.`;

let vektorHistory = [
  { role: 'system', content: VEKTOR_SYSTEM }
];

function toggleVektor() {
  document.getElementById('vektor-panel').classList.toggle('hidden');
}

function formatVektor(text){
  let h=escapeHtml(text||'');
  h=h.replace(/```([\s\S]*?)```/g,'<pre><code>$1</code></pre>')
    .replace(/^###\s+(.+)$/gm,'<h4>$1</h4>').replace(/^##\s+(.+)$/gm,'<h3>$1</h3>').replace(/^#\s+(.+)$/gm,'<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/__(.+?)__/g,'<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\*)(.+?)\*(?!\*)/g,'$1<em>$2</em>').replace(/_(.+?)_/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code>$1</code>');
  h=h.replace(/^\s*[-+]\s+(.+)$/gm,'<li>$1</li>').replace(/^\s*\d+\.\s+(.+)$/gm,'<li>$1</li>');
  h=h.replace(/(?:<li>.*?<\/li>\s*)+/gs,m=>'<ul>'+m+'</ul>').replace(/\n/g,'<br>'); return h;
}
function appendVektorMsg(text, who) {
  const box = document.getElementById('vektor-messages');
  const div = document.createElement('div');
  div.className = 'vektor-msg ' + who;
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return div;
}

async function sendVektor() {
  const input = document.getElementById('vektor-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  appendVektorMsg(text, 'user');
  vektorHistory.push({ role: 'user', content: text });

  const typing = appendVektorMsg('Думаю…', 'bot typing');
  const api = window.VEKTOR_API || 'https://throbbing-grass-315c.claudebote8.workers.dev/chat/completions';

  try {
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: vektorHistory.slice(-12),
        temperature: 0.4,
        max_tokens: 400
      })
    });
    const data = await res.json();
    typing.remove();
    let answer = data?.choices?.[0]?.message?.content
      || data?.error?.message
      || 'Не удалось получить ответ. Попробуй ещё раз.';
    // strip heavy reasoning if present
    if (answer.length > 600) answer = answer.slice(0, 600) + '…';
    appendVektorMsg(answer, 'bot');
    vektorHistory.push({ role: 'assistant', content: answer });
  } catch (e) {
    typing.remove();
    appendVektorMsg('Сеть или Vektor недоступны: ' + e.message, 'bot');
  }
}


function askVektorWithContext(mode){const c=classes.find(x=>x.id===currentClassId),l=c?.lessons.find(x=>x.id===currentLessonId);const userAnswer=document.querySelector('.task-item textarea')?.value||document.querySelector('.task-item input:checked')?.value||'';const context=l?`
Lesson: ${l.title} (${l.level})
Theory: ${l.content||l.description||'—'}
Question: ${l.tasks?.[0]?.question||'—'}
My answer: ${userAnswer||'not entered'}`:'';document.getElementById('vektor-panel').classList.remove('hidden');document.getElementById('vektor-input').value=(mode==='check'?'Проверь мой ответ и объясни ошибки. ':'Объясни тему простыми словами с примером. ')+context;sendVektor();}
function vektorPrepareCall(){const l=classes.find(x=>x.id===currentClassId)?.lessons.find(x=>x.id===currentLessonId);const topic=l?.title||'Small talk';document.getElementById('vektor-panel').classList.remove('hidden');document.getElementById('vektor-input').value=`Подготовь меня к звонку на тему «${topic}»: дай 5 полезных фраз на английском с переводом.`;sendVektor();}
function startVoiceInput(){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR)return alert('Голосовой ввод поддерживается не всеми браузерами. Попробуй Chrome.');const rec=new SR();rec.lang='en-US';rec.interimResults=true;rec.onresult=e=>document.getElementById('vektor-input').value=Array.from(e.results).map(r=>r[0].transcript).join(' ');rec.onerror=e=>alert('Voice input: '+e.error);rec.start();}
async function addLessonWord(word,trans){const c=classes.find(x=>x.id===currentClassId);if(!c||!word)return;c.vocab||=[];if(!c.vocab.some(v=>v.word.toLowerCase()===word.toLowerCase()))c.vocab.push({word,trans,addedBy:currentUser.id,addedAt:Date.now()});saveClasses();if(supabaseClient)await addPersonalWord(word,trans);alert('Добавлено в словарь: '+word);}
function practiceVocab(){const words=classes.find(x=>x.id===currentClassId)?.vocab||[];if(!words.length)return alert('Словарь пока пуст');const w=words[Math.floor(Math.random()*words.length)];alert(`${w.word}

Перевод: ${w.trans||'не добавлен'}`);}
function renderStudentProgress(c){const st=c.students.find(x=>x.id===currentUser.id);const el=document.getElementById('student-progress');if(!el)return;el.textContent=st?`Прогресс: ${(st.completedLessons||[]).length}/${c.lessons.length} уроков · ${(st.homeworkSubmitted||[]).length}/${c.lessons.filter(l=>l.isHomework).length} домашек`:'Ученики класса и прогресс — вкладка «Участники»';}
// ==================== WHITEBOARD + CLASS CHAT ====================
let wb = { tool: 'pen', color: '#6366f1', size: 4, drawing: false, lastX: 0, lastY: 0, bound: false };

function initWhiteboard(cls) {
  const canvas = document.getElementById('whiteboard');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  // Fit internal resolution to display size once
  const rect = canvas.getBoundingClientRect();
  if (rect.width > 0) {
    const ratio = window.devicePixelRatio || 1;
    // keep logical 960x540 mapping via CSS; draw in canvas coords
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Restore saved image
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (cls.boardImage) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = cls.boardImage;
  }

  if (wb.bound) return;
  wb.bound = true;

  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - r.left) * (canvas.width / r.width),
      y: (src.clientY - r.top) * (canvas.height / r.height)
    };
  };

  const start = (e) => {
    e.preventDefault();
    wb.drawing = true;
    const p = pos(e);
    wb.lastX = p.x; wb.lastY = p.y;
  };
  const move = (e) => {
    if (!wb.drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(wb.lastX, wb.lastY);
    ctx.lineTo(p.x, p.y);
    if (wb.tool === 'eraser') {
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = Math.max(12, wb.size * 3);
      if (document.documentElement.getAttribute('data-theme') === 'dark') ctx.strokeStyle = '#0f172a';
    } else {
      ctx.strokeStyle = wb.color;
      ctx.lineWidth = wb.size;
    }
    ctx.stroke();
    wb.lastX = p.x; wb.lastY = p.y;
  };
  const end = () => { wb.drawing = false; };

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      wb.tool = btn.dataset.tool;
    });
  });
  document.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      wb.color = btn.dataset.color;
      wb.tool = 'pen';
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'pen'));
    });
  });
  document.getElementById('board-size')?.addEventListener('input', (e) => {
    wb.size = Number(e.target.value) || 4;
  });
  document.getElementById('board-clear')?.addEventListener('click', () => {
    if (!confirm('Очистить доску?')) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });
}

function saveBoard() {
  const c = classes.find(x => x.id === currentClassId);
  if (!c) return;
  c.boardText = document.getElementById('class-board')?.value || '';
  c.boardAt = Date.now();
  const canvas = document.getElementById('whiteboard');
  if (canvas) {
    try { c.boardImage = canvas.toDataURL('image/png'); } catch (_) {}
  }
  saveClasses();
  alert('Доска сохранена.');
}

function renderClassChat(cls) {
  const box = document.getElementById('class-chat-messages');
  if (!box) return;
  const msgs = cls.chatMessages || [];
  box.innerHTML = msgs.slice(-100).map(m => {
    const me = m.userId === currentUser?.id;
    return `<div class="class-chat-msg${me ? ' me' : ''}"><span class="meta">${escapeHtml(m.name || 'Участник')} · ${new Date(m.at).toLocaleString()}</span>${escapeHtml(m.text)}</div>`;
  }).join('') || '<p class="muted">Пока нет сообщений — напишите первыми.</p>';
  box.scrollTop = box.scrollHeight;
}

function sendClassChat() {
  const input = document.getElementById('class-chat-input');
  const text = (input?.value || '').trim();
  if (!text || !currentUser) return;
  const c = classes.find(x => x.id === currentClassId);
  if (!c) return;
  c.chatMessages = c.chatMessages || [];
  c.chatMessages.push({
    id: 'm' + Date.now(),
    userId: currentUser.id,
    name: currentUser.name || 'Участник',
    text,
    at: Date.now()
  });
  if (c.chatMessages.length > 200) c.chatMessages = c.chatMessages.slice(-200);
  saveClasses();
  if (input) input.value = '';
  renderClassChat(c);
}

async function renderPersonalVocab(){const list=document.getElementById('personal-vocab-list');if(!list)return;let words=[];if(supabaseClient&&currentUser){const {data,error}=await supabaseClient.from('personal_vocabulary').select('*').order('created_at',{ascending:false});if(error)console.warn('Personal vocab load',error.message);else words=data||[];}list.innerHTML=words.map(w=>`<article class="vocab-item"><div class="word">${escapeHtml(w.word)}</div><div class="trans">${escapeHtml(w.translation||'')}</div><button class="btn btn-outline btn-sm" data-delete-vocab="${w.id}">Удалить</button></article>`).join('')||'<p class="muted">Слов пока нет — добавляй их из уроков или вручную.</p>';list.onclick=async e=>{const id=e.target.dataset.deleteVocab;if(!id)return;const {error}=await supabaseClient.from('personal_vocabulary').delete().eq('id',id);if(error)alert('Не удалось удалить слово: '+error.message);else renderPersonalVocab();};}
async function addPersonalWord(word,translation){if(!currentUser||!word?.trim())return;const {error}=await supabaseClient.from('personal_vocabulary').upsert({user_id:currentUser.id,word:word.trim(),translation:translation||null},{onConflict:'user_id,word'});if(error){alert('Не удалось сохранить слово в личный словарь: '+error.message);return;}renderPersonalVocab();}
async function addPersonalVocabFromForm(){const word=document.getElementById('personal-vocab-word').value.trim(),translation=document.getElementById('personal-vocab-translation').value.trim();if(!word)return;await addPersonalWord(word,translation);document.getElementById('personal-vocab-word').value='';document.getElementById('personal-vocab-translation').value='';}
async function practicePersonalVocab(){const {data,error}=await supabaseClient.from('personal_vocabulary').select('word,translation');if(error)return alert('Не удалось загрузить словарь: '+error.message);if(!data?.length)return alert('Словарь пока пуст');const w=data[Math.floor(Math.random()*data.length)];alert(`${w.word}\n\nПеревод: ${w.translation||'не добавлен'}`);}

function renderCallHistory(){const box=document.getElementById('call-history-list');if(!box)return;const arr=JSON.parse(localStorage.getItem('azena_call_history')||'[]');box.innerHTML=arr.slice().reverse().map(x=>`<div class="call-history-item"><b>${escapeHtml(x.room||'Видеозвонок')}</b><span>${new Date(x.date).toLocaleString()}</span><p>${escapeHtml(x.note||'Заметок нет')}</p></div>`).join('')||'<p class="muted">Звонков пока нет</p>';}
async function saveCallLog(note){const entry={date:Date.now(),room:currentRoomCode?`Комната ${currentRoomCode}`:'Видеозвонок',note};const arr=JSON.parse(localStorage.getItem('azena_call_history')||'[]');arr.push(entry);localStorage.setItem('azena_call_history',JSON.stringify(arr.slice(-80)));renderCallHistory();if(supabaseClient&&currentUser) await supabaseClient.from('call_history').insert({user_id:currentUser.id,room_code:currentRoomCode,note});}




// ==================== PEERJS LIVE FROM CLASS ====================
// Uses the existing PeerJS stack (createPeerInstance, getLocalStream, etc.)
// Teacher becomes host with deterministic peer ID from class code.
// Students join by calling that peer ID.

function startLiveFromClass() {
  const cls = classes.find(c => c.id === currentClassId);
  if (!cls) {
    alert('Сначала открой класс');
    showPage('classes');
    return;
  }
  const codeEl = document.getElementById('live-room-code');
  const nameEl = document.getElementById('live-display-name');
  if (codeEl) codeEl.value = cls.code;
  if (nameEl) nameEl.value = currentUser?.name || '';
  showPage('video');
  // Don't auto-start: user chooses Host or Join (any role)
}

// mode: 'host' | 'join' — independent of account role (teacher↔teacher works)
async function joinLiveClassroom(mode = 'join') {
  const code = (document.getElementById('live-room-code')?.value || '').trim();
  if (!code) { alert('Укажи код комнаты / класса'); return; }
  if (!currentUser) { alert('Для видеозвонка войди в Azena.'); return; }

  if (peer || currentCall || localStream) endCallCleanup(false);

  setStatus('Подключение…');
  const pipStatus = document.getElementById('pip-status');
  if (pipStatus) pipStatus.textContent = 'Подключение…';

  try {
    if (mode === 'host') startHost(code);
    else await joinAsStudent(code, pipStatus);
  } catch (e) {
    console.error(e);
    alert('Не удалось начать звонок: ' + (e.message || e));
    endCallCleanup(true);
  }
}

async function joinAsStudent(code, pipStatus) {
  isHost = false;
  currentRoomCode = code;
  const hostId = peerIdFromCode(code);

  createPeerInstance();

  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Таймаут подключения к сигнальному серверу')), 15000);
    peer.on('open', () => { clearTimeout(t); resolve(); });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') return; // handled on call
      clearTimeout(t);
      reject(err);
    });
  });

  setStatus('Подключаемся к комнате ' + code + '…');
  const stream = await getLocalStream();
  showVideoRoom();

  // Retry calling host a few times (teacher may still be opening camera)
  let lastErr = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      setStatus('Звоним хосту… (попытка ' + attempt + '/5)');
      if (pipStatus) pipStatus.textContent = 'Звоним… ' + attempt + '/5';

      const call = peer.call(hostId, stream);
      if (!call) throw new Error('peer.call вернул null — хост не найден');

      currentCall = call;
      setupCallHandlers(call);

      // Wait briefly for stream or error
      const ok = await new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (!done) { done = true; resolve(v); } };
        call.on('stream', () => finish(true));
        call.on('error', (e) => { lastErr = e; finish(false); });
        // PeerJS often emits peer-unavailable on the peer object, not the call
        const onPeerErr = (err) => {
          if (err.type === 'peer-unavailable') { lastErr = err; finish(false); }
        };
        peer.on('error', onPeerErr);
        setTimeout(() => finish(false), 4000); // wait 4s per attempt
      });

      if (ok) {
        dataConnection = peer.connect(hostId);
        setupDataConn(dataConnection);
        incrementCalls();
        if (pipStatus) pipStatus.textContent = 'В эфире · ' + code;
        setStatus('Звонок активен ✓');
        return;
      }

      try { call.close(); } catch (_) {}
      currentCall = null;
      // wait a bit before retry
      await new Promise(r => setTimeout(r, 1500));
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  setStatus('Не удалось дозвониться. Убедись, что учитель уже нажал «Начать / войти».');
  if (pipStatus) pipStatus.textContent = 'Нет ответа';
  alert('Не удалось подключиться к хосту.\n\n1) Кто-то должен сначала нажать «Создать комнату»\n2) Код комнаты должен совпадать\n3) Оба должны разрешить камеру/микрофон\n\n' + (lastErr?.type || lastErr?.message || ''));
}

function leaveLiveClassroom() {
  endCallCleanup(true);
}

// PiP controls reuse the same stream toggles
function dailyToggleMic() { toggleMic(); }
function dailyToggleCam() { toggleCam(); }
function dailyToggleScreen() {
  alert('Демонстрация экрана в P2P-режиме пока не поддерживается.');
}

function togglePipSize() {
  document.getElementById('pip-video')?.classList.toggle('expanded');
}

(function enablePipDragAndResize() {
  let drag = null, resize = null;
  const getPip = () => document.getElementById('pip-video');
  document.addEventListener('pointerdown', (e) => {
    const el = getPip();
    if (!el || el.classList.contains('hidden')) return;
    if (e.target.closest('#pip-resize-grip')) {
      const r = el.getBoundingClientRect();
      resize = { x: e.clientX, y: e.clientY, w: r.width, h: r.height };
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (!e.target.closest('#pip-drag-handle') || e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { x: e.clientX - r.left, y: e.clientY - r.top };
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    const el = getPip(); if (!el) return;
    if (resize) {
      const w = Math.max(190, Math.min(window.innerWidth * .94, resize.w + e.clientX - resize.x));
      const h = Math.max(170, Math.min(window.innerHeight * .72, resize.h + e.clientY - resize.y));
      el.style.width = w + 'px'; el.style.height = h + 'px';
      return;
    }
    if (drag) {
      const r = el.getBoundingClientRect();
      const left = Math.max(0, Math.min(window.innerWidth - r.width, e.clientX - drag.x));
      const top = Math.max(0, Math.min(window.innerHeight - r.height, e.clientY - drag.y));
      el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto';
    }
  });
  document.addEventListener('pointerup', () => { drag = null; resize = null; });
  document.addEventListener('pointercancel', () => { drag = null; resize = null; });
})();

// ==================== INIT ====================


// ==================== LESSON UX (Edvibe-like) + 10 helpers ====================
const LESSON_TEMPLATES = {
  grammar: {
    title: 'Grammar focus',
    level: 'B1',
    category: 'grammar',
    description: 'Разбор правила + практика',
    content: '## Правило\n\nОбъясни структуру.\n\n## Примеры\n1. …\n2. …\n\n## Практика',
    tasks: [
      { type: 'truefalse', question: 'Утверждение по правилу верно?', correct: 'true' },
      { type: 'choice', question: 'Выбери правильную форму', options: ['option A', 'option B', 'option C', 'option D'], correct: 'option A' },
      { type: 'open', question: 'Напиши 2 своих примера' }
    ]
  },
  vocab: {
    title: 'Vocabulary pack',
    level: 'A2',
    category: 'vocabulary',
    description: 'Новые слова и закрепление',
    content: '## Слова\n- word — перевод\n\n## Пример в предложении',
    tasks: [
      { type: 'match', question: 'Соедини слово и перевод', pairs: 'cat=кот, dog=собака, bird=птица' },
      { type: 'fill', question: 'I ___ to school every day. (go)', correct: 'go' },
      { type: 'open', question: 'Составь 3 предложения с новыми словами' }
    ]
  },
  speaking: {
    title: 'Speaking practice',
    level: 'B1',
    category: 'speaking',
    description: 'Разговорные вопросы и фразы',
    content: '## Warm-up\nAnswer in 2–3 sentences.\n\n## Useful phrases\n- In my opinion…\n- What I mean is…',
    tasks: [
      { type: 'open', question: 'Talk about your last weekend (5–7 sentences)' },
      { type: 'open', question: 'Agree or disagree: "Homework is useful." Explain.' }
    ]
  },
  reading: {
    title: 'Reading + comprehension',
    level: 'B1',
    category: 'reading',
    description: 'Текст и вопросы на понимание',
    content: '## Text\nPaste a short text here.\n\n## Tips\nUnderline unknown words.',
    tasks: [
      { type: 'choice', question: 'Main idea of the text?', options: ['A', 'B', 'C', 'D'], correct: 'A' },
      { type: 'truefalse', question: 'The author agrees with the idea.', correct: 'false' },
      { type: 'open', question: 'Summarize the text in 3 sentences' }
    ]
  },
  homework: {
    title: 'Homework',
    level: 'B1',
    category: 'homework',
    description: 'Домашнее задание',
    content: 'Сделай задания до дедлайна и отправь ответы.',
    tasks: [
      { type: 'open', question: 'Complete the exercise from the lesson' },
      { type: 'fill', question: 'She ___ (be) here yesterday.', correct: 'was' }
    ]
  }
};

function applyLessonTemplate(key) {
  const t = LESSON_TEMPLATES[key];
  if (!t) return;
  document.getElementById('lesson-title').value = t.title;
  document.getElementById('lesson-level').value = t.level;
  const cat = document.getElementById('lesson-category');
  if (cat) {
    // try to select matching option or set value
    cat.value = t.category;
  }
  document.getElementById('lesson-description').value = t.description || '';
  document.getElementById('lesson-content').value = t.content || '';
  if (key === 'homework') {
    const hw = document.getElementById('lesson-is-homework');
    if (hw) hw.checked = true;
  }
  const canvas = document.getElementById('lesson-canvas');
  if (canvas) {
    canvas.innerHTML = '';
    if (t.content) addLessonBlock('text', { text: t.content });
    (t.tasks || []).forEach(task => addLessonBlock(task.type || 'open', task));
    updateBlocksCount();
  }
}


let lessonStepIndex = 0;


function parseFillSentence(question, correct) {
  // Supports: "Someone ___ the door" or "Someone [is opening] the door"
  let q = question || '';
  let answer = (correct || '').trim();
  const bracket = q.match(/\[([^\]]+)\]/);
  if (bracket) {
    answer = answer || bracket[1];
    q = q.replace(/\[[^\]]+\]/, '___');
  }
  // Hint after em dash: ".... — OPEN"
  const dash = q.split(/\s*[—–-]\s*/);
  let hint = '';
  if (dash.length > 1 && dash[dash.length - 1].length < 24) {
    hint = dash.pop().trim();
    q = dash.join(' — ').trim();
  }
  const parts = q.split('___');
  return { parts, answer, hint };
}

function renderInlineFill(t, index) {
  const { parts, answer, hint } = parseFillSentence(t.question, t.correct);
  let html = `<div class="ev-item" data-tid="${t.id}" data-type="fill" data-correct="${escapeHtml(answer)}">`;
  html += `<span class="ev-num">${index}.</span> <span class="ev-line">`;
  parts.forEach((part, i) => {
    html += `<span class="ev-text">${escapeHtml(part)}</span>`;
    if (i < parts.length - 1) {
      html += `<input class="ev-blank task-open" autocomplete="off" spellcheck="false" data-answer="${escapeHtml(answer)}" />`;
    }
  });
  html += `</span>`;
  if (hint) html += ` <span class="ev-hint">— ${escapeHtml(hint)}</span>`;
  html += `</div>`;
  return html;
}


function renderEdvibeLesson(lesson, isTeacher) {
  const view = document.getElementById('lesson-view');
  if (!view) return;
  document.body.classList.add('classroom-mode');

  const blocks = lessonBlocksFromLegacy(lesson);
  const sections = [];
  let currentSection = { title: 'Урок', items: [] };
  sections.push(currentSection);

  blocks.forEach(b => {
    if (b.type === 'divider') {
      currentSection = { title: b.title || 'Раздел', items: [] };
      sections.push(currentSection);
    } else {
      currentSection.items.push(b);
    }
  });
  if (sections.length === 1 && !sections[0].items.length && (lesson.tasks || []).length) {
    sections[0].items = (lesson.tasks || []).map(t => ({ ...t, type: t.type || 'open' }));
  }

  let exerciseIndex = 0;
  const mainHtml = sections.map((sec, sIdx) => {
    const body = sec.items.map(b => {
      if (b.type === 'text') return `<div class="ev-theory">${escapeHtml(b.text||'').replace(/\n/g,'<br>')}</div>`;
      if (b.type === 'note') return `<div class="ev-note">${escapeHtml(b.text||'')}</div>`;
      if (b.type === 'heading') return `<h3 class="ev-custom-heading">${escapeHtml(b.title||'Раздел')}</h3>`;
      if (b.type === 'audio') return b.url ? `<div class="ev-media-block"><audio controls preload="none" src="${escapeHtml(b.url)}"></audio>${b.caption?`<small>${escapeHtml(b.caption)}</small>`:''}</div>` : '';
      if (b.type === 'image') return b.url ? `<figure class="ev-media-block"><img src="${escapeHtml(b.url)}" alt="${escapeHtml(b.caption||'Иллюстрация к уроку')}" loading="lazy">${b.caption?`<figcaption>${escapeHtml(b.caption)}</figcaption>`:''}</figure>` : '';
      if (b.type === 'flashcards') { const cards=(b.text||'').split('\n').map(x=>x.split('=').map(y=>y.trim())).filter(x=>x[0]&&x[1]); return `<div class="ev-flashcards">${cards.map((c,i)=>`<button type="button" class="ev-flashcard" data-front="${escapeHtml(c[0])}" data-back="${escapeHtml(c[1])}"><b>${escapeHtml(c[0])}</b><span>Нажми, чтобы увидеть перевод</span></button>`).join('')}</div>`; }
      if (b.type === 'video') {
        const id = youtubeId(b.url||'');
        return id ? `<div class="yt-wrap"><iframe src="https://www.youtube.com/embed/${id}" allowfullscreen loading="lazy"></iframe></div>` : '';
      }
      if (b.type === 'wordlist') {
        const lines = (b.text||'').split('\n').filter(Boolean);
        return `<div class="ev-wordlist"><ul>${lines.map(l=>'<li>'+escapeHtml(l)+'</li>').join('')}</ul></div>`;
      }
      if (['fill','open','choice','truefalse','order','match'].includes(b.type)) {
        exerciseIndex++;
        if (b.type === 'fill') return renderInlineFill(b, exerciseIndex);
        if (b.type === 'choice') {
          return `<div class="ev-item" data-tid="${b.id}" data-type="choice" data-correct="${escapeHtml(b.correct||'')}">
            <span class="ev-num">${exerciseIndex}.</span>
            <div class="ev-q">${escapeHtml(b.question||'')}</div>
            <div class="task-choices">${(b.options||[]).map(o=>`<label class="choice-label"><input type="radio" name="ans_${b.id}" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>`).join('')}</div>
          </div>`;
        }
        if (b.type === 'truefalse') {
          return `<div class="ev-item" data-tid="${b.id}" data-type="truefalse" data-correct="${escapeHtml(b.correct||'true')}">
            <span class="ev-num">${exerciseIndex}.</span>
            <div class="ev-q">${escapeHtml(b.question||'')}</div>
            <div class="task-choices">
              <label class="choice-label"><input type="radio" name="ans_${b.id}" value="true"> Верно</label>
              <label class="choice-label"><input type="radio" name="ans_${b.id}" value="false"> Неверно</label>
            </div>
          </div>`;
        }
        if (b.type === 'order') {
          const bank=(b.correct||'').split(/\s+/).filter(Boolean).sort(()=>Math.random()-0.5);
          return `<div class="ev-item" data-tid="${b.id}" data-type="order" data-correct="${escapeHtml(b.correct||'')}">
            <span class="ev-num">${exerciseIndex}.</span>
            <div class="ev-q">${escapeHtml(b.question||'')}</div>
            <p class="word-bank">${bank.map(escapeHtml).join(' · ')}</p>
            <input class="task-open" placeholder="Собери предложение" />
          </div>`;
        }
        if (b.type === 'match') {
          const pairs=(b.pairs||'').split(',').map(x=>x.trim().split('='));
          return `<div class="ev-item" data-tid="${b.id}" data-type="match">
            <span class="ev-num">${exerciseIndex}.</span>
            <div class="ev-q">${escapeHtml(b.question||'')}</div>
            <div class="match-task">${pairs.map(p=>`<label>${escapeHtml(p[0]||'')} → <input class="match-answer" data-expected="${escapeHtml(p[1]||'')}" /></label>`).join('')}</div>
          </div>`;
        }
        return `<div class="ev-item" data-tid="${b.id}" data-type="open">
          <span class="ev-num">${exerciseIndex}.</span>
          <div class="ev-q">${escapeHtml(b.question||'')}</div>
          <textarea class="task-open" rows="2" placeholder="Твой ответ..."></textarea>
        </div>`;
      }
      return '';
    }).join('');
    return `<section class="ev-section" id="ev-sec-${sIdx}" data-sec="${sIdx}">
      <h3 class="ev-section-title">${escapeHtml(sec.title)}</h3>
      ${body}
    </section>`;
  }).join('');

  const sectionsNav = sections.map((s,i) =>
    `<button type="button" class="ev-sec-btn ${i===0?'active':''}" data-sec="${i}">${escapeHtml(s.title)}</button>`
  ).join('');

  const cls = classes.find(c => c.id === currentClassId);
  const remoteName = isTeacher
    ? ((cls?.students || [])[0]?.name || 'Ученик')
    : (cls?.teacherName || 'Учитель');
  const localName = currentUser?.name || 'Вы';
  const inCall = !!(currentCall || localStream);

  view.innerHTML = `
    <div class="classroom ${inCall ? 'in-call' : ''}">
      <header class="cr-top cr-top-compact">
        <button type="button" class="cr-back" id="cr-back" title="Назад">←</button>
        <div class="cr-heading"><strong>${escapeHtml(lesson.title)}</strong><span>${escapeHtml(cls?.name || 'Класс')}</span></div>
        <div class="cr-layout-switch" role="group" aria-label="Вид урока">
          <button type="button" class="cr-layout-btn" data-layout="mobile">Телефон</button>
          <button type="button" class="cr-layout-btn active" data-layout="desktop">ПК</button>
        </div>
      </header>

      <div class="cr-body">
        <main class="cr-lesson">
          <div class="cr-lesson-tabs">
            <button type="button" class="cr-tab active">Урок</button>
            <button type="button" class="cr-tab" id="cr-tab-hw">Домашняя работа</button>
          </div>
          <div class="cr-lesson-scroll" id="ev-exercises">
            <div class="cr-lesson-title">
              <span class="badge">${escapeHtml(lesson.level||'')}</span>
              <h2>${escapeHtml(lesson.title)}</h2>
              <p class="muted">${escapeHtml(lesson.description||'')}</p>
            </div>
            ${mainHtml}
            <div id="tasks-result" class="tasks-result"></div>
          </div>
          <div class="cr-lesson-scroll hidden" id="ev-homework-panel">
            <div class="cr-lesson-title"><span class="badge">Домашняя работа</span><h2>${escapeHtml(lesson.title)}</h2>
            <p class="muted">${lesson.isHomework ? 'Это домашнее задание. Выполни упражнения во вкладке «Урок» и сохрани ответы.' : 'К этому уроку отдельное домашнее задание пока не прикреплено.'}</p></div>
            ${lesson.deadline ? `<p class="ev-note">Срок выполнения: ${escapeHtml(new Date(lesson.deadline).toLocaleString('ru-RU'))}</p>` : ''}
            <button type="button" class="btn btn-primary" id="ev-homework-back">Вернуться к заданиям</button>
          </div>
          <div class="cr-lesson-toolbar">
            <button type="button" class="btn btn-outline btn-sm" id="ev-check">Проверить</button>
            <button type="button" class="btn btn-outline btn-sm" id="ev-show-answers">Показать ответы</button>
            <button type="button" class="btn btn-outline btn-sm" id="ev-font-down">A−</button>
            <button type="button" class="btn btn-outline btn-sm" id="ev-font-up">A+</button>
            <button type="button" class="btn btn-outline btn-sm" id="ev-next-wrong">К ошибке</button>
            <span class="muted" id="ev-progress-label"></span>
          </div>
        </main>

        <aside class="cr-side">
          <div class="cr-call-card cr-call-launcher">
            <div class="cr-call-title"><span class="cr-call-dot"></span><b>Видеоурок</b></div>
            <p class="cr-call-hint">Звонок откроется в одном плавающем окне и останется доступен во время выполнения заданий.</p>
            <button type="button" class="btn btn-success btn-full" id="cr-call-btn">Подключиться к звонку</button>
            <button type="button" class="btn btn-outline btn-full" id="cr-join-btn">Войти по коду класса</button>
          </div>
          <div class="cr-side-card">
            <h4>Разделы</h4>
            <div class="ev-sec-list">${sectionsNav}</div>
            <button type="button" class="btn btn-outline btn-sm btn-full" id="ev-complete">Завершить урок</button>
          </div>
          <div class="cr-side-card teacher-tools" style="${isTeacher?'':'display:none'}">
            <h4>Учителю</h4>
            <button type="button" class="btn btn-outline btn-sm btn-full" id="edit-lesson-btn-cr">Редактировать</button>
            <button type="button" class="btn btn-outline btn-sm btn-full" id="ev-step-mode">По шагам</button>
          </div>
        </aside>
      </div>

      <footer class="cr-bar cr-bar-compact">
        <span class="cr-local-pill">${escapeHtml(localName)}</span>
        <span class="cr-call-footnote">Управление камерой, микрофоном и завершением — в плавающем окне звонка.</span>
        <button type="button" class="btn btn-outline btn-sm" id="cr-save-answers">Сохранить ответы</button>
      </footer>
    </div>`;

  view.querySelectorAll('.ev-flashcard').forEach(card=>card.addEventListener('click',()=>{const flipped=card.classList.toggle('flipped');card.innerHTML=flipped?`<b>${escapeHtml(card.dataset.back)}</b><span>Нажми, чтобы вернуть слово</span>`:`<b>${escapeHtml(card.dataset.front)}</b><span>Нажми, чтобы увидеть перевод</span>`;}));

  // Delegated handlers keep dynamically rendered lesson controls responsive on touch and desktop.
  const lessonRoot = view.querySelector('.classroom');
  if (lessonRoot) {
    lessonRoot.addEventListener('input', () => { scheduleSaveAnswers(lesson.id); updateProgressLabel(); });
    lessonRoot.addEventListener('change', () => { scheduleSaveAnswers(lesson.id); updateProgressLabel(); });
    const lessonTab = lessonRoot.querySelector('.cr-tab:not(#cr-tab-hw)');
    const homeworkTab = lessonRoot.querySelector('#cr-tab-hw');
    const exercises = lessonRoot.querySelector('#ev-exercises');
    const homeworkPanel = lessonRoot.querySelector('#ev-homework-panel');
    lessonTab?.addEventListener('click', () => { lessonTab.classList.add('active'); homeworkTab?.classList.remove('active'); exercises?.classList.remove('hidden'); homeworkPanel?.classList.add('hidden'); });
    homeworkTab?.addEventListener('click', () => { homeworkTab.classList.add('active'); lessonTab?.classList.remove('active'); exercises?.classList.add('hidden'); homeworkPanel?.classList.remove('hidden'); });
  }

  // Attach streams if call already running
  syncClassroomVideos();

  // Restore saved answers
  restoreLessonAnswers(lesson.id);

  view.querySelectorAll('.ev-sec-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      view.querySelectorAll('.ev-sec-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('ev-sec-' + btn.dataset.sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.getElementById('ev-homework-back')?.addEventListener('click', () => document.querySelector('#lesson-view .cr-tab:not(#cr-tab-hw)')?.click());
  document.getElementById('cr-back')?.addEventListener('click', () => {
    document.body.classList.remove('classroom-mode');
    showPage('class-view');
  });
  const savedLayout = localStorage.getItem('azena_lesson_layout') || (window.matchMedia?.('(max-width: 760px)').matches ? 'mobile' : 'desktop');
  setLessonLayout(savedLayout);
  view.querySelectorAll('[data-layout]').forEach(btn => btn.addEventListener('click', () => setLessonLayout(btn.dataset.layout)));
  document.getElementById('ev-check')?.addEventListener('click', () => {
    checkEdvibeAnswers(lesson);
    updateProgressLabel();
  });
  document.getElementById('ev-show-answers')?.addEventListener('click', () => showAllAnswers(lesson));
  document.getElementById('ev-font-up')?.addEventListener('click', () => changeExerciseFont(1));
  document.getElementById('ev-font-down')?.addEventListener('click', () => changeExerciseFont(-1));
  document.getElementById('ev-next-wrong')?.addEventListener('click', jumpToNextWrong);
  document.getElementById('ev-complete')?.addEventListener('click', markLessonComplete);
  document.getElementById('ev-step-mode')?.addEventListener('click', () => {
    document.body.classList.remove('classroom-mode');
    lessonStepIndex = 0;
    renderLessonStepMode(lesson, isTeacher);
  });
  document.getElementById('edit-lesson-btn-cr')?.addEventListener('click', editCurrentLesson);
  document.getElementById('cr-call-btn')?.addEventListener('click', () => {
    const code = cls?.code || '';
    const codeEl = document.getElementById('live-room-code');
    if (codeEl) codeEl.value = code;
    joinLiveClassroom('host').then(() => setTimeout(syncClassroomVideos, 800));
  });
  document.getElementById('cr-join-btn')?.addEventListener('click', () => {
    const code = cls?.code || '';
    const codeEl = document.getElementById('live-room-code');
    if (codeEl) codeEl.value = code;
    joinLiveClassroom('join').then(() => setTimeout(syncClassroomVideos, 800));
  });
  document.getElementById('cr-save-answers')?.addEventListener('click', () => {
    saveLessonAnswers(lesson.id);
    alert('Ответы сохранены на этом устройстве');
  });
  document.getElementById('cr-fs')?.addEventListener('click', () => {
    const root = view.querySelector('.classroom');
    if (!document.fullscreenElement) root?.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  view.querySelectorAll('.ev-blank').forEach((input, idx, arr) => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const next = arr[idx + 1];
        if (next) next.focus();
        else document.getElementById('ev-check')?.click();
      }
    });
    input.addEventListener('input', () => {
      input.classList.remove('blank-ok', 'blank-bad');
      scheduleSaveAnswers(lesson.id);
    });
  });
  updateProgressLabel();
}

function setLessonLayout(mode) {
  const normalized = mode === 'mobile' ? 'mobile' : 'desktop';
  document.querySelector('.classroom')?.classList.toggle('lesson-mobile-layout', normalized === 'mobile');
  document.querySelector('.classroom')?.classList.toggle('lesson-desktop-layout', normalized === 'desktop');
  document.querySelectorAll('.cr-layout-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.layout === normalized));
  try { localStorage.setItem('azena_lesson_layout', normalized); } catch (_) {}
}

function syncClassroomVideos() {
  // The lesson and the video page use the same PeerJS streams and the same floating call window.
  // No second classroom video element is created, so audio/video cannot drift out of sync.
  if (currentCall || localStream) showPip();
}

function syncCrCtrlIcons() {
  setIconBtn(document.getElementById('cr-mic'), isMicOn ? 'mic' : 'mic-off');
  setIconBtn(document.getElementById('cr-cam'), isCamOn ? 'cam' : 'cam-off');
}

function changeExerciseFont(dir) {
  const el = document.getElementById('ev-exercises');
  if (!el) return;
  const cur = parseFloat(getComputedStyle(el).fontSize) || 16;
  el.style.fontSize = Math.max(13, Math.min(22, cur + dir * 1.5)) + 'px';
}

function jumpToNextWrong() {
  const wrong = document.querySelector('#ev-exercises .ev-item.is-wrong');
  wrong?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showAllAnswers(lesson) {
  document.querySelectorAll('#ev-exercises .ev-item').forEach(item => {
    const type = item.dataset.type;
    const correct = item.dataset.correct || '';
    if (type === 'fill' || type === 'order') {
      const input = item.querySelector('.ev-blank, .task-open');
      if (input && correct) { input.value = correct; input.classList.add('blank-ok'); input.classList.remove('blank-bad'); }
    } else if (type === 'choice' || type === 'truefalse') {
      const option = [...item.querySelectorAll('input[type=radio]')].find(r => r.value === correct);
      if (option) option.checked = true;
    } else if (type === 'match') {
      item.querySelectorAll('.match-answer').forEach(input => { input.value = input.dataset.expected || ''; input.classList.add('blank-ok'); });
    }
    item.classList.remove('is-wrong'); item.classList.add('is-correct');
  });
  updateProgressLabel();
}

function lessonAnswersKey(lessonId) {
  return `azena_ans:${currentUser?.id || 'x'}:${currentClassId}:${lessonId}`;
}
function saveLessonAnswers(lessonId) {
  const data = {};
  document.querySelectorAll('#ev-exercises .ev-item').forEach(item => {
    const id = item.dataset.tid;
    const input = item.querySelector('.ev-blank, .task-open, textarea.task-open');
    if (input) data[id] = input.value;
    const checked = item.querySelector('input[type=radio]:checked');
    if (checked) data[id] = checked.value;
    const matches = [...item.querySelectorAll('.match-answer')];
    if (matches.length) data[id] = matches.map(x => x.value);
  });
  localStorage.setItem(lessonAnswersKey(lessonId), JSON.stringify(data));
}
let _ansSaveTimer = null;
function scheduleSaveAnswers(lessonId) {
  clearTimeout(_ansSaveTimer);
  _ansSaveTimer = setTimeout(() => saveLessonAnswers(lessonId), 400);
}
function restoreLessonAnswers(lessonId) {
  try {
    const data = JSON.parse(localStorage.getItem(lessonAnswersKey(lessonId)) || '{}');
    document.querySelectorAll('#ev-exercises .ev-item').forEach(item => {
      const id = item.dataset.tid;
      if (data[id] == null) return;
      const input = item.querySelector('.ev-blank, .task-open, textarea.task-open');
      if (input && !Array.isArray(data[id])) input.value = data[id];
      const radio = item.querySelector(`input[type=radio][value="${CSS.escape(String(data[id]))}"]`);
      if (radio) radio.checked = true;
      if (Array.isArray(data[id])) item.querySelectorAll('.match-answer').forEach((el, i) => { el.value = data[id][i] || ''; });
    });
  } catch (_) {}
}
function updateProgressLabel() {
  const items = document.querySelectorAll('#ev-exercises .ev-item');
  const filled = [...items].filter(i => {
    const input = i.querySelector('.ev-blank, .task-open, textarea.task-open');
    if (input) return !!(input.value || '').trim();
    const matches = [...i.querySelectorAll('.match-answer')];
    if (matches.length) return matches.some(x => x.value.trim());
    return !!i.querySelector('input[type=radio]:checked');
  }).length;
  const el = document.getElementById('ev-progress-label');
  if (el) el.textContent = items.length ? `Заполнено ${filled}/${items.length}` : '';
}

function checkEdvibeAnswers(lesson) {
  let correct = 0, total = 0;
  document.querySelectorAll('#ev-exercises .ev-item').forEach(item => {
    const type = item.dataset.type;
    if (type === 'open') {
      total++;
      const val = item.querySelector('.task-open')?.value.trim();
      if (val) { correct++; item.classList.add('is-correct'); item.classList.remove('is-wrong'); }
      else { item.classList.add('is-wrong'); item.classList.remove('is-correct'); }
      return;
    }
    if (type === 'fill' || type === 'order') {
      total++;
      const input = item.querySelector('.task-open, .ev-blank');
      const user = (input?.value || '').trim().toLowerCase();
      const ans = (item.dataset.correct || '').trim().toLowerCase();
      if (user && user === ans) {
        correct++;
        item.classList.add('is-correct');
        item.classList.remove('is-wrong');
        if (input) { input.classList.add('blank-ok'); input.classList.remove('blank-bad'); }
      } else {
        item.classList.add('is-wrong');
        item.classList.remove('is-correct');
        if (input) { input.classList.add('blank-bad'); input.classList.remove('blank-ok'); }
      }
      return;
    }
    if (type === 'choice' || type === 'truefalse') {
      total++;
      const checked = item.querySelector('input[type=radio]:checked');
      const user = checked ? checked.value : '';
      if (String(user) === String(item.dataset.correct)) {
        correct++; item.classList.add('is-correct'); item.classList.remove('is-wrong');
      } else {
        item.classList.add('is-wrong'); item.classList.remove('is-correct');
      }
      return;
    }
    if (type === 'match') {
      total++;
      const inputs = [...item.querySelectorAll('.match-answer')];
      const ok = inputs.length && inputs.every(f => f.value.trim().toLowerCase() === (f.dataset.expected||'').toLowerCase());
      if (ok) { correct++; item.classList.add('is-correct'); item.classList.remove('is-wrong'); }
      else { item.classList.add('is-wrong'); item.classList.remove('is-correct'); }
    }
  });
  const box = document.getElementById('tasks-result');
  if (box) {
    box.className = 'tasks-result show';
    box.innerHTML = `<strong>Результат: ${correct} из ${total}</strong>`;
  }
}

function renderLessonStepMode(lesson, isTeacher) {
  const legacyBlocks = lessonBlocksFromLegacy(lesson);
  const tasks = (lesson.tasks && lesson.tasks.length) ? lesson.tasks : blocksToTasks(legacyBlocks);
  const view = document.getElementById('lesson-view');
  if (!view || !tasks.length) return;

  if (lessonStepIndex >= tasks.length) lessonStepIndex = tasks.length - 1;
  if (lessonStepIndex < 0) lessonStepIndex = 0;
  const t = tasks[lessonStepIndex];
  const progress = Math.round(((lessonStepIndex + 1) / tasks.length) * 100);

  let body = '';
  if (t.type === 'choice') {
    body = (t.options || []).map((o,i)=>`<label class="task-option"><input type="radio" name="step_ans" value="${escapeHtml(o)}"> ${escapeHtml(o)}</label>`).join('');
  } else if (t.type === 'truefalse') {
    body = `<label class="task-option"><input type="radio" name="step_ans" value="true"> Верно</label>
            <label class="task-option"><input type="radio" name="step_ans" value="false"> Неверно</label>`;
  } else if (t.type === 'match') {
    body = `<p class="muted">Пары: ${escapeHtml(t.pairs || '')}</p><textarea id="step_ans_text" rows="3" placeholder="Твой ответ"></textarea>`;
  } else {
    body = `<textarea id="step_ans_text" rows="3" placeholder="Твой ответ"></textarea>`;
  }

  const teacherHint = isTeacher && t.correct ? `<p class="muted teacher-key">Ключ: <b>${escapeHtml(String(t.correct))}</b></p>` : '';

  view.innerHTML = `
    <div class="lesson-step-shell">
      <div class="lesson-step-top">
        <button type="button" class="btn btn-outline btn-sm" id="lesson-focus-toggle">Фокус</button>
        <button type="button" class="btn btn-outline btn-sm" id="lesson-timer-btn">Таймер 5м</button>
        <span id="lesson-timer-display" class="muted"></span>
        <button type="button" class="btn btn-outline btn-sm" id="lesson-star-btn">${(lesson.starred ? '★' : '☆')} В избранное</button>
      </div>
      <div class="lesson-progress-bar"><div class="lesson-progress-fill" style="width:${progress}%"></div></div>
      <p class="muted">Задание ${lessonStepIndex + 1} из ${tasks.length}</p>
      <article class="lesson-step-card">
        <h2>${escapeHtml(lesson.title)}</h2>
        <h3>${escapeHtml(t.question || 'Задание')}</h3>
        <div class="task-body">${body}</div>
        ${teacherHint}
      </article>
      <div class="lesson-step-nav">
        <button type="button" class="btn btn-outline" id="step-prev" ${lessonStepIndex===0?'disabled':''}>Назад</button>
        <button type="button" class="btn btn-primary" id="step-next">${lessonStepIndex >= tasks.length-1 ? 'К результатам' : 'Далее'}</button>
      </div>
      <div class="lesson-classic-link"><button type="button" class="btn btn-outline btn-sm" id="lesson-classic-view">Весь урок сразу</button></div>
    </div>`;

  document.getElementById('step-prev')?.addEventListener('click', () => { lessonStepIndex--; renderLessonStepMode(lesson, isTeacher); });
  document.getElementById('step-next')?.addEventListener('click', () => {
    if (lessonStepIndex >= tasks.length - 1) {
      // fall back to classic check view
      viewLesson(currentClassId, lesson.id, true);
      return;
    }
    lessonStepIndex++;
    renderLessonStepMode(lesson, isTeacher);
  });
  document.getElementById('lesson-classic-view')?.addEventListener('click', () => viewLesson(currentClassId, lesson.id, true));
  document.getElementById('lesson-focus-toggle')?.addEventListener('click', toggleFocusMode);
  document.getElementById('lesson-timer-btn')?.addEventListener('click', () => startLessonTimer(5 * 60));
  document.getElementById('lesson-star-btn')?.addEventListener('click', () => toggleLessonStar(lesson.id));
}

function toggleFocusMode() {
  document.body.classList.toggle('focus-mode');
}

let lessonTimerId = null;
function startLessonTimer(seconds) {
  clearInterval(lessonTimerId);
  let left = seconds;
  const el = document.getElementById('lesson-timer-display');
  const tick = () => {
    const m = String(Math.floor(left / 60)).padStart(2, '0');
    const s = String(left % 60).padStart(2, '0');
    if (el) el.textContent = `⏱ ${m}:${s}`;
    if (left <= 0) {
      clearInterval(lessonTimerId);
      if (el) el.textContent = 'Время вышло';
      try { navigator.vibrate?.(200); } catch(_){}
      return;
    }
    left--;
  };
  tick();
  lessonTimerId = setInterval(tick, 1000);
}

function toggleLessonStar(lessonId) {
  const cls = classes.find(c => c.id === currentClassId);
  const lesson = cls?.lessons?.find(l => l.id === lessonId);
  if (!lesson) return;
  lesson.starred = !lesson.starred;
  saveClasses();
  alert(lesson.starred ? 'Урок в избранном' : 'Убран из избранного');
}

function filterClassLessons() {
  const q = (document.getElementById('lesson-search')?.value || '').toLowerCase();
  const lvl = document.getElementById('lesson-filter-level')?.value || '';
  document.querySelectorAll('#class-lessons-list .lesson-card, #class-lessons-list .card').forEach(card => {
    const text = card.textContent.toLowerCase();
    const okQ = !q || text.includes(q);
    const okL = !lvl || text.includes(lvl.toLowerCase());
    card.style.display = okQ && okL ? '' : 'none';
  });
}

function renderHomeContinue() {
  const box = document.getElementById('home-continue');
  if (!box || !currentUser) return;
  const recent = [];
  classes.forEach(c => {
    (c.lessons || []).forEach(l => {
      if (l.updatedAt || l.createdAt || l.starred) {
        recent.push({ classId: c.id, className: c.name, lesson: l });
      }
    });
  });
  recent.sort((a,b) => (b.lesson.updatedAt||b.lesson.createdAt||0) - (a.lesson.updatedAt||a.lesson.createdAt||0));
  const starred = recent.filter(r => r.lesson.starred).slice(0, 3);
  const top = (starred.length ? starred : recent.slice(0, 3));
  if (!top.length) { box.classList.add('hidden'); box.innerHTML=''; return; }
  box.classList.remove('hidden');
  box.innerHTML = `<h3>Продолжить</h3><div class="continue-grid">${top.map(r => `
    <button type="button" class="card continue-card" data-cid="${r.classId}" data-lid="${r.lesson.id}">
      <strong>${escapeHtml(r.lesson.title)}</strong>
      <span class="muted">${escapeHtml(r.className)}${r.lesson.starred?' · ★':''}</span>
    </button>`).join('')}</div>`;
  box.querySelectorAll('.continue-card').forEach(btn => {
    btn.addEventListener('click', () => {
      openClass(btn.dataset.cid);
      setTimeout(() => viewLesson(btn.dataset.cid, btn.dataset.lid), 50);
    });
  });
}

function copyClassInvite() {
  const cls = classes.find(c => c.id === currentClassId);
  if (!cls) return;
  const text = `Присоединяйся к классу «${cls.name}» в Azena. Код: ${cls.code}`;
  navigator.clipboard.writeText(text).then(() => alert('Приглашение скопировано')).catch(() => alert('Код: ' + cls.code));
}

function markLessonComplete() {
  const cls = classes.find(c => c.id === currentClassId);
  if (!cls || !currentLessonId || !currentUser) return;
  const st = (cls.students || []).find(s => s.id === currentUser.id);
  if (st) {
    st.completedLessons = st.completedLessons || [];
    if (!st.completedLessons.includes(currentLessonId)) st.completedLessons.push(currentLessonId);
    saveClasses();
    alert('Урок отмечен как пройденный');
  } else {
    // teacher or not in students list — store on user local
    const key = 'azena_completed:' + currentUser.id;
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const id = currentClassId + ':' + currentLessonId;
    if (!arr.includes(id)) arr.push(id);
    localStorage.setItem(key, JSON.stringify(arr));
    alert('Урок отмечен как пройденный');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
  initTheme();

  // Critical landing buttons first
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);
  document.getElementById('theme-toggle-app')?.addEventListener('click', toggleTheme);

  document.getElementById('btn-login')?.addEventListener('click', () => {
    try { openAuth('login'); } catch (err) { console.error(err); alert('Ошибка открытия входа'); }
  });
  document.getElementById('btn-register')?.addEventListener('click', () => {
    try { openAuth('register'); } catch (err) { console.error(err); alert('Ошибка открытия регистрации'); }
  });
  document.getElementById('auth-close')?.addEventListener('click', closeAuth);
  document.getElementById('auth-form')?.addEventListener('submit', handleAuth);
  document.getElementById('auth-switch-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    const mode = document.getElementById('auth-form').dataset.mode;
    openAuth(mode === 'login' ? 'register' : 'login');
  });

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  document.querySelectorAll('[data-goto]').forEach(el => {
    el.addEventListener('click', () => showPage(el.dataset.goto));
  });
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  document.getElementById('create-class-form')?.addEventListener('submit', createClass);
  document.getElementById('join-class-form')?.addEventListener('submit', joinClass);

  document.getElementById('lesson-form')?.addEventListener('submit', handleLessonSubmit);
  document.getElementById('edit-lesson-btn')?.addEventListener('click', editCurrentLesson);
  document.getElementById('delete-lesson-btn')?.addEventListener('click', deleteCurrentLesson);
  document.getElementById('add-task-btn')?.addEventListener('click', () => addTaskBlock());
  document.getElementById('lesson-images-input')?.addEventListener('change', handleImageUpload);
  document.getElementById('go-create-lesson')?.addEventListener('click', () => {
    if (!currentClassId) {
      alert('Сначала открой класс');
      showPage('classes');
      return;
    }
    resetLessonForm();
    showPage('create-lesson');
  });

  document.querySelectorAll('.vtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.vtab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const isCreate = tab.dataset.vtab === 'create';
      document.getElementById('create-room-card').classList.toggle('hidden', !isCreate);
      document.getElementById('join-room-card').classList.toggle('hidden', isCreate);
    });
  });
  document.getElementById('create-room-btn')?.addEventListener('click', createRoom);
  document.getElementById('join-room-btn')?.addEventListener('click', joinRoom);
  document.getElementById('copy-room-code')?.addEventListener('click', copyRoomCode);
  document.getElementById('end-call')?.addEventListener('click', () => endCallCleanup(true));
  document.getElementById('toggle-mic')?.addEventListener('click', toggleMic);
  document.getElementById('toggle-cam')?.addEventListener('click', toggleCam);
  document.getElementById('toggle-chat')?.addEventListener('click', toggleChatPanel);
  document.getElementById('close-chat')?.addEventListener('click', toggleChatPanel);
  document.getElementById('send-chat')?.addEventListener('click', sendChat);
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  document.getElementById('new-phrase-btn')?.addEventListener('click', showRandomPhrase);
  document.getElementById('speak-phrase')?.addEventListener('click', speakPhrase);

  // Class tabs
  document.querySelectorAll('.ctab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.ctab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('ctab-' + tab.dataset.ctab)?.classList.add('active');
    });
  });

  document.getElementById('open-pinned')?.addEventListener('click', () => {
    const cls = classes.find(c => c.id === currentClassId);
    if (cls?.pinnedLessonId) viewLesson(cls.id, cls.pinnedLessonId);
  });

  document.getElementById('add-vocab-btn')?.addEventListener('click', addVocab);
  document.getElementById('start-class-live')?.addEventListener('click', startLiveFromClass);
  document.getElementById('start-class-call')?.addEventListener('click', startLiveFromClass);

  // Profile edit
  document.getElementById('profile-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!currentUser) return;
    currentUser.name = document.getElementById('edit-name').value.trim() || currentUser.name;
    currentUser.email = document.getElementById('edit-email').value.trim() || currentUser.email;
    currentUser.bio = document.getElementById('edit-bio').value.trim();
    saveUser(currentUser);
    enterApp();
    alert('Профиль сохранён');
  });

  document.getElementById('avatar-input')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 800 * 1024) return alert('Фото слишком большое (макс ~800 КБ)');
    const reader = new FileReader();
    reader.onload = () => {
      currentUser.avatar = reader.result;
      saveUser(currentUser);
      enterApp();
    };
    reader.readAsDataURL(file);
  });

  // Daily PIP controls
  const relayToggle = document.getElementById('force-relay-toggle');
  if (relayToggle) {
    relayToggle.checked = localStorage.getItem('azena_force_relay') === '1';
    relayToggle.addEventListener('change', () => {
      forceRelay = relayToggle.checked;
      localStorage.setItem('azena_force_relay', forceRelay ? '1' : '0');
      setStatus(forceRelay ? 'Надёжный режим: ON (трафик через TURN)' : 'Надёжный режим: OFF');
    });
  }
  document.getElementById('host-live-btn')?.addEventListener('click', () => joinLiveClassroom('host'));
  document.getElementById('join-live-btn')?.addEventListener('click', () => joinLiveClassroom('join'));
  document.getElementById('pip-mic')?.addEventListener('click', dailyToggleMic);
  document.getElementById('pip-cam')?.addEventListener('click', dailyToggleCam);
  document.getElementById('pip-screen')?.addEventListener('click', dailyToggleScreen);
  document.getElementById('pip-expand')?.addEventListener('click', togglePipSize);
  document.getElementById('pip-end')?.addEventListener('click', leaveLiveClassroom);
  document.getElementById('leave-live-btn')?.addEventListener('click', leaveLiveClassroom);
  document.getElementById('start-class-live')?.addEventListener('click', startLiveFromClass);

  document.getElementById('vektor-fab')?.addEventListener('click', toggleVektor);
  document.getElementById('vektor-close')?.addEventListener('click', toggleVektor);
  document.getElementById('vektor-send')?.addEventListener('click', sendVektor);
  document.getElementById('vektor-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendVektor();
  });

  document.getElementById('vektor-voice')?.addEventListener('click',startVoiceInput);
  document.getElementById('vektor-prepare-call')?.addEventListener('click',vektorPrepareCall);
  document.getElementById('vocab-practice')?.addEventListener('click',practiceVocab);
  document.getElementById('personal-vocab-add')?.addEventListener('click',addPersonalVocabFromForm);
  document.getElementById('personal-vocab-practice')?.addEventListener('click',practicePersonalVocab);
  document.getElementById('save-board')?.addEventListener('click',saveBoard);
  ['lesson-title','lesson-level','lesson-category','lesson-description'].forEach(id=>document.getElementById(id)?.addEventListener('input',scheduleBuilderDraft));
  document.getElementById('lesson-canvas')?.addEventListener('input',scheduleBuilderDraft);
  document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&document.getElementById('page-create-lesson')?.classList.contains('active')){e.preventDefault();document.getElementById('lesson-form')?.requestSubmit();}});
  document.getElementById('restore-lesson-draft')?.addEventListener('click',restoreBuilderDraft);
  document.querySelectorAll('.palette-item[data-block]').forEach(btn => {
    btn.addEventListener('click', () => addLessonBlock(btn.dataset.block));
  });
  document.getElementById('lesson-preview-btn')?.addEventListener('click', () => {
    const blocks = collectBlocks();
    if (!blocks.length) return alert('Сначала добавьте блоки');
    alert('Превью: в уроке будет ' + blocks.length + ' блоков.\nПервый: ' + (BLOCK_LABELS[blocks[0].type] || blocks[0].type));
  });
  document.querySelectorAll('.tpl-btn').forEach(btn => {
    btn.addEventListener('click', () => applyLessonTemplate(btn.dataset.tpl));
  });
  document.querySelectorAll('[data-quick-task]').forEach(btn => {
    btn.addEventListener('click', () => addTaskBlock({ type: btn.dataset.quickTask, question: '' }));
  });
  document.getElementById('lesson-search')?.addEventListener('input', filterClassLessons);
  document.getElementById('lesson-filter-level')?.addEventListener('change', filterClassLessons);
  document.getElementById('copy-class-invite')?.addEventListener('click', copyClassInvite);
  document.getElementById('class-chat-send')?.addEventListener('click', sendClassChat);
  document.getElementById('class-chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendClassChat();
  });
  // When opening board/chat tab, resize canvas if needed
  document.querySelectorAll('.ctab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.ctab === 'board') {
        setTimeout(() => {
          const c = classes.find(x => x.id === currentClassId);
          if (c) initWhiteboard(c);
        }, 50);
      }
      if (tab.dataset.ctab === 'chat') {
        const c = classes.find(x => x.id === currentClassId);
        if (c) renderClassChat(c);
      }
    });
  });
  initSupabase().then(async ready=>{if(ready){const {data:{session}}=await supabaseClient.auth.getSession();if(session?.user){const p=await supabaseClient.from('profiles').select('*').eq('id',session.user.id).maybeSingle();currentUser={id:session.user.id,name:p.data?.name||session.user.user_metadata?.name||session.user.email.split('@')[0],email:session.user.email,role:p.data?.role||session.user.user_metadata?.role||'student',bio:p.data?.bio||''};saveUser(currentUser);await loadCloudClasses();enterApp();}}});

  if (loadUser()) {
    enterApp();
    try { supabaseUpsertProfile(currentUser); } catch (_) {}
  } else {
    showScreen('landing');
  }

  // Clean up Whereby embed when leaving the page
  window.addEventListener('beforeunload', () => {
    try { leaveLiveClassroom(); } catch (_) {}
  });
  } catch (err) {
    console.error('Azena init error', err);
    // still show landing so buttons work if possible
    try { showScreen('landing'); } catch (_) {}
  }
});
