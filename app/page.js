"use client";

import { useState } from "react";
import styles from "./page.module.css";

export default function Home() {
  const [mode, setMode] = useState("topic"); // "topic" | "existing"
  const [subject, setSubject] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [topic, setTopic] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [file, setFile] = useState(null);
  const [totalDays, setTotalDays] = useState("5");
  const [hoursPerDay, setHoursPerDay] = useState("1");
  const [includeImages, setIncludeImages] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setStatus("");
    setBusy(true);

    try {
      let existingContent = "";

      if (mode === "existing") {
        setStatus("Reading uploaded module...");
        if (file) {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch("/api/parse-module", { method: "POST", body: formData });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Failed to read the uploaded file.");
          existingContent = json.extractedText;
        } else if (pastedText.trim()) {
          existingContent = pastedText.trim();
        } else {
          throw new Error("Upload a file or paste in your existing module content.");
        }
      }

      setStatus("Generating lesson content with AI...");
      const genRes = await fetch("/api/generate-module", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          gradeLevel,
          topic: topic || subject,
          totalDays: Number(totalDays),
          hoursPerDay: Number(hoursPerDay),
          existingContent: existingContent || undefined,
        }),
      });
      const genJson = await genRes.json();
      if (!genRes.ok) throw new Error(genJson.error || "Failed to generate lesson content.");
      const moduleData = genJson.data;

      let images = [];
      if (includeImages) {
        setStatus("Generating slide images...");
        const imgRes = await fetch("/api/generate-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days: moduleData.days }),
        });
        const imgJson = await imgRes.json();
        if (imgRes.ok) images = imgJson.images || [];
        // Non-fatal: if image generation fails outright, keep going without images.
      }

      setStatus("Building your PowerPoint deck...");
      const pptxRes = await fetch("/api/build-pptx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleData, images }),
      });
      if (!pptxRes.ok) {
        const errJson = await pptxRes.json();
        throw new Error(errJson.error || "Failed to build the presentation.");
      }

      const blob = await pptxRes.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(topic || subject || "lesson-deck").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("Done! Your deck has been downloaded.");
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Module → PPT Converter</h1>
      <p className={styles.subtitle}>
        Turn a lesson module (or just a topic) into a 4-5 day PowerPoint deck, split into 1-2 hour daily sessions.
      </p>

      <div className={styles.tabs}>
        <button
          type="button"
          className={`${styles.tab} ${mode === "topic" ? styles.tabActive : ""}`}
          onClick={() => setMode("topic")}
        >
          Generate from a topic
        </button>
        <button
          type="button"
          className={`${styles.tab} ${mode === "existing" ? styles.tabActive : ""}`}
          onClick={() => setMode("existing")}
        >
          Use an existing module
        </button>
      </div>

      <form onSubmit={handleSubmit}>
        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="subject">Subject</label>
            <input id="subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="gradeLevel">Grade Level</label>
            <input id="gradeLevel" type="text" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} required />
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor="topic">Topic / Week Title</label>
          <input id="topic" type="text" value={topic} onChange={(e) => setTopic(e.target.value)} required />
        </div>

        {mode === "existing" && (
          <>
            <div className={styles.field}>
              <label htmlFor="file">Upload existing module (.docx or .txt)</label>
              <input id="file" type="file" accept=".docx,.txt" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </div>
            <div className={styles.field}>
              <label htmlFor="pastedText">...or paste the module content directly</label>
              <textarea id="pastedText" rows={6} value={pastedText} onChange={(e) => setPastedText(e.target.value)} />
            </div>
          </>
        )}

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor="totalDays">Number of Days</label>
            <select id="totalDays" value={totalDays} onChange={(e) => setTotalDays(e.target.value)}>
              <option value="4">4 days</option>
              <option value="5">5 days</option>
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="hoursPerDay">Hours per Day</label>
            <select id="hoursPerDay" value={hoursPerDay} onChange={(e) => setHoursPerDay(e.target.value)}>
              <option value="1">1 hour</option>
              <option value="2">2 hours</option>
            </select>
          </div>
        </div>

        <div className={styles.checkboxRow}>
          <input
            id="includeImages"
            type="checkbox"
            checked={includeImages}
            onChange={(e) => setIncludeImages(e.target.checked)}
          />
          <label htmlFor="includeImages" style={{ marginBottom: 0 }}>
            Include AI-generated images per day
          </label>
        </div>

        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? "Generating..." : "Generate PPTX"}
        </button>
      </form>

      {status && <div className={styles.status}>{status}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
