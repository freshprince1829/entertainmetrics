import { useId, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Notice } from "../components/ui";

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="auth-page">
      <Link to="/" className="auth-brand" aria-label="EntertainMetrics home">
        <span className="brand-mark auth-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0B0D10" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 18v-6a9 9 0 0118 0v6" />
            <path d="M21 19a2 2 0 01-2 2h-1v-6h3z" />
            <path d="M3 19a2 2 0 002 2h1v-6H3z" />
          </svg>
        </span>
        EntertainMetrics
      </Link>
      <main className="auth-card">
        <h1>{title}</h1>
        {subtitle && <p className="auth-subtitle">{subtitle}</p>}
        {children}
      </main>
      {footer && <p className="auth-footer">{footer}</p>}
    </div>
  );
}

function PasswordInput({ id, value, onChange, autoComplete, label = "Password" }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-controls={id}
        >
          {visible ? "Hide" : "Show"}
          <span className="visually-hidden"> password</span>
        </button>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { session, loading, signIn, configError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const ids = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const info = location.state?.message;
  const from = location.state?.from;
  const destination = from?.pathname ? `${from.pathname}${from.search ?? ""}` : "/dashboard";

  if (!loading && session) return <Navigate to={destination} replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const { error: message } = await signIn(email, password);
    if (message) {
      setError(message);
      setSubmitting(false);
      return;
    }
    navigate(destination, { replace: true });
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Use the account your administrator created for you."
      footer="Access is by invitation. Contact your administrator."
    >
      {configError && <Notice tone="error">{configError}</Notice>}
      {info && !error && <Notice tone="info">{info}</Notice>}
      <form onSubmit={handleSubmit} noValidate={false}>
        <div className="auth-field">
          <label htmlFor={`${ids}-email`}>Email</label>
          <input
            id={`${ids}-email`}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>
        <PasswordInput
          id={`${ids}-password`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        <div className="auth-row">
          <Link to="/forgot-password" state={{ email }}>
            Forgot password?
          </Link>
        </div>
        <div aria-live="polite">{error && <Notice tone="error">{error}</Notice>}</div>
        <button type="submit" className="primary-button auth-submit" disabled={submitting || Boolean(configError)}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { resetPassword, configError } = useAuth();
  const location = useLocation();
  const ids = useId();
  const [email, setEmail] = useState(location.state?.email ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const { error: message } = await resetPassword(email);
    setSubmitting(false);
    if (message) setError(message);
    else setSent(true);
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we'll send you a link to choose a new password."
      footer={<Link to="/login">Back to sign in</Link>}
    >
      {configError && <Notice tone="error">{configError}</Notice>}
      {sent ? (
        <Notice tone="success">
          If an account exists for {email}, a reset link is on its way. Check your inbox (and spam folder).
        </Notice>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor={`${ids}-email`}>Email</label>
            <input
              id={`${ids}-email`}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>
          <div aria-live="polite">{error && <Notice tone="error">{error}</Notice>}</div>
          <button type="submit" className="primary-button auth-submit" disabled={submitting || Boolean(configError)}>
            {submitting ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordPage() {
  const { session, loading, updatePassword } = useAuth();
  const navigate = useNavigate();
  const ids = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError("");
    const { error: message } = await updatePassword(password);
    if (message) {
      setError(message);
      setSubmitting(false);
      return;
    }
    navigate("/dashboard", { replace: true });
  }

  if (loading) {
    return <AuthShell title="Choose a new password"><p className="auth-subtitle">Checking your link…</p></AuthShell>;
  }

  // The emailed link signs the user in for this purpose; without that
  // session the link is invalid or expired.
  if (!session) {
    return (
      <AuthShell title="Link expired" footer={<Link to="/login">Back to sign in</Link>}>
        <Notice tone="error">This reset link is invalid or has expired.</Notice>
        <Link to="/forgot-password" className="primary-button auth-submit">
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle={`For ${session.user.email}`}>
      <form onSubmit={handleSubmit}>
        <PasswordInput
          id={`${ids}-new`}
          label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <PasswordInput
          id={`${ids}-confirm`}
          label="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />
        <p className="auth-hint">At least {MIN_PASSWORD_LENGTH} characters.</p>
        <div aria-live="polite">{error && <Notice tone="error">{error}</Notice>}</div>
        <button type="submit" className="primary-button auth-submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save new password"}
        </button>
      </form>
    </AuthShell>
  );
}
