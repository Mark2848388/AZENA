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
    currentUser.role === 'teacher' ? 'Учитель 👨‍🏫' : 'Ученик 👨‍🎓';
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
}

// ==================== NAVIGATION ====================
function showPage(pageId) {
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
  document.getElementById('lesson-form-title').textContent = 'Создать урок';
  document.getElementById('lesson-id').value = '';
  document.getElementById('lesson-form').reset();
  document.getElementById('lesson-level').value = 'B1';
  document.getElementById('lesson-images-preview').innerHTML = '';
  document.getElementById('tasks-builder').innerHTML = '';
  window._lessonImages = [];
}

function addTaskBlock(task = null) {
  const id = task?.id || 't_' + Date.now() + Math.random().toString(36).slice(2, 5);
  const type = task?.type || 'open';
  const div = document.createElement('div');
  div.className = 'task-block';
  div.dataset.taskId = id;
  div.innerHTML = `
    <div class="task-block-header">
      <select class="task-type">
        <option value="open" ${type === 'open' ? 'selected' : ''}>Открытый ответ</option>
        <option value="choice" ${type === 'choice' ? 'selected' : ''}>Выбор варианта</option>
        <option value="truefalse" ${type === 'truefalse' ? 'selected' : ''}>Верно / Неверно</option>
        <option value="fill" ${type === 'fill' ? 'selected' : ''}>Fill the gaps</option>
        <option value="order" ${type === 'order' ? 'selected' : ''}>Order the words</option>
        <option value="match" ${type === 'match' ? 'selected' : ''}>Match (пары)</option>
      </select>
      <button type="button" class="btn btn-danger btn-sm remove-task">×</button>
    </div>
    <input type="text" class="task-question" placeholder="Вопрос / задание" value="${escapeHtml(task?.question || '')}" />
    <div class="task-options ${type === 'choice' ? '' : 'hidden'}">
      <input type="text" class="opt" placeholder="Вариант 1" value="${escapeHtml(task?.options?.[0] || '')}" />
      <input type="text" class="opt" placeholder="Вариант 2" value="${escapeHtml(task?.options?.[1] || '')}" />
      <input type="text" class="opt" placeholder="Вариант 3" value="${escapeHtml(task?.options?.[2] || '')}" />
      <input type="text" class="opt" placeholder="Вариант 4" value="${escapeHtml(task?.options?.[3] || '')}" />
      <input type="text" class="task-correct" placeholder="Правильный ответ (текст варианта)" value="${escapeHtml(task?.correct || '')}" />
    </div>
    <div class="task-extra-answer ${['fill','order'].includes(type) ? '' : 'hidden'}"><input class="extra-correct" placeholder="Правильный ответ / фраза" value="${escapeHtml(task?.correct || '')}" /></div>
    <div class="task-match ${type === 'match' ? '' : 'hidden'}"><textarea class="match-pairs" rows="3" placeholder="Пары в формате cat=кот, dog=собака">${escapeHtml(task?.pairs || '')}</textarea></div>
    <div class="task-tf ${type === 'truefalse' ? '' : 'hidden'}">
      <label><input type="radio" name="tf_${id}" value="true" ${task?.correct === 'true' ? 'checked' : ''}> Верно</label>
      <label><input type="radio" name="tf_${id}" value="false" ${task?.correct === 'false' ? 'checked' : ''}> Неверно</label>
    </div>
  `;
  div.querySelector('.task-type').addEventListener('change', (e) => {
    const t = e.target.value;
    div.querySelector('.task-options').classList.toggle('hidden', t !== 'choice');
    div.querySelector('.task-tf').classList.toggle('hidden', t !== 'truefalse');
    div.querySelector('.task-extra-answer').classList.toggle('hidden', !['fill','order'].includes(t));
    div.querySelector('.task-match').classList.toggle('hidden', t !== 'match');
  });
  div.querySelector('.remove-task').addEventListener('click', () => div.remove());
  document.getElementById('tasks-builder').appendChild(div);
}

