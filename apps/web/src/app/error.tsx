"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-card">
      <h1>Let’s try that again.</h1>
      <p>
        This page couldn’t load. Your saved changes are still on the server.
      </p>
      <button onClick={reset}>Reload page</button>
      <a href="/">Go home</a>
    </main>
  );
}
