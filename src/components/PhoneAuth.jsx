import { useState, useEffect } from "react";
import { auth } from "../Firebase/firebase.utils"; // make sure path is lowercase
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { speak } from "./VoiceAssistant";

const PhoneAuth = () => {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [confirmationResult, setConfirmationResult] = useState(null);

  // ✅ Initialize reCAPTCHA once when component loads
  useEffect(() => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "invisible",
      });
    }
  }, []);

  const sendOtp = async () => {
    speak("Put your phone number, we go send you code.");

    // ✅ Format Nigerian numbers automatically
    let formattedPhone = phone;
    if (/^0\d{10}$/.test(phone)) {
      formattedPhone = "+234" + phone.slice(1); // remove leading 0, add +234
    }

    try {
      const result = await signInWithPhoneNumber(auth, formattedPhone, window.recaptchaVerifier);
      setConfirmationResult(result);
      speak("We don send 6 digit code go your phone.");
    } catch (error) {
      speak("The number no correct, abeg try again.");
      console.error(error);
    }
  };

  const verifyOtp = async () => {
    try {
      await confirmationResult.confirm(otp);
      speak("Correct! You don enter app.");
      // 👉 Optional: redirect to menu/dashboard
      // navigate("/menu");
    } catch {
      speak("The code no correct, try again.");
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">Login With Phone</h2>
      <input
        type="text"
        placeholder="08123456789"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="border p-2 m-2"
      />
      <button onClick={sendOtp} className="bg-blue-500 text-white p-2 m-2">
        Send Code
      </button>

      <input
        type="text"
        placeholder="Enter 6 digit code"
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
        className="border p-2 m-2"
      />
      <button onClick={verifyOtp} className="bg-green-500 text-white p-2 m-2">
        Verify Code
      </button>

      <div id="recaptcha-container"></div>
    </div>
  );
};

export default PhoneAuth;
