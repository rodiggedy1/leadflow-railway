import { FormEvent, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  Clock3,
  KeyRound,
  LayoutGrid,
  Loader2,
  Search,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { ADMIN_PAGES } from "@shared/const";
import { trpc } from "@/lib/trpc";
import "./team-confirmation-review.css";
import "./team-exact-live.css";

const pageLabelById = new Map<string, string>(ADMIN_PAGES.map((page) => [page.id, page.label]));
const pageOptions = ADMIN_PAGES.map((page) => page.id);

type AccountMutation = { id: number; name: string; nextActive: boolean };
type PermissionTarget = { id: number; name: string; pagePermissions: string[] | null; isAdmin: boolean | number };
type PasswordTarget = { id: number; name: string };

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "TM";
}

function avatarTone(id: number) {
  return ["violet", "blue", "mint", "amber"][id % 4];
}

function formatResponseTime(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatCurrency(value: number | null | undefined) {
  const numeric = Number(value ?? 0);
  return numeric > 0 ? `$${numeric.toLocaleString()}` : "—";
}

function formatCreated(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(date);
}

function pageLabels(pagePermissions: string[] | null, isAdmin: boolean | number) {
  if (isAdmin || pagePermissions === null) return ["All pages"];
  return pagePermissions.map((pageId) => pageLabelById.get(pageId) ?? pageId);
}

export default function TeamExactLive() {
  const utils = trpc.useUtils();
  const { data: session, isLoading: sessionLoading } = trpc.agents.me.useQuery();
  const { data: accounts = [], isLoading: accountsLoading, error: accountsError } = trpc.agents.list.useQuery(undefined, {
    enabled: Boolean(session?.isAdmin),
  });
  const { data: performance = [] } = trpc.agents.performance.useQuery(undefined, {
    enabled: Boolean(session?.isAdmin),
  });
  const { data: callAssist = [] } = trpc.agents.callAssistStats.useQuery(undefined, {
    enabled: Boolean(session?.isAdmin),
  });

  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [pendingActiveChange, setPendingActiveChange] = useState<AccountMutation | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<PermissionTarget | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<PasswordTarget | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<string[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordAgain, setResetPasswordAgain] = useState("");

  const refreshAccounts = async () => {
    await Promise.all([
      utils.agents.list.invalidate(),
      utils.agents.performance.invalidate(),
      utils.agents.callAssistStats.invalidate(),
    ]);
  };

  const createAccount = trpc.agents.create.useMutation({
    onSuccess: async () => {
      await refreshAccounts();
      toast.success("Team account created.");
      setCreateOpen(false);
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewPasswordAgain("");
    },
    onError: (error) => toast.error(error.message),
  });

  const setAccountActive = trpc.agents.setActive.useMutation({
    onSuccess: async (_, input) => {
      await refreshAccounts();
      toast.success(input.isActive ? "Team account activated." : "Team account deactivated.");
      setPendingActiveChange(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const setPagePermissions = trpc.agents.setPagePermissions.useMutation({
    onSuccess: async () => {
      await refreshAccounts();
      toast.success("Page access updated.");
      setPermissionsOpen(false);
      setPermissionsTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const resetAccountPassword = trpc.agents.resetPassword.useMutation({
    onSuccess: async () => {
      await utils.agents.list.invalidate();
      toast.success("Password reset.");
      setPasswordOpen(false);
      setPasswordTarget(null);
      setResetPassword("");
      setResetPasswordAgain("");
    },
    onError: (error) => toast.error(error.message),
  });

  const liveMembers = useMemo(() => {
    const performanceById = new Map(performance.map((item) => [item.id, item]));
    const callAssistById = new Map(callAssist.map((item) => [item.id, item]));

    return accounts.map((account) => {
      const stats = performanceById.get(account.id);
      const calls = callAssistById.get(account.id);
      return {
        ...account,
        stats: {
          callsThisWeek: stats?.callsThisWeek ?? 0,
          bookingsThisWeek: stats?.bookingsThisWeek ?? 0,
          totalAssigned: stats?.totalAssigned ?? 0,
          bookingsAllTime: stats?.bookingsAllTime ?? 0,
          conversionRate: stats?.conversionRate ?? 0,
          revenueBooked: stats?.revenueBooked ?? 0,
          avgResponseTimeMinutes: stats?.avgResponseTimeMinutes ?? null,
        },
        callAssist: {
          totalCalls: calls?.totalCalls ?? 0,
          callsToday: calls?.callsToday ?? 0,
          callBookings: calls?.callBookings ?? 0,
          callRevenue: calls?.callRevenue ?? 0,
          callConversionRate: calls?.callConversionRate ?? 0,
        },
      };
    });
  }, [accounts, callAssist, performance]);

  const visibleMembers = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return liveMembers;
    return liveMembers.filter((member) => [member.name, member.email, member.isAdmin ? "admin" : "agent"]
      .join(" ")
      .toLowerCase()
      .includes(term));
  }, [liveMembers, query]);

  const performanceMembers = useMemo(() => [...visibleMembers].sort((a, b) =>
    b.stats.bookingsThisWeek - a.stats.bookingsThisWeek ||
    b.stats.callsThisWeek - a.stats.callsThisWeek ||
    b.stats.totalAssigned - a.stats.totalAssigned
  ), [visibleMembers]);

  const selected = liveMembers.find((member) => member.id === selectedId) ?? null;
  const activeCount = liveMembers.filter((member) => member.isActive).length;
  const handledLeads = liveMembers.reduce((total, member) => total + member.stats.totalAssigned, 0);

  const openPermissions = (member: PermissionTarget) => {
    if (member.isAdmin) return;
    setPermissionsTarget(member);
    setDraftPermissions(member.pagePermissions === null ? null : [...member.pagePermissions]);
    setPermissionsOpen(true);
  };

  const togglePermission = (pageId: string) => {
    setDraftPermissions((permissions) => {
      if (permissions === null) return pageOptions.filter((item) => item !== pageId);
      return permissions.includes(pageId)
        ? permissions.filter((item) => item !== pageId)
        : [...permissions, pageId];
    });
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!newName.trim() || !newEmail.trim() || newPassword.length < 6) {
      toast.error("Enter a name, email, and password of at least 6 characters.");
      return;
    }
    if (newPassword !== newPasswordAgain) {
      toast.error("The passwords do not match.");
      return;
    }
    if (!window.confirm(`Create the Team account for ${newName.trim()} (${newEmail.trim()})?`)) return;
    createAccount.mutate({ name: newName.trim(), email: newEmail.trim(), password: newPassword });
  };

  const submitPasswordReset = (event: FormEvent) => {
    event.preventDefault();
    if (!passwordTarget) return;
    if (resetPassword.length < 6) {
      toast.error("Use a password of at least 6 characters.");
      return;
    }
    if (resetPassword !== resetPasswordAgain) {
      toast.error("The passwords do not match.");
      return;
    }
    if (!window.confirm(`Reset the password for ${passwordTarget.name}?`)) return;
    resetAccountPassword.mutate({ agentId: passwordTarget.id, newPassword: resetPassword });
  };

  if (sessionLoading) {
    return <main className="team-review ops-review ops-team-loading"><Loader2 className="animate-spin" /> Loading Team workspace…</main>;
  }

  if (!session?.isAdmin) {
    return (
      <main className="team-review ops-review">
        <section className="ops-team-gate">
          <ShieldOff size={23} />
          <h1>Team administration requires an admin account</h1>
          <p>This workspace uses the existing Team account, access, and performance contracts. Sign in with an admin account to view or manage them.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="team-review ops-review" data-live-workspace="team">
      <header className="ops-utility">
        <label>
          <Search size={17} />
          <input aria-label="Search Team members" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Team…" />
          <kbd>⌘ K</kbd>
        </label>
        <div>
          <button type="button" aria-label="Refresh Team data" onClick={() => void refreshAccounts()}><Bell size={18} /></button>
          <span>{initials(session.name)}</span>
        </div>
      </header>

      <div className="ops-content">
        <section className="ops-head">
          <div>
            <span>Team operations · Live</span>
            <h1><UsersRound size={27} />Team</h1>
            <p>Manage real agent accounts, existing page access, and the current performance records in one operational surface.</p>
          </div>
          <p><Sparkles size={14} />Connected to existing agent accounts and performance records</p>
        </section>

        <section className="ops-stat-strip" aria-label="Team summary">
          <article><span className="ops-stat-icon is-violet"><UsersRound size={19} /></span><div><strong>{liveMembers.length}</strong><small>Team members</small></div></article>
          <article><span className="ops-stat-icon is-mint"><ShieldCheck size={19} /></span><div><strong>{activeCount}</strong><small>Active accounts</small></div></article>
          <article><span className="ops-stat-icon is-blue"><Activity size={19} /></span><div><strong>{handledLeads}</strong><small>Leads handled</small></div></article>
          <article><span className="ops-stat-icon is-amber"><Clock3 size={19} /></span><div><strong>{liveMembers.length - activeCount}</strong><small>Inactive accounts</small></div></article>
        </section>

        {accountsError && <p className="ops-status-notice ops-status-notice--error">Unable to load Team accounts: {accountsError.message}</p>}

        <section className="ops-surface ops-performance">
          <header>
            <div>
              <span>Performance view</span>
              <h2>Agent performance</h2>
              <p>Current account-level metrics from existing agent assignment, call, booking, and revenue records.</p>
            </div>
            <button className="ops-quiet" type="button" onClick={() => void refreshAccounts()}>Refresh <ChevronDown size={14} /></button>
          </header>
          {accountsLoading ? (
            <div className="ops-team-empty"><Loader2 className="animate-spin" /> Loading live performance…</div>
          ) : performanceMembers.length === 0 ? (
            <div className="ops-team-empty">No Team accounts match this search.</div>
          ) : (
            <div className="ops-performance-grid">
              {performanceMembers.map((member, index) => {
                const response = formatResponseTime(member.stats.avgResponseTimeMinutes);
                const responseClass = member.stats.avgResponseTimeMinutes === null || member.stats.avgResponseTimeMinutes === undefined
                  ? ""
                  : member.stats.avgResponseTimeMinutes < 60 ? "is-good" : "is-warm";
                const conversionClass = member.stats.conversionRate >= 35 ? "is-good" : "is-warm";
                return (
                  <button className="ops-person-card" type="button" key={member.id} onClick={() => setSelectedId(member.id)}>
                    <header>
                      <span className={`ops-avatar is-${avatarTone(member.id)}`}>{initials(member.name)}</span>
                      <div><strong>{member.name}</strong><small>{member.email}</small></div>
                      <em>#{index + 1}</em>
                    </header>
                    <div className="ops-person-metrics">
                      <span><b>{member.stats.totalAssigned}</b><small>Leads handled</small></span>
                      <span><b className={conversionClass}>{member.stats.conversionRate}%</b><small>Conv. rate</small></span>
                      <span><b className={responseClass}>{response}</b><small>Avg response</small></span>
                      <span><b className="is-good">{formatCurrency(member.stats.revenueBooked)}</b><small>Revenue closed</small></span>
                    </div>
                    <footer><span>{member.stats.callsThisWeek} calls this week</span><span>{member.stats.bookingsAllTime} booked all-time</span></footer>
                    <section className="ops-call-assist">
                      <b><BriefcaseBusiness size={12} />Call assist</b>
                      <div>
                        <span><strong>{member.callAssist.totalCalls}</strong><small>Total calls</small></span>
                        <span><strong>{member.callAssist.callBookings}</strong><small>Booked</small></span>
                        <span><strong>{member.callAssist.callConversionRate}%</strong><small>Conv. rate</small></span>
                      </div>
                    </section>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="ops-surface ops-accounts">
          <header>
            <div>
              <span>Access control</span>
              <h2>Team accounts</h2>
              <p>Manage who can access the agent workspace and which operational surfaces appear for them.</p>
            </div>
            <button className="ops-primary" type="button" onClick={() => setCreateOpen(true)}><UserPlus size={15} />Add team member</button>
          </header>
          <div className="ops-table-wrap">
            <table>
              <thead><tr><th>Member</th><th>Status</th><th>Access</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {visibleMembers.map((member) => (
                  <tr key={member.id} onClick={() => setSelectedId(member.id)}>
                    <td><span className={`ops-avatar is-${avatarTone(member.id)}`}>{initials(member.name)}</span><div><b>{member.name}</b><small>{member.email}</small></div></td>
                    <td><em className={member.isActive ? "ops-status is-active" : "ops-status"}>{member.isActive ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}{member.isActive ? "Active" : "Inactive"}</em></td>
                    <td>{member.isAdmin || member.pagePermissions === null ? <span className="ops-all-pages">All pages</span> : <span className="ops-pages-count"><LayoutGrid size={12} />{member.pagePermissions.length} pages</span>}</td>
                    <td><span className="ops-created">{formatCreated(member.createdAt)}</span></td>
                    <td><button className="ops-row-action" type="button" onClick={(event) => { event.stopPropagation(); setPendingActiveChange({ id: member.id, name: member.name, nextActive: !Boolean(member.isActive) }); }}>{member.isActive ? <><ShieldOff size={13} />Deactivate</> : <><ShieldCheck size={13} />Activate</>}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selected && (
        <aside className="ops-drawer" aria-label="Team member detail">
          <header>
            <button type="button" aria-label="Close Team member detail" onClick={() => setSelectedId(null)}><X size={18} /></button>
            <div><span className={`ops-avatar is-${avatarTone(selected.id)}`}>{initials(selected.name)}</span><section><h2>{selected.name}</h2><p>{selected.email}</p></section></div>
            <em className={selected.isActive ? "ops-status is-active" : "ops-status"}>{selected.isActive ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}{selected.isActive ? "Active" : "Inactive"}</em>
          </header>
          <section><span>Account summary</span><div className="ops-detail-grid"><p><small>Role</small><b>{selected.isAdmin ? "Admin" : "Agent"}</b></p><p><small>Created</small><b>{formatCreated(selected.createdAt)}</b></p><p><small>Leads handled</small><b>{selected.stats.totalAssigned}</b></p><p><small>Call conversion</small><b>{selected.callAssist.callConversionRate}%</b></p></div></section>
          <section><div className="ops-section-title"><span>Page access</span>{!selected.isAdmin && <button type="button" onClick={() => openPermissions(selected)}><LayoutGrid size={13} />Manage</button>}</div><div className="ops-access-chips">{pageLabels(selected.pagePermissions, selected.isAdmin).map((page) => <i key={page}>{page}</i>)}</div></section>
          <section><div className="ops-section-title"><span>Account actions</span></div><button className="ops-detail-action" type="button" onClick={() => { setPasswordTarget({ id: selected.id, name: selected.name }); setPasswordOpen(true); }}><KeyRound size={14} />Reset password</button><button className="ops-detail-action" type="button" onClick={() => setPendingActiveChange({ id: selected.id, name: selected.name, nextActive: !Boolean(selected.isActive) })}>{selected.isActive ? <ShieldOff size={14} /> : <ShieldCheck size={14} />}{selected.isActive ? "Deactivate account" : "Activate account"}</button></section>
        </aside>
      )}

      {createOpen && <div className="ops-modal-backdrop" onClick={() => setCreateOpen(false)}><form className="ops-modal" onSubmit={submitCreate} onClick={(event) => event.stopPropagation()}><header><h2><UserPlus size={17} />Add team member</h2><button type="button" onClick={() => setCreateOpen(false)}><X size={17} /></button></header><label>Full name<input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Team member name" autoFocus /></label><label>Email<input value={newEmail} onChange={(event) => setNewEmail(event.target.value)} placeholder="name@example.com" type="email" /></label><label>Initial password<input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Minimum 6 characters" type="password" /></label><label>Confirm password<input value={newPasswordAgain} onChange={(event) => setNewPasswordAgain(event.target.value)} placeholder="Repeat password" type="password" /></label><footer><button type="button" onClick={() => setCreateOpen(false)}>Cancel</button><button className="ops-primary" type="submit" disabled={createAccount.isPending}>{createAccount.isPending ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}Create member</button></footer></form></div>}

      {permissionsOpen && permissionsTarget && <div className="ops-modal-backdrop" onClick={() => setPermissionsOpen(false)}><section className="ops-modal ops-modal--permissions" onClick={(event) => event.stopPropagation()}><header><h2><LayoutGrid size={17} />Page access · {permissionsTarget.name}</h2><button type="button" onClick={() => setPermissionsOpen(false)}><X size={17} /></button></header><p>Choose the real admin pages this Team account can access. Unrestricted access is preserved until a page is cleared. Saving changes its actual account permission.</p><div className="ops-permission-list">{pageOptions.map((pageId) => <label key={pageId}><input type="checkbox" checked={draftPermissions === null || draftPermissions.includes(pageId)} onChange={() => togglePermission(pageId)} />{pageLabelById.get(pageId) ?? pageId}</label>)}</div><footer><button type="button" onClick={() => setPermissionsOpen(false)}>Cancel</button><button className="ops-primary" type="button" disabled={setPagePermissions.isPending} onClick={() => { if (!window.confirm(`Save page access for ${permissionsTarget.name}?`)) return; setPagePermissions.mutate({ agentId: permissionsTarget.id, pagePermissions: draftPermissions }); }}>{setPagePermissions.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Save access</button></footer></section></div>}

      {passwordOpen && passwordTarget && <div className="ops-modal-backdrop" onClick={() => setPasswordOpen(false)}><form className="ops-modal" onSubmit={submitPasswordReset} onClick={(event) => event.stopPropagation()}><header><h2><KeyRound size={17} />Reset password · {passwordTarget.name}</h2><button type="button" onClick={() => setPasswordOpen(false)}><X size={17} /></button></header><label>New password<input value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} placeholder="Minimum 6 characters" type="password" autoFocus /></label><label>Confirm password<input value={resetPasswordAgain} onChange={(event) => setResetPasswordAgain(event.target.value)} placeholder="Repeat password" type="password" /></label><footer><button type="button" onClick={() => setPasswordOpen(false)}>Cancel</button><button className="ops-primary" type="submit" disabled={resetAccountPassword.isPending}>{resetAccountPassword.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}Reset password</button></footer></form></div>}

      {pendingActiveChange && <div className="ops-modal-backdrop" onClick={() => setPendingActiveChange(null)}><section className="ops-modal ops-modal--confirm" onClick={(event) => event.stopPropagation()}><header><h2>{pendingActiveChange.nextActive ? <ShieldCheck size={17} /> : <ShieldOff size={17} />}{pendingActiveChange.nextActive ? "Activate account" : "Deactivate account"}</h2><button type="button" onClick={() => setPendingActiveChange(null)}><X size={17} /></button></header><p>{pendingActiveChange.nextActive ? `${pendingActiveChange.name} will regain access to the agent workspace.` : `${pendingActiveChange.name} will lose access to the agent workspace until reactivated.`}</p><footer><button type="button" onClick={() => setPendingActiveChange(null)}>Cancel</button><button className="ops-primary" type="button" disabled={setAccountActive.isPending} onClick={() => setAccountActive.mutate({ agentId: pendingActiveChange.id, isActive: pendingActiveChange.nextActive })}>{setAccountActive.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{pendingActiveChange.nextActive ? "Activate" : "Deactivate"}</button></footer></section></div>}
    </main>
  );
}
