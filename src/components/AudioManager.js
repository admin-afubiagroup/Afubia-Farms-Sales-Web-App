
// =========================================
// GLOBAL AUDIO MANAGER
// =========================================

let currentAudio = null;


// =========================================
// STOP ALL AUDIO
// =========================================

export const stopAllAudio = () => {

  // Stop currently managed audio
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;

    currentAudio.onended = null;
    currentAudio.onerror = null;

    currentAudio = null;
  }

  // Stop any other HTML audio elements
  document.querySelectorAll("audio").forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });

  // Stop text-to-speech
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
};


// =========================================
// PLAY AUDIO AND WAIT UNTIL FINISHED
// =========================================

export const playAudio = (src) => {

  return new Promise((resolve, reject) => {

    // Stop anything currently playing
    stopCurrentAudio();

    const audio = new Audio(src);

    currentAudio = audio;

    audio.onended = () => {

      if (currentAudio === audio) {
        currentAudio = null;
      }

      resolve();
    };

    audio.onerror = () => {

      if (currentAudio === audio) {
        currentAudio = null;
      }

      reject(
        new Error(`Could not play audio: ${src}`)
      );
    };

    audio.play().catch((error) => {

      if (currentAudio === audio) {
        currentAudio = null;
      }

      reject(error);
    });

  });
};


// =========================================
// STOP ONLY CURRENT HTML AUDIO
// =========================================

const stopCurrentAudio = () => {

  if (currentAudio) {

    currentAudio.pause();
    currentAudio.currentTime = 0;

    currentAudio.onended = null;
    currentAudio.onerror = null;

    currentAudio = null;
  }
};


// =========================================
// TEXT TO SPEECH
// =========================================

export const speakAudio = (text) => {

  return new Promise((resolve) => {

    if (!("speechSynthesis" in window)) {
      resolve();
      return;
    }

    // Stop any previous speech
    window.speechSynthesis.cancel();

    const utterance =
      new SpeechSynthesisUtterance(text);

    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onend = () => {
      resolve();
    };

    utterance.onerror = () => {
      resolve();
    };

    window.speechSynthesis.speak(utterance);

  });
};


// =========================================
// PLAY AUDIO WHEN PAGE OPENS
// =========================================
//
// Browser autoplay policies may block this.
// If blocked, the first interaction will
// start the audio.
//

export const playOnPageOpen = (src) => {

  let cancelled = false;
  let audio = null;

  const startAudio = async () => {

    if (cancelled) {
      return;
    }

    try {

      stopAllAudio();

      audio = new Audio(src);

      currentAudio = audio;

      await audio.play();

      document.removeEventListener(
        "pointerdown",
        handleInteraction
      );

      document.removeEventListener(
        "keydown",
        handleInteraction
      );

    } catch {

      // Browser blocked autoplay.
      // The first interaction will try again.

    }

  };


  const handleInteraction = () => {
    startAudio();
  };


  document.addEventListener(
    "pointerdown",
    handleInteraction,
    { once: true }
  );

  document.addEventListener(
    "keydown",
    handleInteraction,
    { once: true }
  );


  // Try immediately
  startAudio();


  // Cleanup function
  return () => {

    cancelled = true;

    document.removeEventListener(
      "pointerdown",
      handleInteraction
    );

    document.removeEventListener(
      "keydown",
      handleInteraction
    );

    if (audio) {

      audio.pause();
      audio.currentTime = 0;
    }

    stopAllAudio();
  };
};
