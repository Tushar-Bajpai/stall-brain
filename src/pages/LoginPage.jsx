import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
} from "firebase/auth";
import { auth } from "../utils/firebase";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const getPostAuthRoute = (user) => {
    if (!user) return "/login";
    const { creationTime, lastSignInTime } = user.metadata ?? {};
    const isFirstLogin =
      Boolean(creationTime && lastSignInTime) && creationTime === lastSignInTime;
    return isFirstLogin ? "/profile" : "/forecast";
  };

  useEffect(() => {
    let active = true;
    getRedirectResult(auth)
      .then((result) => {
        if (!active) return;
        if (result?.user) {
          navigate(getPostAuthRoute(result.user));
        }
      })
      .catch((authError) => {
        if (!active) return;
        setError(authError.message || "Google sign-in failed.");
      })
      .finally(() => {
        if (!active) return;
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      navigate(getPostAuthRoute(credential.user));
    } catch (authError) {
      setError(authError.message || "Unable to sign in.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      navigate(getPostAuthRoute(credential.user));
    } catch (authError) {
      const shouldRedirect =
        authError?.code === "auth/popup-blocked" ||
        authError?.code === "auth/operation-not-supported-in-this-environment" ||
        authError?.message?.includes("Pending promise");

      if (shouldRedirect) {
        try {
          await signInWithRedirect(auth, new GoogleAuthProvider());
          return;
        } catch (redirectError) {
          setError(redirectError.message || "Google sign-in failed.");
        }
      } else {
        setError(authError.message || "Google sign-in failed.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white">
      <div className="relative flex min-h-screen items-center justify-center px-6 py-16">
        <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="pointer-events-none absolute -top-32 left-1/2 h-[28rem] w-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,rgba(251,191,36,0.2),transparent_70%)] blur-3xl" />

        <div className="relative z-10 w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <div className="mb-8 space-y-3 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-300/40 bg-amber-300/10 text-xs font-semibold text-amber-200">
              BB
            </div>
            <h1 className="text-2xl font-semibold">Welcome back</h1>
            <p className="text-sm text-white/60">Sign in to keep forecasting at full signal.</p>
          </div>

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-white/50" htmlFor="email">
                Email
              </label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50 focus:ring-2 focus:ring-amber-300/20"
                id="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                type="email"
                value={email}
                required
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs uppercase tracking-[0.2em] text-white/50" htmlFor="password">
                Password
              </label>
              <input
                className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-300/50 focus:ring-2 focus:ring-amber-300/20"
                id="password"
                name="password"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter your password"
                type="password"
                value={password}
                required
              />
            </div>

            {error ? <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-200">{error}</p> : null}

            <button
              className="w-full rounded-full bg-amber-300 px-4 py-3 text-sm font-semibold text-black transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_12px_24px_rgba(251,191,36,0.35)] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={isLoading}
              type="submit"
            >
              {isLoading ? "Signing in..." : "Login"}
            </button>
          </form>

          <div className="my-6 flex items-center gap-3 text-xs text-white/40">
            <span className="h-px flex-1 bg-white/10" />
            or continue with
            <span className="h-px flex-1 bg-white/10" />
          </div>

          <button
            className="flex w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80 transition duration-300 hover:border-white/30 hover:text-white"
            onClick={handleGoogleLogin}
            type="button"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[0.6rem] font-bold text-black">G</span>
            Continue with Google
          </button>

          <p className="mt-6 text-center text-sm text-white/60">
            New here?{" "}
            <Link className="text-amber-200 transition hover:text-amber-100" to="/signup">
              Create an account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
