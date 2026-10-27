import { useState } from "react";
import { auth } from "../Firebase/firebase.utils";
import { sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth";

const AuthTest = () => {
  const [email, setEmail] = useState("");

  const sendLink = async () => {
    const actionCodeSettings = {
      url: "http://localhost:5173/dashboard", // stays inside your app
      handleCodeInApp: true,
    };
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem("emailForSignIn", email);
    alert("Check your email for the login link!");
  };

  const completeSignIn = async () => {
    
    if (isSignInWithEmailLink(auth, window.location.href)) {
      let storedEmail = window.localStorage.getItem("emailForSignIn");
      if (!storedEmail) {
        storedEmail = window.prompt("Enter your email again:");
      }
      await signInWithEmailLink(auth, storedEmail, window.location.href);
      alert("Login successful!");
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-xl font-bold">Auth Test</h2>
      <input
        type="email"
        placeholder="Enter Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="border p-2 m-2"
      />
      <button onClick={sendLink} className="bg-blue-500 text-white p-2 m-2">
        Send Login Link
      </button>
      <button onClick={completeSignIn} className="bg-green-500 text-white p-2 m-2">
        Complete Sign In
      </button>
    </div>
  );
};

export default AuthTest;
