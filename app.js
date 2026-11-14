(() => {
  'use strict';
  const LEVEL_STORAGE = {A2:'swz-hoeren-a2-v1',B1:'swz-hoeren-b1-v3',B2:'swz-aspekte-neu-b2-v1','B1+–B2':'swz-hoeren-umgangssprache-v1'};
  const LEVEL = Object.hasOwn(LEVEL_STORAGE,document.documentElement.dataset.level) ? document.documentElement.dataset.level : 'B2';
  const IS_UMG = LEVEL === 'B1+–B2';
  const FIRST_LESSON_NUMBER = 1;
  const EXPECTED_LESSON_COUNT = Number(document.documentElement.dataset.lessonCount);
  const STORAGE_KEY = LEVEL_STORAGE[LEVEL];
  const LEGACY_KEY = null;
  const TOPICS = Object.assign(Object.create(null), IS_UMG ? {arbeit:'Arbeit & Beruf',digital:'Digitaler Alltag',familie:'Familie',freizeit:'Freizeit',freunde:'Freundschaft',konsum:'Einkaufen & Service',plaene:'Pläne & Entscheidungen',stress:'Stress & Herausforderungen',unterwegs:'Unterwegs',wohnen:'Wohnen & Nachbarschaft'} : {});
  const REGISTERS = {umgangssprachlich:'umgangssprachlich',salopp:'sehr informell',gesprochen:'gesprochen'};
  const FORMATS = {story:'Geschichte',dialogue:'Gespräch',interview:'Interview',report:'Bericht',discussion:'Diskussion',message:IS_UMG ? 'Sprachnachricht' : 'Nachricht & Durchsage'};
  const QUESTION_GROUPS = {
    multiple_choice: {title: 'Multiple Choice', hint: 'Wähle die richtige Antwort.', count: 10},
    true_false: {title: 'Richtig oder falsch?', hint: 'Stimmt die Aussage mit dem Hörtext überein?' , count: 5},
    gap: {title: 'Ausdrücke ergänzen', hint: 'Ergänze das fehlende Wort oder Verb aus den Ausdrücken.', count: 10},
  };
  const PAGE_SIZE = 12;
  const filters = {query:'',topic:'',format:'',status:'',page:0};
  const $ = (id) => document.getElementById(id);
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const required = ['lesson-list', 'lesson-heading', 'lesson-description', 'lesson-counter', 'lesson-topic', 'lesson-duration', 'audio-player', 'audio-status', 'audio-rewind', 'audio-speed', 'lesson-download', 'lesson-pdf-download', 'question-list', 'check-answers', 'reset-answers', 'question-progress', 'result-box', 'transcript-toggle', 'transcript-panel', 'expressions-list', 'learning-panel', 'progress-text', 'progress-bar', 'continue-learning', 'lesson-error', 'toast'];
  if (required.some((id) => !$(id))) {
    console.error('SWZ Hören: required application elements are missing.');
    return;
  }
  const audio = $('audio-player');
  const state = { current: '', speed: 1, lessons: Object.create(null), legacyResults:Object.create(null) };
  let lessons = [];
  let current = null;
  let storageAvailable = true;
  let storageNoticeShown = false;
  let toastTimer;
  let audioRetry;
  let synchronizedTranscripts = null;
  let transcriptSync = null;
  let pendingTrackSeek = null;
  let audioObjectURL = null;
  let audioRequest = 0;

  function announce(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500);
  }
  function storageUnavailable() {
    storageAvailable = false;
    if (!storageNoticeShown) {
      storageNoticeShown = true;
      announce('Dein Browser kann den Fortschritt gerade nicht speichern. Du kannst weiterüben; nach dem Schließen ist der Stand möglicherweise nicht mehr verfügbar.');
    }
  }
  const formatTime = (value) => {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) return '—';
    const seconds = Math.round(Number(value));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };
  function worksheetFilename(lesson) {
    const everyday = lesson.id.match(/^umg-(\d{3})$/);
    if (everyday) return `Umgangssprache_B1plus_B2_Uebung_${everyday[1]}.pdf`;
    const chapter = lesson.id.match(/^aspekte-b2-k(\d{2})-(\d{2})$/);
    if (chapter) return `Aspekte_B2_Kapitel_${chapter[1]}_Hoeren_${chapter[2]}.pdf`;
    const exam = lesson.id.match(/^aspekte-b2-pruefung-(\d{2})$/);
    return exam ? `Aspekte_B2_Pruefung_Hoeren_${exam[1]}.pdf` : `${lesson.id}.pdf`;
  }
  function configureWorksheetLink(link, lesson) {
    link.href = `./assets/worksheets/${lesson.id}.pdf`;
    link.dataset.vaultFile = `./assets/worksheets/${lesson.id}.pdf`;
    link.download = worksheetFilename(lesson);
    link.type = 'application/pdf';
    link.target = '_blank';
    link.rel = 'noopener';
    link.dataset.pdfLesson = lesson.id;
    link.setAttribute('aria-label', `PDF herunterladen: ${lesson.title}`);
  }
  function downloadIcon() {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('class', 'pdf-download-icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    icon.append(path);
    return icon;
  }
  function freshRecord(lesson) {
    return { practiceVersion: lesson.practiceVersion, answers: lesson.questions.map(() => null), submitted: false, attempts: 0, best: 0, lastScore: 0, updated: 0 };
  }
  function record(lesson = current) {
    if (!state.lessons[lesson.id]) state.lessons[lesson.id] = freshRecord(lesson);
    return state.lessons[lesson.id];
  }
  function hasReviewed(lesson) {
    return record(lesson).attempts > 0 || !!state.legacyResults[lesson.id]?.attempts;
  }
  function canReadTranscript() {
    return !!current;
  }
  function save() {
    if (!storageAvailable) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (_) { storageUnavailable(); }
  }
  function restore() {
    let saved;
    let raw;
    let fromLegacy = false;
    try { raw = localStorage.getItem(STORAGE_KEY); if (!raw && LEGACY_KEY) { raw = localStorage.getItem(LEGACY_KEY); fromLegacy = !!raw; } }
    catch (_) { storageUnavailable(); }
    if (raw && raw.length < 75000) {
      try { saved = JSON.parse(raw); } catch (_) { /* Ignore a corrupted saved record. */ }
    }
    if (!saved || typeof saved !== 'object') return;
    if (lessons.some((lesson) => lesson.id === saved.current)) state.current = saved.current;
    if ([0.75, 1, 1.25].includes(saved.speed)) state.speed = saved.speed;
    for (const lesson of lessons) {
      const old = fromLegacy ? saved.lessons?.[lesson.id] : saved.legacyResults?.[lesson.id];
      const previousTotal = fromLegacy ? 5 : [5, 10].includes(old?.total) ? old.total : IS_UMG || LEVEL === 'A2' ? 10 : 5;
      if (old && Number.isInteger(old.best) && old.best >= 0 && old.best <= previousTotal && Number.isInteger(old.attempts) && old.attempts > 0) {
        state.legacyResults[lesson.id] = {best:old.best,attempts:Math.min(9999,old.attempts),total:previousTotal};
        if (Array.isArray(old.earlier)) state.legacyResults[lesson.id].earlier = old.earlier.filter(v => [5,10].includes(v.total) && Number.isInteger(v.best) && v.best >= 0 && v.best <= v.total && Number.isInteger(v.attempts) && v.attempts > 0).slice(0,2).map(v => ({best:v.best,attempts:Math.min(9999,v.attempts),total:v.total}));
      }
      if (fromLegacy) continue;
      const item = saved.lessons && Object.hasOwn(saved.lessons, lesson.id) ? saved.lessons[lesson.id] : null;
      if (!item || typeof item !== 'object') continue;
      const next = freshRecord(lesson);
      next.answers = lesson.questions.map((question, index) => {
        const answer = Array.isArray(item.answers) ? item.answers[index] : null;
        return Number.isInteger(answer) && answer >= 0 && answer < question.options.length ? answer : null;
      });
      if (lesson.practiceVersion === 2 && item.practiceVersion !== 2) {
        // The original ten questions keep their IDs and option order. Preserve
        // their answers and history without presenting a 10-point score as /25.
        next.answers = next.answers.map((answer, index) => index < 10 ? answer : null);
        if (Number.isInteger(item.best) && item.best >= 0 && item.best <= 10 && Number.isInteger(item.attempts) && item.attempts > 0) {
          const prior = state.legacyResults[lesson.id];
          state.legacyResults[lesson.id] = {best:item.best,attempts:Math.min(9999,item.attempts),total:10};
          if (prior && prior.total !== 10) state.legacyResults[lesson.id].earlier = [{best:prior.best,attempts:prior.attempts,total:prior.total}, ...(prior.earlier || [])].slice(0,2);
        }
        next.updated = Number.isFinite(item.updated) ? Math.max(0, Math.min(Date.now(), item.updated)) : 0;
        state.lessons[lesson.id] = next;
        continue;
      }
      next.attempts = Number.isInteger(item.attempts) ? Math.max(0, Math.min(9999, item.attempts)) : 0;
      next.best = Number.isInteger(item.best) ? Math.max(0, Math.min(lesson.questions.length, item.best)) : 0;
      next.submitted = item.submitted === true && next.answers.every((answer) => answer !== null) && next.attempts > 0;
      next.lastScore = next.submitted ? next.answers.reduce((sum, answer, index) => sum + (answer === lesson.questions[index].answer ? 1 : 0), 0) : 0;
      next.updated = Number.isFinite(item.updated) ? Math.max(0, Math.min(Date.now(), item.updated)) : 0;
      if (!next.attempts) next.best = 0;
      state.lessons[lesson.id] = next;
    }
  }
  function normalize(data) {
    const rows = Array.isArray(data) ? data : data && data.lessons;
    if (!Array.isArray(rows) || !rows.length || rows.length > 200 || (EXPECTED_LESSON_COUNT > 0 && rows.length !== EXPECTED_LESSON_COUNT)) throw new Error('Invalid available lesson count');
    const ids = new Set();
    return rows.map((row, index) => {
      if (!row || typeof row !== 'object' || row.level !== LEVEL || typeof row.id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(row.id) || ids.has(row.id)) throw new Error('Invalid lesson ID or level');
      if (row.number !== FIRST_LESSON_NUMBER + index) throw new Error('Invalid available lesson numbering');
      ids.add(row.id);
      if (typeof row.topic === 'string' && !Object.hasOwn(TOPICS, row.topic)) {
        const chapterNumber = row.topic.match(/\d+/)?.[0];
        TOPICS[row.topic] = row.topicLabel || (row.chapterTitle ? `${chapterNumber ? 'Kapitel ' + Number(chapterNumber) + ' · ' : ''}${row.chapterTitle}` : chapterNumber ? `Kapitel ${Number(chapterNumber)}` : row.topic);
      }
      if (typeof row.title !== 'string' || !Array.isArray(row.questions) || row.questions.length < 1 || row.questions.length > 30) throw new Error('Invalid lesson');
      const questions = row.questions.map((question) => {
        if (typeof question.question !== 'string' || !Array.isArray(question.options) || question.options.length < 2 || question.options.length > 5 || question.options.some((option) => typeof option !== 'string') || !Number.isInteger(question.answer) || question.answer < 0 || question.answer >= question.options.length || typeof question.explanation !== 'string') throw new Error('Invalid question');
        return question;
      });
      {
        if (row.practiceVersion !== 2 || questions.length !== 25 || new Set(questions.map(q => q.id)).size !== 25) throw new Error('Invalid practice questions');
        questions.forEach((question, questionIndex) => {
          const expectedType = questionIndex < 10 ? 'multiple_choice' : questionIndex < 15 ? 'true_false' : 'gap';
          const expectedId = row.id + '-q' + String(questionIndex + 1).padStart(2, '0');
          const allowedOriginalIds = [expectedId, row.id + '-q' + (questionIndex + 1)];
          const allowedStatementIds = [11,12,13,14,15].map(n => row.id + '-q' + n);
          if (question.type !== expectedType || (expectedType === 'true_false' ? !allowedStatementIds.includes(question.id) : expectedType === 'multiple_choice' ? !allowedOriginalIds.includes(question.id) : question.id !== expectedId)) throw new Error('Invalid question type or ID');
          if (question.type === 'true_false' && (question.options.length !== 2 || question.options[0] !== 'Richtig' || question.options[1] !== 'Falsch')) throw new Error('Invalid true/false choices');
          if (question.type === 'gap' && (question.options.length !== 4 || question.question.split('____').length !== 2 || typeof question.expression !== 'string')) throw new Error('Invalid expression gap');
        });
      }
      const paragraphs = Array.isArray(row.paragraphs) ? row.paragraphs.filter((part) => typeof part === 'string') : typeof row.script === 'string' ? row.script.split(/\n\s*\n/).filter(Boolean) : [];
      if (!paragraphs.length) throw new Error('Transcript missing');
      const expressions = Array.isArray(row.expressions) ? row.expressions.filter((item) => item && typeof item.de === 'string' && typeof item.ar === 'string') : [];
      if ((expressions.length !== 15 || new Set(expressions.map(item => item.de)).size !== 15 || expressions.some(item => !item.de.trim() || !item.ar.trim() || typeof item.example !== 'string' || !item.example.trim() || (IS_UMG && !Object.hasOwn(REGISTERS,item.register))))) throw new Error('Expression context missing');
      if (questions.some(question => question.type === 'gap' && !expressions.some(expression => expression.de === question.expression))) throw new Error('Unknown gap expression');
      const originalTracks = Array.isArray(row.originalTracks) ? row.originalTracks : [];
      let previousTrackEnd = 0;
      for (const track of originalTracks) {
        if (!track || typeof track.track !== 'string' || !track.track.trim() || (track.title !== undefined && typeof track.title !== 'string') ||
            !Number.isFinite(track.start) || !Number.isFinite(track.end) || track.start < 0 || track.start < previousTrackEnd - .02 ||
            track.end <= track.start || track.end > row.durationSeconds + .1) throw new Error('Invalid original track index');
        previousTrackEnd = track.end;
      }
      return { ...row, arabicTitle: row.arabicTitle || row.titleAr || 'Hörübung', description: row.description || row.descriptionAr || '', descriptionDe: row.descriptionDe || '', questions, paragraphs, expressions, originalTracks };
    });
  }
  const searchText = (value) => String(value).toLocaleLowerCase('de').normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f]/g,'').replace(/ß/g,'ss').replace(/[أإآ]/g,'ا').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-0x660)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-0x6F0));
  function filteredLessons() {
    const terms = searchText(filters.query).split(/\s+/).filter(Boolean);
    return lessons.filter(lesson => {
      const saved = record(lesson);
      const expressionTerms = lesson.expressions.flatMap(item => [item.de,item.ar]).join(' ');
      const text = searchText([lesson.track,...(lesson.originalTracks || []).map(item => `${item.track} ${item.title || ''}`),lesson.number,String(lesson.number).padStart(2,'0'),lesson.title,lesson.arabicTitle,lesson.description,lesson.descriptionDe,TOPICS[lesson.topic],expressionTerms].join(' '));
      return (!filters.topic || lesson.topic === filters.topic) && (!filters.format || lesson.format === filters.format) &&
        (!filters.status || (filters.status === 'done' ? hasReviewed(lesson) : !hasReviewed(lesson))) && terms.every(term => text.includes(term));
    });
  }
  function renderCards() {
    const fragment = document.createDocumentFragment();
    const matches = filteredLessons();
    const pages = Math.max(1,Math.ceil(matches.length / PAGE_SIZE));
    filters.page = Math.min(filters.page,pages-1);
    matches.slice(filters.page*PAGE_SIZE,(filters.page+1)*PAGE_SIZE).forEach((lesson) => {
      const saved = record(lesson);
      const card = el('article', `lesson-card${current && current.id === lesson.id ? ' is-active' : ''}${hasReviewed(lesson) ? ' is-complete' : ''}`);
      const top = el('div', 'lesson-card-top');
      top.append(el('span', 'lesson-number', lesson.track || String(lesson.number).padStart(2, '0')));
      const previous = state.legacyResults[lesson.id];
      top.append(el('span', 'lesson-status', saved.attempts ? `✓ Bestes Ergebnis ${saved.best}/${lesson.questions.length}` : previous ? `✓ Früheres Ergebnis ${previous.best}/${previous.total}` : saved.answers.some((answer) => answer !== null) ? 'Begonnen' : 'Neu'));
      const title = el('h3', 'lesson-card-title', lesson.title);
      title.lang = 'de'; title.dir = 'ltr';
      const meta = el('p', 'lesson-card-meta', `${formatTime(lesson.durationSeconds)} · ${lesson.questions.length} Fragen · ${FORMATS[lesson.format] || LEVEL}`);
      const button = el('button', 'lesson-card-action', saved.answers.some((answer) => answer !== null) || saved.attempts ? 'Weiterüben' : 'Übung öffnen');
      button.type = 'button';
      button.dataset.lesson = lesson.id;
      button.setAttribute('aria-label', `${button.textContent}: ${lesson.title}`);
      if (current && current.id === lesson.id) button.setAttribute('aria-current', 'true');
      const pdf = el('a', 'lesson-card-download');
      configureWorksheetLink(pdf, lesson);
      pdf.title = 'Transkript · Ausdrücke · Übungen als PDF';
      pdf.append(downloadIcon(), el('span', '', 'PDF'));
      const actions = el('div', 'lesson-card-actions');
      actions.append(button, pdf);
      card.append(top, title, el('p', 'lesson-card-topic', TOPICS[lesson.topic] || LEVEL), el('p', 'lesson-card-description', lesson.descriptionDe), meta, actions);
      fragment.append(card);
    });
    if (!matches.length) fragment.append(el('p','empty-results','Keine passende Übung. Versuche einen anderen Titel, Track oder Ausdruck.'));
    $('lesson-list').replaceChildren(fragment);
    if ($('filter-count')) $('filter-count').textContent = matches.length === lessons.length ? `${lessons.length} Hörübungen` : `${matches.length} passende Übungen`;
    if ($('page-status')) $('page-status').textContent = `Seite ${filters.page+1} von ${pages}`;
    if ($('page-previous')) $('page-previous').disabled = filters.page === 0;
    if ($('page-next')) $('page-next').disabled = filters.page >= pages-1;
    if ($('pagination')) $('pagination').hidden = matches.length <= PAGE_SIZE;
    renderProgress();
  }
  function renderProgress() {
    const completed = lessons.filter(hasReviewed).length;
    $('progress-bar').max = lessons.length;
    $('progress-bar').value = completed;
    $('progress-text').textContent = `${completed} von ${lessons.length} Übungen bearbeitet`;
    $('progress-bar').setAttribute('aria-label', `Dein Fortschritt: ${completed} von ${lessons.length}`);
    $('continue-learning').textContent = lessons.every(lesson => record(lesson).attempts > 0) ? 'Übungen wiederholen' : completed || lessons.some((lesson) => record(lesson).answers.some((answer) => answer !== null)) ? 'Weiterlernen' : 'Jetzt loshören';
    renderCourseProgress();
  }
  function renderCourseProgress() {
    document.querySelectorAll('[data-course-progress]').forEach(node => {
      const course = node.dataset.courseProgress;
      const total = course === 'B2' ? 38 : 50;
      let completed = 0;
      if (course === LEVEL) completed = lessons.filter(hasReviewed).length;
      else {
        try {
          const raw = localStorage.getItem(LEVEL_STORAGE[course]);
          const saved = raw && raw.length < 75000 ? JSON.parse(raw) : null;
          const ids = new Set([...Object.keys(saved?.lessons || {}), ...Object.keys(saved?.legacyResults || {})]);
          for (const id of ids) {
            const validId = course === 'B2' ? /^aspekte-b2-(?:k\d{2}-\d{2}|pruefung-\d{2})$/.test(id) : /^umg-0(?:[0-4]\d|50)$/.test(id) && id !== 'umg-000';
            if (validId && [saved?.lessons?.[id], saved?.legacyResults?.[id]].some(item => Number.isInteger(item?.attempts) && item.attempts > 0)) completed++;
          }
        } catch (_) { /* Section navigation remains available without stored progress. */ }
      }
      node.textContent = `${Math.min(completed, total)} von ${total} bearbeitet`;
    });
  }
  function renderQuestions() {
    const saved = record();
    const fragment = document.createDocumentFragment();
    current.questions.forEach((question, index) => {
      if (index === 0 || question.type !== current.questions[index - 1].type) {
        const group = QUESTION_GROUPS[question.type];
        const heading = el('header', 'practice-group-heading');
        heading.dataset.group = question.type;
        const title = el('h4', 'practice-group-title', group.title); title.dir = 'ltr'; title.lang = 'de';
        const count = el('span', 'practice-group-count', `${group.count} Fragen`); count.dir = 'ltr'; count.lang = 'de';
        const hint = el('p', 'practice-group-hint', group.hint); hint.dir = 'ltr'; hint.lang = 'de';
        heading.append(title, count, hint);
        fragment.append(heading);
      }
      const fieldset = el('fieldset', 'question-card');
      fieldset.dir = 'ltr'; fieldset.lang = 'de';
      fieldset.dataset.question = String(index);
      fieldset.dataset.questionType = question.type;
      const legend = el('legend', 'question-legend');
      const prompt = el('span', 'question-prompt');
      if (question.type === 'gap') {
        const [before, after] = question.question.split('____');
        const blank = el('span', 'question-blank', '____');
        blank.setAttribute('aria-label', 'Lücke');
        prompt.append(document.createTextNode(before), blank, document.createTextNode(after));
      } else prompt.textContent = question.question;
      legend.append(el('span', 'question-number', String(index + 1).padStart(2, '0')), prompt);
      fieldset.append(legend);
      question.options.forEach((option, optionIndex) => {
        const chosen = saved.answers[index] === optionIndex;
        const correct = saved.submitted && optionIndex === question.answer;
        const wrong = saved.submitted && chosen && !correct;
        const label = el('label', `answer-option${chosen ? ' is-selected' : ''}${correct ? ' is-correct' : ''}${wrong ? ' is-wrong' : ''}`);
        const input = el('input');
        input.type = 'radio'; input.name = `question-${index}`; input.value = String(optionIndex);
        input.checked = chosen; input.disabled = saved.submitted;
        input.dataset.question = String(index);
        label.append(input, el('span', 'option-letter', String.fromCharCode(65 + optionIndex)), el('span', 'option-text', option));
        if (correct || wrong) {
          const note = el('span', 'answer-note', correct ? '✓ Richtige Antwort' : '✕ Deine Antwort');
          note.lang = 'de'; note.dir = 'ltr'; label.append(note);
        }
        fieldset.append(label);
      });
      if (saved.submitted) {
        const explanation = el('p', 'question-explanation', question.explanation);
        fieldset.append(explanation);
      }
      fragment.append(fieldset);
    });
    $('question-list').replaceChildren(fragment);
    renderQuestionProgress();
    renderResult();
  }
  function renderQuestionProgress() {
    const saved = record();
    const answered = saved.answers.filter((answer) => answer !== null).length;
    $('question-progress').textContent = `${answered} / ${current.questions.length} beantwortet`;
    $('check-answers').disabled = saved.submitted || answered < current.questions.length;
    $('check-answers').textContent = saved.submitted ? 'Antworten geprüft' : 'Antworten prüfen';
    $('reset-answers').disabled = !answered;
    $('reset-answers').textContent = saved.submitted ? 'Noch einmal üben' : 'Antworten zurücksetzen';
    $('transcript-toggle').disabled = !canReadTranscript();
    if (!canReadTranscript()) $('transcript-toggle').textContent = 'Transkript öffnen';
    else $('transcript-toggle').textContent = $('transcript-panel').hidden ? 'Transkript öffnen' : 'Transkript schließen';
  }
  function renderResult() {
    const saved = record();
    const box = $('result-box');
    box.replaceChildren();
    box.hidden = !saved.submitted;
    if (!saved.submitted) return;
    const perfect = saved.lastScore === current.questions.length;
    box.dataset.success = perfect ? 'true' : 'false';
    box.append(
      el('h3', 'result-title', perfect ? `Sehr gut! ${saved.lastScore} von ${current.questions.length}` : `Dein Ergebnis: ${saved.lastScore} von ${current.questions.length}`),
      el('p', 'result-detail', perfect ? 'Du hast die Details gut verstanden. Wiederhole die Ausdrücke oder probiere die nächste Übung.' : 'Lies die Erklärungen und höre noch einmal zu. Das Transkript und die Ausdrücke helfen dir dabei.'),
      el('p', 'result-detail', `Bestes Ergebnis: ${saved.best}/${current.questions.length} · Versuche: ${saved.attempts}`)
    );
    {
      const breakdown = el('ul', 'result-breakdown'); breakdown.dir = 'ltr'; breakdown.lang = 'de';
      for (const [type, group] of Object.entries(QUESTION_GROUPS)) {
        const score = current.questions.reduce((sum, question, index) => sum + (question.type === type && saved.answers[index] === question.answer ? 1 : 0), 0);
        breakdown.append(el('li', '', `${group.title} ${score}/${group.count}`));
      }
      box.append(breakdown);
    }
  }
  function renderTranscript() {
    $('transcript-panel').hidden = false;
    $('transcript-toggle').setAttribute('aria-expanded', 'true');
    const fragment = document.createDocumentFragment();
    if (transcriptSync && synchronizedTranscripts?.has(current.id)) {
      transcriptSync.render(current, synchronizedTranscripts.get(current.id));
      transcriptSync.setOpen(true);
    } else {
      if (current.format === 'dialogue' && Array.isArray(current.turns)) {
        current.turns.forEach((turn,index) => {
          const p = el('p','transcript-turn speaker-'+(index%2)); p.lang='de';p.dir='ltr';
          p.append(el('strong','speaker-name',turn.speaker+': '),document.createTextNode(turn.text));fragment.append(p);
        });
      } else current.paragraphs.forEach((paragraph) => {
        const p = el('p', '', paragraph); p.lang = 'de'; p.dir = 'ltr'; fragment.append(p);
      });
      $('transcript-panel').replaceChildren(fragment);
    }
    const expressions = document.createDocumentFragment();
    current.expressions.forEach((expression) => {
      const item = el('div', 'expression-card');
      const german = el('p', 'expression-de', expression.de); german.lang = 'de'; german.dir = 'ltr';
      const arabic = el('p', 'expression-ar', expression.ar); arabic.lang = 'ar-EG'; arabic.dir = 'rtl';
      item.append(german, arabic);
      if (typeof expression.example === 'string' && expression.example) {
        const example=el('p','expression-example',expression.example);example.lang='de';example.dir='ltr';item.append(example);
      }
      expressions.append(item);
    });
    $('expressions-list').replaceChildren(expressions);
  }
  function setAudioStatus(text) { $('audio-status').textContent = text; }
  function refreshOriginalTrack() {
    if (!current || !$('original-track-list')) return;
    const time = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    $('original-track-list').querySelectorAll('button[data-track-index]').forEach(button => {
      const track = current.originalTracks[Number(button.dataset.trackIndex)];
      const active = !!track && time >= track.start && time < track.end;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
  }
  function renderOriginalTracks() {
    const section = $('original-tracks'), list = $('original-track-list');
    if (!section || !list) return;
    const tracks = current.originalTracks || [];
    section.hidden = !tracks.length;
    section.open = tracks.length > 1 && tracks.length <= 4;
    section.querySelector('summary').textContent = tracks.length === 1 ? 'Originalaufnahme im Lehrbuch' : `${tracks.length} Aufnahmen in dieser Übung`;
    const fragment = document.createDocumentFragment();
    tracks.forEach((track, index) => {
      const button = el('button', 'original-track');
      button.type = 'button'; button.dataset.trackIndex = String(index);
      button.setAttribute('aria-label', `Audio ${track.track}: ${track.title || 'Originalaufnahme'} abspielen`);
      button.append(el('span', 'original-track-number', track.track), el('span', 'original-track-title', track.title || 'Originalaufnahme'), el('span', 'original-track-time', track.start === 0 ? '0:00' : formatTime(track.start)));
      fragment.append(button);
    });
    list.replaceChildren(fragment);
    refreshOriginalTrack();
  }
  function clearAudioError() { if (audioRetry) audioRetry.hidden = true; }
  function showAudioError() {
    setAudioStatus('Die Aufnahme konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.');
    if (!audioRetry) {
      audioRetry = el('button', 'audio-retry', 'Audio erneut laden');
      audioRetry.type = 'button';
      audioRetry.addEventListener('click', () => {
        clearAudioError();
        setAudioStatus('Audio wird geladen …');
        if (!audio.getAttribute('src') && current) loadLessonAudio(current);
        else audio.load();
      });
      $('audio-status').insertAdjacentElement('afterend', audioRetry);
    }
    audioRetry.hidden = false;
  }
  function releaseAudio() {
    audioRequest++;
    audio.removeAttribute('src');
    if (audioObjectURL) { URL.revokeObjectURL(audioObjectURL); audioObjectURL = null; }
  }
  function loadLessonAudio(lesson) {
    releaseAudio();
    const request = audioRequest;
    setAudioStatus('Audio wird geladen …');
    const onProgress = (percent) => { if (request === audioRequest) setAudioStatus(`Audio wird geladen … ${percent} %`); };
    window.SWZVault.objectURL(lesson.audio, 'audio/mpeg', onProgress).then((url) => {
      const isBlob = url.startsWith('blob:');
      if (request !== audioRequest || current !== lesson) { if (isBlob) URL.revokeObjectURL(url); return; }
      if (isBlob) audioObjectURL = url;
      audio.src = url;
      audio.playbackRate = state.speed;
      setAudioStatus('Starte, wenn du bereit bist. Höre zuerst auf die Hauptidee, dann auf die Details.');
      audio.load();
    }).catch((error) => {
      if (request !== audioRequest) return;
      console.error('SWZ Hören could not load audio:', error);
      showAudioError();
    });
  }
  function selectLesson(id, { scroll = false, updateHash = true } = {}) {
    const lesson = lessons.find((item) => item.id === id) || lessons[0];
    const changed = !current || current.id !== lesson.id;
    if (changed) {
      audio.pause();
      pendingTrackSeek = null;
      current = lesson;
      state.current = lesson.id;
      $('lesson-heading').textContent = lesson.title;
      $('lesson-heading').lang = 'de'; $('lesson-heading').dir = 'ltr';
      $('lesson-description').textContent = lesson.descriptionDe;
      $('lesson-counter').textContent = lesson.track ? `Audio ${lesson.track}` : `Übung ${lesson.number}`;
      $('lesson-topic').textContent = TOPICS[lesson.topic] || LEVEL;
      if ($('lesson-voice')) {
        const voiceLabels = {'حوار بصوتين':'Dialog · 2 Stimmen','رواية':'Erzählung','صوت رجالي':'Männerstimme','صوت نسائي':'Frauenstimme'};
        $('lesson-voice').textContent = voiceLabels[lesson.voiceLabel] || lesson.voiceLabel || FORMATS[lesson.format] || '';
      }
      if ($('legacy-result')) {
        const old = state.legacyResults[lesson.id];
        $('legacy-result').hidden = !old;
        $('legacy-result').textContent = old ? `Dein früheres Ergebnis: ${old.best}/${old.total} · Die erweiterte Übung hat ${lesson.questions.length} Fragen.` : '';
      }
      $('lesson-duration').textContent = formatTime(lesson.durationSeconds);
      configureWorksheetLink($('lesson-pdf-download'), lesson);
      $('lesson-download').hidden = false;
      clearAudioError();
      if (typeof lesson.audio === 'string' && lesson.audio) {
        loadLessonAudio(lesson);
      } else {
        releaseAudio();
        setAudioStatus('Die Aufnahme ist gerade nicht verfügbar.');
      }
      $('audio-speed').value = String(state.speed);
      renderOriginalTracks();
      renderTranscript();
      renderQuestions();
      renderCards();
      save();
    }
    if (updateHash && location.hash !== `#lesson/${lesson.id}`) {
      try { history.replaceState(null, '', `#lesson/${lesson.id}`); } catch (_) { /* Hash is optional. */ }
    }
    if (scroll) {
      $('learning-panel').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      $('lesson-heading').setAttribute('tabindex', '-1');
      $('lesson-heading').focus({ preventScroll: true });
    }
  }
  function idFromHash() {
    const match = location.hash.match(/^#lesson\/([a-z0-9-]+)$/);
    return match && lessons.some((lesson) => lesson.id === match[1]) ? match[1] : null;
  }
  function grade() {
    if (!current) return;
    const saved = record();
    if (saved.submitted) return;
    if (saved.answers.some((answer) => answer === null)) { announce('Beantworte zuerst alle Fragen. Danach kannst du deine Antworten prüfen.'); return; }
    saved.lastScore = saved.answers.reduce((sum, answer, index) => sum + (answer === current.questions[index].answer ? 1 : 0), 0);
    saved.best = Math.max(saved.best, saved.lastScore);
    saved.attempts = Math.min(9999, saved.attempts + 1);
    saved.submitted = true;
    saved.updated = Date.now();
    save(); renderQuestions(); renderCards();
    $('result-box').setAttribute('tabindex', '-1');
    $('result-box').focus({ preventScroll: true });
    $('result-box').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  }
  $('lesson-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-lesson]');
    if (button) selectLesson(button.dataset.lesson, { scroll: true });
  });
  [['lesson-search','query','input'],['topic-filter','topic','change'],['format-filter','format','change'],['status-filter','status','change']].forEach(([id,key,eventName]) => {
    if ($(id)) $(id).addEventListener(eventName,()=>{filters[key]=$(id).value;filters.page=0;renderCards();});
  });
  [['page-previous',-1],['page-next',1]].forEach(([id,delta]) => {
    if ($(id)) $(id).addEventListener('click',()=>{filters.page+=delta;renderCards();$('library').scrollIntoView({behavior:'smooth',block:'start'});});
  });
  if ($('clear-filters')) $('clear-filters').addEventListener('click',()=>{
    filters.query='';filters.topic='';filters.format='';filters.status='';filters.page=0;
    ['lesson-search','topic-filter','format-filter','status-filter'].forEach(id=>{if($(id))$(id).value='';});renderCards();
  });
  $('continue-learning').addEventListener('click', () => {
    if (!lessons.length) return;
    const unfinished = lessons.filter((lesson) => !record(lesson).submitted);
    const mostRecent = unfinished.slice().sort((a, b) => record(b).updated - record(a).updated)[0];
    selectLesson(mostRecent ? mostRecent.id : state.current || lessons[0].id, { scroll: true });
  });
  $('question-list').addEventListener('change', (event) => {
    const target = event.target;
    if (!current || !target.matches('input[type=radio][data-question]') || record().submitted) return;
    const index = Number(target.dataset.question);
    const value = Number(target.value);
    if (!Number.isInteger(index) || !current.questions[index] || !Number.isInteger(value) || value < 0 || value >= current.questions[index].options.length) return;
    const saved = record(); saved.answers[index] = value; saved.updated = Date.now();
    target.closest('fieldset').querySelectorAll('.answer-option').forEach((label) => label.classList.toggle('is-selected', label.contains(target)));
    save(); renderQuestionProgress(); renderCards();
  });
  $('question-list').addEventListener('submit', (event) => { event.preventDefault(); grade(); });
  $('check-answers').addEventListener('click', (event) => { event.preventDefault(); grade(); });
  $('reset-answers').addEventListener('click', () => {
    if (!current) return;
    const saved = record(); saved.answers = current.questions.map(() => null); saved.submitted = false; saved.updated = Date.now();
    save(); renderQuestions(); renderCards();
    announce('Ein neuer Versuch. Dein bestes Ergebnis bleibt gespeichert.');
  });
  $('transcript-toggle').addEventListener('click', () => {
    if (!canReadTranscript()) return;
    $('transcript-panel').hidden = !$('transcript-panel').hidden;
    $('transcript-toggle').setAttribute('aria-expanded', String(!$('transcript-panel').hidden));
    transcriptSync?.setOpen(!$('transcript-panel').hidden);
    renderQuestionProgress();
  });
  $('audio-rewind').addEventListener('click', () => {
    if (audio.readyState > 0 && Number.isFinite(audio.currentTime)) {
      audio.currentTime = Math.max(0, audio.currentTime - 10);
      setAudioStatus('10 Sekunden zurück. Höre die Stelle noch einmal.');
    }
  });
  $('audio-speed').addEventListener('change', () => {
    const speed = Number($('audio-speed').value);
    if (![0.75, 1, 1.25].includes(speed)) return;
    state.speed = speed; audio.playbackRate = speed; save();
    setAudioStatus(speed === 1 ? 'Normale Geschwindigkeit.' : speed < 1 ? 'Langsamer – so kannst du die Wörter besser verstehen.' : 'Schnellere Wiedergabe.');
  });
  $('original-track-list')?.addEventListener('click', event => {
    const button = event.target.closest('button[data-track-index]');
    if (!button || !current) return;
    const track = current.originalTracks[Number(button.dataset.trackIndex)];
    if (!track) return;
    const lessonId = current.id;
    pendingTrackSeek = {lessonId, time: track.start};
    transcriptSync?.cancelRepeat();
    try { audio.currentTime = track.start; if (audio.readyState > 0) pendingTrackSeek = null; } catch (_) { /* Retry when metadata arrives. */ }
    refreshOriginalTrack();
    try {
      Promise.resolve(audio.play()).catch(() => { if (current?.id === lessonId) setAudioStatus('Drücke im Audioplayer auf Wiedergabe, um weiterzuhören.'); });
    } catch (_) { setAudioStatus('Drücke im Audioplayer auf Wiedergabe, um weiterzuhören.'); }
  });
  audio.addEventListener('timeupdate', refreshOriginalTrack);
  audio.addEventListener('seeking', refreshOriginalTrack);
  audio.addEventListener('loadedmetadata', () => {
    audio.playbackRate = state.speed;
    if (pendingTrackSeek?.lessonId === current?.id) {
      try { audio.currentTime = pendingTrackSeek.time; pendingTrackSeek = null; } catch (_) { /* A later metadata event may make seeking possible. */ }
    }
    if (current && Number.isFinite(audio.duration) && audio.duration > 0) {
      current.durationSeconds = audio.duration;
      $('lesson-duration').textContent = formatTime(audio.duration);
      renderCards();
    }
  });
  audio.addEventListener('play', () => { clearAudioError(); setAudioStatus('Höre in Ruhe zu. Du kannst das Transkript jederzeit öffnen.'); });
  audio.addEventListener('playing', () => { clearAudioError(); setAudioStatus('Die Aufnahme läuft. Achte auf die Bedeutung und die Details.'); });
  audio.addEventListener('waiting', () => { if (!audio.paused) setAudioStatus('Einen Moment … Audio wird geladen.'); });
  audio.addEventListener('pause', () => { if (!audio.ended && audio.currentTime > 0) setAudioStatus('Pausiert. Mach weiter, wenn du bereit bist.'); });
  audio.addEventListener('ended', () => setAudioStatus('Die Aufnahme ist zu Ende. Höre noch einmal oder beantworte die Fragen.'));
  audio.addEventListener('error', () => { if (current && current.audio) showAudioError(); });
  window.addEventListener('hashchange', () => { const id = idFromHash(); if (id) selectLesson(id, { scroll: true, updateHash: false }); });
  async function initialize() {
    try {
      if (!window.SWZVault) throw new Error('Vault script did not load');
      await window.SWZVault.ready;
      lessons = normalize(await window.SWZVault.json('./assets/lessons.json'));
      if (document.documentElement.dataset.transcriptSync === 'sentences-v1') {
        let transcriptTimeout;
        try {
          if (!window.SWZTranscriptSync) throw new Error('Transcript controls did not load');
          const timedData = await Promise.race([
            window.SWZVault.json('./assets/transcripts.json'),
            new Promise((_, reject) => { transcriptTimeout = setTimeout(() => reject(new Error('Transcript download timed out')), 15000); }),
          ]);
          synchronizedTranscripts = window.SWZTranscriptSync.validate(timedData, lessons);
          transcriptSync = window.SWZTranscriptSync.create({
            audio, panel: $('transcript-panel'),
            canRead: canReadTranscript,
            onPlaybackError: () => setAudioStatus('Drücke im Audioplayer auf Wiedergabe, um weiterzuhören.'),
          });
        } catch (error) {
          console.error('SWZ synchronized transcript unavailable:', error);
          const note = $('transcript-note');
          if (note) note.textContent = 'Das Transkript ist verfügbar. Die Satzansicht und Übersetzung konnten nicht geladen werden. Lade die Seite erneut, um es noch einmal zu versuchen.';
        } finally {
          clearTimeout(transcriptTimeout);
        }
      }
      if ($('topic-filter')) {
        Object.entries(TOPICS).filter(([id])=>lessons.some(l=>l.topic===id)).forEach(([id,label])=>{
          const option=el('option','',label);option.value=id;$('topic-filter').append(option);
        });
      }
      if ($('catalog-duration')) $('catalog-duration').textContent = Math.round(lessons.reduce((sum,l)=>sum+(Number(l.durationSeconds)||0),0)/60)+' Minuten Hörtraining';
      if ($('course-chapter-count')) $('course-chapter-count').textContent = String(new Set(lessons.filter(lesson => lesson.chapter > 0).map(lesson => lesson.chapter)).size);
      restore();
      $('lesson-error').hidden = true;
      selectLesson(idFromHash() || state.current || lessons[0].id);
      document.documentElement.dataset.appReady = 'true';
    } catch (error) {
      console.error('SWZ Hören could not load lessons:', error);
      $('lesson-error').hidden = false;
      $('lesson-error').textContent = 'Die Übungen konnten nicht geladen werden. Prüfe deine Verbindung und lade die Seite neu.';
      $('continue-learning').disabled = true;
      $('check-answers').disabled = true;
      setAudioStatus('Die Aufnahmen werden mit den Übungen geladen.');
    }
  }
  initialize();
})();