function collectTasks() {
  const tasks = [];
  document.querySelectorAll('.task-block').forEach(block => {
    const type = block.querySelector('.task-type').value;
    const question = block.querySelector('.task-question').value.trim();
    if (!question) return;
    const task = { id: block.dataset.taskId, type, question };
    if (type === 'choice') {
      task.options = Array.from(block.querySelectorAll('.opt')).map(i => i.value.trim()).filter(Boolean);
      task.correct = block.querySelector('.task-correct').value.trim();
    }
    if (['fill','order'].includes(type)) task.correct=block.querySelector('.extra-correct').value.trim();
    if(type==='match') task.pairs=block.querySelector('.match-pairs').value.trim();
    if (type === 'truefalse') {
      const checked = block.querySelector('input[type=radio]:checked');
      task.correct = checked ? checked.value : 'true';
    }
    tasks.push(task);
  });
  return tasks;
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
  const content = document.getElementById('lesson-content').value.trim();
  const images = window._lessonImages || [];
  const tasks = collectTasks();

  if (!title) return alert('Укажи название урока');

  const lessonData = {
    title, level, category, description, content,
    images, tasks, deadline: document.getElementById('lesson-deadline')?.value || null,
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

function viewLesson(classId, lessonId) {
  const cls = classes.find(c => c.id === classId);
  if (!cls) return;
  const lesson = cls.lessons.find(l => l.id === lessonId);
  if (!lesson) return;

  currentClassId = classId;
  currentLessonId = lessonId;

  const view = document.getElementById('lesson-view');
  let imagesHtml = '';
  if (lesson.images?.length) {
    imagesHtml = '<div class="lesson-images">' +
      lesson.images.map(src => '<img src="' + src + '" alt="Картинка к уроку">').join('') +
      '</div>';
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
    <div class="content">${escapeHtml(lesson.content || '')}</div>
    <div class="lesson-vektor-tools"><button class="btn btn-outline btn-sm" id="lesson-explain-vektor">Объясни это</button><button class="btn btn-outline btn-sm" id="lesson-check-vektor">Проверь мой ответ</button><button class="btn btn-outline btn-sm" id="lesson-prepare-call">Подготовь к звонку</button></div>
    <div class="lesson-word-tools"><input id="lesson-word-input" placeholder="Word" /><input id="lesson-word-translation" placeholder="Перевод" /><button id="lesson-add-word" class="btn btn-outline btn-sm">+ В словарь</button></div>
    ${tasksHtml}
  `;

  document.getElementById('lesson-explain-vektor')?.addEventListener('click',()=>askVektorWithContext('explain'));
  document.getElementById('lesson-check-vektor')?.addEventListener('click',()=>askVektorWithContext('check'));
  document.getElementById('lesson-prepare-call')?.addEventListener('click',vektorPrepareCall);
  document.getElementById('lesson-add-word')?.addEventListener('click',()=>addLessonWord(document.getElementById('lesson-word-input').value.trim(),document.getElementById('lesson-word-translation').value.trim()));
  const checkBtn = document.getElementById('check-tasks-btn');
  if (checkBtn) {
    checkBtn.addEventListener('click', () => checkLessonTasks(lesson));
  }

  const isTeacher = currentUser.role === 'teacher' && cls.teacherId === currentUser.id;
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
  document.getElementById('tasks-builder').innerHTML = '';
  (lesson.tasks || []).forEach(t => addTaskBlock(t));
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
const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
};

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
  const opts = { debug: 2, config: ICE_CONFIG };
  peer = id ? new Peer(id, opts) : new Peer(opts);

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

  peer.on('disconnected', () => { setStatus('Сигнал-сервер отключился, переподключаемся…'); try { peer.reconnect(); } catch(e) { console.warn(e); } });
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
    audio: true
  });
  const v = document.getElementById('local-video');
  if (v) v.srcObject = localStream;
  const pipL = document.getElementById('pip-local');
  if (pipL) pipL.srcObject = localStream;
  return localStream;
}

function setupCallHandlers(call) {
  call.on('stream', (remoteStream) => {
    const rv = document.getElementById('remote-video');
    if (rv) rv.srcObject = remoteStream;
    document.getElementById('remote-placeholder')?.classList.add('hidden');
    setStatus('Звонок активен ✓');
    const pipR = document.getElementById('pip-remote');
    if (pipR) pipR.srcObject = remoteStream;
    showPip();
  });
  call.on('close', () => endCallCleanup(false));
  call.on('error', (err) => {
    console.error(err);
    setStatus('Ошибка звонка');
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
  // sync streams
  const local = document.getElementById('local-video');
  const remote = document.getElementById('remote-video');
  const pipL = document.getElementById('pip-local');
  const pipR = document.getElementById('pip-remote');
  if (local?.srcObject && pipL) pipL.srcObject = local.srcObject;
  if (remote?.srcObject && pipR) pipR.srcObject = remote.srcObject;
  const st = document.getElementById('pip-status');
  if (st) st.textContent = 'Звонок активен';
}

function hidePip() {
  document.getElementById('pip-video')?.classList.add('hidden');
  const pipL = document.getElementById('pip-local');
  const pipR = document.getElementById('pip-remote');
  if (pipL) pipL.srcObject = null;
  if (pipR) pipR.srcObject = null;
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

  peer.on('open', async () => {
    console.log('Host ready:', peer.id);
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
  });
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
  if (mic) { mic.textContent = '🎤'; mic.classList.remove('muted-state'); }
  if (cam) { cam.textContent = '📷'; cam.classList.remove('muted-state'); }
}

function toggleMic() {
  if (!localStream) return;
  isMicOn = !isMicOn;
  localStream.getAudioTracks().forEach(t => (t.enabled = isMicOn));
  const btn = document.getElementById('toggle-mic');
  btn.textContent = isMicOn ? '🎤' : '🔇';
  btn.classList.toggle('muted-state', !isMicOn);
}
function toggleCam() {
  if (!localStream) return;
  isCamOn = !isCamOn;
  localStream.getVideoTracks().forEach(t => (t.enabled = isCamOn));
  const btn = document.getElementById('toggle-cam');
  btn.textContent = isCamOn ? '📷' : '🚫';
  btn.classList.toggle('muted-state', !isCamOn);
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
function saveBoard(){const c=classes.find(x=>x.id===currentClassId);if(!c)return;c.boardText=document.getElementById('class-board').value;c.boardAt=Date.now();saveClasses();alert('Доска сохранена и отправлена в облако.');}

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
  setTimeout(() => joinLiveClassroom(), 150);
}

async function joinLiveClassroom() {
  const code = (document.getElementById('live-room-code')?.value || '').trim();
  if (!code) { alert('Укажи код комнаты / класса'); return; }
  if (!currentUser) { alert('Для видеозвонка войди в Azena.'); return; }

  const cls = classes.find(c => String(c.code || '').toLowerCase() === code.toLowerCase());
  // Teacher of this class becomes host. Also treat role=teacher as host when no class match.
  const isTeacher = !!(cls && (cls.teacherId === currentUser.id || cls.teacher_id === currentUser.id))
    || (!cls && currentUser.role === 'teacher');

  // Clean previous call
  if (peer || currentCall || localStream) endCallCleanup(false);

  setStatus('Подключение…');
  const pipStatus = document.getElementById('pip-status');
  if (pipStatus) pipStatus.textContent = 'Подключение…';

  try {
    if (isTeacher) {
      // Teacher: create host room with fixed Peer ID from class code
      startHost(code);
    } else {
      // Student: join existing host (with retries)
      await joinAsStudent(code, pipStatus);
    }
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
      setStatus('Звоним учителю… (попытка ' + attempt + '/5)');
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
  alert('Не удалось подключиться к учителю.\n\n1) Учитель должен сначала нажать «Начать / войти»\n2) Код класса должен совпадать\n3) Оба должны разрешить камеру/микрофон\n\n' + (lastErr?.type || lastErr?.message || ''));
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

(function enablePipDrag() {
  let dragging = false, ox = 0, oy = 0;
  document.addEventListener('mousedown', (e) => {
    const el = document.getElementById('pip-video');
    if (!el || el.classList.contains('hidden')) return;
    if (!e.target.closest('.pip-header')) return;
    dragging = true;
    const r = el.getBoundingClientRect();
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const el = document.getElementById('pip-video');
    if (!el) return;
    el.style.left = Math.max(0, e.clientX - ox) + 'px';
    el.style.top = Math.max(0, e.clientY - oy) + 'px';
    el.style.right = 'auto';
  });
  document.addEventListener('mouseup', () => { dragging = false; });
  // touch
  document.addEventListener('touchstart', (e) => {
    const el = document.getElementById('pip-video');
    if (!el || el.classList.contains('hidden')) return;
    if (!e.target.closest('.pip-header')) return;
    const t = e.touches[0];
    dragging = true;
    const r = el.getBoundingClientRect();
    ox = t.clientX - r.left;
    oy = t.clientY - r.top;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const el = document.getElementById('pip-video');
    if (!el) return;
    const t = e.touches[0];
    el.style.left = Math.max(0, t.clientX - ox) + 'px';
    el.style.top = Math.max(0, t.clientY - oy) + 'px';
    el.style.right = 'auto';
  }, { passive: true });
  document.addEventListener('touchend', () => { dragging = false; });
})();


// ==================== INIT ====================
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
  document.getElementById('join-live-btn')?.addEventListener('click', joinLiveClassroom);
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
