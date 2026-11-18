// Solara City — story and dialog. Raka is a newcomer from the islands
// trying to make it in Solara City; Bang Dar is the fixer who hands out
// the jobs. All characters and lines are original. The dialog box shows
// one line at a time, auto-advances, and E skips to the next line.

export const DIALOGS = {
  m1_meet: [
    { who: 'BANG DAR', text: 'Raka, ya? Baru datang dari pulau, katanya mau jadi orang besar di Solara.' },
    { who: 'RAKA', text: 'Bang Dar. Saya dengar abang yang pegang kerjaan di kota ini.' },
    { who: 'BANG DAR', text: 'Betul. Antar saya ke dermaga timur — jalan 90, tikungan -90. Nanti kita bicara soal kerjaan beneran.' },
  ],
  m1_done: [
    { who: 'BANG DAR', text: 'Bagus, kamu bisa nyetir. Besok ada paket — saya kabari.' },
    { who: 'RAKA', text: 'Siap, Bang.' },
  ],
  m2_pickup: [
    { who: 'BANG DAR', text: 'Paketnya di sudut -90/-90. Antar ke ujung timur, 144/90. Hati-hati, polisi lagi panas.' },
    { who: 'RAKA', text: 'Berapa upahnya?' },
    { who: 'BANG DAR', text: '250. Jangan sampai ketangkap.' },
  ],
  m2_done: [
    { who: 'BANG DAR', text: 'Paket sampai. 250 buat kamu — kerja bagus, Raka.' },
    { who: 'RAKA', text: 'Ada kerjaan lain, Bang?' },
  ],
  m3_start: [
    { who: 'BANG DAR', text: 'Raka, polisi sudah pasang tiga bintang buat kamu. Hilang dulu dari radar mereka, baru ke taman tengah.' },
    { who: 'RAKA', text: 'Saya kabur dulu, Bang.' },
  ],
  m3_lost: [
    { who: 'RAKA', text: 'Polisi sudah pergi. Sekarang ke taman tengah, cepat.' },
  ],
  m3_done: [
    { who: 'BANG DAR', text: 'Kamu lolos. Mulai sekarang, kamu orang saya di Solara City.' },
    { who: 'RAKA', text: 'Baru permulaan, Bang.' },
  ],
};

const LINE_SECONDS = 3.6;

// A dialog queue over three DOM elements (box, speaker, text). show()
// takes the lines and a callback for when the last line is dismissed.
export function createDialog(boxEl, speakerEl, textEl) {
  const state = {
    lines: [],
    index: 0,
    timer: 0,
    onDone: null,

    get isOpen() {
      return state.lines.length > 0;
    },

    show(lines, onDone) {
      state.lines = lines.slice();
      state.index = 0;
      state.timer = LINE_SECONDS;
      state.onDone = onDone || null;
      speakerEl.textContent = state.lines[0].who;
      textEl.textContent = state.lines[0].text;
      boxEl.style.display = 'block';
    },

    advance() {
      if (!state.isOpen) return;
      state.index++;
      if (state.index >= state.lines.length) {
        state.close();
        return;
      }
      state.timer = LINE_SECONDS;
      speakerEl.textContent = state.lines[state.index].who;
      textEl.textContent = state.lines[state.index].text;
    },

    close() {
      state.lines = [];
      state.index = 0;
      state.timer = 0;
      boxEl.style.display = 'none';
      const done = state.onDone;
      state.onDone = null;
      if (done) done();
    },

    update(dt) {
      if (!state.isOpen) return;
      state.timer -= dt;
      if (state.timer <= 0) state.advance();
    },
  };
  return state;
}
