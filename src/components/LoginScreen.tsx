import { FormEvent, useState } from "react";
import { useNavigate } from "react-router";
import spmLogo from "@/imports/SPM_Logo.png";

function FieldIcon({ type }: { type: "email" | "lock" | "eye" }) {
  if (type === "email") return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]"><rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="m5 7 5.75 4.6a2 2 0 0 0 2.5 0L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  if (type === "lock") return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px]"><rect x="4" y="10" width="16" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M8 10V7.5a4 4 0 1 1 8 0V10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-[19px] w-[19px]"><path d="M2.5 12s3.4-5.5 9.5-5.5S21.5 12 21.5 12s-3.4 5.5-9.5 5.5S2.5 12 2.5 12Z" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="2.4" stroke="currentColor" strokeWidth="1.7" /></svg>;
}

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setNotice("");
    setLoading(true);
    window.setTimeout(() => {
      setLoading(false);
      navigate("/", { replace: true });
    }, 700);
  };

  return (
    <main className="login-page flex min-h-screen items-center justify-center px-5 py-8 sm:px-8" aria-labelledby="login-title">
      <section className="login-frame grid w-full max-w-[860px] overflow-hidden bg-white md:grid-cols-[260px_1fr]" aria-labelledby="login-title">
        <aside className="login-brand relative hidden overflow-hidden bg-[#354557] p-8 text-white md:flex md:flex-col">
          <div className="login-brand-orbit login-brand-orbit-one" />
          <div className="login-brand-orbit login-brand-orbit-two" />
          <div className="relative self-start">
            <img src={spmLogo} alt="SPM Lab Solutions" className="h-14 w-auto" />
            <p className="mt-5 max-w-[175px] text-xs leading-5 text-[#b5c5d1]">A simpler way to keep your operations moving.</p>
          </div>
          <div className="relative mt-auto">
            <span className="block h-px w-9 bg-[#47bee7]" />
            <p className="mt-4 text-sm font-medium tracking-[.04em] text-[#e5f6fc]">SPM ERP</p>
          </div>
        </aside>
        <div className="flex min-h-[510px] items-center px-7 py-10 sm:px-12 md:min-h-[540px] md:px-14">
          <div className="w-full max-w-[375px]">
            <div className="mb-8 md:hidden">
              <img src={spmLogo} alt="SPM Lab Solutions" className="h-10 w-auto" />
              <p className="mt-3 text-xs font-medium tracking-[.08em] text-[#168ebc]">SPM ERP</p>
            </div>
          <div className="mb-8">
            <h1 id="login-title" className="text-[1.75rem] font-bold tracking-[-0.035em] text-[#2a3442]">Welcome back</h1>
            <p className="mt-2 text-sm leading-6 text-[#526274]">Please enter your details to continue.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-[#3d4a5c]">Email</span>
              <span className="login-field">
                <span className="pointer-events-none text-[#8b9aab]"><FieldIcon type="email" /></span>
                <input type="email" autoComplete="email" required placeholder="name@company.com" value={email} onChange={(event) => setEmail(event.target.value)} className="login-input" />
              </span>
            </label>

            <div className="block">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#3d4a5c]">Password</span>
                <button type="button" onClick={() => setNotice("Please contact your ERP administrator to reset your password.")} className="text-xs font-medium text-[#168ebc] hover:text-[#0e759d] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1aa8dc]">Forgot password?</button>
              </div>
              <span className="login-field">
                <span className="pointer-events-none text-[#8b9aab]"><FieldIcon type="lock" /></span>
                <input type={showPassword ? "text" : "password"} autoComplete="current-password" required placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} className="login-input" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)} className="text-[#8796a6] transition-colors hover:text-[#168ebc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1aa8dc]"><FieldIcon type="eye" /></button>
              </span>
            </div>

            <label className="flex cursor-pointer items-center gap-2.5 pt-0.5 text-sm text-[#526274]">
              <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} className="login-check" />
              <span aria-hidden="true" className="login-check-mark">✓</span>
              Remember me
            </label>

            <button type="submit" disabled={loading} className="login-submit mt-2">
              {loading ? "Signing in…" : "Sign in"}
            </button>
            {notice && <p role="status" className="border-l-2 border-[#1aa8dc] bg-[#f0faff] px-3.5 py-3 text-xs leading-5 text-[#4f6375]">{notice}</p>}
          </form>
          <p className="mt-7 text-center text-xs text-[#6b7b8d]">Need access? <a href="mailto:admin@spmlabsolutions.com" className="font-medium text-[#168ebc] hover:underline">Contact your admin</a></p>
          </div>
        </div>
      </section>
    </main>
  );
}
