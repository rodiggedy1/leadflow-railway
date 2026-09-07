import { trpc } from "@/lib/trpc";
import { useOpsStream } from "@/hooks/useOpsStream";
import { BookingPaymentActions } from "@/components/BookingPaymentActions";
import { PortalRequestPaymentActions } from "@/components/PortalRequestPaymentActions";
import { BOOKING_WIDGET_PRICED_EXTRAS } from "@shared/bookingWidgetConfig";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, CreditCard, Download, ExternalLink, Filter, ImageIcon, Loader2, MapPin, MessageCircle, MoreHorizontal, Plus, Search, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@/pages/bookings-preview.css";

type StatusFilter = "All" | "Confirmed" | "Needs attention" | "Completed";
type NativeExtra = { id: string; label: string; quantity: number };
type StaffJobPhoto = { id: number; photoUrl: string; thumbnailUrl: string | null; filename: string | null; photoType: string; createdAt: Date };
type StaffJobSignoff = { signatureUrl: string | null; customerResponse: string | null; customerNotes: string | null; customerNotHome: boolean; signedOffAt: Date } | null;
type WorkspaceRow = {
  key: string;
  source: "booking" | "funnel" | "portal" | "leadflow";
  id: number;
  publicNumber: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  status: string;
  requestedLocalDate: string | null;
  requestedLocalTime: string | null;
  address: string | null;
  serviceName: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  recurrence: string | null;
  extras: NativeExtra[];
  specialRequestNotes: string[];
  assignmentStatus: string;
  assignedTeamName: string | null;
  paymentStatus: string;
  paymentBrand: string | null;
  paymentLast4: string | null;
  stripePaymentMethodId: string | null;
  paymentChargedAt: number | null;
  firstCleaningTotalCents: number | null;
};

const ACTIVE_BOOKING_SOURCES: WorkspaceRow["source"][] = ["booking", "funnel", "leadflow"];
const isCancelledBookingStatus = (status: string) => ["cancelled", "canceled"].includes(status.trim().toLowerCase());
const isInactiveBookingStatus = (status: string) => ["cancelled", "canceled", "rescheduled", "missing_from_launch27"].includes(status.trim().toLowerCase());
const isActiveBookingRow = (row: WorkspaceRow) =>
  ACTIVE_BOOKING_SOURCES.includes(row.source)
  && !isInactiveBookingStatus(row.status)
  && (row.source !== "funnel" || row.status === "booked");

