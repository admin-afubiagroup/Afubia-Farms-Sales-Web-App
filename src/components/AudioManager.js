// One browser voice for every page; no audio recordings or external TTS service.
const guidance = {
  dashboard: 'Welcome! Wetin you wan do today? Tap Turn Oil to record oil wey you package, or tap Record today market to record wetin customer buy.',
  turn_oil: 'Abeg enter how many keg you turn. Enter the seventy five c l bottles, one litre bottles, and five litre jerrycans wey you fill. Check am well before you save.',
  sellpage: 'Choose wetin customer buy. Enter how many, check the price and stock, then tap save sale.',
  ChooseItemFirst: 'Abeg choose the product first.',
  conversion_error: 'This record never save. Abeg check the message for screen, correct am, then try again.',
  selly: 'Sale don save. You sell', for: 'for', turn: 'You turn', kegs: 'keg of oil into',
  '75clbottle2': 'seventy five c l bottles', '1Lbottle2': 'one litre bottles', '5ljerrycan2': 'five litre jerrycans',
  welcome_audio: 'Welcome to Afubia Farms. Abeg sign in to continue.'
};
let pending = null;
let voice = null;
export function stopAllAudio() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  if (pending) { pending(); pending = null; }
}
export function speakAudio(text) {
  stopAllAudio();
  return new Promise(resolve => {
    if (!('speechSynthesis' in window) || localStorage.getItem('afubiaVoiceMuted') === 'yes') { resolve(); return; }
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    voice = voices.find(v => v.voiceURI === voice?.voiceURI) || voices.find(v => /en-NG/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
    const utterance = new SpeechSynthesisUtterance(String(text).replace(/\band\b/g, 'and'));
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'en-NG';
    utterance.rate = .9; utterance.pitch = 1; utterance.volume = 1;
    let timer;
    const finish = () => { clearTimeout(timer); if (pending === finish) pending = null; resolve(); };
    pending = finish;
    utterance.onend = finish; utterance.onerror = finish;
    // Never leave saving or navigation waiting on a broken speech engine.
    timer = setTimeout(finish, Math.max(4000, Math.min(String(text).length * 100, 20000)));
    synth.speak(utterance);
  });
}
export function playAudio(key) {
  const name = String(key).split('/').pop().replace(/\.m4a$/i, '');
  return speakAudio(guidance[name] || name.replace(/[_-]/g, ' '));
}
export function playOnPageOpen(key) {
  // Speech starts on a real user gesture, never fights browser autoplay rules.
  let cancelled = false;
  const start = () => { if (!cancelled) { cleanupListeners(); void playAudio(key); } };
  const cleanupListeners = () => { document.removeEventListener('pointerdown', start); document.removeEventListener('keydown', start); };
  document.addEventListener('pointerdown', start);
  document.addEventListener('keydown', start);
  return () => { cancelled = true; cleanupListeners(); stopAllAudio(); };
}
