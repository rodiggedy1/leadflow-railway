import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { proxyRecordingUrl } from "@/lib/utils";
import { useAiCallerSession } from "@/hooks/useAiCallerSession";
import { SCENARIOS, SCENARIO_SLUG, customerToItem, cleanerToItem, buildScript, applyMergeFields } from "./AiCallsExactLive";
import { AiCallerWorkspace, type CallerContact, type CallerRecord } from "@/components/AiCallerWorkspace";

/** Approved caller using the existing owned API, voice, model and prompt. */
export default function AiCallerLive() {
  const [date] = useState(() => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }));
  const [searchQuery, setSearchQuery] = useState("");
  const contactSearch = trpc.leadflowJobs.callMatrix.searchContacts.useQuery({ query: searchQuery }, {
    enabled: searchQuery.length > 0, staleTime: 10_000, refetchOnWindowFocus: false, retry: false,
  });
  const people = trpc.leadflowJobs.callMatrix.getPeople.useQuery({ date }, { staleTime: 60_000 });
  const templates = trpc.leadflowJobs.callMatrix.getTemplates.useQuery(undefined, { staleTime: 30_000 });
  const outbound = trpc.leadflowJobs.callMatrix.getCallHistory.useQuery({ limit: 50 }, { staleTime: 30_000 });
  const inbound = trpc.voice.listCalls.useQuery({ limit: 50, offset: 0 }, { staleTime: 30_000 });
  const startMutation = trpc.leadflowJobs.callMatrix.startCall.useMutation();
  const utils = trpc.useUtils();
  const calls = useAiCallerSession({
    startCall: params => startMutation.mutateAsync(params),
    pollCall: params => utils.leadflowJobs.callMatrix.pollCall.fetch(params),
  });
  const completedId = useRef<string | null>(null);
  useEffect(() => {
    const session = calls.session;
    if (!session || session.phase !== "terminal" || !session.vapiCallId || completedId.current === session.vapiCallId) return;
    completedId.current = session.vapiCallId;
    // One history refresh at completion, not page-wide background polling.
    void utils.leadflowJobs.callMatrix.getCallHistory.invalidate();
  }, [calls.session, utils]);

  const contacts = useMemo<CallerContact[]>(() => {
    const customers = (people.data?.customers ?? []).map(customerToItem);
    const teams = (people.data?.cleaners ?? []).map(cleanerToItem);
    return [...customers.map(person => ({ person, audience: "customer" as const })), ...teams.map(person => ({ person, audience: "cleaner" as const }))].map(({ person, audience }) => ({
      id: person.id, name: person.name, phone: person.phone,
      initials: person.name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase(),
      type: audience === "customer" ? "Customer" : "Team",
      location: person.meta, leadflowJobId: person.leadflowJobId, jobDate: date,
      scripts: SCENARIOS[audience].map(scenario => {
        const template = templates.data?.find(item => item.scenario === SCENARIO_SLUG[scenario.title] && item.audience === audience);
        return { label: scenario.title, text: template ? applyMergeFields(template.body, person, audience) : buildScript(person, scenario.title, audience) };
      }),
    }));
  }, [people.data, templates.data, date]);

  const searchedContacts = useMemo<CallerContact[]>(() => (contactSearch.isPlaceholderData ? [] : contactSearch.data ?? []).map(person => ({
    id: `search-${person.id}`, name: person.name, phone: person.phone,
    initials: person.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase(),
    type: person.source === "cleaner" ? "Team" : person.source === "lead" ? "Lead" : "Customer",
    location: person.context,
    // Search identifies a person, not a current booking. Do not manufacture job facts or scripts.
    leadflowJobId: null, jobDate: date, scripts: [],
  })), [contactSearch.data, contactSearch.isPlaceholderData, date]);

  const recent = useMemo<CallerRecord[]>(() => {
    function historyPerson(phone: string | null, name?: string | null): CallerContact {
      // History identifies the called number, not a fabricated job association.
      const known = contacts.find(person => person.phone === phone);
      const label = name || known?.name || phone || "Unknown caller";
      return { id: `history-${phone ?? label}`, name: label,
        initials: label.split(" ").map(part => part[0]).join("").slice(0,2).toUpperCase(),
        phone, type: known?.type ?? "Customer", location: "Existing call record",
        leadflowJobId: null, jobDate: date, scripts: [],
      };
    }
    const outboundRows = (outbound.data ?? []).map(call => ({
      id: `outbound-${call.id}`, person: historyPerson(call.calledPhone),
      reason: call.step === "ai_matrix_cleaner" ? "Team call" : "Customer call",
      outcome: call.outcome, durationSeconds: call.durationSeconds,
      time: call.createdAt, transcript: call.transcript, summary: call.summary,
      recordingUrl: proxyRecordingUrl(call.recordingUrl),
      sortTs: Date.parse(call.createdAt ?? "") || 0,
    }));
    const inboundRows = (inbound.data?.calls ?? []).map(call => ({
      id: `inbound-${call.id}`, person: historyPerson(call.callerPhone, call.callerName),
      reason: "Inbound AI call", outcome: call.outcome, durationSeconds: call.durationSeconds,
      time: call.createdAt ? new Date(call.createdAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : null,
      transcript: call.transcript, summary: call.summary,
      recordingUrl: proxyRecordingUrl(call.recordingUrl),
      sortTs: call.createdAt ? new Date(call.createdAt).getTime() : 0,
    }));
    return [...outboundRows, ...inboundRows].sort((left, right) => right.sortTs - left.sortTs);
  }, [outbound.data, inbound.data, contacts, date]);
  const displayedSession = calls.session?.outcome ? {
    ...calls.session, outcome: { ...calls.session.outcome, recordingUrl: proxyRecordingUrl(calls.session.outcome.recordingUrl) },
  } : calls.session;

  return <AiCallerWorkspace review={false} contacts={contacts} recent={recent}
    session={displayedSession} onStartCall={calls.startCall} onDismissSession={calls.dismissSession}
    businessDate={date} onConfigure={() => { window.location.href = "/admin/ai-calls?view=configuration"; }}
    onSearchChange={setSearchQuery} searchResults={{ query: searchQuery, contacts: searchedContacts,
      loading: contactSearch.isFetching, error: contactSearch.error ? "Contact search failed. Edit the search to try again." : null }}
    loading={people.isLoading || templates.isLoading}
    error={people.error?.message ?? templates.error?.message}
    historyLoading={outbound.isLoading || inbound.isLoading}
    historyError={outbound.error?.message ?? inbound.error?.message}
    onRefresh={() => { void outbound.refetch(); void inbound.refetch(); }} />;
}
