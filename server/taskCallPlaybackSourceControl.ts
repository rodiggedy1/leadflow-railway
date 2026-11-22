/** Test-only: restore only the fixed approved task-call playback/display hunks.
 * Behavioral tests always execute the actual unnormalized component. */
const approved: Record<string, Array<[string, string]>> = {
  "client/src/components/ClaudeCustomerTasks.tsx": [
    [
      "import { proxyRecordingUrl } from \"@/lib/utils\";\n",
      ""
    ],
    [
      "  const [failedUrl, setFailedUrl] = useState<string | null>(null);\n  const [attempt, setAttempt] = useState(0);\n  const url = proxyRecordingUrl(recording.data?.url);\n  const retry = () => { setFailedUrl(null); setAttempt(value => value + 1); void recording.refetch(); };\n",
      ""
    ],
    [
      "  if (recording.isError) return <p role=\"alert\">Call recording unavailable. <button type=\"button\" onClick={retry}>Retry</button></p>;\n  if (!url) return <p>Call recording unavailable.</p>;\n",
      "  if (recording.isError) return <p role=\"alert\">Call recording unavailable. <button type=\"button\" onClick={() => void recording.refetch()}>Retry</button></p>;\n  if (!recording.data?.url) return <p>Call recording unavailable.</p>;\n"
    ],
    [
      "    <audio key={`${url}:${attempt}`} controls preload=\"metadata\" className=\"w-full\" aria-label=\"Call recording\" src={url} onError={() => setFailedUrl(url)} />\n    {failedUrl === url && <p role=\"alert\">Audio could not be loaded. <button type=\"button\" onClick={retry}>Retry</button></p>}\n    <a href={url} target=\"_blank\" rel=\"noopener noreferrer\">Open call recording</a>\n",
      "    <audio controls preload=\"none\" className=\"w-full\" aria-label=\"Call recording\" src={recording.data.url} />\n    <a href={recording.data.url} target=\"_blank\" rel=\"noopener noreferrer\">Open call recording</a>\n"
    ],
    [
      "}\n/** Use the AI Calls page's line/label presentation, without inventing speaker identity.\n * Saved Whisper evidence is not diarized: label-like words inside it remain prose. */\nexport function CustomerTaskCallTranscript({ task }: { task: Extract<CustomerTask, { call: unknown }> }) {\n  const unattributed = task.call.provider === \"openphone\" && task.call.transcriptSource === \"saved\";\n  return <div className=\"cct-call-transcript\">{task.call.transcript.split(/\\r?\\n/).filter(line => line.trim()).map((line, index) => {\n    const match = line.match(/^\\s*(Assistant|AI|User|Caller|Customer|Client|Staff|Unattributed):([\\s\\S]*)$/i);\n    const labeled = match && (!unattributed || /^unattributed$/i.test(match[1]));\n    const content = labeled ? match[2] : line;\n    // Neutral reading paragraphs only; do not imply new speakers or alter words.\n    const paragraphs = content.match(/(?:\\s*\\S+){1,60}\\s*/g) ?? [content];\n    return <article className=\"cct-call-turn\" key={index}>\n      {labeled && <strong className=\"cct-call-speaker\">{match[1]}:</strong>}\n      {paragraphs.map((paragraph, paragraphIndex) => <p className=\"cct-verbatim\" key={paragraphIndex}>{paragraph}</p>)}\n    </article>;\n  })}</div>;\n",
      ""
    ],
    [
      "        <section aria-label=\"Full call transcript\"><h4>Full call transcript</h4><CustomerTaskCallTranscript task={task} /></section>\n",
      "        <section aria-label=\"Full call transcript\"><h4>Full call transcript</h4><p className=\"cct-verbatim\">{task.call.transcript}</p></section>\n"
    ]
  ],
  "client/src/components/claude-customer-tasks.css": [
    [
      ".cct-call-transcript { display: grid; gap: 12px; margin-top: 10px; font-size: 12px; line-height: 1.65; }\n.cct-call-turn { min-width: 0; padding-left: 10px; border-left: 2px solid #625274; }\n.cct-call-speaker { color: #dcc5fa; font-size: 11px; }\n",
      ""
    ]
  ]
};
export function withoutApprovedTaskCallPlayback(path: string, source: string): string {
  for (const [current, original] of approved[path] ?? []) {
    const count = source.split(current).length - 1;
    if (count !== 0 && count !== 1) throw new Error(`Unexpected task-call preservation hunk: ${path}`);
    if (count === 1) source = source.replace(current, original);
  }
  return source;
}
