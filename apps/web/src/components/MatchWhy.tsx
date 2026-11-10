"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
type Row = Record<string, any>;
export default function MatchWhy({
  matchId,
  api,
}: {
  matchId: string;
  api: (url: string) => Promise<any>;
}) {
  const [data, setData] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    api(`/matches/${matchId}/explanation`)
      .then((d) => {
        if (alive) setData(d);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [matchId, api, attempt]);
  return (
    <>
      <header className="page-heading">
        <span className="eyebrow">ONLY WHAT YOU BOTH CHOOSE TO SHARE</span>
        <h1>Your common ground.</h1>
      </header>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button
            className="secondary"
            onClick={() => setAttempt((x) => x + 1)}
          >
            Retry
          </button>
        </div>
      )}
      {!data && !error && (
        <p role="status">Loading the current permitted explanation…</p>
      )}
      {data && (
        <section className="panel form-stack">
          <span className="pill">{data.basis}</span>
          <p>{data.reason}</p>
          <div className="tag-list">
            {data.commonGround.map((tag: string) => (
              <span className="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
          <p>
            Evidence support: <strong>{data.evidenceGrade}</strong>. This is not
            a relationship probability.
          </p>
          <p>{data.notice}</p>
          <p className="muted">
            Deterministic explanation from approved tags. No AI model or Elastic
            query is claimed.
          </p>
          <Link href="/taste/consent" className="text-link">
            Change what can be used
          </Link>
          <Link href={`/chats/${matchId}`} className="button secondary">
            Back to the conversation
          </Link>
        </section>
      )}
    </>
  );
}
