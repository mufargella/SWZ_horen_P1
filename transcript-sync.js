/* Sentence playback controller for Aspekte neu B2. */
(() => {
  'use strict';
  const clean = text => text.replace(/\s+/g, ' ').trim();
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function validate(data, lessons) {
    if (data?.schemaVersion !== 1 || !['A2','B1','B2','B1+–B2'].includes(data.level) || lessons.some(lesson => lesson.level !== data.level) || data.translationLanguage !== 'ar-EG' ||
        !Array.isArray(data.lessons) || data.lessons.length !== lessons.length) throw new Error('Invalid synchronized transcript collection');
    const result = new Map();
    lessons.forEach((lesson, index) => {
      const entry = data.lessons[index];
      if (!entry || entry.id !== lesson.id || entry.audio !== lesson.audio ||
          !Number.isFinite(entry.durationSeconds) || entry.durationSeconds <= 0 ||
          Math.abs(entry.durationSeconds - lesson.durationSeconds) > .05 || !Array.isArray(entry.cues) ||
          !entry.cues.length || entry.cues.length > 200) throw new Error('Transcript/audio mismatch');
      const blocks = lesson.format === 'dialogue' ? lesson.turns.map(turn => turn.text) : lesson.paragraphs;
      const grouped = blocks.map(() => []);
      let previousEnd = 0, previousBlock = 0;
      entry.cues.forEach((cue, cueIndex) => {
        if (cue.id !== lesson.id + '-s' + String(cueIndex + 1).padStart(3, '0') ||
            typeof cue.de !== 'string' || !cue.de.trim() || typeof cue.ar !== 'string' || !cue.ar.trim() ||
            !Number.isInteger(cue.blockIndex) || cue.blockIndex < previousBlock || !grouped[cue.blockIndex] ||
            !Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.start < previousEnd - .002 ||
            cue.end <= cue.start || cue.end > entry.durationSeconds + .01 ||
            cue.speaker !== (lesson.format === 'dialogue' ? lesson.turns[cue.blockIndex].speaker : null)) {
          throw new Error('Invalid sentence timing or translation');
        }
        previousEnd = cue.end; previousBlock = cue.blockIndex;
        grouped[cue.blockIndex].push(cue.de);
      });
      if (grouped.some((sentences, block) => clean(sentences.join(' ')) !== clean(blocks[block]))) throw new Error('Transcript text changed');
      result.set(lesson.id, entry);
    });
    return result;
  }
  function create({audio, panel, canRead, onPlaybackError}) {
    let entry = null, cards = [], active = -1, frame = null, sentenceStop = null, requestedSeek = null;
    let arabicVisible = false, following = true;
    let list, translationButton, followButton, playButton, previousButton, nextButton, repeatButton, counter, progress;
    const interactive = () => !!entry && !panel.hidden && canRead();
    const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    function setFollowing(value) {
      following = value;
      if (!followButton) return;
      followButton.setAttribute('aria-pressed', String(value));
      followButton.textContent = value ? 'Mitlesen aktiv' : 'Satz automatisch folgen';
    }
    function scrollToActive(force = false) {
      if (!following || !interactive() || active < 0 || !list?.clientHeight) return;
      const outer = list.getBoundingClientRect(), inner = cards[active].getBoundingClientRect();
      if (!force && inner.top >= outer.top + 10 && inner.bottom <= outer.bottom - 10) return;
      const inset = inner.height < list.clientHeight ? (list.clientHeight - inner.height) / 2 : 8;
      list.scrollTo({top: Math.max(0, list.scrollTop + inner.top - outer.top - inset), behavior: force || reducedMotion() ? 'auto' : 'smooth'});
    }
    function refreshButtons() {
      if (!entry || !playButton) return;
      playButton.textContent = audio.paused || audio.ended ? 'Abspielen' : 'Pause';
      playButton.setAttribute('aria-label', audio.paused || audio.ended ? 'Aufnahme abspielen' : 'Pause');
      previousButton.disabled = active <= 0;
      nextButton.disabled = active >= entry.cues.length - 1;
    }
    function sync(force = false) {
      if (!entry) return;
      let time = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      if (sentenceStop !== null && time >= sentenceStop - .006 && !audio.paused) {
        const stoppedAt = Math.max(0, sentenceStop - .012);
        sentenceStop = null;
        requestedSeek = {lessonId: entry.id, time: stoppedAt};
        try { audio.currentTime = stoppedAt; } catch (_) { /* The pause still applies if seeking fails. */ }
        audio.pause();
        time = audio.currentTime;
      }
      if (!interactive()) return;
      let low = 0, high = entry.cues.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (entry.cues[middle].start <= time + .001) low = middle + 1;
        else high = middle;
      }
      const next = Math.max(0, low - 1);
      if (active !== next) {
        if (cards[active]) { cards[active].classList.remove('is-active'); cards[active].removeAttribute('aria-current'); }
        active = next;
        cards[active].classList.add('is-active'); cards[active].setAttribute('aria-current', 'true');
        counter.textContent = `Satz ${active + 1} / ${entry.cues.length}`;
        refreshButtons(); scrollToActive(force);
      } else if (force) scrollToActive(true);
      progress.value = Math.max(0, Math.min(entry.durationSeconds, time));
    }
    function stopFrame() {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
    }
    function tick() {
      frame = null; sync();
      if ((interactive() || sentenceStop !== null) && !audio.paused && !audio.ended) frame = window.requestAnimationFrame(tick);
    }
    function startFrame() {
      stopFrame(); sync();
      if ((interactive() || sentenceStop !== null) && !audio.paused && !audio.ended) frame = window.requestAnimationFrame(tick);
    }
    function play() {
      const lessonId = entry?.id;
      try {
        Promise.resolve(audio.play()).catch(() => {
          if (entry?.id === lessonId) { sentenceStop = null; refreshButtons(); onPlaybackError(); }
        });
      } catch (_) { sentenceStop = null; onPlaybackError(); }
    }
    function seekSentence(index, single = false) {
      if (!interactive() || !entry.cues[index]) return;
      const cue = entry.cues[index];
      sentenceStop = single ? cue.end : null;
      requestedSeek = {lessonId: entry.id, time: cue.start};
      setFollowing(true);
      try { audio.currentTime = cue.start; } catch (_) { /* Apply after metadata becomes available. */ }
      sync(true); play();
    }
    function toggleArabic() {
      if (!interactive()) return;
      arabicVisible = !arabicVisible;
      list.querySelectorAll('.sync-ar').forEach(node => { node.hidden = !arabicVisible; });
      translationButton.setAttribute('aria-pressed', String(arabicVisible));
      translationButton.textContent = arabicVisible ? 'Arabisch ausblenden' : 'Arabisch · بالمصري';
      scrollToActive(true);
    }
    function button(text, className, label) {
      const node = make('button', className, text); node.type = 'button';
      if (label) node.setAttribute('aria-label', label);
      return node;
    }
    function render(lesson, transcript) {
      stopFrame(); sentenceStop = null; requestedSeek = null;
      entry = transcript; cards = []; active = -1; following = true;
      panel.dataset.synced = 'true'; panel.replaceChildren();
      const options = make('div', 'sync-options'); options.dir = 'ltr'; options.lang = 'de';
      translationButton = button(arabicVisible ? 'Arabisch ausblenden' : 'Arabisch · بالمصري', 'sync-option');
      translationButton.id = 'transcript-arabic-toggle'; translationButton.setAttribute('aria-pressed', String(arabicVisible));
      translationButton.setAttribute('aria-controls', 'transcript-sentences');
      translationButton.addEventListener('click', toggleArabic);
      followButton = button('', 'sync-option'); followButton.id = 'transcript-follow';
      followButton.addEventListener('click', () => { if (interactive()) { setFollowing(!following); scrollToActive(true); } });
      setFollowing(true); options.append(translationButton, followButton);
      const hint = make('p', 'sync-hint', 'Tippe auf einen Satz, um dort zu starten. Mit „Satz wiederholen“ hörst du nur diesen Satz.');
      hint.dir = 'ltr'; hint.lang = 'de';
      list = make('div', 'sync-cues'); list.id = 'transcript-sentences'; list.tabIndex = 0;
      list.setAttribute('aria-label', 'Sätze der Aufnahme');
      let block = -1, group;
      entry.cues.forEach((cue, index) => {
        if (block !== cue.blockIndex) {
          block = cue.blockIndex;
          group = make('section', 'sync-group' + (lesson.format === 'dialogue' ? ' transcript-turn speaker-' + (block % 2) : ''));
          if (cue.speaker) {
            const name = make('h4', 'speaker-name', cue.speaker); name.lang = 'de'; name.dir = 'ltr'; group.append(name);
          }
          list.append(group);
        }
        const card = button('', 'sync-sentence');
        card.title = `Ab Satz ${index + 1} abspielen`;
        card.dataset.cue = String(index); card.id = cue.id;
        const de = make('span', 'sync-de', cue.de); de.lang = 'de'; de.dir = 'ltr';
        const ar = make('span', 'sync-ar', cue.ar); ar.lang = 'ar-EG'; ar.dir = 'rtl'; ar.hidden = !arabicVisible;
        card.append(de, ar); group.append(card); cards.push(card);
      });
      list.addEventListener('click', event => {
        const card = event.target.closest('button[data-cue]');
        if (card && list.contains(card)) seekSentence(Number(card.dataset.cue));
      });
      list.addEventListener('wheel', () => setFollowing(false), {passive: true});
      list.addEventListener('touchmove', () => setFollowing(false), {passive: true});
      list.addEventListener('keydown', event => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) setFollowing(false); });
      const footer = make('div', 'sync-footer'); footer.dir = 'ltr'; footer.lang = 'de';
      const position = make('div', 'sync-position');
      counter = make('span', 'sync-counter', `Satz 1 / ${entry.cues.length}`); counter.id = 'transcript-position';
      progress = make('progress', 'sync-progress'); progress.max = entry.durationSeconds; progress.value = 0;
      progress.setAttribute('aria-label', 'Position in der Aufnahme'); position.append(counter, progress);
      const controls = make('div', 'sync-controls');
      previousButton = button('Zurück', 'sync-control', 'Vorheriger Satz'); previousButton.id = 'transcript-previous';
      playButton = button('Abspielen', 'sync-control sync-play'); playButton.id = 'transcript-play';
      nextButton = button('Weiter', 'sync-control', 'Nächster Satz'); nextButton.id = 'transcript-next';
      repeatButton = button('Satz wiederholen', 'sync-control', 'Nur den aktuellen Satz abspielen'); repeatButton.id = 'transcript-repeat';
      previousButton.addEventListener('click', () => seekSentence(active - 1));
      nextButton.addEventListener('click', () => seekSentence(active + 1));
      repeatButton.addEventListener('click', () => seekSentence(Math.max(0, active), true));
      playButton.addEventListener('click', () => {
        if (!interactive()) return;
        if (!audio.paused && !audio.ended) audio.pause();
        else if (audio.ended) seekSentence(0);
        else play();
      });
      controls.append(previousButton, playButton, nextButton, repeatButton);
      footer.append(position, controls); panel.append(options, hint, list, footer); refreshButtons();
    }
    function setOpen(open) {
      if (open && interactive()) { sync(true); startFrame(); refreshButtons(); }
      else { stopFrame(); if (sentenceStop !== null) startFrame(); }
    }
    audio.addEventListener('timeupdate', () => sync());
    audio.addEventListener('play', () => { refreshButtons(); startFrame(); });
    audio.addEventListener('playing', startFrame);
    audio.addEventListener('pause', () => { stopFrame(); sync(); refreshButtons(); });
    audio.addEventListener('ended', () => { sentenceStop = null; stopFrame(); sync(); refreshButtons(); });
    audio.addEventListener('ratechange', () => sync());
    audio.addEventListener('seeking', () => {
      if (!requestedSeek || requestedSeek.lessonId !== entry?.id || Math.abs(audio.currentTime - requestedSeek.time) > .2) sentenceStop = null;
      sync();
    });
    audio.addEventListener('seeked', () => { requestedSeek = null; sync(); });
    audio.addEventListener('loadedmetadata', () => {
      if (requestedSeek?.lessonId === entry?.id) {
        try { audio.currentTime = requestedSeek.time; } catch (_) { requestedSeek = null; sentenceStop = null; }
      }
      sync();
    });
    audio.addEventListener('error', () => { sentenceStop = null; stopFrame(); refreshButtons(); });
    return {render, setOpen, cancelRepeat() { sentenceStop = null; requestedSeek = null; }};
  }
  window.SWZTranscriptSync = Object.freeze({validate, create});
})();
