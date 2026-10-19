export const speak = (text) => {
  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);

  // ✅ Try to pick a Nigerian English voice if available
  const voices = synth.getVoices();
  const naijaVoice = voices.find(
    (v) =>
      v.lang.toLowerCase().includes("en-ng") || // English (Nigeria)
      v.name.toLowerCase().includes("nigeria")  // Voice name mentions Nigeria
  );

  if (naijaVoice) {
    utterance.voice = naijaVoice;
  } else {
    // fallback to any English voice
    utterance.lang = "en-NG"; // Nigerian English locale
  }

  synth.speak(utterance);
};