const API_STATUS: Record<Exclude<StatusFilter, "All">, "confirmed" | "needs_attention" | "completed"> = {
  Confirmed: "confirmed",
  "Needs attention": "needs_attention",
  Completed: "completed",
};
const businessDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00`);
const shiftDate = (value: string, days: number) => {
  const date = dateAtNoon(value);
  date.setDate(date.getDate() + days);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
};
const displayDate = (value: string) => dateAtNoon(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const displayTime = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
};
const displayRequestedTime = (value: string) => /^\d{2}:\d{2}$/.test(value) ? displayTime(value) : value;
const labelStatus = (value: string) => value === "lead" ? "Lead / In progress" : value === "payment_incomplete" ? "Reservation started / Payment incomplete" : value === "needs_attention" ? "Needs attention" : value === "pending_payment" ? "Pending payment" : value === "missing_from_launch27" ? "No longer in Launch27" : value.charAt(0).toUpperCase() + value.slice(1);
const labelRecurrence = (value: string) => value === "biweekly" ? "Every 2 weeks" : value === "one-time" ? "One-time" : value.charAt(0).toUpperCase() + value.slice(1);
const extrasFrom = (value: unknown): NativeExtra[] => Array.isArray(value)
  ? value.filter((item): item is NativeExtra => Boolean(item && typeof item === "object" && typeof (item as NativeExtra).id === "string" && typeof (item as NativeExtra).label === "string" && typeof (item as NativeExtra).quantity === "number"))
  : [];
const funnelExtrasFrom = (value: unknown): NativeExtra[] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { id?: unknown; quantity?: unknown };
    if (typeof candidate.id !== "string" || typeof candidate.quantity !== "number") return [];
    return [{ id: candidate.id, label: BOOKING_WIDGET_PRICED_EXTRAS.find((extra) => extra.id === candidate.id)?.label ?? candidate.id, quantity: candidate.quantity }];
  })
  : [];
const notesFrom = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const importedExtrasFrom = (value: string | null): NativeExtra[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").map((id) => ({ id, label: BOOKING_WIDGET_PRICED_EXTRAS.find((extra) => extra.id === id)?.label ?? id, quantity: 1 })) : [];
  } catch {
    return [];
  }
};
const importedTimeFrom = (value: string | null): string | null => {
  if (!value || Number.isNaN(new Date(value).getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
};
const photoDownloadName = (photo: StaffJobPhoto, index: number) => photo.filename?.trim() || `cleaner-photo-${index + 1}.jpg`;
const photoDownloadUrl = (photo: StaffJobPhoto, index: number) => `/api/media-proxy?url=${encodeURIComponent(photo.photoUrl)}&download=1&filename=${encodeURIComponent(photoDownloadName(photo, index))}`;

function BookingSignoffReview({ bookingKey, signoff, isLoading, isError }: { bookingKey: string; signoff: StaffJobSignoff | undefined; isLoading: boolean; isError: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const title = document.querySelector(".bookings-detail-panel .bookings-photo-review-title");
    const photoSection = title?.closest(".bookings-editor-section");
    const parent = photoSection?.parentElement;
    if (!photoSection || !parent) {
      setHost(null);
      return;
    }
    const nextHost = document.createElement("div");
    nextHost.className = "bookings-signoff-review-host";
    parent.insertBefore(nextHost, photoSection.nextSibling);
    setHost(nextHost);
    return () => nextHost.remove();
  }, [bookingKey]);
  const responseLabel = signoff?.customerResponse === "great" ? "Everything looks great" : signoff?.customerResponse === "touchup" ? "Needs one touch-up" : "Major issue";
  if (!host) return null;
  return createPortal(<section className="bookings-editor-section bookings-signoff-review"><div className="bookings-photo-review-title"><div><small>CUSTOMER SIGN-OFF</small><h3>Visit confirmation</h3><p>Captured by the cleaner after the visit.</p></div></div>{isLoading ? <div className="bookings-photo-review-empty"><Loader2 className="animate-spin" />Loading sign-off…</div> : isError ? <div className="bookings-photo-review-empty error">Customer sign-off could not be loaded for this booking.</div> : !signoff ? <div className="bookings-photo-review-empty">No customer sign-off recorded.</div> : signoff.customerNotHome ? <div className="bookings-signoff-not-home">Customer was not home — sign-off bypassed.</div> : <div className="bookings-signoff-summary"><div><small>SATISFACTION</small><strong className={`bookings-signoff-response ${signoff.customerResponse ?? "issue"}`}>{responseLabel}</strong></div>{signoff.customerNotes && <div><small>CUSTOMER NOTES</small><p>{signoff.customerNotes}</p></div>}{signoff.signatureUrl && <div><small>SIGNATURE</small><img src={signoff.signatureUrl} alt="Customer signature" /></div>}</div>}</section>, host);
}

function BookingListRow({ row, selected, onSelect }: { row: WorkspaceRow; selected: boolean; onSelect: () => void }) {
  const home = row.source === "portal" ? "Service request" : row.bedrooms === null || row.bathrooms === null ? "Details in progress" : row.bedrooms === 0 ? `Studio · ${row.bathrooms} baths` : `${row.bedrooms} bed · ${row.bathrooms} baths`;
  const hasCard = row.paymentStatus === "card_on_file" || row.paymentStatus === "captured";
  const sourceMissing = row.status === "missing_from_launch27";
  return <button type="button" className={`bookings-row${selected ? " selected" : ""}${sourceMissing ? " source-missing" : ""}`} onClick={onSelect}>
    <span className="bookings-customer-cell"><b>{row.requestedLocalTime ? displayRequestedTime(row.requestedLocalTime) : "Lead"}</b><i className={sourceMissing ? "bookings-status-dot source-missing" : row.status === "lead" || row.status === "needs_attention" ? "bookings-status-dot attention" : "bookings-status-dot"} /><span><strong>{row.customerName}</strong><small><MapPin /> {row.address ?? "Details in progress"}</small></span></span>
    <span className="bookings-service-cell"><strong>{row.serviceName ?? "Booking lead"}</strong><small>{home}{row.recurrence ? ` · ${labelRecurrence(row.recurrence)}` : ""}</small>{sourceMissing ? <em className="bookings-source-missing-label">No longer in Launch27</em> : row.source === "funnel" ? <em>{labelStatus(row.status)}</em> : row.source === "portal" ? <em>Service request</em> : row.source === "leadflow" ? <em>Launch27 import</em> : row.extras.length > 0 && <em>+{row.extras.length} extra{row.extras.length > 1 ? "s" : ""}</em>}</span>
    <span className="bookings-team-cell"><i className="bookings-team-avatar gray">?</i><span><strong>{row.assignedTeamName ?? (row.assignmentStatus === "assigned" ? "Assigned" : "Unassigned")}</strong><small>{sourceMissing ? "Review source removal" : row.assignmentStatus === "assigned" ? "Team assigned" : "Needs review"}</small></span></span>
    <span className={hasCard ? "bookings-payment-ok" : "bookings-payment-missing"}><CreditCard />{row.paymentStatus === "captured" ? "Paid" : hasCard ? `${row.paymentBrand ?? "Card"}${row.paymentLast4 ? ` •••• ${row.paymentLast4}` : " on file"}` : "Not started"}</span>
    <strong className="bookings-row-price">{row.firstCleaningTotalCents === null ? "—" : `$${(row.firstCleaningTotalCents / 100).toFixed(0)}`}</strong><MoreHorizontal />
  </button>;
}

export default function NativeBookingsWorkspace({ realtimeEnabled }: { realtimeEnabled: boolean }) {
  const [view, setView] = useState<"bookings" | "leads">("bookings");
  const [activeKey, setRawActiveKey] = useState<string | null>(null);
  const detailDismissedRef = useRef(false);
  const setActiveKey = (key: string | null) => {
    detailDismissedRef.current = key === null;
    setRawActiveKey(key);
  };
  const [date, setDate] = useState(businessDate);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [photoLightbox, setPhotoLightbox] = useState<{ label: "Before" | "After"; photos: StaffJobPhoto[]; index: number } | null>(null);
  const listInput = useMemo(() => ({ date, status: status === "All" ? undefined : API_STATUS[status], query: query.trim() || undefined, limit: 200 }), [date, query, status]);
  const funnelListInput = useMemo(() => ({ query: query.trim() || undefined, limit: 200 }), [query]);
  const listQuery = trpc.bookings.list.useQuery(listInput, { staleTime: 10_000 });
  const funnelListQuery = trpc.bookingFunnel.list.useQuery(funnelListInput, { staleTime: 10_000 });
  const portalRequestsQuery = trpc.customerPortal.staffRequests.useQuery({ limit: 200 }, { staleTime: 10_000 });
  const leadflowJobsQuery = trpc.leadflowJobs.list.useQuery({ date, query: query.trim() || undefined }, { staleTime: 10_000 });
  const leadflowJobsImportStatus = trpc.leadflowJobs.importStatus.useQuery(undefined, { staleTime: 10_000 });
  const importLeadflowJobs = trpc.leadflowJobs.importNextThirtyDays.useMutation();
  const syncLeadflowJobsDate = trpc.leadflowJobs.syncDate.useMutation();
  const refreshLeadflowJobDetails = trpc.leadflowJobs.refreshImportedDetails.useMutation();
  const updateLeadflowJob = trpc.leadflowJobs.update.useMutation();
  const customerMagicLink = trpc.customerPortal.staffMagicLink.useMutation({
    onSuccess: ({ url }) => {
      if (!navigator.clipboard?.writeText) {
        setImportSummary(`Customer My Home link: ${url}`);
        return;
      }
      void navigator.clipboard.writeText(url).then(() => {
        setImportSummary("Customer My Home link copied.");
      }).catch(() => {
        setImportSummary(`Customer My Home link: ${url}`);
      });
    },
    onError: (error) => setImportSummary(`Customer My Home link could not be created: ${error.message}`),
  });
  const cancelLeadflowJob = trpc.leadflowJobs.cancel.useMutation();
  const cancelBooking = trpc.bookings.cancel.useMutation();
  const cancelFunnel = trpc.bookingFunnel.cancel.useMutation();
  const cancelPortalRequest = trpc.customerPortal.cancelStaffRequest.useMutation();
  const selectedBookingId = activeKey?.startsWith("booking:") ? Number(activeKey.slice("booking:".length)) : null;
  const selectedFunnelId = activeKey?.startsWith("funnel:") ? Number(activeKey.slice("funnel:".length)) : null;
  const detailQuery = trpc.bookings.get.useQuery({ id: selectedBookingId ?? 0 }, { enabled: selectedBookingId !== null, staleTime: 10_000 });
  const funnelDetailQuery = trpc.bookingFunnel.get.useQuery({ id: selectedFunnelId ?? 0 }, { enabled: selectedFunnelId !== null, staleTime: 10_000 });
  const hasConnectedRef = useRef(false);

  const refreshBookingAndFunnelQueries = () => {
    void funnelListQuery.refetch();
    if (selectedFunnelId !== null) void funnelDetailQuery.refetch();
    void listQuery.refetch();
    void portalRequestsQuery.refetch();
    void leadflowJobsQuery.refetch();
    if (selectedBookingId !== null) void detailQuery.refetch();
  };
  useOpsStream({
    onBookingFunnelUpdate: refreshBookingAndFunnelQueries,
    onConnected: () => {
      if (!hasConnectedRef.current) {
        hasConnectedRef.current = true;
        return;
      }
      refreshBookingAndFunnelQueries();
    },
  }, { enabled: realtimeEnabled, label: "NativeBookings" });

  const bookings = listQuery.data ?? [];
  const funnelLeads = funnelListQuery.data ?? [];
  const portalRequests = portalRequestsQuery.data ?? [];
  const rows = useMemo<WorkspaceRow[]>(() => {
    const bookingRows = bookings.filter((booking) => !isCancelledBookingStatus(booking.status)).map((booking) => ({
      key: `booking:${booking.id}`, source: "booking" as const, id: booking.id, publicNumber: booking.publicBookingNumber,
      customerName: booking.customerName, customerPhone: booking.customerPhone, customerEmail: booking.customerEmail,
      status: booking.status, requestedLocalDate: booking.requestedLocalDate, requestedLocalTime: booking.requestedLocalTime,
      address: booking.address, serviceName: booking.serviceName, bedrooms: booking.bedrooms, bathrooms: booking.bathrooms,
      recurrence: booking.recurrence, extras: extrasFrom(booking.extras), specialRequestNotes: notesFrom(booking.specialRequestNotes),
      assignmentStatus: booking.assignmentStatus, assignedTeamName: null, paymentStatus: booking.paymentStatus, paymentBrand: null, paymentLast4: null,
      stripePaymentMethodId: null, paymentChargedAt: null, firstCleaningTotalCents: booking.firstCleaningTotalCents,
    }));
    const funnelRows = funnelLeads.filter((lead) => !lead.bookingId).map((lead) => ({
      key: `funnel:${lead.id}`, source: "funnel" as const, id: lead.id, publicNumber: lead.publicFunnelNumber,
      customerName: lead.customerName, customerPhone: lead.customerPhone, customerEmail: lead.customerEmail,
      status: lead.stage, requestedLocalDate: lead.requestedLocalDate, requestedLocalTime: lead.requestedLocalTime,
      address: lead.address, serviceName: lead.serviceName, bedrooms: lead.bedrooms, bathrooms: lead.bathrooms,
      recurrence: lead.recurrence, extras: funnelExtrasFrom(lead.extras), specialRequestNotes: notesFrom(lead.specialRequestNotes),
      assignmentStatus: "unassigned", assignedTeamName: null, paymentStatus: lead.paymentLast4 ? "card_on_file" : "not_started", paymentBrand: null,
      paymentLast4: lead.paymentLast4, stripePaymentMethodId: null, paymentChargedAt: null, firstCleaningTotalCents: lead.firstCleaningTotalCents,
    }));
    const inProgressFunnelRows = funnelRows.filter((row) => row.status === "lead");
    const portalRequestRows = portalRequests.filter((request) => !isCancelledBookingStatus(request.status)).map((request) => ({
      key: `portal:${request.id}`, source: "portal" as const, id: request.id, publicNumber: request.publicRequestNumber,
      customerName: request.customerName, customerPhone: request.customerPhone, customerEmail: request.customerEmail,
      status: request.status, requestedLocalDate: request.requestedLocalDate, requestedLocalTime: request.requestedLocalTime,
      address: request.address, serviceName: request.serviceName, bedrooms: null, bathrooms: null, recurrence: null,
      extras: [], specialRequestNotes: request.customerRequest ? [request.customerRequest] : [], assignmentStatus: "unassigned", assignedTeamName: null,
      paymentStatus: request.paymentChargedAt ? "captured" : request.stripePaymentMethodId && request.paymentLast4 ? "card_on_file" : "not_started",
      paymentBrand: request.paymentBrand, paymentLast4: request.paymentLast4, stripePaymentMethodId: request.stripePaymentMethodId,
      paymentChargedAt: request.paymentChargedAt, firstCleaningTotalCents: request.estimatedTotalCents,
    }));
    const importedRows = (leadflowJobsQuery.data ?? []).filter((job) => !isCancelledBookingStatus(job.bookingStatus)).map((job) => ({
      key: `leadflow:job:${job.id}`, source: "leadflow" as const, id: job.id, publicNumber: `L27-${job.launch27BookingId ?? job.id}`,
      customerName: job.customerName, customerPhone: job.customerPhone ?? "", customerEmail: job.customerEmail,
      status: job.bookingStatus, requestedLocalDate: job.jobDate, requestedLocalTime: importedTimeFrom(job.serviceDateTime),
      address: job.jobAddress, serviceName: job.serviceName, bedrooms: job.bedrooms, bathrooms: job.bathrooms,
      recurrence: job.frequency, extras: importedExtrasFrom(job.extras), specialRequestNotes: job.customerNotes ? [job.customerNotes] : [],
      assignmentStatus: job.teamName ? "assigned" : "unassigned", assignedTeamName: job.teamName, paymentStatus: job.hasStripeCard ? "card_on_file" : "not_started", paymentBrand: job.paymentBrand,
      paymentLast4: job.paymentLast4, stripePaymentMethodId: null, paymentChargedAt: null, firstCleaningTotalCents: job.jobTotalCents,
    }));
    const scheduledRows = [...funnelRows.filter((row) => row.status !== "lead" && !isCancelledBookingStatus(row.status)), ...bookingRows, ...importedRows]
      .filter((row) => row.requestedLocalDate === date)
      .filter((row) => row.source !== "leadflow" || status === "All" || status === "Confirmed");
    if (view === "bookings") return [...inProgressFunnelRows, ...portalRequestRows, ...scheduledRows];
    return inProgressFunnelRows;
  }, [bookings, date, funnelLeads, leadflowJobsQuery.data, portalRequests, status, view]);

  useEffect(() => {
    if (!rows.length) return setRawActiveKey(null);
    if (activeKey !== null && rows.some((row) => row.key === activeKey)) return;
    if (!detailDismissedRef.current) setActiveKey(rows[0].key);
  }, [activeKey, rows]);

  const active = useMemo<WorkspaceRow | null>(() => {
    if (selectedBookingId !== null && detailQuery.data) {
      const booking = detailQuery.data;
      return {
        key: `booking:${booking.id}`, source: "booking", id: booking.id, publicNumber: booking.publicBookingNumber,
        customerName: booking.customerName, customerPhone: booking.customerPhone, customerEmail: booking.customerEmail,
        status: booking.status, requestedLocalDate: booking.requestedLocalDate, requestedLocalTime: booking.requestedLocalTime,
        address: booking.address, serviceName: booking.serviceName, bedrooms: booking.bedrooms, bathrooms: booking.bathrooms,
        recurrence: booking.recurrence, extras: extrasFrom(booking.extras), specialRequestNotes: notesFrom(booking.specialRequestNotes),
        assignmentStatus: booking.assignmentStatus, assignedTeamName: null, paymentStatus: booking.paymentStatus, paymentBrand: null, paymentLast4: null,
        stripePaymentMethodId: null, paymentChargedAt: null, firstCleaningTotalCents: booking.firstCleaningTotalCents,
      };
    }
    if (selectedFunnelId !== null && funnelDetailQuery.data) {
      const lead = funnelDetailQuery.data;
      return {
        key: `funnel:${lead.id}`, source: "funnel", id: lead.id, publicNumber: lead.publicFunnelNumber,
        customerName: lead.customerName, customerPhone: lead.customerPhone, customerEmail: lead.customerEmail,
        status: lead.stage, requestedLocalDate: lead.requestedLocalDate, requestedLocalTime: lead.requestedLocalTime,
        address: lead.address, serviceName: lead.serviceName, bedrooms: lead.bedrooms, bathrooms: lead.bathrooms,
        recurrence: lead.recurrence, extras: funnelExtrasFrom(lead.extras), specialRequestNotes: notesFrom(lead.specialRequestNotes),
        assignmentStatus: "unassigned", assignedTeamName: null, paymentStatus: lead.paymentLast4 ? "card_on_file" : "not_started", paymentBrand: null,
        paymentLast4: lead.paymentLast4, stripePaymentMethodId: null, paymentChargedAt: null, firstCleaningTotalCents: lead.firstCleaningTotalCents,
      };
    }
    return rows.find((row) => row.key === activeKey) ?? null;
  }, [activeKey, detailQuery.data, funnelDetailQuery.data, rows, selectedBookingId, selectedFunnelId]);
  const copyCustomerMagicLink = () => {
    if (!active?.customerName || !active.customerPhone) {
      setImportSummary("Customer name and phone number are required to create a My Home link.");
      return;
    }
    customerMagicLink.mutate({
      customerName: active.customerName,
      customerPhone: active.customerPhone,
      customerEmail: active.customerEmail,
    });
  };
  const activePhotoBookingKey = active ? `${active.source}:${active.id}` : "leadflow:0";
  const staffPhotosQuery = trpc.leadflowJobs.staffPhotos.useQuery({ bookingKey: activePhotoBookingKey }, { enabled: active !== null, staleTime: 10_000 });
  const staffSignoffQuery = trpc.leadflowJobs.staffSignoff.useQuery({ bookingKey: activePhotoBookingKey }, { enabled: active !== null, staleTime: 10_000 });
  const staffPhotos = staffPhotosQuery.data ?? [];
  const beforePhotos = staffPhotos.filter(photo => photo.photoType === "before");
  const afterPhotos = staffPhotos.filter(photo => photo.photoType === "after" || photo.photoType === "general");
  const activePhoto = photoLightbox ? photoLightbox.photos[photoLightbox.index] : null;

  useEffect(() => {
    if (!photoLightbox) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPhotoLightbox(null);
      if (event.key === "ArrowLeft") setPhotoLightbox(current => current && current.index > 0 ? { ...current, index: current.index - 1 } : current);
      if (event.key === "ArrowRight") setPhotoLightbox(current => current && current.index < current.photos.length - 1 ? { ...current, index: current.index + 1 } : current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [photoLightbox]);

  useEffect(() => {
    setRescheduleDate(active?.source === "leadflow" ? active.requestedLocalDate ?? "" : "");
  }, [active?.key, active?.requestedLocalDate, active?.source]);

  const dates = useMemo(() => [-1, 0, 1, 2].map((offset) => shiftDate(date, offset)), [date]);
  const activeBookingRows = useMemo(() => rows.filter(isActiveBookingRow), [rows]);
  const metricRows = view === "bookings" ? activeBookingRows : rows;
  const revenueCents = metricRows.reduce((total, row) => total + (row.firstCleaningTotalCents ?? 0), 0);
  const assigned = metricRows.filter((row) => row.assignmentStatus === "assigned").length;
  const cards = metricRows.filter((row) => row.paymentStatus === "card_on_file" || row.paymentStatus === "captured").length;
  const portalPaymentAvailable = active?.source === "portal" && Boolean(active.stripePaymentMethodId && active.paymentLast4 && active.firstCleaningTotalCents !== null);
  const cancellationPending = cancelLeadflowJob.isPending || cancelBooking.isPending || cancelFunnel.isPending || cancelPortalRequest.isPending;
  const cancelActiveRecord = () => {
    if (!active || cancellationPending) return;
    const onSuccess = () => {
      setImportSummary(`${active.customerName}'s booking was cancelled.`);
      setActiveKey(null);
      refreshBookingAndFunnelQueries();
    };
    const onError = (error: Error) => setImportSummary(`Cancellation failed: ${error.message}`);
    if (active.source === "leadflow") {
      cancelLeadflowJob.mutate({ jobId: active.id }, { onSuccess, onError });
      return;
    }
    if (active.source === "booking") {
      cancelBooking.mutate({ id: active.id }, { onSuccess, onError });
      return;
    }
    if (active.source === "funnel") {
      cancelFunnel.mutate({ id: active.id }, { onSuccess, onError });
      return;
    }
    cancelPortalRequest.mutate({ id: active.id }, { onSuccess, onError });
  };

  return <main className={`bookings-ops-shell ${active ? "has-detail" : ""}`}>
    {active && <BookingSignoffReview bookingKey={activePhotoBookingKey} signoff={staffSignoffQuery.data} isLoading={staffSignoffQuery.isLoading} isError={staffSignoffQuery.isError} />}
    <section className="bookings-ops-main">
      <header className="bookings-ops-header"><div><p>OPERATIONS · BOOKINGS</p><h1>Bookings</h1><span>{view === "bookings" ? "Native requests and isolated Launch27 imports appear here for review." : "Phone-captured booking leads appear here while customers finish the flow."}</span>{importSummary && <p>{importSummary}</p>}{importLeadflowJobs.error && <p role="alert">Import failed: {importLeadflowJobs.error.message}</p>}{refreshLeadflowJobDetails.error && <p role="alert">Launch27 detail refresh failed: {refreshLeadflowJobDetails.error.message}</p>}</div><button type="button" className="bookings-new-booking" disabled title="Manual booking creation is not connected in this release"><Plus />New booking</button><button type="button" className="bookings-new-booking" disabled={refreshLeadflowJobDetails.isPending} onClick={() => refreshLeadflowJobDetails.mutate(undefined, { onSuccess: (result) => { setImportSummary(`Launch27 details: ${result.refreshed}/${result.checked} jobs refreshed; ${result.dateErrors} day errors.`); void leadflowJobsQuery.refetch(); } })}><CreditCard />{refreshLeadflowJobDetails.isPending ? "Refreshing…" : "Refresh team & card details"}</button><button type="button" className="bookings-new-booking" disabled={importLeadflowJobs.isPending || leadflowJobsImportStatus.data?.completed === true} title={leadflowJobsImportStatus.data?.completed ? "The initial 30-day Launch27 import is complete." : undefined} onClick={() => importLeadflowJobs.mutate(undefined, { onSuccess: (result) => { setImportSummary(`30-day import: ${result.totals.active} active jobs; ${result.totals.created} added; ${result.totals.updated} refreshed; ${result.totals.errors} day errors.`); void leadflowJobsQuery.refetch(); void leadflowJobsImportStatus.refetch(); } })}><CalendarDays />{importLeadflowJobs.isPending ? "Importing…" : leadflowJobsImportStatus.data?.completed ? "Initial import completed" : "Import next 30 days"}</button></header>
      <div className="bookings-toolbar"><div className="bookings-status-tabs" aria-label="Bookings workspace view"><button type="button" className={view === "bookings" ? "active" : ""} onClick={() => setView("bookings")}>Bookings</button><button type="button" className={view === "leads" ? "active" : ""} onClick={() => setView("leads")}>Leads</button></div>{view === "bookings" && <><button type="button" className="bookings-filter-button" disabled={syncLeadflowJobsDate.isPending} onClick={() => syncLeadflowJobsDate.mutate({ date }, { onSuccess: (result) => { setImportSummary(`Launch27 ${result.date}: ${result.active} active jobs; ${result.created} added; ${result.updated} updated; ${result.sourceMissing} marked no longer in Launch27; ${result.alreadyPresent} already present.`); void leadflowJobsQuery.refetch(); } })}><CalendarDays />{syncLeadflowJobsDate.isPending ? "Syncing…" : `Sync ${displayDate(date)}`}</button><button type="button" className="bookings-filter-button" disabled={!active || cancellationPending} onClick={cancelActiveRecord}><X />{cancellationPending ? "Cancelling…" : "Cancel selected booking"}</button></>}</div>
      {view === "bookings" && <div className="bookings-date-rail" aria-label="Select booking date">{dates.map((option) => { const item = dateAtNoon(option); return <button type="button" key={option} className={date === option ? "date-active" : ""} onClick={() => setDate(option)}><small>{item.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</small><strong>{item.getDate()}</strong>{date === option && <i />}</button>; })}<label><CalendarDays /><input aria-label="Choose booking date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label></div>}
      <div className="bookings-metric-row" aria-label="Booking metrics"><article><span className="bookings-metric-icon coral"><CalendarDays /></span><div><small>{view === "bookings" ? "BOOKINGS" : "LEADS"}</small><strong>{metricRows.length}</strong><p>{view === "bookings" ? "on selected date" : "in progress"}</p></div></article><article><span className="bookings-metric-icon violet"><Users /></span><div><small>TEAMS ASSIGNED</small><strong>{assigned}<em>/{metricRows.length}</em></strong><p>{metricRows.length - assigned ? `${metricRows.length - assigned} needs a team` : "Everything covered"}</p></div></article><article><span className="bookings-metric-icon green"><CreditCard /></span><div><small>CARDS ON FILE</small><strong>{cards}<em>/{metricRows.length}</em></strong><p>{metricRows.length - cards ? `${metricRows.length - cards} not started` : "All secured"}</p></div></article><article><span className="bookings-metric-icon gold">$</span><div><small>REVENUE</small><strong>${(revenueCents / 100).toLocaleString()}</strong><p>active first-clean totals</p></div></article></div>
      <div className="bookings-toolbar"><div className="bookings-search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, address, or request number" /></div>{view === "bookings" ? <div className="bookings-status-tabs">{(["All", "Confirmed", "Needs attention", "Completed"] as const).map((option) => <button type="button" key={option} className={status === option ? "active" : ""} onClick={() => setStatus(option)}>{option}</button>)}</div> : <div className="bookings-status-tabs"><button type="button" className="active">Lead / In progress</button></div>}<button type="button" className="bookings-filter-button" disabled><Filter />Filters</button></div>
      <div className="bookings-list" aria-label={view === "bookings" ? "LeadFlow bookings list" : "Native LeadFlow leads list"}><div className="bookings-list-head"><span>TIME & CUSTOMER</span><span>SERVICE</span><span>TEAM</span><span>PAYMENT</span><span>TOTAL</span><span /></div>{(listQuery.isLoading || funnelListQuery.isLoading || leadflowJobsQuery.isLoading) ? <div className="bookings-empty-day"><Loader2 className="animate-spin" /><h3>Loading {view}</h3></div> : (listQuery.error || funnelListQuery.error || leadflowJobsQuery.error) ? <div className="bookings-empty-day"><X /><h3>Could not load {view}</h3><p>{listQuery.error?.message ?? funnelListQuery.error?.message ?? leadflowJobsQuery.error?.message}</p></div> : rows.length ? rows.map((row) => <BookingListRow key={row.key} row={row} selected={activeKey === row.key} onSelect={() => setActiveKey(row.key)} />) : <div className="bookings-empty-day"><CalendarDays /><h3>No {view} found</h3><p>{view === "bookings" ? "Try another date or clear your filters." : "New phone-captured leads will appear here."}</p></div>}</div>
    </section>
    {active && <aside className="bookings-detail-panel" aria-label={`Booking details for ${active.customerName}`}><header><div><small>{active.publicNumber}</small><h2>{active.customerName}</h2><span className={active.status === "lead" || active.status === "needs_attention" ? "bookings-detail-status attention" : "bookings-detail-status"}>{labelStatus(active.status)}</span></div><button type="button" onClick={() => setActiveKey(null)} aria-label="Close booking detail panel"><X /></button></header><div className="bookings-detail-scroll"><section className="bookings-detail-summary"><div><CalendarDays /><span><small>REQUESTED TIME</small><strong>{active.requestedLocalTime && active.requestedLocalDate ? `${displayTime(active.requestedLocalTime)} · ${displayDate(active.requestedLocalDate)}` : "Not selected yet"}</strong></span></div><div><MapPin /><span><small>ADDRESS</small><strong>{active.address ?? "Not entered yet"}</strong></span></div></section><section className="bookings-editor-section"><div className="bookings-section-title"><div><small>SERVICE & EXTRAS</small><h3>{active.serviceName ?? "Booking details in progress"}</h3></div><strong>{active.firstCleaningTotalCents === null ? "—" : `$${(active.firstCleaningTotalCents / 100).toFixed(0)}`}</strong></div><p className="bookings-home-line">{active.bedrooms === null || active.bathrooms === null ? "Room details not entered yet" : `${active.bedrooms === 0 ? "Studio" : `${active.bedrooms} bedrooms`} · ${active.bathrooms} bathrooms`}</p><div className="bookings-selected-extras">{active.extras.length ? active.extras.map((extra) => <button type="button" disabled key={extra.id}>{extra.label}{extra.quantity > 1 ? ` × ${extra.quantity}` : ""}</button>) : <button type="button" disabled>Nothing extra</button>}</div></section><section className="bookings-editor-section"><small>RECURRING PREFERENCE</small>{active.source === "leadflow" ? <div className="bookings-choice-grid">{(["One time", "Weekly", "Bi-weekly", "Tri-weekly", "Monthly"] as const).map((frequency) => <button type="button" key={frequency} className={active.recurrence?.toLowerCase().replace(/-/g, "").startsWith(frequency.toLowerCase().replace("-", "")) ? "choice-active" : ""} disabled={updateLeadflowJob.isPending} onClick={() => updateLeadflowJob.mutate({ jobId: active.id, frequency }, { onSuccess: refreshBookingAndFunnelQueries })}>{frequency}</button>)}</div> : <div className="bookings-choice-grid"><button type="button" className="choice-active" disabled>{active.recurrence ? labelRecurrence(active.recurrence) : "Not selected"}</button></div>}<p className="bookings-editor-hint">{active.source === "leadflow" ? "The selected interval creates the next LeadFlow job at end of the service day." : !active.recurrence ? "Preference not entered yet." : active.recurrence === "one-time" ? "One-time request." : "No future visits were created. Confirm the recurring plan during review."}</p></section><section className="bookings-editor-section"><small>ASSIGNED TEAM</small><div className="bookings-team-select"><button type="button" className="bookings-team-option active" disabled><i className="bookings-team-avatar gray">?</i><span><strong>{active.assignedTeamName ?? "Unassigned"}</strong><small>{active.assignedTeamName ? "Launch27 assignment" : "No team assigned"}</small></span></button></div></section><section className="bookings-editor-section"><small>PAYMENT</small>{active.source === "leadflow" ? <div className={active.paymentStatus === "card_on_file" ? "bookings-card-panel" : "bookings-card-panel missing"}><CreditCard /><div><strong>{active.paymentStatus === "card_on_file" ? `${active.paymentBrand ?? "Card"}${active.paymentLast4 ? ` •••• ${active.paymentLast4}` : " on file"}` : "No card on file"}</strong><p>Imported from Launch27. Payment actions remain unchanged.</p></div></div> : active.source === "booking" && active.firstCleaningTotalCents !== null ? <BookingPaymentActions bookingId={active.id} totalCents={active.firstCleaningTotalCents} paymentStatus={active.paymentStatus} /> : portalPaymentAvailable && active.firstCleaningTotalCents !== null ? <PortalRequestPaymentActions requestId={active.id} totalCents={active.firstCleaningTotalCents} onPaymentUpdated={refreshBookingAndFunnelQueries} /> : <div className="bookings-card-panel missing"><CreditCard /><div><strong>Payment not started</strong><p>Card collection is not connected for this in-progress lead.</p></div></div>}</section><section className="bookings-editor-section"><div className="bookings-photo-review-title"><div><small>CLEANER PHOTOS</small><h3>Before & after</h3><p>Uploaded from the cleaner visit portal.</p></div><ImageIcon /></div>{staffPhotosQuery.isLoading ? <div className="bookings-photo-review-empty"><Loader2 className="animate-spin" />Loading photos…</div> : staffPhotosQuery.isError ? <div className="bookings-photo-review-empty error">Photos could not be loaded for this booking.</div> : <div className="bookings-photo-review-groups">{([{ label: "Before", detail: "Visit condition", photos: beforePhotos }, { label: "After", detail: "Finished result", photos: afterPhotos }] as const).map(group => <section className={`bookings-photo-review-group ${group.label === "After" ? "after" : ""}`} key={group.label}><header><div><strong>{group.label}</strong><span>{group.detail}</span></div><small>{group.photos.length} photo{group.photos.length === 1 ? "" : "s"}</small></header>{group.photos.length ? <div className="bookings-photo-review-grid">{group.photos.map((photo, index) => <button type="button" key={photo.id} className="bookings-photo-review-thumb" onClick={() => setPhotoLightbox({ label: group.label, photos: group.photos, index })} aria-label={`Open ${group.label.toLowerCase()} photo ${index + 1}`}><img src={photo.thumbnailUrl ?? photo.photoUrl} alt={`${group.label} photo ${index + 1}`} /><span>View</span></button>)}</div> : <div className="bookings-photo-review-empty">No {group.label.toLowerCase()} photos uploaded.</div>}</section>)}</div>}</section><section className="bookings-editor-section"><small>CUSTOMER</small><p className="bookings-home-line">{active.customerPhone}<br />{active.customerEmail ?? "Email not entered yet"}</p><div className="bookings-customer-actions"><button type="button" disabled={customerMagicLink.isPending || !active.customerName || !active.customerPhone} onClick={copyCustomerMagicLink} title={active.customerName && active.customerPhone ? "Copy this customer's reusable one-year My Home link" : "Customer name and phone number are required"}>{customerMagicLink.isPending ? <Loader2 className="animate-spin" /> : <Copy />} {customerMagicLink.isPending ? "Copying…" : "Copy Customer My Home Link"}</button></div></section><section className="bookings-editor-section"><small>NOTES & SPECIAL REQUESTS</small><textarea value={active.specialRequestNotes.join("\n")} readOnly placeholder="No special requests" /><div className="bookings-customer-actions"><button type="button" disabled><MessageCircle />Text customer</button>{active.source === "leadflow" ? <div><label><CalendarDays />Reschedule <input type="date" value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} /></label><button type="button" disabled={!rescheduleDate || rescheduleDate === active.requestedLocalDate || updateLeadflowJob.isPending} onClick={() => updateLeadflowJob.mutate({ jobId: active.id, jobDate: rescheduleDate }, { onSuccess: refreshBookingAndFunnelQueries })}>Save date</button></div> : <button type="button" disabled><CalendarDays />Reschedule</button>}</div></section></div><footer><button type="button" className="bookings-cancel-button" disabled={cancellationPending} onClick={cancelActiveRecord}>{cancellationPending ? "Cancelling…" : "Cancel booking"}</button><button type="button" className="bookings-save-button" disabled>Save changes</button></footer></aside>}
    {photoLightbox && activePhoto && <div className="bookings-photo-lightbox" role="dialog" aria-modal="true" aria-label={`${photoLightbox.label} photo viewer`} onClick={() => setPhotoLightbox(null)}><div className="bookings-photo-lightbox__toolbar"><span>{photoLightbox.label} · {photoLightbox.index + 1} of {photoLightbox.photos.length}</span><a href={photoDownloadUrl(activePhoto, photoLightbox.index)} onClick={event => event.stopPropagation()}><Download />Download original</a><button type="button" onClick={() => setPhotoLightbox(null)} aria-label="Close photo viewer"><X /></button></div>{photoLightbox.index > 0 && <button type="button" className="bookings-photo-lightbox__previous" onClick={event => { event.stopPropagation(); setPhotoLightbox(current => current && current.index > 0 ? { ...current, index: current.index - 1 } : current); }} aria-label="Previous photo"><ChevronLeft /></button>}{photoLightbox.index < photoLightbox.photos.length - 1 && <button type="button" className="bookings-photo-lightbox__next" onClick={event => { event.stopPropagation(); setPhotoLightbox(current => current && current.index < current.photos.length - 1 ? { ...current, index: current.index + 1 } : current); }} aria-label="Next photo"><ChevronRight /></button>}<img src={activePhoto.photoUrl} alt={`${photoLightbox.label} cleaner photo`} onClick={event => event.stopPropagation()} /></div>}
  </main>;
}
